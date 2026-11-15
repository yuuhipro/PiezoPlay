// Polyphonic → monophonic: finds the one melody line inside a full mix.
// Harmonic-summation pitch salience over spectral peaks (Melodia-style),
// then a continuity-aware Viterbi pass so the line doesn't hop between chord tones.
// Output matches trackPitch(): { f0, aper, rms, peak, hopMs, frames }.

export const SR = 16000;
export const HOP = 192; // 12 ms, same grid as the single-voice tracker
const N = 2048; // 128 ms window
const K = 5; // pitch candidates kept per frame
const H = 8; // harmonics summed
const ALPHA = 0.8; // harmonic weight decay
const PEAK_RANGE_DB = 40;
const JUMP_COST = 0.05; // per semitone, capped at a fifth so octave leaps stay cheap
const JUMP_CAP = 7;
const BIN_CENTS = 10;
const F_REF = 27.5;

// Melody search ranges. "weight" softens the bass roll-off for low voices.
export const RANGES = {
  low: { song: [60, 700], voice: [50, 700], weight: 0.6 },
  mid: { song: [100, 1400], voice: [70, 2000], weight: 1 },
  high: { song: [190, 2100], voice: [150, 2100], weight: 1 },
};

const tick = () => new Promise((r) => setTimeout(r, 0));

let fftCache = null;
function fftTables() {
  if (fftCache) return fftCache;
  const rev = new Uint32Array(N);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(N / 2);
  const sin = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / N);
    sin[i] = -Math.sin((2 * Math.PI * i) / N);
  }
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  // A-weighting: tames bass and kick so they don't out-shout the melody.
  const aw = new Float64Array(N / 2 + 1);
  let awMax = 0;
  for (let k = 1; k <= N / 2; k++) {
    const f = (k * SR) / N;
    const f2 = f * f;
    const ra =
      (12194 ** 2 * f2 * f2) /
      ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
    aw[k] = ra;
    awMax = Math.max(awMax, ra);
  }
  for (let k = 0; k <= N / 2; k++) aw[k] /= awMax;
  const cos2 = new Float64Array(101);
  for (let i = 0; i <= 100; i++) cos2[i] = Math.cos((Math.PI / 2) * (i / 100)) ** 2;
  fftCache = { rev, cos, sin, win, aw, cos2 };
  return fftCache;
}

