import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginAuthoringRequest, PluginAuthoringResult, PluginPresentationModel } from "@denote/plugin-sdk";
import { DEFAULT_EDITOR_DISPLAY_SETTINGS } from "../lib/editorDisplay";
import { PresentationEditor } from "./PresentationEditor";

vi.mock("./PlainTextEditor", () => ({
  PlainTextEditor: ({ value, onChange, onCursorChange }: {
    value: string; onChange: (source: string) => void; onCursorChange: (position: { line: number; character: number }) => void;
  }) => <textarea aria-label="Presentation source" value={value} onChange={(event) => onChange(event.currentTarget.value)}
    onSelect={(event) => onCursorChange({
      line: event.currentTarget.value.slice(0, event.currentTarget.selectionStart).split("\n").length - 1, character: 0,
    })} />,
}));

const source = "# First\n\n===\n\n# Second\n";
const boundary = source.indexOf("===");
const model: PluginPresentationModel = {
  bodyStart: 0,
  slides: [{ from: 0, to: boundary, line: 1, title: "First" }, { from: boundary + 4, to: source.length, line: 5, title: "Second" }],
  separators: [{ from: boundary, to: boundary + 4 }],
  options: { title: "Synthetic deck", author: "", theme: "system", aspectRatio: "16:9", alignment: "left",
    slideNumbers: true, autoplay: false, advanceSeconds: 2, loop: false, transition: "none" },
  notices: [],
};
const request = vi.fn(async (request: PluginAuthoringRequest): Promise<PluginAuthoringResult> => {
  if (request.feature !== "presentation" || request.action !== "parse") throw new Error("Unexpected test request");
  return { feature: "presentation", action: "parse", model };
});
const base = {
  path: "Deck.md", source, readOnly: false, active: true, request,
  displaySettings: DEFAULT_EDITOR_DISPLAY_SETTINGS, lineEnding: "lf" as const,
  renderPreview: (markdown: string) => <div aria-label="Slide content">{markdown}</div>,
  onChange: vi.fn(), onClose: vi.fn(),
};
let fullscreen: Element | null = null;

beforeEach(() => {
  fullscreen = null;
  vi.clearAllMocks();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => true });
  HTMLElement.prototype.requestFullscreen = vi.fn(async function (this: HTMLElement) {
    fullscreen = this;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  document.exitFullscreen = vi.fn(async () => {
    fullscreen = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("presentation authoring and lifecycle", () => {
  it("uses a modal native fallback when WebKit element fullscreen is disabled, then restores its lease", async () => {
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false });
    const user = userEvent.setup();
    const release = vi.fn(async () => {});
    const enter = vi.fn(async () => release);
    const view = render(<PresentationEditor {...base} nativeFullscreen={enter} />);
    await screen.findByText("Slide 1 of 2");
    await user.click(screen.getByRole("button", { name: "Present" }));
    expect(await screen.findByRole("dialog", { name: "Full-screen presentation" })).toBeInTheDocument();
    expect(enter).toHaveBeenCalledWith(expect.any(AbortSignal));
    fireEvent.keyDown(screen.getByRole("spinbutton", { name: "Advance seconds" }), { key: "Escape" });
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Full-screen presentation" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Present" })).toHaveFocus();
    view.unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps exact complete source, synchronizes preview, and navigates full-screen by keyboard", async () => {
    const user = userEvent.setup();
    render(<PresentationEditor {...base} />);
    await screen.findByText("Slide 1 of 2");
    expect(screen.getByLabelText("Presentation source")).toHaveValue(source);
    expect(base.onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByLabelText("Slide content")).toHaveTextContent("# Second");
    await user.click(screen.getByRole("button", { name: "Present" }));
    await waitFor(() => expect(fullscreen).not.toBeNull());
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText("Slide 1 of 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByText("Slide 2 of 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.exitFullscreen).toHaveBeenCalled());
    expect(base.onChange).not.toHaveBeenCalled();
  });

  it("pauses hidden and inactive decks and clears timers and fullscreen on close", async () => {
    vi.useFakeTimers();
    const view = render(<PresentationEditor {...base} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    hidden.mockReturnValue(false);
    view.rerender(<PresentationEditor {...base} active={false} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    hidden.mockRestore();
  });
});
