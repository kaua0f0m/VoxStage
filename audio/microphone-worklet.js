/* Capture only. No pitch search, network, recording or audible microphone loop. */
class VoxStageMicrophone extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Float32Array(4096); this.cursor = 0; this.frames = 0; this.active = false; this.epoch = 0;
    this.port.onmessage = event => {
      if (event.data.type === 'stop') this.stopped = true;
      if (event.data.type === 'active') {
        this.active = event.data.active; this.epoch = event.data.epoch;
        this.cursor = 0; this.frames = 0;
      }
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0]?.[0];
    if (!this.active || !input) return true;
    for (let index = 0; index < input.length; index++) {
      this.samples[this.cursor] = input[index];
      this.cursor = (this.cursor + 1) % this.samples.length; this.frames++;
      if (this.frames >= this.samples.length && this.frames % 2048 === 0) {
        const frame = new Float32Array(this.samples.length);
        for (let i = 0; i < frame.length; i++) frame[i] = this.samples[(this.cursor + i) % this.samples.length];
        this.port.postMessage({samples:frame, epoch:this.epoch, sampleRate,
          centerTime:currentTime + (index + 1) / sampleRate - frame.length / (2 * sampleRate)}, [frame.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('voxstage-microphone', VoxStageMicrophone);
