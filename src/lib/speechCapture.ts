import { encodeSpeechWav, MAX_SPEECH_SECONDS, SPEECH_SAMPLE_RATE } from "./speech";

let active: SpeechCapture | null = null;

export class SpeechCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private count = 0;
  private closed = false;
  private paused = false;
  private flushed: (() => void) | null = null;
  private cancelForegroundWait: (() => void) | null = null;
  level = 0;

  constructor(private readonly onLimit: () => void, private readonly onError: (message: string) => void) {}

  get seconds() { return this.count / SPEECH_SAMPLE_RATE; }
  get isPaused() { return this.paused; }

  async start() {
    if (active || this.closed) throw new Error("Another microphone recording is active. Stop it first.");
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      throw new Error("Microphone recording is unavailable on this platform.");
    }
    active = this;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
      if (this.closed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("Microphone request cancelled.", "AbortError");
      }
      this.stream = stream;
      stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      if (document.hidden || !document.hasFocus()) {
        await new Promise<void>((resolve, reject) => {
          const clean = () => { window.clearTimeout(timer); window.removeEventListener("focus", focused); this.cancelForegroundWait = null; };
          const focused = () => { if (!document.hidden && document.hasFocus()) { clean(); resolve(); } };
          const timer = window.setTimeout(() => { clean(); reject(new Error("Microphone permission changed while Denote was inactive. Return and start recording again.")); }, 1500);
          this.cancelForegroundWait = () => { clean(); reject(new DOMException("Microphone request cancelled.", "AbortError")); };
          window.addEventListener("focus", focused);
          focused();
        });
      }
      if (this.closed) throw new DOMException("Microphone request cancelled.", "AbortError");
      stream.getAudioTracks().forEach((track) => { track.onended = () => this.onError("Microphone access ended. Finish or discard the current recording."); });
      const context = new AudioContext();
      this.context = context;
      if (!context.audioWorklet) throw new Error("Private audio capture is unavailable on this platform.");
      await context.audioWorklet.addModule(new URL("./speechCaptureProcessor.js", import.meta.url));
      if (this.closed) throw new DOMException("Microphone request cancelled.", "AbortError");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "denote-speech-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const gain = context.createGain();
      gain.gain.value = 0;
      this.source = source; this.node = node; this.gain = gain;
      node.onprocessorerror = () => this.onError("Audio capture failed. Finish or discard the current recording.");
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data && typeof event.data === "object" && "finished" in event.data && event.data.finished === true) {
          this.flushed?.(); this.flushed = null; return;
        }
        if (!(event.data instanceof Float32Array)) { this.onError("Audio capture returned invalid samples."); return; }
        const samples = event.data;
        if (this.closed) { samples.fill(0); return; }
        if (samples.some((value) => !Number.isFinite(value))) { samples.fill(0); this.onError("Audio capture returned invalid samples."); return; }
        const remaining = SPEECH_SAMPLE_RATE * MAX_SPEECH_SECONDS - this.count;
        if (remaining <= 0) { samples.fill(0); return; }
        const accepted = samples.length > remaining ? samples.slice(0, remaining) : samples;
        if (accepted !== samples) samples.fill(0);
        this.count += accepted.length;
        this.level = accepted.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
        this.chunks.push(accepted);
        if (this.count === SPEECH_SAMPLE_RATE * MAX_SPEECH_SECONDS) this.onLimit();
      };
      source.connect(node); node.connect(gain); gain.connect(context.destination);
      await context.resume();
      if (this.closed) throw new DOMException("Microphone request cancelled.", "AbortError");
      if (document.hidden || !document.hasFocus()) throw new Error("Return to Denote and start recording again. No background recording was started.");
      stream.getAudioTracks().forEach((track) => { track.enabled = true; });
    } catch (caught) {
      await this.cancel();
      if (caught instanceof DOMException && caught.name === "NotAllowedError") throw new Error("Microphone access was denied. Allow Denote in OS privacy settings and retry.");
      if (caught instanceof DOMException && caught.name === "NotFoundError") throw new Error("No microphone is available. Connect an input device and retry.");
      throw caught;
    }
  }

  pause(paused: boolean) {
    if (this.closed) return;
    this.paused = paused;
    this.level = 0;
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = !paused; });
    this.node?.port.postMessage({ paused });
  }

  private async release() {
    this.closed = true;
    this.cancelForegroundWait?.(); this.cancelForegroundWait = null;
    this.flushed?.(); this.flushed = null;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    this.node?.port.postMessage({ closed: true });
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.port.close(); this.node.disconnect(); }
    this.node = null;
    this.source?.disconnect(); this.source = null;
    this.gain?.disconnect(); this.gain = null;
    const context = this.context;
    this.context = null;
    if (active === this) active = null;
    if (context && context.state !== "closed") await context.close();
  }

  async finish(): Promise<Uint8Array<ArrayBuffer>> {
    let samples: Float32Array | null = null;
    try {
      this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      try {
        if (this.node && !this.closed) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => { this.flushed = null; reject(new Error("The last audio samples could not be collected. The recording was not saved.")); }, 1500);
            this.flushed = () => { window.clearTimeout(timer); resolve(); };
            this.node!.port.postMessage({ finish: true });
          });
        }
      } finally { await this.release(); }
      samples = new Float32Array(this.count);
      let offset = 0;
      for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
      return encodeSpeechWav(samples);
    } finally { samples?.fill(0); this.clear(); }
  }

  async cancel() {
    try { await this.release(); }
    finally { this.clear(); }
  }

  private clear() {
    for (const chunk of this.chunks) chunk.fill(0);
    this.chunks = []; this.count = 0; this.level = 0;
  }
}
