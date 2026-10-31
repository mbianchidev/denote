class DenoteSpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.paused = false;
    this.closed = false;
    this.port.onmessage = ({ data }) => {
      if (data.finish || data.paused) {
        if (this.offset) {
          const tail = this.buffer.slice(0, this.offset);
          this.port.postMessage(tail, [tail.buffer]);
        }
      }
      this.paused = Boolean(data.paused);
      this.closed = Boolean(data.closed || data.finish);
      this.buffer.fill(0);
      this.offset = 0;
      this.phase = 0;
      this.sum = 0;
      this.count = 0;
      if (data.finish) this.port.postMessage({ finished: true });
    };
  }

  process(inputs) {
    const channels = inputs[0];
    if (this.closed) return false;
    if (this.paused || !channels?.length) return true;
    for (let frame = 0; frame < channels[0].length; frame++) {
      let value = 0;
      for (const channel of channels) value += channel[frame] / channels.length;
      this.sum += value;
      this.count++;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      const sample = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      while (this.phase >= sampleRate) {
        this.buffer[this.offset++] = sample;
        this.phase -= sampleRate;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(2048);
          this.offset = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("denote-speech-capture", DenoteSpeechCapture);
