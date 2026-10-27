export type EnterNativeFullscreen = (signal: AbortSignal) => Promise<() => Promise<void>>;

interface NativeWindow {
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
}

export class NativeFullscreenHost {
  private tail: Promise<void> = Promise.resolve();
  private active: { id: number; previous: boolean } | null = null;
  private sequence = 0;
  private closed = false;

  constructor(private readonly window: NativeWindow) {}

  activate() { this.closed = false; }

  enter: EnterNativeFullscreen = (signal) => {
    const id = ++this.sequence;
    return this.run(async () => {
      this.assertLive(signal);
      const previous = this.active?.previous ?? await this.window.isFullscreen();
      this.assertLive(signal);
      await this.window.setFullscreen(true);
      if (signal.aborted || this.closed) {
        if (!this.active) await this.window.setFullscreen(previous);
        throw new DOMException("Presentation closed before fullscreen was ready.", "AbortError");
      }
      this.active = { id, previous };
      let release: Promise<void> | null = null;
      return () => {
        if (release) return release;
        const pending = this.run(async () => {
          if (this.active?.id !== id) return;
          await this.window.setFullscreen(previous);
          this.active = null;
        });
        release = pending;
        void pending.catch(() => { if (release === pending) release = null; });
        return pending;
      };
    });
  };

  dispose(): Promise<void> {
    this.closed = true;
    return this.run(async () => {
      if (!this.active) return;
      await this.window.setFullscreen(this.active.previous);
      this.active = null;
    });
  }

  private assertLive(signal: AbortSignal) {
    if (signal.aborted || this.closed) throw new DOMException("Presentation fullscreen was cancelled.", "AbortError");
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(() => {}, () => {});
    return result;
  }
}
