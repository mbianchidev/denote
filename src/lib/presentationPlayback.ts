export class PresentationPlayback {
  private index = 0;
  private deadline: number | null = null;

  constructor(private readonly count: number, private readonly seconds: number, private readonly loop: boolean) {
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
      throw new Error("Choose a slide interval from 1 to 3600 seconds.");
    }
  }
  play(now: number) { this.deadline = now + this.seconds * 1000; }
  pause() { this.deadline = null; }
  move(index: number, now: number) {
    this.index = Math.max(0, Math.min(this.count - 1, index));
    if (this.deadline !== null) this.deadline = now + this.seconds * 1000;
  }
  restart(now: number) { this.move(0, now); }
  tick(now: number) {
    if (this.deadline !== null && now >= this.deadline) {
      const steps = Math.floor((now - this.deadline) / (this.seconds * 1000)) + 1;
      const next = this.index + steps;
      this.index = this.loop ? next % this.count : Math.min(this.count - 1, next);
      this.deadline = !this.loop && this.index === this.count - 1 ? null : this.deadline + steps * this.seconds * 1000;
    }
    return {
      index: this.index,
      playing: this.deadline !== null,
      remainingMs: this.deadline === null ? this.seconds * 1000 : Math.max(0, this.deadline - now),
    };
  }
}
