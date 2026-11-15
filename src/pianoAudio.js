// Keep a small pool of quiet, running voices ready so taps don't create audio
// graphs or wait for a new AudioContext on the critical path.
let preview;

export function primePianoAudio() {
  if (preview?.ctx.state === 'closed') preview = null;
  if (!preview) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Audio unavailable');
    const ctx = new AudioContext({latencyHint:'interactive'});
    try {
      const voices = Array.from({length:3}, () => {
        const oscillator = ctx.createOscillator(), gain = ctx.createGain();
        oscillator.type = 'triangle';
        gain.gain.setValueAtTime(0, ctx.currentTime);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start();
        return {oscillator,gain};
      });
      preview = {ctx,voices,next:0};
    } catch (error) {
      ctx.close().catch(()=>{});
      throw error;
    }
  }
  if (preview.ctx.state !== 'running') preview.ctx.resume().catch(()=>{});
  return preview;
}

export function playPianoFrequency(frequency, onError) {
  const state = primePianoAudio(), {ctx,voices} = state;
  if (ctx.state !== 'running') ctx.resume().catch(onError);
  const voice = voices[state.next++ % voices.length], now = ctx.currentTime;
  voice.oscillator.frequency.setValueAtTime(frequency, now);
  voice.gain.gain.cancelScheduledValues(now);
  voice.gain.gain.setValueAtTime(.0001, now);
  voice.gain.gain.exponentialRampToValueAtTime(.16, now+.006);
  voice.gain.gain.exponentialRampToValueAtTime(.0001, now+.30);
}

export function closePianoAudio() {
  const state = preview;
  preview = null;
  if (!state) return;
  for (const {oscillator,gain} of state.voices) {
    try { oscillator.stop(); oscillator.disconnect(); gain.disconnect(); } catch { /* already stopped */ }
  }
  if (state.ctx.state !== 'closed') state.ctx.close().catch(()=>{});
}
