export interface ClockSoundPlayer {
  readonly ready: boolean;
  enable: () => Promise<void>;
  setRinging: (ringing: boolean) => void;
  dispose: () => Promise<void>;
}

export class ClockSound implements ClockSoundPlayer {
  private context: AudioContext | null = null;
  private interval: number | null = null;
  private ringing = false;
  private readonly nodes = new Set<OscillatorNode>();

  get ready(): boolean {
    return this.context?.state === "running";
  }

  async enable(): Promise<void> {
    if (typeof AudioContext !== "function") throw new Error("Alarm sound is unavailable. System notification sounds still follow your operating-system settings.");
    this.context ??= new AudioContext();
    await this.context.resume();
    if (!this.ready) throw new Error("Alarm sound is blocked. Choose Enable alarm sound and check your system audio settings.");
    this.setRinging(this.ringing);
  }

  setRinging(ringing: boolean): void {
    this.ringing = ringing;
    if (!ringing) {
      if (this.interval !== null) window.clearInterval(this.interval);
      this.interval = null;
      for (const node of this.nodes) node.stop();
      this.nodes.clear();
    } else if (this.ready && this.interval === null) {
      this.pulse();
      this.interval = window.setInterval(() => this.pulse(), 2_000);
    }
  }

  async dispose(): Promise<void> {
    this.setRinging(false);
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed") await context.close();
  }

  private pulse(): void {
    const context = this.context;
    if (!context || context.state !== "running") return;
    const node = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    node.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    node.connect(gain);
    gain.connect(context.destination);
    node.onended = () => {
      this.nodes.delete(node);
      node.disconnect();
      gain.disconnect();
    };
    this.nodes.add(node);
    node.start(now);
    node.stop(now + 0.3);
  }
}
