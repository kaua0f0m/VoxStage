/* Heavy pitch analysis stays outside both the UI and the audio render thread. */
importScripts('pitch-core.js');
const pitch = self.VoxStagePitch;
self.onmessage = event => {
  const data = event.data;
  try {
    if (data.type === 'live') {
      const samples = pitch.resample(data.samples, data.sampleRate);
      self.postMessage({type:'live', sequence:data.sequence, epoch:data.epoch, centerTime:data.centerTime,
        detected:pitch.detect(samples, pitch.RATE, data.noiseFloor, .22)});
      return;
    }
    if (data.type !== 'reference') return;
    const inputs = data.tracks || [{id:'Lead', samples:data.samples, sampleRate:data.sampleRate}];
    const maps = [];
    for (let trackIndex = 0; trackIndex < inputs.length; trackIndex++) {
      const input = inputs[trackIndex];
      const samples = pitch.resample(input.samples, input.sampleRate);
      input.samples = null;
      const hop = Math.round(pitch.RATE * pitch.STEP);
      const length = Math.max(0, Math.floor((samples.length - pitch.FRAME) / hop) + 1);
      const frequencies = new Float32Array(length), confidence = new Float32Array(length), levels = new Float32Array(length);
      let peak = 0;
      for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
      const floor = Math.max(.0015, peak * .0075);
      for (let index = 0; index < length; index++) {
        const result = pitch.detect(samples.subarray(index * hop, index * hop + pitch.FRAME), pitch.RATE, floor, .25);
        frequencies[index] = result.confidence >= .78 ? result.frequency : 0;
        confidence[index] = result.confidence; levels[index] = result.rms;
        if (index % 160 === 0) self.postMessage({type:'progress', id:data.id, track:input.id, progress:(trackIndex + index / Math.max(1, length)) / inputs.length});
      }
      maps.push(pitch.stabilizeReference({id:input.id, start:pitch.FRAME / (2 * pitch.RATE), step:pitch.STEP,
        duration:samples.length / pitch.RATE, frequencies, confidence, levels}, floor));
    }
    const reference = pitch.mergeReferences(maps, data.mode || 'Lead');
    const transfer = [reference.frequencies.buffer, ...maps.flatMap(map => [map.frequencies.buffer,map.confidence.buffer,map.levels.buffer])];
    self.postMessage({type:'reference', id:data.id, reference}, transfer);
  } catch (error) { self.postMessage({type:'error', id:data.id, message:error.message}); }
};