function fft(re, im, t) {
  for (let i = 0; i < N; i++) {
    const j = t.rev[i];
    if (j > i) {
      let x = re[i]; re[i] = re[j]; re[j] = x;
      x = im[i]; im[i] = im[j]; im[j] = x;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = t.cos[k * step];
        const wi = t.sin[k * step];
        const a = s + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

/**
 * channels: [Float32Array] or [L, R] at 16 kHz.
 * focus: mix | center | left | right. range: [loHz, hiHz].
 */
export async function melodyFromChannels(channels, { focus = "mix", range = RANGES.mid.song, weight = 1 } = {}, onProgress) {
  const t = fftTables();
  const stereo = channels.length > 1;
  const L = channels[0];
  const R = stereo ? channels[1] : channels[0];
  const len = L.length;
  const frames = Math.max(0, Math.floor((len - 1) / HOP));
  const [lo, hi] = range;
  const nBins = Math.ceil((1200 * Math.log2(hi / F_REF)) / BIN_CENTS) + 12;
  const bLo = Math.floor((1200 * Math.log2(lo / F_REF)) / BIN_CENTS);
  const bHi = Math.min(nBins - 2, Math.ceil((1200 * Math.log2(hi / F_REF)) / BIN_CENTS));
  const kMin = Math.max(2, Math.floor((lo * 0.9 * N) / SR));
  const kMax = Math.min(N / 2 - 2, Math.ceil((5000 * N) / SR));

  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const mag = new Float64Array(N / 2 + 1);
  const sal = new Float64Array(nBins);
  const pkF = new Float64Array(256);
  const pkA = new Float64Array(256);
  const candB = new Float32Array(frames * K);
  const candS = new Float32Array(frames * K);
  const candN = new Uint8Array(frames);
  const rms = new Float32Array(frames);
  const floorDb = 10 ** (-PEAK_RANGE_DB / 20);
  let clock = performance.now();

  for (let f = 0; f < frames; f++) {
    const center = f * HOP + 200; // lines up with the single-voice tracker's frames
    const start = center - N / 2;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const idx = start + i;
      const l = idx >= 0 && idx < len ? L[idx] : 0;
      const r = idx >= 0 && idx < len ? R[idx] : 0;
      let x;
      if (focus === "left") x = l;
      else if (focus === "right") x = r;
      else x = (l + r) * 0.5;
      if (i >= N / 2 - 200 && i < N / 2 + 200) e += x * x;
      // stereo packed into one complex FFT: L real, R imag
      re[i] = l * t.win[i];
      im[i] = r * t.win[i];
    }
    rms[f] = Math.sqrt(e / 400);
    fft(re, im, t);
    let mMax = 0;
    for (let k = 1; k <= N / 2; k++) {
      const nk = (N - k) % N;
      const lr = (re[k] + re[nk]) * 0.5, li = (im[k] - im[nk]) * 0.5; // L[k]
      const rr = (im[k] + im[nk]) * 0.5, ri = (re[nk] - re[k]) * 0.5; // R[k]
      let m;
      if (focus === "left") m = Math.hypot(lr, li);
      else if (focus === "right") m = Math.hypot(rr, ri);
      else {
        const mr = (lr + rr) * 0.5, mi = (li + ri) * 0.5;
        m = Math.hypot(mr, mi);
        if (focus === "center" && stereo) {
          const pl = lr * lr + li * li, pr = rr * rr + ri * ri;
          const sim = (2 * (lr * rr + li * ri)) / (pl + pr + 1e-12); // 1 = dead centre
          m *= sim > 0 ? sim * sim : 0;
        }
      }
      m *= weight === 1 ? t.aw[k] : t.aw[k] ** weight;
      mag[k] = m;
      if (k >= kMin && k <= kMax && m > mMax) mMax = m;
    }
    if (mMax > 1e-7) {
      // spectral peaks, interpolated in log magnitude
      let np = 0;
      const gate = mMax * floorDb;
      for (let k = kMin; k <= kMax && np < 256; k++) {
        const b = mag[k];
        if (b < gate || b <= mag[k - 1] || b < mag[k + 1]) continue;
        const a = 20 * Math.log10(mag[k - 1] + 1e-12);
        const bd = 20 * Math.log10(b + 1e-12);
        const c = 20 * Math.log10(mag[k + 1] + 1e-12);
        const den = a - 2 * bd + c;
        const p = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
        pkF[np] = ((k + p) * SR) / N;
        pkA[np] = 10 ** ((bd - 0.25 * (a - c) * p) / 20) / mMax;
        np++;
      }
      sal.fill(0, Math.max(0, bLo - 12), Math.min(nBins, bHi + 12));
      for (let q = 0; q < np; q++) {
        const fq = pkF[q];
        const aq = pkA[q];
        let w = 1;
        for (let h = 1; h <= H; h++, w *= ALPHA) {
          const f0 = fq / h;
          if (f0 < lo * 0.94) break;
          if (f0 > hi * 1.06) continue;
          const c = (1200 * Math.log2(f0 / F_REF)) / BIN_CENTS;
          const cb = Math.round(c);
          for (let b = Math.max(bLo, cb - 10); b <= Math.min(bHi, cb + 10); b++) {
            const d = Math.abs(b - c);
            if (d >= 10) continue;
            sal[b] += t.cos2[Math.round(d * 10)] * w * aq;
          }
        }
      }
      // keep the K strongest salience peaks
      let n = 0;
      const base = f * K;
      for (let b = bLo + 1; b < bHi; b++) {
        const s = sal[b];
        if (s <= 0 || s <= sal[b - 1] || s < sal[b + 1]) continue;
        const den = sal[b - 1] - 2 * s + sal[b + 1];
        const p = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (sal[b - 1] - sal[b + 1])) / den)) : 0;
        if (n < K) {
          candB[base + n] = b + p; candS[base + n] = s; n++;
        } else {
          let mi = 0;
          for (let j = 1; j < K; j++) if (candS[base + j] < candS[base + mi]) mi = j;
          if (s > candS[base + mi]) { candB[base + mi] = b + p; candS[base + mi] = s; }
        }
      }
      // scale by frame loudness so quiet frames don't look as confident as loud ones
      for (let j = 0; j < n; j++) candS[base + j] *= mMax;
      candN[f] = n;
    }
    if (onProgress && performance.now() - clock > 40) {
      if (onProgress((f / Math.max(1, frames)) * 0.92) === false) throw new Error("cancelled");
      await tick();
      clock = performance.now();
    }
  }

  // Normalise salience against the loud part of the song.
  const tops = [];
  for (let f = 0; f < frames; f++) {
    let m = 0;
    for (let j = 0; j < candN[f]; j++) m = Math.max(m, candS[f * K + j]);
    if (m > 0) tops.push(m);
  }
  const ref = percentile(tops, 0.9) || 1;

  // Viterbi: stay on one line, pay for leaps.
  const score = new Float64Array(frames * K);
  const back = new Int8Array(frames * K).fill(-1);
  for (let f = 0; f < frames; f++) {
    const n = candN[f];
    const base = f * K;
    const prevN = f > 0 ? candN[f - 1] : 0;
    for (let j = 0; j < n; j++) {
      const e = Math.min(1.5, candS[base + j] / ref);
      let best = 0, arg = -1;
      for (let i = 0; i < prevN; i++) {
        const st = Math.abs(candB[base + j] - candB[base - K + i]) / (100 / BIN_CENTS);
        const cost = JUMP_COST * Math.min(st, JUMP_CAP) + (st > 13 ? 0.3 + 0.05 * (st - 13) : 0);
        const v = score[base - K + i] - cost;
        if (arg < 0 || v > best) { best = v; arg = i; }
      }
      score[base + j] = e + (arg >= 0 ? Math.max(0, best) : 0);
      back[base + j] = arg >= 0 && best > 0 ? arg : -1;
    }
  }
  const choice = new Int8Array(frames).fill(-1);
  for (let f = frames - 1; f >= 0; f--) {
    if (!candN[f]) continue;
    const base = f * K;
    let j = choice[f];
    if (j < 0) {
      // chain end: best score here
      j = 0;
      for (let i = 1; i < candN[f]; i++) if (score[base + i] > score[base + j]) j = i;
    }
    choice[f] = j;
    const p = back[base + j];
    if (p >= 0 && f > 0) choice[f - 1] = p;
  }

  const f0 = new Float32Array(frames);
  const aper = new Float32Array(frames).fill(1);
  const conf = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const j = choice[f];
    if (j < 0) continue;
    f0[f] = F_REF * 2 ** ((candB[f * K + j] * BIN_CENTS) / 1200);
    conf[f] = Math.min(1, candS[f * K + j] / ref);
  }
  // smooth confidence so a note's voicing doesn't flicker
  for (let f = 0; f < frames; f++) {
    if (!f0[f]) continue;
    let s = 0, c = 0;
    for (let d = -3; d <= 3; d++) {
      const g = f + d;
      if (g < 0 || g >= frames || !f0[g]) continue;
      if (Math.abs(Math.log2(f0[g] / f0[f])) > 0.06) continue;
      s += conf[g]; c++;
    }
    // aper 0.35 (the default strictness) ≈ half as salient as the song's loud melody
    aper[f] = 0.7 * (1 - s / c);
  }
  let peak = 0;
  for (let f = 0; f < frames; f++) peak = Math.max(peak, rms[f]);
  onProgress?.(1);
  return { f0, aper, rms, peak, hopMs: (HOP / SR) * 1000, frames, kind: "song" };
}

