// User-provided Determination flute arrangement: frequency (Hz), duration (ms).
const SCORE = `
740 36;740 252;698 36;698 228;622 264;554 264;622 252;466 264;523 528;415 516;622 264;698 252;740 36;740 336;740 144;831 36;831 516;1109 36;1109 456;932 36;932 492;932 252;932 36;932 228;932 264;932 252;
740 36;740 240;698 36;698 216;622 36;622 240;554 252;622 264;466 252;523 36;523 504;415 552;311 240;349 156;349 108;370 528;349 168;349 348;277 528;311 516;311 252;311 228;311 36;311 228;311 36;311 228;
740 36;740 240;698 36;698 216;622 36;622 240;554 252;622 252;466 276;523 528;415 504;622 264;698 252;740 36;740 348;740 144;831 36;831 516;1109 36;1109 444;932 36;932 504;932 252;932 264;932 264;932 252;
740 36;740 228;698 36;698 228;622 36;622 228;554 264;622 252;466 264;523 540;415 540;311 240;349 156;349 108;370 540;349 156;349 348;277 36;277 492;311 528;311 480;311 36;311 228;311 252;
831 36;831 240;740 264;659 36;659 228;622 264;554 252;659 276;622 492;466 36;466 756;622 36;622 228;831 264;740 264;659 36;659 228;622 264;554 252;659 264;622 1020;
311 36;311 240;415 264;554 36;554 240;523 252;466 264;415 252;466 264;523 252;466 588;311 744;349 264;370 492;494 528;622 516;587 36;587 1476;587 36;
831 36;831 252;740 252;659 36;659 240;622 264;554 252;659 264;622 504;466 36;466 756;622 264;831 264;740 252;659 36;659 240;622 252;554 264;659 264;622 1020;
311 36;311 240;415 252;554 36;554 240;523 252;466 276;415 240;466 276;523 252;466 588;311 744;349 252;370 540;349 120;349 36;349 348;277 36;277 492;311 528;311 480;311 36;311 228;311 36;311 252
`;
export function makeDemo() {
  let at = 0;
  const notes = SCORE.trim().split(/;\s*/).map(pair => {
    const [freq, dur] = pair.trim().split(/\s+/).map(Number);
    const note = { freq, dur, start: at, midi: Math.round(69 + 12 * Math.log2(freq / 440)) };
    at += dur;
    return note;
  });
  const rate = 16000, samples = Math.ceil(at * rate / 1000);
  const buffer = new AudioBuffer({ length: samples, sampleRate: rate, numberOfChannels: 1 });
  const out = buffer.getChannelData(0);
  for (const note of notes) {
    const begin = Math.round(note.start * rate / 1000), len = Math.round(note.dur * rate / 1000);
    for (let i = 0; i < len && begin + i < samples; i++) {
      const envelope = Math.min(1, i / 100, (len - i) / 100);
      out[begin + i] = 0.22 * envelope * Math.sin(2 * Math.PI * note.freq * i / rate);
    }
  }
  // Exact source notes avoid losing 36 ms notes to the analysis smoothing.
  const hopMs = 12, frames = Math.ceil(at / hopMs), f0 = new Float32Array(frames), aper = new Float32Array(frames), rms = new Float32Array(frames);
  let j = 0;
  for (let f = 0; f < frames; f++) {
    while (j + 1 < notes.length && f * hopMs >= notes[j].start + notes[j].dur) j++;
    f0[f] = notes[j].freq; rms[f] = 0.15;
  }
  return { buffer, notes, track: { f0, aper, rms, peak: 0.15, hopMs, frames, kind: 'voice' } };
}
