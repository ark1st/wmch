// All effects are synthesized locally; no audio files or network requests.
import { drawTiming } from './core.mjs';
let context, bus;
export async function unlockAudio() {
  context ??= new AudioContext();
  if (context.state === 'suspended') await context.resume();
}
export function stopAudio() { if (bus) { bus.gain.setValueAtTime(0, context.currentTime); bus = null; } }
export function playDraw(round) {
  if (!context || context.state !== 'running') return;
  stopAudio();
  bus = context.createGain(); bus.gain.value = .23; bus.connect(context.destination);
  const start = context.currentTime + .03;
  const tone = (frequency, offset, length, volume, type = 'sine') => {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = type; osc.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(volume, start + offset + .005);
    gain.gain.exponentialRampToValueAtTime(.0001, start + offset + length);
    osc.connect(gain); gain.connect(bus); osc.start(start + offset); osc.stop(start + offset + length + .01);
  };
  const rustle = offset => {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * .07), context.sampleRate);
    const values = new Uint32Array(buffer.length); crypto.getRandomValues(values);
    buffer.getChannelData(0).set(Array.from(values, n => n / 0x80000000 - 1));
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = buffer; filter.type = 'bandpass'; filter.frequency.value = 1800;
    gain.gain.setValueAtTime(.12, start + offset); gain.gain.exponentialRampToValueAtTime(.0001, start + offset + .07);
    source.connect(filter); filter.connect(gain); gain.connect(bus); source.start(start + offset);
  };
  const timing = drawTiming(round.duration);
  for (let t = 0; t < timing.mixUntil / 1000; t += .075) {
    if (round.mode === 'ticket' || round.mode === 'drum') rustle(t);
    else tone(round.mode === 'ball' ? 340 : 1200, t, .035, .09, 'triangle');
  }
  round.numbers.forEach((_, i) => tone(round.mode === 'ball' ? 580 : 880, (timing.revealStart + i * timing.stagger) / 1000, .13, .23, 'triangle'));
  [784, 988, 1175].forEach((n, i) => tone(n, round.duration / 1000 - .5 + i * .08, .65, .12));
}
