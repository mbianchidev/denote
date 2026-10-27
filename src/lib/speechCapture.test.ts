import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechCapture } from "./speechCapture";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function syntheticTrack() {
  const stop = vi.fn();
  const track: MediaStreamTrack = Object.assign(new EventTarget(), {
    id: "synthetic-track", kind: "audio", label: "Synthetic microphone", enabled: true, muted: false,
    readyState: "live" as const, contentHint: "speech", onended: null, onmute: null, onunmute: null,
    stop, clone: (): MediaStreamTrack => track, getCapabilities: () => ({}), getConstraints: () => ({}),
    getSettings: () => ({}), applyConstraints: async () => {},
  });
  return { track, stop };
}

describe("explicit microphone capture and cleanup", () => {
  it("never requests a microphone on construction and stops a permission grant that arrives after cancellation", async () => {
    let grant: ((stream: Partial<MediaStream>) => void) | undefined;
    const { track, stop } = syntheticTrack();
    const stream: Partial<MediaStream> = { getTracks: () => [track], getAudioTracks: () => [track] };
    const getUserMedia = vi.fn(() => new Promise<Partial<MediaStream>>((resolve) => { grant = resolve; }));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("AudioContext", class {});
    vi.stubGlobal("AudioWorkletNode", class {});
    const capture = new SpeechCapture(vi.fn(), vi.fn());
    expect(getUserMedia).not.toHaveBeenCalled();
    const started = capture.start();
    await capture.cancel();
    grant?.(stream);
    await expect(started).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, echoCancellation: true }, video: false });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("flushes final audio samples before stopping, zeroizes buffers, and releases every track and audio resource", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { track, stop } = syntheticTrack();
    const stream: Partial<MediaStream> = { getTracks: () => [track], getAudioTracks: () => [track] };
    const close = vi.fn(async () => {});
    const disconnect = vi.fn();
    const portClose = vi.fn();
    const nodes: FakeNode[] = [];
    class FakeNode {
      onprocessorerror: (() => void) | null = null;
      port = {
        onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
        close: portClose,
        postMessage: (data: { finish?: boolean }) => {
          if (data.finish) {
            this.port.onmessage?.(new MessageEvent("message", { data: new Float32Array([0.25]) }));
            this.port.onmessage?.(new MessageEvent("message", { data: { finished: true } }));
          }
        },
      };
      constructor() { nodes.push(this); }
      connect() {}
      disconnect = disconnect;
    }
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    vi.stubGlobal("AudioWorkletNode", FakeNode);
    vi.stubGlobal("AudioContext", class {
      state = "running"; audioWorklet = { addModule: vi.fn(async () => {}) }; destination = {};
      createMediaStreamSource() { return { connect() {}, disconnect }; }
      createGain() { return { gain: { value: 0 }, connect() {}, disconnect }; }
      resume() { return Promise.resolve(); }
      close = close;
    });
    const capture = new SpeechCapture(vi.fn(), vi.fn());
    await capture.start();
    const samples = new Float32Array([0.5, -0.5]);
    const node = nodes[0];
    if (!node) throw new Error("The fake audio node did not start.");
    node.port.onmessage?.(new MessageEvent("message", { data: samples }));
    capture.pause(true);
    expect(track.enabled).toBe(false);
    capture.pause(false);
    const wav = await capture.finish();
    expect(wav.length).toBe(44 + 3 * 2);
    expect([...samples]).toEqual([0, 0]);
    expect(stop).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(3);
    expect(portClose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
