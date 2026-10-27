import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeSpeechWav, SPEECH_SAMPLE_RATE } from "../src/lib/speech";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let approved = false;
let engineDirectory: string | null = null;
let executable = process.env.DENOTE_SPEECH_TEST_EXECUTABLE || "";
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === "--approve-download") approved = true;
  else if (argument === "--engine-dir" && args[index + 1]) engineDirectory = resolve(args[++index]);
  else if (argument === "--executable" && args[index + 1]) executable = resolve(args[++index]);
  else throw new Error("Usage: npm run test:speech-model -- --approve-download [--engine-dir <private-cache>] [--executable <current-build>]");
}
if (!approved) throw new Error("Explicit --approve-download is required for the 742 MB NVIDIA Nemotron model (OpenMDW 1.1: https://openmdw.ai/license/1-1/) and pinned Apache-2.0 runtime.");

function run(command: string, arguments_: string[], env = process.env) {
  const result = spawnSync(command, arguments_, { cwd: root, env, stdio: "inherit", timeout: 1_800_000 });
  if (result.error) throw new Error(`Unable to run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status ?? result.signal}.`);
}

function normalizeGeneratedWave(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
  if (bytes.length < 44 || bytes.length > 25 * 1024 * 1024 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("The offline speech generator did not produce bounded WAV audio.");
  let format = -1;
  let data = -1;
  let length = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) throw new Error("The generated WAV has an invalid chunk length.");
    if (text(offset, 4) === "fmt ") { if (size < 16) throw new Error("The generated WAV has no PCM format."); format = offset + 8; }
    if (text(offset, 4) === "data") { data = offset + 8; length = size; }
    offset += 8 + size + size % 2;
  }
  if (format < 0 || data < 0 || view.getUint16(format, true) !== 1 || view.getUint16(format + 14, true) !== 16) throw new Error("The offline generator must produce PCM16 WAV.");
  const channels = view.getUint16(format + 2, true);
  const rate = view.getUint32(format + 4, true);
  if (channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || length % (channels * 2)) throw new Error("The generated WAV has an unsupported channel count or sample rate.");
  const frames = length / (channels * 2);
  const samples = new Float32Array(Math.floor(frames * SPEECH_SAMPLE_RATE / rate));
  try {
    for (let index = 0; index < samples.length; index++) {
      const position = index * rate / SPEECH_SAMPLE_RATE;
      const first = Math.floor(position);
      const second = Math.min(first + 1, frames - 1);
      const fraction = position - first;
      let sample = 0;
      for (let channel = 0; channel < channels; channel++) {
        const a = view.getInt16(data + (first * channels + channel) * 2, true);
        const b = view.getInt16(data + (second * channels + channel) * 2, true);
        sample += (a + (b - a) * fraction) / channels / 32768;
      }
      samples[index] = sample;
    }
    return encodeSpeechWav(samples);
  } finally { samples.fill(0); }
}

const temporary = mkdtempSync(join(tmpdir(), "denote-synthetic-speech-"));
try {
  const raw = join(temporary, "generated.wav");
  const phrase = "This is a synthetic speech test. This is a synthetic speech test.";
  if (process.platform === "darwin") {
    run("/usr/bin/say", ["-v", "Samantha", "--file-format=WAVE", "--data-format=LEI16@16000", "--channels=1", "-o", raw, phrase]);
  } else if (process.platform === "win32") {
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", [
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Speech;",
      "$voice=New-Object System.Speech.Synthesis.SpeechSynthesizer;",
      "$format=New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono);",
      "try { $voice.SetOutputToWaveFile($env:DENOTE_SYNTHETIC_WAV,$format); $voice.Speak('This is a synthetic speech test. This is a synthetic speech test.'); } finally { $voice.Dispose(); }",
    ].join(" ")], { ...process.env, DENOTE_SYNTHETIC_WAV: raw });
  } else if (process.platform === "linux") {
    run("espeak-ng", ["-w", raw, phrase]);
  } else { throw new Error("The synthetic speech generator supports macOS, Windows, and Linux only."); }
  const generated = readFileSync(raw);
  const normalized = normalizeGeneratedWave(generated);
  const wav = join(temporary, "synthetic.wav");
  writeFileSync(wav, normalized, { mode: 0o600 });
  generated.fill(0); normalized.fill(0);
  const engine = engineDirectory ?? join(temporary, "engine");
  mkdirSync(engine, { recursive: true });
  if (!executable) {
    run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--bin", "denote", "--jobs", "2"]);
    executable = join(root, "src-tauri/target/debug", process.platform === "win32" ? "denote.exe" : "denote");
  }
  run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--lib", "--jobs", "2",
    "speech_real_approved_model", "--", "--ignored", "--nocapture", "--test-threads", "1"], {
    ...process.env, DENOTE_SPEECH_TEST_DOWNLOAD: "approved", DENOTE_SPEECH_TEST_ROOT: engine,
    DENOTE_SPEECH_TEST_EXECUTABLE: executable, DENOTE_SPEECH_TEST_WAV: wav,
  });
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
