// Decoding, single-voice pitch tracking (YIN) and the demo tune.
import { SR, HOP } from "./mono.js";

export async function decodeFile(file) {
  const data = await file.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(data);
  } finally {
    ctx.close();
  }
}

/** Band-limit and fold to one channel for the single-voice tracker. */
export async function prepare(buffer, focus = "mix", wide = false) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const len = Math.max(1, Math.ceil(buffer.duration * SR));
  const ctx = new OfflineAudioContext(ch, len, SR);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 55;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = wide ? 5500 : 3200;
  src.connect(hp).connect(lp).connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  if (ch === 1) return out.getChannelData(0);
  const l = out.getChannelData(0);
  const r = out.getChannelData(1);
  if (focus === "left") return l;
  if (focus === "right") return r;
  const m = new Float32Array(l.length);
  for (let i = 0; i < m.length; i++) m[i] = (l[i] + r[i]) * 0.5;
  return m;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** YIN, for audio that is already one voice. */
export async function trackPitch(x, onProgress, { minHz = 70, maxHz = 2000, mode = "voice" } = {}) {
  const hop = HOP;
  const W = 400;
  const tauMin = Math.max(2, Math.floor(SR / maxHz));
  const tauMax = Math.ceil(SR / minHz);
  const frames = Math.max(0, Math.floor((x.length - W - tauMax - 1) / hop));
  const f0 = new Float32Array(frames);
  const aper = new Float32Array(frames).fill(1);
  const rms = new Float32Array(frames);
  const diff = new Float32Array(tauMax + 2);
  const cmnd = new Float32Array(tauMax + 2);
  const threshold = 0.15;
  let clock = performance.now();
  for (let g = 0; g < frames; g++) {
    const y = g * hop;
    let e = 0;
    for (let i = 0; i < W; i++) e += x[y + i] * x[y + i];
    rms[g] = Math.sqrt(e / W);
    if (rms[g] > 1e-4) {
      for (let tau = 1; tau <= tauMax; tau++) {
        let s = 0;
        const o = y + tau;
        for (let i = 0; i < W; i++) {
          const d = x[y + i] - x[o + i];
          s += d * d;
        }
        diff[tau] = s;
      }
      let run = 0;
      cmnd[0] = 1;
      for (let tau = 1; tau <= tauMax; tau++) {
        run += diff[tau];
        cmnd[tau] = run > 0 ? (diff[tau] * tau) / run : 1;
      }
      let best = -1;
      for (let tau = tauMin; tau < tauMax; tau++) {
        if (cmnd[tau] < threshold) {
          while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
          best = tau;
          break;
        }
      }
      if (best < 0) {
        let m = Infinity;
        for (let tau = tauMin; tau < tauMax; tau++) if (cmnd[tau] < m) { m = cmnd[tau]; best = tau; }
      }
      // For single-instrument audio, reject noisy, non-periodic fallback matches.
      if (mode === "piano" && best > 0 && cmnd[best] > 0.45) best = -1;
      if (best > tauMin && best < tauMax - 1) {
        const a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1];
        const den = a - 2 * b + c;
        const p = den !== 0 ? (0.5 * (a - c)) / den : 0;
        f0[g] = SR / (best + Math.max(-1, Math.min(1, p)));
      } else if (best > 0) f0[g] = SR / best;
      if (best > 0) aper[g] = cmnd[best];
    }
    if (performance.now() - clock > 40) {
      if (onProgress?.(g / frames) === false) throw new Error("cancelled");
      await tick();
      clock = performance.now();
    }
  }
  let peak = 0;
  for (let g = 0; g < frames; g++) peak = Math.max(peak, rms[g]);
  if (mode === "piano" && frames && peak > 0) {
    // Only use a noise-floor estimate when the recording has clearly quiet regions.
    // Constant-level musical material should never set its own noise gate.
    const levels = Float32Array.from(rms).sort();
    const quiet = levels[Math.floor((frames - 1) * 0.2)];
    const floor = quiet < peak * 0.25 ? Math.max(peak * 0.003, quiet * 1.4) : peak * 0.003;
    for (let g = 0; g < frames; g++) if (rms[g] < floor) { f0[g] = 0; aper[g] = 1; }
  }
  onProgress?.(1);
  return { f0, aper, rms, peak, hopMs: (hop / SR) * 1000, frames, kind: mode === "piano" ? "piano" : "voice" };
}

