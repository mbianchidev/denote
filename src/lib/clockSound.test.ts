import { afterEach, describe, expect, it, vi } from "vitest";
import { ClockSound } from "./clockSound";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("alarm sound", () => {
  it("starts only after explicit enablement and disposes every repeating timer", async () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const close = vi.fn();
    class SyntheticAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      async resume() { this.state = "running"; }
      async close() { this.state = "closed"; close(); }
      createOscillator() {
        return { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start, stop, onended: null };
      }
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
      }
    }
    vi.stubGlobal("AudioContext", SyntheticAudioContext);
    const sound = new ClockSound();
    sound.setRinging(true);
    expect(start).not.toHaveBeenCalled();
    await sound.enable();
    expect(start).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2_000);
    expect(start).toHaveBeenCalledTimes(2);
    sound.setRinging(false);
    expect(vi.getTimerCount()).toBe(0);
    await sound.dispose();
    expect(close).toHaveBeenCalledOnce();
    expect(sound.ready).toBe(false);
  });

  it("reports unavailable audio instead of pretending the alarm can play", async () => {
    vi.stubGlobal("AudioContext", undefined);
    await expect(new ClockSound().enable()).rejects.toThrow(/unavailable/u);
  });
});
