import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { encodeSpeechWav } from "../lib/speech";
import { SpeechPanel } from "./SpeechPanel";
import { formatSpeechShortcut, parseSpeechShortcut } from "../lib/speechShortcut";

const native = vi.hoisted(() => ({ status: vi.fn(), install: vi.fn(), remove: vi.fn(), transcribe: vi.fn(), cancel: vi.fn() }));
const microphone = vi.hoisted(() => ({ start: vi.fn(), finish: vi.fn(), cancel: vi.fn(), pause: vi.fn() }));
vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(),
  api: { speechEngineStatus: native.status, installSpeechEngine: native.install,
    removeSpeechEngine: native.remove, transcribeSpeech: native.transcribe, cancelSpeechOperation: native.cancel },
}));
vi.mock("../lib/speechCapture", () => ({
  SpeechCapture: class {
    seconds = 1; level = 0.2;
    start = microphone.start; finish = microphone.finish; cancel = microphone.cancel; pause = microphone.pause;
  },
}));
vi.mock("./AudioPlayback", () => ({ AudioPlayback: () => <span role="group" aria-label="Recorded audio preview" /> }));

const source = "Keep **this source** unchanged.";
const localEngine = {
  installed: true, modelCached: true, supported: true, model: "Synthetic local model", modelBytes: 742090464,
  runtimeBytes: 100, sourceUrl: "https://synthetic.invalid", licenseUrl: "https://synthetic.invalid/license", locales: ["auto", "en-US"],
};
const props = {
  pluginId: "denote.speech", workspaceScope: "/synthetic", path: "Synthetic.md", source,
  selection: { source, from: 0, to: 0, restore: () => {} }, readOnly: false,
  onInsert: vi.fn(), onSaveVoiceNote: vi.fn(async () => {}), onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  native.status.mockResolvedValue(localEngine);
  native.cancel.mockResolvedValue(undefined);
  native.install.mockResolvedValue(undefined);
  native.transcribe.mockResolvedValue({ text: "An invented transcript.", words: [{ text: "Invented", startMs: 0, endMs: 200 }] });
  microphone.start.mockResolvedValue(undefined);
  microphone.cancel.mockResolvedValue(undefined);
  microphone.finish.mockImplementation(async () => encodeSpeechWav(new Float32Array([0.1, -0.1, 0.2])));
  vi.stubGlobal("speechSynthesis", { getVoices: () => [
    { voiceURI: "local-synthetic", name: "Synthetic local", lang: "en-US", localService: true, default: true },
    { voiceURI: "remote-synthetic", name: "Synthetic remote", lang: "en-US", localService: false, default: false },
  ], cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("speech privacy and explicit actions", () => {
  it("saves and resets the device shortcut without starting a microphone", async () => {
    const user = userEvent.setup();
    const change = vi.fn((value: string) => formatSpeechShortcut(parseSpeechShortcut(value, "MacIntel")));
    render(<SpeechPanel {...props} onShortcutChange={change} />);
    await user.click(screen.getByText("Dictation shortcut", { selector: "summary" }));
    const input = screen.getByRole("textbox", { name: "Dictation shortcut" });
    await user.clear(input); await user.type(input, "Control+Shift+D");
    await user.click(screen.getByRole("button", { name: "Save shortcut" }));
    expect(change).toHaveBeenLastCalledWith("Control+Shift+D");
    expect(input).toHaveValue("Ctrl+Shift+D");
    await user.click(screen.getByRole("button", { name: "Use Ctrl+Space" }));
    expect(change).toHaveBeenLastCalledWith("Ctrl+Space");
    expect(input).toHaveValue("Ctrl+Space");
    expect(microphone.start).not.toHaveBeenCalled();
  });

  it("cancels a queued model-check gesture before editing a shortcut", async () => {
    let ready: ((value: typeof localEngine) => void) | undefined;
    native.status.mockImplementation(() => new Promise<typeof localEngine>((resolve) => { ready = resolve; }));
    const user = userEvent.setup();
    render(<SpeechPanel {...props} dictationRequest={1} onShortcutChange={(value) => value} />);
    await screen.findByText("Checking the local model before dictation…");
    await user.click(screen.getByText("Dictation shortcut", { selector: "summary" }));
    await user.click(screen.getByRole("textbox", { name: "Dictation shortcut" }));
    await act(async () => { ready?.(localEngine); });
    expect(microphone.start).not.toHaveBeenCalled();
  });

  it("does not allow shortcut changes while microphone initialization is pending", async () => {
    let ready: (() => void) | undefined;
    microphone.start.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const user = userEvent.setup();
    const view = render(<SpeechPanel {...props} dictationRequest={1} onShortcutChange={(value) => value} />);
    await screen.findByText("Requesting microphone access…");
    await user.click(screen.getByText("Dictation shortcut", { selector: "summary" }));
    expect(screen.getByRole("textbox", { name: "Dictation shortcut" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save shortcut" })).toBeDisabled();
    view.unmount();
    await act(async () => { ready?.(); });
  });

  it("starts the first explicit shortcut once under Development StrictMode and still releases it on unmount", async () => {
    const view = render(<StrictMode><SpeechPanel {...props} dictationRequest={1} /></StrictMode>);
    await screen.findByText("Recording microphone audio");
    expect(microphone.start).toHaveBeenCalledOnce();
    view.unmount();
    expect(microphone.cancel).toHaveBeenCalledOnce();
  });

  it.each(["second shortcut", "configuration focus", "read mode", "suspension", "unmount"] as const)(
    "cancels a ready-model request before microphone acquisition on %s",
    async (cancellation) => {
      vi.useFakeTimers();
      const view = render(<SpeechPanel {...props} onShortcutChange={(value) => value} />);
      try {
        await act(async () => {});
        expect(screen.getByRole("button", { name: "Start dictation" })).toBeEnabled();
        view.rerender(<SpeechPanel {...props} dictationRequest={1} onShortcutChange={(value) => value} />);
        if (cancellation === "second shortcut") view.rerender(<SpeechPanel {...props} dictationRequest={2} />);
        else if (cancellation === "configuration focus") {
          act(() => screen.getByText("Dictation shortcut", { selector: "summary" }).focus());
        } else if (cancellation === "read mode") {
          view.rerender(<SpeechPanel {...props} dictationRequest={1} readOnly />);
        } else if (cancellation === "suspension") {
          view.rerender(<SpeechPanel {...props} dictationRequest={1} suspended />);
        } else view.unmount();
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(microphone.start).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        vi.useRealTimers();
      }
    },
  );

  it("does not carry a pending shortcut into another note scope", async () => {
    let ready: ((value: typeof localEngine) => void) | undefined;
    native.status.mockImplementation(() => new Promise<typeof localEngine>((resolve) => { ready = resolve; }));
    const view = render(<SpeechPanel {...props} dictationRequest={1} />);
    await screen.findByText("Checking the local model before dictation…");
    view.rerender(<SpeechPanel {...props} path="Other invented note.md" dictationRequest={1} />);
    await act(async () => { ready?.(localEngine); });
    expect(microphone.start).not.toHaveBeenCalled();
  });

  it("reads a live sidebar selection and never reuses stale source offsets for speech", async () => {
    const user = userEvent.setup();
    const captureSelection = vi.fn(() => ({ source, from: 7, to: 18, restore: () => {} }));
    const view = render(<SpeechPanel {...props} selection={null} captureSelection={captureSelection} />);
    await user.click(screen.getByRole("button", { name: "Read selection aloud" }));
    expect(window.speechSynthesis.speak).toHaveBeenCalledWith(expect.objectContaining({ text: "this source" }));
    view.rerender(<SpeechPanel {...props} source="An edited invented note." captureSelection={captureSelection} />);
    await user.click(screen.getByRole("button", { name: "Read selection aloud" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Select text in the note");
    expect(window.speechSynthesis.speak).toHaveBeenCalledOnce();
  });

  it("opens a non-modal sidebar and records without requiring an editor selection", async () => {
    const user = userEvent.setup();
    render(<SpeechPanel {...props} selection={null} />);
    expect(screen.getByRole("region", { name: "Speech" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("Recording microphone audio")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Finish recording" }));
    await user.click(await screen.findByRole("button", { name: "Save voice note" }));
    expect(props.onSaveVoiceNote).toHaveBeenCalledWith(expect.any(Uint8Array), source.length, source.length);
    expect(screen.queryByText(/Place the caret/)).not.toBeInTheDocument();
  });

  it("starts and finishes shortcut dictation, transcribes locally, and keeps insertion explicit", async () => {
    const user = userEvent.setup();
    const view = render(<SpeechPanel {...props} selection={null} dictationRequest={1} />);
    expect(await screen.findByText("Recording microphone audio")).toBeVisible();
    expect(microphone.start).toHaveBeenCalledOnce();
    view.rerender(<SpeechPanel {...props} selection={null} dictationRequest={2} />);
    const review = await screen.findByRole("textbox", { name: "Review transcript" });
    expect(review).toHaveValue("An invented transcript.");
    expect(native.transcribe).toHaveBeenCalledOnce();
    expect(props.onInsert).not.toHaveBeenCalled();
    expect(screen.getByText(/added to the end of this note/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Insert transcript" }));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("\n\nAn invented transcript.", source.length, source.length);
  });

  it("appends a reviewed transcript after an intervening note edit instead of replacing stale source", async () => {
    const user = userEvent.setup();
    const view = render(<SpeechPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await screen.findByText("Recording microphone audio");
    await user.click(screen.getByRole("button", { name: "Finish recording" }));
    await user.click(await screen.findByRole("button", { name: "Transcribe audio locally" }));
    await screen.findByRole("textbox", { name: "Review transcript" });
    const edited = `${source}\r\nAn intervening invented edit.  `;
    view.rerender(<SpeechPanel {...props} source={edited} />);
    await user.click(screen.getByRole("button", { name: "Insert transcript" }));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("\r\n\r\nAn invented transcript.", edited.length, edited.length);
  });

  it("does not start a microphone from a shortcut when the local model is missing", async () => {
    native.status.mockResolvedValue({
      installed: false, supported: true, model: "Synthetic model", modelBytes: 742090464,
      runtimeBytes: 100, locales: ["auto"],
    });
    render(<SpeechPanel {...props} dictationRequest={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Download the local model");
    expect(microphone.start).not.toHaveBeenCalled();
    expect(native.install).not.toHaveBeenCalled();
    expect(screen.getByText("Local transcription model").closest("details")).toHaveAttribute("open");
  });

  it("does not record in read mode and discards a pending shortcut on dialog suspension", async () => {
    const view = render(<SpeechPanel {...props} readOnly dictationRequest={1} />);
    await waitFor(() => expect(native.status).toHaveBeenCalledOnce());
    expect(microphone.start).not.toHaveBeenCalled();
    view.rerender(<SpeechPanel {...props} dictationRequest={2} />);
    await screen.findByText("Recording microphone audio");
    view.rerender(<SpeechPanel {...props} suspended dictationRequest={2} />);
    await waitFor(() => expect(microphone.cancel).toHaveBeenCalled());
    view.rerender(<SpeechPanel {...props} dictationRequest={2} />);
    expect(microphone.start).toHaveBeenCalledOnce();
    expect(screen.queryByText("Recording microphone audio")).not.toBeInTheDocument();
  });

  it("cancels pending microphone access with Escape and discards a late permission result", async () => {
    let granted: (() => void) | undefined;
    microphone.start.mockImplementation(() => new Promise<void>((resolve) => { granted = resolve; }));
    render(<SpeechPanel {...props} dictationRequest={1} />);
    await screen.findByText("Requesting microphone access…");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(microphone.cancel).toHaveBeenCalledOnce());
    await act(async () => { granted?.(); });
    expect(screen.queryByText("Recording microphone audio")).not.toBeInTheDocument();
    expect(props.onInsert).not.toHaveBeenCalled();
    expect(native.transcribe).not.toHaveBeenCalled();
  });

  it("uses a second shortcut to cancel requesting microphone initialization and rejects a late start", async () => {
    let granted: (() => void) | undefined;
    microphone.start.mockImplementation(() => new Promise<void>((resolve) => { granted = resolve; }));
    const view = render(<SpeechPanel {...props} dictationRequest={1} />);
    await screen.findByText("Requesting microphone access…");
    view.rerender(<SpeechPanel {...props} dictationRequest={2} />);
    await waitFor(() => expect(microphone.cancel).toHaveBeenCalledOnce());
    await act(async () => { granted?.(); });
    expect(screen.queryByText("Recording microphone audio")).not.toBeInTheDocument();
    expect(native.transcribe).not.toHaveBeenCalled();
    expect(props.onInsert).not.toHaveBeenCalled();
  });

  it("does not start delayed shortcut recording after the window loses focus", async () => {
    let ready: ((value: typeof localEngine) => void) | undefined;
    native.status.mockImplementation(() => new Promise<typeof localEngine>((resolve) => { ready = resolve; }));
    render(<SpeechPanel {...props} dictationRequest={1} />);
    await screen.findByText("Checking the local model before dictation…");
    fireEvent(window, new Event("blur"));
    await act(async () => { ready?.(localEngine); });
    expect(microphone.start).not.toHaveBeenCalled();
    expect(native.transcribe).not.toHaveBeenCalled();
  });

  it("lets a second shortcut cancel waiting for the local model without a late microphone start", async () => {
    let ready: ((value: typeof localEngine) => void) | undefined;
    native.status.mockImplementation(() => new Promise<typeof localEngine>((resolve) => { ready = resolve; }));
    const view = render(<SpeechPanel {...props} dictationRequest={1} />);
    await screen.findByText("Checking the local model before dictation…");
    view.rerender(<SpeechPanel {...props} dictationRequest={2} />);
    await screen.findByText("Dictation cancelled before microphone access.");
    await act(async () => { ready?.(localEngine); });
    expect(microphone.start).not.toHaveBeenCalled();
  });

  it("cancels finishing audio on teardown and ignores additional shortcut requests while flushing", async () => {
    let finish: ((value: Uint8Array) => void) | undefined;
    microphone.finish.mockImplementation(() => new Promise<Uint8Array>((resolve) => { finish = resolve; }));
    const view = render(<SpeechPanel {...props} dictationRequest={1} />);
    await screen.findByText("Recording microphone audio");
    view.rerender(<SpeechPanel {...props} dictationRequest={2} />);
    await screen.findByText("Finishing recording…");
    view.rerender(<SpeechPanel {...props} dictationRequest={3} />);
    expect(microphone.start).toHaveBeenCalledOnce();
    view.unmount();
    expect(microphone.cancel).toHaveBeenCalled();
    const late = encodeSpeechWav(new Float32Array([0.1, 0.2]));
    await act(async () => { finish?.(late); });
    expect(late.every((byte) => byte === 0)).toBe(true);
    expect(native.transcribe).not.toHaveBeenCalled();
  });

  it("does not turn a failed model check and later explicit download into deferred microphone consent", async () => {
    native.status.mockRejectedValueOnce(new Error("Synthetic model status failure."));
    const user = userEvent.setup();
    render(<SpeechPanel {...props} dictationRequest={1} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic model status failure.");
    await user.click(screen.getByText("Local transcription model"));
    await user.click(screen.getByRole("checkbox", { name: /I approve this download/ }));
    await user.click(screen.getByRole("button", { name: "Download local model and engine" }));
    await screen.findByText("Verified local speech model installed.");
    expect(microphone.start).not.toHaveBeenCalled();
    expect(native.install).toHaveBeenCalledOnce();
  });

  it("does not activate microphones or downloads on open and never offers a remote voice", async () => {
    render(<SpeechPanel {...props} />);
    await waitFor(() => expect(native.status).toHaveBeenCalled());
    expect(microphone.start).not.toHaveBeenCalled();
    expect(native.install).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "Synthetic local (en-US)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Synthetic remote/ })).not.toBeInTheDocument();
  });

  it("stops by keyboard and requires an editable transcript review before exact note insertion", async () => {
    const user = userEvent.setup();
    render(<SpeechPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    expect(await screen.findByText("Recording microphone audio")).toBeVisible();
    expect(microphone.start).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("button", { name: "Finish recording" }), { key: "Escape" });
    await screen.findByRole("group", { name: "Recorded audio preview" });
    expect(microphone.finish).toHaveBeenCalledTimes(1);
    expect(native.transcribe).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Transcribe audio locally" }));
    const review = await screen.findByLabelText("Review transcript");
    expect(review).toHaveValue("An invented transcript.");
    expect(props.onInsert).not.toHaveBeenCalled();
    await user.clear(review); await user.type(review, "Reviewed invented text.");
    await user.click(screen.getByRole("button", { name: "Insert transcript" }));
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("Reviewed invented text.", 0, 0);
    expect(props.onSaveVoiceNote).not.toHaveBeenCalled();
  });

  it("cancels native transcription on close and discards late results instead of resurrecting a draft", async () => {
    let resolve: ((result: { text: string; words: [] }) => void) | undefined;
    native.transcribe.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup();
    const view = render(<SpeechPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "Start recording" }));
    await screen.findByText("Recording microphone audio");
    await user.click(screen.getByRole("button", { name: "Finish recording" }));
    await screen.findByRole("group", { name: "Recorded audio preview" });
    await user.click(screen.getByRole("button", { name: "Transcribe audio locally" }));
    await waitFor(() => expect(native.transcribe).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => { resolve?.({ text: "Late synthetic transcript.", words: [] }); });
    expect(native.cancel).toHaveBeenCalledWith("denote.speech", expect.any(String));
    expect(props.onInsert).not.toHaveBeenCalled();
    expect(screen.queryByText("Late synthetic transcript.")).not.toBeInTheDocument();
  });
});