/**
 * Ode to Joy with a band under it: lead in the centre, chords panned,
 * bass and hats. A fair test of the monophonic step.
 */
export function demoSamples(rate = 44100) {
  const names = { C: 60, D: 62, E: 64, F: 65, G: 67 };
  const score = "E E F G G F E D C C D E E. D: D- E E F G G F E D C C D E D. C: C-";
  const beat = 0.34;
  const notes = [];
  let at = 0.3;
  for (const tok of score.split(" ")) {
    let len = 1;
    if (tok.endsWith(".")) len = 1.5;
    if (tok.endsWith(":")) len = 0.5;
    if (tok.endsWith("-")) len = 2;
    notes.push({ midi: names[tok[0]] + 12, start: at, dur: len * beat * 0.9 });
    at += len * beat;
  }
  const total = at + 0.6;
  const n = Math.ceil(total * rate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

  // lead: bright, slight vibrato, dead centre
  let ph = 0;
  for (const nt of notes) {
    const s0 = Math.floor(nt.start * rate);
    const len = Math.floor(nt.dur * rate);
    const f = hz(nt.midi);
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t * 4);
      ph += (2 * Math.PI * f * vib) / rate;
      const env = Math.min(1, t / 0.02) * Math.min(1, (len - i) / (0.06 * rate)) * (0.85 + 0.15 * Math.exp(-t * 6));
      let y = 0;
      for (let h = 1; h <= 6; h++) y += Math.sin(ph * h) / (h * h * 0.7 + 0.3);
      L[s0 + i] += 0.26 * env * y;
      R[s0 + i] += 0.26 * env * y;
    }
  }
  // chords every two beats (I–V–I–V…), soft pads panned wide
  const prog = [[48, 52, 55], [43, 47, 50], [48, 52, 55], [43, 47, 50], [48, 52, 55], [41, 45, 48], [43, 47, 50], [48, 52, 55]];
  const bar = beat * 4;
  for (let b = 0; b * bar + 0.3 < total - 0.6; b++) {
    const chord = prog[b % prog.length];
    const s0 = Math.floor((0.3 + b * bar) * rate);
    const len = Math.floor(bar * rate * 0.97);
    chord.forEach((m, v) => {
      const f = hz(m + 12);
      const pan = v === 1 ? 0.5 : v === 0 ? 0.15 : 0.85;
      for (let i = 0; i < len && s0 + i < n; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.08) * Math.min(1, (len - i) / (0.1 * rate));
        const y = 0.06 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) + 0.12 * Math.sin(6 * Math.PI * f * t));
        L[s0 + i] += y * Math.cos((pan * Math.PI) / 2) * 1.4;
        R[s0 + i] += y * Math.sin((pan * Math.PI) / 2) * 1.4;
      }
    });
    // bass on beats 1 and 3
    for (let k = 0; k < 2; k++) {
      const f = hz(chord[0] - 12);
      const s1 = s0 + Math.floor(k * 2 * beat * rate);
      const len2 = Math.floor(beat * 1.8 * rate);
      for (let i = 0; i < len2 && s1 + i < n; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.01) * Math.exp(-t * 2.2);
        const y = 0.16 * env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t));
        L[s1 + i] += y;
        R[s1 + i] += y;
      }
    }
  }
  // hats on the off-beats
  for (let q = 0; 0.3 + (q + 0.5) * beat < total - 0.6; q++) {
    const s0 = Math.floor((0.3 + (q + 0.5) * beat) * rate);
    let hp = 0, prev = 0;
    for (let i = 0; i < 0.05 * rate && s0 + i < n; i++) {
      const w = rand();
      hp = 0.6 * (hp + w - prev);
      prev = w;
      const y = 0.05 * hp * Math.exp((-i / rate) * 70);
      L[s0 + i] += y * 1.2;
      R[s0 + i] += y * 0.8;
    }
  }
  return { rate, L, R, notes };
}

export function synthDemo() {
  const { rate, L, R } = demoSamples();
  const buf = new AudioBuffer({ length: L.length, sampleRate: rate, numberOfChannels: 2 });
  buf.copyToChannel(L, 0);
  buf.copyToChannel(R, 1);
  return buf;
}
