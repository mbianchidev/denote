import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeSpeechWav } from "../lib/speech";
import { SpeechPanel } from "./SpeechPanel";

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
const props = {
  pluginId: "denote.speech", workspaceScope: "/synthetic", path: "Synthetic.md", source,
  selection: { source, from: 0, to: 0, restore: () => {} }, readOnly: false,
  onInsert: vi.fn(), onSaveVoiceNote: vi.fn(async () => {}), onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  native.status.mockResolvedValue({
    installed: true, supported: true, model: "Synthetic local model", modelBytes: 742090464,
    runtimeBytes: 100, sourceUrl: "https://synthetic.invalid", licenseUrl: "https://synthetic.invalid/license", locales: ["auto", "en-US"],
  });
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
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("speech privacy and explicit actions", () => {
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
    expect(props.onInsert).toHaveBeenCalledExactlyOnceWith("Reviewed invented text.");
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
