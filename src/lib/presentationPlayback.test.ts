import { describe, expect, it } from "vitest";
import { PresentationPlayback } from "./presentationPlayback";

describe("presentation autoplay", () => {
  it("keeps absolute deadlines after late ticks instead of accumulating drift", () => {
    const playback = new PresentationPlayback(8, 10, false);
    playback.play(1000);
    expect(playback.tick(11_800)).toMatchObject({ index: 1, remainingMs: 9200, playing: true });
    expect(playback.tick(31_900)).toMatchObject({ index: 3, remainingMs: 9100, playing: true });
    expect(playback.tick(41_000)).toMatchObject({ index: 4, remainingMs: 10_000 });
  });

  it("pauses immediately, resets manual navigation deadlines, and stops at the last slide", () => {
    const playback = new PresentationPlayback(3, 2, false);
    playback.play(0);
    playback.move(1, 500);
    expect(playback.tick(2200)).toMatchObject({ index: 1, remainingMs: 300 });
    playback.pause();
    expect(playback.tick(9999)).toMatchObject({ index: 1, playing: false });
    playback.play(10_000);
    expect(playback.tick(12_000)).toMatchObject({ index: 2, playing: false });
    playback.restart(13_000);
    expect(playback.tick(13_000)).toMatchObject({ index: 0, playing: false });
  });

  it("wraps late ticks while looping and rejects nonpositive or nonfinite intervals", () => {
    const playback = new PresentationPlayback(3, 1, true);
    playback.play(0);
    expect(playback.tick(4500)).toMatchObject({ index: 1, remainingMs: 500, playing: true });
    for (const seconds of [0, -1, NaN, Infinity, 3601]) {
      expect(() => new PresentationPlayback(3, seconds, false)).toThrow();
    }
  });
});
