import { describe, expect, it } from "vitest";
import { audioBytes, encodeSpeechWav, localAudioLink, speechBase64, speechChunks, speechInsertionTarget, speechText, timestampedTranscript } from "./speech";

describe("private speech data", () => {
  it("uses an exact current selection and safely appends without rewriting stale source", () => {
    const source = "---\r\ncustom: keep\r\n---\r\n\r\nA **synthetic** note.  ";
    expect(speechInsertionTarget(source, { source, from: 6, to: 12, restore: () => {} }))
      .toEqual({ from: 6, to: 12, append: false, prefix: "" });
    for (const selection of [null, { source: "An older invented note.", from: 0, to: 5, restore: () => {} }]) {
      expect(speechInsertionTarget(source, selection)).toEqual({ from: source.length, to: source.length, append: true, prefix: "\r\n\r\n" });
    }
    expect(speechInsertionTarget("", null).prefix).toBe("");
    expect(speechInsertionTarget("Synthetic\r\n", null).prefix).toBe("\r\n");
    expect(speechInsertionTarget("Synthetic\n\n", null).prefix).toBe("");
    expect(() => speechInsertionTarget(source, { source, from: -1, to: 2, restore: () => {} })).toThrow(/invalid/);
  });

  it("encodes exact bounded mono PCM16 without files or source rewriting", () => {
    const wav = encodeSpeechWav(new Float32Array([0, -1, 1, 0.5]));
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16000);
    expect([...wav.subarray(44)]).toEqual([0, 0, 0, 128, 255, 127, 0, 64]);
    expect(audioBytes(speechBase64(wav))).toEqual(wav);
    expect(() => encodeSpeechWav(new Float32Array([Number.NaN]))).toThrow(/finite/);
    expect(() => encodeSpeechWav(new Float32Array())).toThrow();
  });

  it("speaks prose without metadata, raw HTML, or link destinations", () => {
    const source = "---\nprivate: invented metadata\n---\n# Synthetic note\n\nRead **these words** [locally](https://synthetic.invalid).\n\n<!-- invented hidden comment -->";
    const text = speechText(source);
    expect(text).toContain("these words");
    expect(text).not.toContain("metadata");
    expect(text).not.toContain("synthetic.invalid");
    expect(text).not.toContain("hidden comment");
    const chunks = speechChunks(`${"Invented words. ".repeat(200)}😀`);
    expect(chunks.every((chunk) => chunk.length <= 800 && !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    expect(chunks.join(" ")).toContain("😀");
  });

  it("limits inline players to ordinary relative local audio links", () => {
    for (const link of ["assets/Synthetic.wav", "../audio/Synthetic%20voice.mp3", "audio.OGG"]) expect(localAudioLink(link)).toBe(true);
    for (const link of ["https://synthetic.invalid/audio.wav", "//synthetic.invalid/audio.mp3", "file:///audio.wav", "javascript:audio.wav", "audio%ZZ.wav", "audio.wav#remote",
      "https%3A%2F%2Fsynthetic.invalid%2Faudio.wav", "%2F%2Fsynthetic.invalid%2Faudio.wav", "audio%00.wav"]) expect(localAudioLink(link)).toBe(false);
  });

  it("uses only returned timing data for optional timestamps", () => {
    expect(timestampedTranscript({ text: "Invented timing.", words: [
      { text: "Invented", startMs: 1200, endMs: 1500 }, { text: "timing.", startMs: 6400, endMs: 6800 },
    ] })).toBe("[00:01] Invented\n[00:06] timing.");
  });
});