/** Render to 16 kHz, keeping stereo when there is one. */
export async function renderChannels(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const len = Math.max(1, Math.ceil(buffer.duration * SR));
  const ctx = new OfflineAudioContext(ch, len, SR);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return ch > 1 ? [out.getChannelData(0), out.getChannelData(1)] : [out.getChannelData(0)];
}

/** One clean sung-sine line from a track, so you can hear what the tool will read. */
export function renderMono(track, voiced, rate = 22050) {
  const hop = track.hopMs / 1000;
  const len = Math.max(1, Math.ceil((track.frames * hop + 0.2) * rate));
  const out = new AudioBuffer({ length: len, sampleRate: rate, numberOfChannels: 1 });
  const d = out.getChannelData(0);
  let phase = 0, amp = 0, freq = 0;
  const atk = 1 - Math.exp(-1 / (0.008 * rate));
  const glide = 1 - Math.exp(-1 / (0.012 * rate));
  const peak = track.peak || 1;
  for (let i = 0; i < len; i++) {
    const f = Math.min(track.frames - 1, Math.floor(i / rate / hop));
    const on = f >= 0 && voiced(f);
    const target = on ? 0.32 * Math.min(1, Math.sqrt(track.rms[f] / peak) * 1.3 + 0.25) : 0;
    if (on) freq = freq ? freq + (track.f0[f] - freq) * (Math.abs(track.f0[f] / freq - 1) > 0.03 ? 1 : glide) : track.f0[f];
    amp += (target - amp) * atk;
    if (amp < 1e-5 && !on) continue;
    phase += (2 * Math.PI * freq) / rate;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    d[i] = amp * (Math.sin(phase) + 0.28 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase));
  }
  return out;
}
