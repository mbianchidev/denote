import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

export const SPEECH_SAMPLE_RATE = 16000;
export const MAX_SPEECH_SECONDS = 600;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const AUDIO_EXTENSION = /\.(?:wav|mp3|m4a|aac|ogg|opus|flac|webm)$/i;

export interface SpeechEngineStatus {
  installed: boolean;
  modelCached: boolean;
  supported: boolean;
  model: string;
  modelBytes: number;
  runtimeBytes: number;
  licenseUrl: string;
  sourceUrl: string;
  locales: string[];
}
export interface SpeechProgress { phase: string; downloadedBytes: number; totalBytes: number }
export interface SpeechTranscript { text: string; words: Array<{ text: string; startMs: number; endMs: number }> }
export interface SpeechAudioBinding {
  read: (href: string) => Promise<{ base64: string; mime: string }>;
  export: (href: string) => Promise<boolean>;
}

export function localAudioLink(href: string): boolean {
  const unsafe = /^[a-z][a-z0-9+.-]*:|^[/\\]|[\u0000-\u001f\u007f]/i;
  if (!href || unsafe.test(href)) return false;
  try { const decoded = decodeURIComponent(href); return !unsafe.test(decoded) && AUDIO_EXTENSION.test(decoded); }
  catch { return false; }
}

export function speechText(source: string): string {
  const prose = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const text: string[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "html" || node.type === "definition") return;
    if ("value" in node && typeof node.value === "string") text.push(node.value);
    else if (node.type === "image" || node.type === "imageReference") { if (node.alt) text.push(node.alt); }
    else if ("children" in node) {
      node.children.forEach(visit);
      if (["paragraph", "heading", "listItem", "code", "blockquote"].includes(node.type)) text.push("\n");
    }
  };
  visit(fromMarkdown(prose));
  return text.join(" ").replace(/[ \t]+/g, " ").trim();
}

export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length) {
    let length = Math.min(800, rest.length);
    if (length < rest.length) {
      const boundary = Math.max(rest.lastIndexOf(". ", length), rest.lastIndexOf("\n", length), rest.lastIndexOf(" ", length));
      if (boundary > 200) length = boundary + 1;
      if (length > 0 && /[\uD800-\uDBFF]/.test(rest[length - 1])) length--;
    }
    const chunk = rest.slice(0, length).trim();
    if (chunk) chunks.push(chunk);
    rest = rest.slice(length);
  }
  return chunks;
}

export function encodeSpeechWav(samples: Float32Array): Uint8Array<ArrayBuffer> {
  if (!samples.length || samples.length > SPEECH_SAMPLE_RATE * MAX_SPEECH_SECONDS ||
      samples.some((sample) => !Number.isFinite(sample))) throw new Error("Audio must contain finite samples and fit within 10 minutes.");
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index); };
  label(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); label(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SPEECH_SAMPLE_RATE, true); view.setUint32(28, SPEECH_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export function speechBase64(bytes: Uint8Array): string {
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("Audio exceeds the 25 MB file limit.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}

export function audioBytes(base64: string): Uint8Array<ArrayBuffer> {
  if (base64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) throw new Error("Audio exceeds the 25 MB file limit.");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function timestampedTranscript(transcript: SpeechTranscript): string {
  const lines: string[] = [];
  let group: string[] = [];
  let start = 0;
  const flush = () => {
    if (!group.length) return;
    const seconds = Math.floor(start / 1000);
    lines.push(`[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}] ${group.join(" ")}`);
    group = [];
  };
  for (const word of transcript.words) {
    if (!group.length) start = word.startMs;
    else if (word.startMs - start >= 5000) { flush(); start = word.startMs; }
    group.push(word.text);
  }
  flush();
  return lines.join("\n");
}

export async function decodeSpeechFile(file: File, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_AUDIO_BYTES || !AUDIO_EXTENSION.test(file.name)) throw new Error("Choose a supported local audio file up to 25 MB.");
  const url = URL.createObjectURL(file);
  const audio = new Audio();
  const context = new AudioContext();
  let decoded: AudioBuffer | null = null;
  let encoded: ArrayBuffer | null = null;
  const check = () => { if (signal?.aborted) throw new DOMException("Audio import cancelled.", "AbortError"); };
  const abort = () => {
    audio.pause(); audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url);
    if (context.state !== "closed") void context.close().catch(() => console.error("Cancelled audio decoder cleanup failed."));
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    check();
    await new Promise<void>((resolve, reject) => {
      const clean = () => { window.clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
      const cancel = () => { clean(); reject(new DOMException("Audio import cancelled.", "AbortError")); };
      const timer = window.setTimeout(() => { clean(); reject(new Error("Audio metadata could not be read. Convert it to WAV and retry.")); }, 10000);
      signal?.addEventListener("abort", cancel, { once: true });
      audio.onloadedmetadata = () => {
        clean();
        if (Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration <= MAX_SPEECH_SECONDS) resolve();
        else reject(new Error("Imported audio must fit within 10 minutes."));
      };
      audio.onerror = () => { clean(); reject(new Error("This audio format cannot be decoded on this platform. Convert it to WAV and retry.")); };
      audio.src = url;
    });
    check();
    encoded = await file.arrayBuffer();
    check();
    decoded = await context.decodeAudioData(encoded);
    check();
    if (decoded.duration > MAX_SPEECH_SECONDS || decoded.numberOfChannels > 2 || decoded.length * decoded.numberOfChannels > 64 * 1024 * 1024) {
      throw new Error("Decoded audio exceeds the local memory or duration limit. Use a shorter mono WAV file.");
    }
    const rendered = new OfflineAudioContext(1, Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE), SPEECH_SAMPLE_RATE);
    const source = rendered.createBufferSource();
    source.buffer = decoded;
    source.connect(rendered.destination);
    source.start();
    const mono = await rendered.startRendering();
    try { check(); return encodeSpeechWav(mono.getChannelData(0)); }
    finally { mono.getChannelData(0).fill(0); }
  } finally {
    audio.pause(); audio.removeAttribute("src"); audio.load();
    audio.onloadedmetadata = null; audio.onerror = null;
    signal?.removeEventListener("abort", abort);
    URL.revokeObjectURL(url);
    if (decoded) for (let channel = 0; channel < decoded.numberOfChannels; channel++) decoded.getChannelData(channel).fill(0);
    if (encoded?.byteLength) new Uint8Array(encoded).fill(0);
    if (context.state !== "closed") await context.close();
  }
}
