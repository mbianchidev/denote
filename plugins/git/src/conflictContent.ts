/**
 * Reading and writing the exact bytes of one conflicted path.
 *
 * The host returns each conflict stage as base64 of the blob Git holds, and
 * takes a resolution back the same way, so neither direction depends on the
 * transport's text handling. Decoding is strict on purpose: content that is
 * not base64 is refused rather than guessed at, content larger than the bound
 * is refused rather than cut short, and content that is not valid UTF-8 text
 * is reported as binary rather than rendered as replacement characters. A
 * surface can then say what a stage is instead of showing something the
 * repository does not contain.
 */

/**
 * The largest stage Denote reads into a conflict editor. A note is text; a
 * blob beyond this is offered as a whole-side choice instead, which never
 * needs its bytes in the renderer.
 */
export const MAX_CONFLICT_STAGE_BYTES = 4 * 1024 * 1024;

export class ConflictContentTooLarge extends Error {
  constructor() {
    super(
      "This conflict is larger than Denote can read. Choose a whole side, or resolve it with your own Git tooling.",
    );
  }
}

export class ConflictContentUnreadable extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type ConflictStageContent =
  | { kind: "text"; text: string; byteLength: number }
  | { kind: "binary"; byteLength: number };

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const BASE64_VALUES = (() => {
  const values = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    values[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return values;
})();

/**
 * Decodes one conflict stage.
 *
 * Whitespace is dropped first, because Git output may be wrapped, and the
 * remainder must then be canonical padded base64: anything else is a report
 * Denote did not produce and is refused.
 */
export function decodeConflictStage(encoded: string): ConflictStageContent {
  const bytes = decodeBase64(encoded);
  if (bytes.includes(0)) {
    return { kind: "binary", byteLength: bytes.length };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { kind: "text", text, byteLength: bytes.length };
  } catch {
    return { kind: "binary", byteLength: bytes.length };
  }
}

/** Encodes one resolved result as the base64 of its UTF-8 bytes. */
export function encodeResolvedContent(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_CONFLICT_STAGE_BYTES) {
    throw new ConflictContentTooLarge();
  }
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64_ALPHABET[first >> 2];
    encoded +=
      BASE64_ALPHABET[((first & 0b11) << 4) | ((second ?? 0) >> 4)];
    encoded +=
      second === undefined
        ? "="
        : BASE64_ALPHABET[((second & 0b1111) << 2) | ((third ?? 0) >> 6)];
    encoded +=
      third === undefined ? "=" : BASE64_ALPHABET[third & 0b111111];
  }
  return encoded;
}

function decodeBase64(encoded: string): Uint8Array {
  const compact = encoded.replace(/[\n\r\t ]/g, "");
  if (compact.length === 0) {
    return new Uint8Array(0);
  }
  if (compact.length % 4 !== 0) {
    throw new ConflictContentUnreadable(
      "Denote could not read this conflict stage because the host report is not valid base64.",
    );
  }
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const byteLength = (compact.length / 4) * 3 - padding;
  if (byteLength > MAX_CONFLICT_STAGE_BYTES) {
    throw new ConflictContentTooLarge();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (let index = 0; index < compact.length; index += 4) {
    const last = index + 4 >= compact.length;
    const quantum = [0, 0, 0, 0];
    for (let position = 0; position < 4; position += 1) {
      const character = compact.charCodeAt(index + position);
      if (character === 61) {
        // Padding is only ever the last one or two characters of the whole
        // value, so a `=` anywhere else is not base64 Denote produced.
        if (!last || position < 2 || (position === 2 && padding !== 2)) {
          throw new ConflictContentUnreadable(
            "Denote could not read this conflict stage because the host report is not valid base64.",
          );
        }
        quantum[position] = 0;
        continue;
      }
      const value = character < 128 ? BASE64_VALUES[character] : -1;
      if (value < 0) {
        throw new ConflictContentUnreadable(
          "Denote could not read this conflict stage because the host report is not valid base64.",
        );
      }
      quantum[position] = value;
    }
    const triple =
      (quantum[0] << 18) | (quantum[1] << 12) | (quantum[2] << 6) | quantum[3];
    if (offset < byteLength) {
      bytes[offset] = (triple >> 16) & 0xff;
      offset += 1;
    }
    if (offset < byteLength) {
      bytes[offset] = (triple >> 8) & 0xff;
      offset += 1;
    }
    if (offset < byteLength) {
      bytes[offset] = triple & 0xff;
      offset += 1;
    }
  }
  return bytes;
}
