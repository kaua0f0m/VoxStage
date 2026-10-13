/* VoxStage pitch/scoring primitives. YIN (de Cheveigné & Kawahara, 2002).
 * Original implementation; shared by the reference worker and deterministic tests. */
(function (root) {
  'use strict';
  const RATE = 12000, FRAME = 768, STEP = .04, MIN_CONFIDENCE = .8;
  function resample(samples, fromRate, toRate = RATE) {
    if (fromRate === toRate) return samples;
    const ratio = fromRate / toRate;
    const output = new Float32Array(Math.floor(samples.length / ratio));
    // Average the source interval: cheap anti-aliasing for the vocal pitch range.
    for (let i = 0; i < output.length; i++) {
      const start = i * ratio, end = (i + 1) * ratio;
      let sum = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        sum += (samples[Math.min(j, samples.length - 1)] || 0) * (Math.min(end, j + 1) - Math.max(start, j));
      }
      output[i] = sum / ratio;
    }
    return output;
  }
  function detect(samples, rate = RATE, noiseFloor = .004, threshold = .15) {
    const size = samples.length;
    if (size < 512) return {frequency:0, confidence:0, rms:0};
    let mean = 0, energy = 0;
    for (let i = 0; i < size; i++) mean += samples[i];
    mean /= size;
    for (let i = 0; i < size; i++) energy += (samples[i] - mean) ** 2;
    const rms = Math.sqrt(energy / size);
    if (rms < noiseFloor) return {frequency:0, confidence:0, rms};
    const minimum = Math.floor(rate / 1000), maximum = Math.min(Math.ceil(rate / 65), Math.floor(size / 2) - 1);
    const difference = new Float64Array(maximum + 2);
    const window = size - maximum - 1;
    let cumulative = 0;
    for (let lag = 1; lag <= maximum + 1; lag++) {
      let sum = 0;
      for (let i = 0; i < window; i++) sum += (samples[i] - samples[i + lag]) ** 2;
      cumulative += sum;
      difference[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
    }
    let best = -1;
    for (let lag = minimum; lag <= maximum; lag++) {
      if (difference[lag] < threshold) {
        while (lag < maximum && difference[lag + 1] < difference[lag]) lag++;
        best = lag; break;
      }
    }
    if (best < 0) return {frequency:0, confidence:0, rms};
    const left = difference[best - 1], center = difference[best], right = difference[best + 1];
    const denominator = left - 2 * center + right;
    const refined = best + (Math.abs(denominator) > 1e-12 ? .5 * (left - right) / denominator : 0);
    const frequency = rate / refined;
    return {frequency:frequency >= 65 && frequency <= 1000 ? frequency : 0, confidence:Math.max(0, 1 - center), rms};
  }
  const midi = frequency => frequency > 0 ? 69 + 12 * Math.log2(frequency / 440) : NaN;
  const frequencyForNote = note => 440 * 2 ** ((note - 69) / 12);
  const median = values => { const sorted = values.slice().sort((a,b) => a-b), middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2; };
  function stabilizeReference(track, noiseFloor = .0015) {
    const raw = track.frequencies, length = raw.length, step = track.step || STEP;
    const contour = Float64Array.from(raw, value => value > 0 ? midi(value) : NaN);
    // Only bridge short detector dropouts with audible energy and matching
    // notes on both sides. Real rests and uncertain long passages stay empty.
    const maxGap = Math.max(1, Math.floor(.161 / step));
    for (let index = 0; index < length;) {
      if (Number.isFinite(contour[index])) { index++; continue; }
      const begin = index; while (index < length && !Number.isFinite(contour[index])) index++;
      if (begin === 0 || index === length || index-begin > maxGap || Math.abs(contour[begin-1]-contour[index]) > .5) continue;
      if (!track.levels || !Array.from(track.levels.subarray(begin,index)).every(level => level >= noiseFloor)) continue;
      contour.fill((contour[begin-1]+contour[index])/2,begin,index);
    }
    // An isolated octave excursion bracketed by the same note is a common
    // harmonic error. Sustained octave changes remain musical note changes.
    for (let index = 1; index < length-1; index++) {
      if (!Number.isFinite(contour[index]) || !Number.isFinite(contour[index-1])) continue;
      const jump = contour[index]-contour[index-1];
      if (Math.abs(jump) < 11.5 || Math.abs(jump-Math.round(jump/12)*12) > .5) continue;
      let end=index+1;
      while (end < length && end-index < maxGap && Math.abs(contour[end]-contour[index]) < .5) end++;
      if (end < length && Math.abs(contour[end]-contour[index-1]) < .5) contour.fill(contour[index-1],index,end);
    }
    const filtered = contour.slice();
    for (let index = 1; index < length-1; index++) {
      if ([contour[index-1],contour[index],contour[index+1]].every(Number.isFinite)) filtered[index] = median([contour[index-1],contour[index],contour[index+1]]);
    }
    const frequencies = new Float32Array(length), notes = [];
    const minimumFrames = Math.max(2, Math.ceil(.075 / step));
    const emit = (begin,end,note) => {
      if (end-begin < minimumFrames) return;
      const frequency = frequencyForNote(note);
      frequencies.fill(frequency,begin,end);
      const confidence = track.confidence ? Array.from(track.confidence.subarray(begin,end)).reduce((sum,value)=>sum+value,0)/(end-begin) : 1;
      notes.push({startIndex:begin,endIndex:end,midi:note,frequency,confidence,
        start:Math.max(0,track.start+(begin-.5)*step),end:Math.min(track.duration,track.start+(end-.5)*step)});
    };
    for (let index = 0; index < length;) {
      if (!Number.isFinite(filtered[index])) { index++; continue; }
      let begin=index, note=Math.round(filtered[index]);
      while (++index < length && Number.isFinite(filtered[index])) {
        // Hysteresis absorbs vibrato around a note. A new note must persist
        // for two frames; do not round every frame independently.
        if (Math.abs(filtered[index]-note) < .75) continue;
        const candidate=Math.round(filtered[index]);
        if (index+1 < length && Number.isFinite(filtered[index+1]) && Math.abs(filtered[index+1]-candidate) < .5) {
          emit(begin,index,note); begin=index; note=candidate;
        }
      }
      emit(begin,index,note);
    }
    // Collapse brief detours between sustained equal notes. This groups the
    // tiny islands made by vibrato/harmonics without erasing a real transition.
    const maxDetour = Math.floor(.161/step), stableFlank = Math.ceil(.119/step);
    for (let index=1; index<notes.length-1;) {
      const left=notes[index-1], middle=notes[index], right=notes[index+1];
      const distance=Math.abs(middle.midi-left.midi);
      if (left.midi===right.midi && left.endIndex===middle.startIndex && middle.endIndex===right.startIndex &&
          middle.endIndex-middle.startIndex<=maxDetour && left.endIndex-left.startIndex>=stableFlank && right.endIndex-right.startIndex>=stableFlank &&
          (distance<=2 || distance%12===0)) {
        const frames=right.endIndex-left.startIndex;
        left.confidence=(left.confidence*(left.endIndex-left.startIndex)+middle.confidence*(middle.endIndex-middle.startIndex)+right.confidence*(right.endIndex-right.startIndex))/frames;
        left.endIndex=right.endIndex;left.end=right.end;
        frequencies.fill(left.frequency,left.startIndex,left.endIndex);
        notes.splice(index,2);index=Math.max(1,index-1);
      } else index++;
    }
    return {...track,frequencies,notes,rawVoicedSeconds:Array.from(raw).filter(value=>value>0).length*step};
  }
  class PitchDisplaySmoother {
    constructor() { this.reset(); }
    reset() { this.history=[]; this.note=null; this.time=null; }
    add(time, detected) {
      // This tracker is display-only; scoring always receives the raw detector.
      if (!(detected?.frequency > 0) || detected.confidence < MIN_CONFIDENCE || !Number.isFinite(time)) { this.reset(); return 0; }
      if (this.time !== null && (time <= this.time || time-this.time > .2)) this.reset();
      const delta=this.time === null ? .04 : time-this.time;
      this.history.push({time,note:midi(detected.frequency)});
      this.history=this.history.filter(point=>time-point.time<=.10).slice(-3);
      const target=median(this.history.map(point=>point.note));
      this.note=this.note === null || Math.abs(target-this.note)>1.2 ? target : this.note+(target-this.note)*(1-Math.exp(-delta/.04));
      this.time=time;
      return frequencyForNote(this.note);
    }
  }
  function noteName(frequency) {
    if (!(frequency > 0)) return '—';
    const note = Math.round(midi(frequency));
    return ['Dó','Dó♯','Ré','Ré♯','Mi','Fá','Fá♯','Sol','Sol♯','Lá','Lá♯','Si'][((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1);
  }
  function centsDifference(actual, expected, acceptOctave = true) {
    if (!(actual > 0 && expected > 0)) return null;
    let cents = 1200 * Math.log2(actual / expected);
    if (acceptOctave) cents -= Math.round(cents / 1200) * 1200;
    return cents;
  }
  function accuracy(actual, expected, tolerance = 75, acceptOctave = true) {
    const cents = centsDifference(actual, expected, acceptOctave);
    if (cents === null) return 0;
    const distance = Math.abs(cents);
    if (distance <= tolerance / 2) return 1;
    return Math.max(0, 1 - (distance - tolerance / 2) / (tolerance * 1.5));
  }
  function referenceCandidates(reference, index, transpose = 0) {
    if (!reference || index < 0 || index >= reference.frequencies.length) return [];
    let candidates = reference.tracks
      ? reference.tracks.filter(track => track.frequencies[index] > 0).map(track => ({frequency:track.frequencies[index], track:track.id}))
      : reference.frequencies[index] > 0 ? [{frequency:reference.frequencies[index], track:'Lead'}] : [];
    // Instruments fill missing vocals; they do not compete with a reliable voice.
    if (candidates.some(candidate => candidate.track !== 'Inst')) candidates = candidates.filter(candidate => candidate.track !== 'Inst');
    return candidates.map(candidate => ({...candidate, index, frequency:candidate.frequency * 2 ** (transpose / 12)}));
  }
  function mergeReferences(tracks, mode = 'Vocals') {
    const length = Math.max(0, ...tracks.map(track => track.frequencies.length));
    const reference = {version:5, mode, start:tracks[0]?.start || 0, step:tracks[0]?.step || STEP,
      duration:Math.max(0, ...tracks.map(track => track.duration)), frequencies:new Float32Array(length), tracks};
    for (let index = 0; index < length; index++) reference.frequencies[index] = referenceCandidates(reference,index)[0]?.frequency || 0;
    return reference;
  }
  function referenceAt(reference, time, transpose = 0, actual = 0, acceptOctave = true) {
    if (!reference || time < 0) return null;
    const index = Math.round((time - reference.start) / reference.step);
    if (index < 0 || index >= reference.frequencies.length) return null;
    const candidates = referenceCandidates(reference, index, transpose);
    if (!candidates.length) return null;
    if (actual > 0) candidates.sort((a,b) => Math.abs(centsDifference(actual,a.frequency,acceptOctave)) - Math.abs(centsDifference(actual,b.frequency,acceptOctave)));
    return {...candidates[0], candidates};
  }
  class Score {
    constructor(reference) {
      this.reference = reference; this.bins = new Map(); this.lastTime = null;
      this.notes=[];this.noteAt=new Int32Array(reference.frequencies.length).fill(-1);
      this.hitNotes=0;this.pitchSum=0;this.sungFrames=0;
      let previous=null;
      for(let index=0;index<reference.frequencies.length;index++) {
        const candidate=referenceCandidates(reference,index)[0];
        if(!candidate){previous=null;continue;}
        const key=`${candidate.track}:${Math.round(midi(candidate.frequency))}`;
        if(!previous || previous.key!==key) { previous={key,frames:0,hits:0,hit:false};this.notes.push(previous); }
        previous.frames++;this.noteAt[index]=this.notes.length-1;
      }
    }
    resetTimeline() { this.lastTime = null; }
    add(time, detected, settings = {}) {
      const previous = this.lastTime;
      this.lastTime = time;
      const actual = detected?.confidence >= MIN_CONFIDENCE ? detected.frequency : 0;
      const now = referenceAt(this.reference, time, settings.transpose || 0, actual, settings.acceptOctave !== false);
      if (previous === null || time <= previous || time - previous > .2) return now;
      const begin = Math.max(0, Math.ceil((previous - this.reference.start) / this.reference.step));
      const end = Math.min(this.reference.frequencies.length - 1, Math.floor((time - this.reference.start) / this.reference.step));
      for (let index = begin; index <= end; index++) {
        if (this.bins.has(index) || !this.reference.frequencies[index]) continue;
        const candidates = referenceCandidates(this.reference, index, settings.transpose || 0);
        const best = Math.max(0, ...candidates.map(candidate => accuracy(actual, candidate.frequency, settings.tolerance || 75, settings.acceptOctave !== false)));
        const hit=actual>0 && candidates.some(candidate=>Math.abs(centsDifference(actual,candidate.frequency,settings.acceptOctave!==false)) <= (settings.tolerance||75));
        this.bins.set(index, {score:best, sung:actual > 0});
        this.pitchSum+=best;if(actual>0)this.sungFrames++;
        const note=this.notes[this.noteAt[index]];
        if(note && hit) {
          note.hits++;
          if(!note.hit && note.hits>=Math.max(1,Math.ceil(note.frames*.35))) {note.hit=true;this.hitNotes++;}
        }
      }
      return now;
    }
    result() {
      const count = this.bins.size;
      const accuracy=this.notes.length?this.hitNotes/this.notes.length*100:0;
      return {points:this.hitNotes*1000,hitNotes:this.hitNotes,totalNotes:this.notes.length,accuracy,
        ...starRating(accuracy),pitchAccuracy:count?this.pitchSum/count*100:0,
        coverage:count ? this.sungFrames / count * 100 : 0, seconds:count * this.reference.step, frames:count};
    }
  }
  function starRating(percent) {
    return {stars:[9,18,27,36,45].filter(threshold=>percent>=threshold-1e-8).length,gold:percent>=55-1e-8};
  }
  root.VoxStagePitch = {RATE, FRAME, STEP, MIN_CONFIDENCE, resample, detect, midi, frequencyForNote, stabilizeReference, PitchDisplaySmoother, noteName, centsDifference, accuracy, referenceAt, referenceCandidates, mergeReferences, Score,starRating};
  if (typeof module !== 'undefined') module.exports = root.VoxStagePitch;
})(globalThis);
