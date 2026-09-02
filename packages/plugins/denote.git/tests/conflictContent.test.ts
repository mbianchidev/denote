import { describe, expect, it } from "vitest";
import {
  MAX_CONFLICT_STAGE_BYTES,
  ConflictContentTooLarge,
  decodeConflictStage,
  encodeResolvedContent,
} from "../src/conflictContent";

/** Base64 of the given UTF-8 text, produced without the module under test. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("decodeConflictStage", () => {
  it("decodes exact UTF-8 text", () => {
    expect(decodeConflictStage(base64("one\ntwo\n"))).toEqual({
      kind: "text",
      text: "one\ntwo\n",
      byteLength: 8,
    });
  });

  it("decodes Unicode without losing a character", () => {
    const text = "émoji 🌱\nünïcödé\n行\n";
    const decoded = decodeConflictStage(base64(text));

    expect(decoded).toEqual({
      kind: "text",
      text,
      byteLength: new TextEncoder().encode(text).length,
    });
  });

  it("reports an empty stage as empty text", () => {
    expect(decodeConflictStage("")).toEqual({
      kind: "text",
      text: "",
      byteLength: 0,
    });
  });

  it("reports content with a NUL byte as binary", () => {
    expect(decodeConflictStage(base64("one\u0000two"))).toEqual({
      kind: "binary",
      byteLength: 7,
    });
  });

  it("reports content that is not valid UTF-8 as binary", () => {
    // 0xFF never appears in valid UTF-8.
    expect(decodeConflictStage("//79")).toEqual({
      kind: "binary",
      byteLength: 3,
    });
  });

  it("refuses base64 that is not base64", () => {
    for (const value of ["not base64!", "AAA", "AB=A", "====", "A\u0000AA"]) {
      expect(() => decodeConflictStage(value)).toThrow(
        /not valid base64|could not read/i,
      );
    }
  });

  it("ignores the line breaks Git output may be wrapped with", () => {
    const encoded = base64("one\ntwo\n");
    const wrapped = `${encoded.slice(0, 4)}\n${encoded.slice(4)}\n`;

    expect(decodeConflictStage(wrapped)).toEqual({
      kind: "text",
      text: "one\ntwo\n",
      byteLength: 8,
    });
  });

  it("refuses a stage larger than it will read", () => {
    const oversized = base64("a".repeat(MAX_CONFLICT_STAGE_BYTES + 1));

    expect(() => decodeConflictStage(oversized)).toThrow(
      ConflictContentTooLarge,
    );
  });
});

describe("encodeResolvedContent", () => {
  it("round-trips text through base64", () => {
    for (const text of ["", "one\ntwo\n", "émoji 🌱\n行\n", "no newline"]) {
      expect(decodeConflictStage(encodeResolvedContent(text))).toEqual({
        kind: "text",
        text,
        byteLength: new TextEncoder().encode(text).length,
      });
    }
  });

  it("produces canonical padded base64", () => {
    expect(encodeResolvedContent("one")).toBe(base64("one"));
    expect(encodeResolvedContent("four")).toBe(base64("four"));
    expect(encodeResolvedContent("fives")).toBe(base64("fives"));
  });

  it("refuses a result larger than it will send", () => {
    expect(() =>
      encodeResolvedContent("a".repeat(MAX_CONFLICT_STAGE_BYTES + 1)),
    ).toThrow(ConflictContentTooLarge);
  });
});
