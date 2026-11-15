/*
 * MP3 → Arduino tone(). Subject: a hobbyist turning a song into a buzzer sketch.
 * Look: brass music-box punch strip + piezo disc, navy console for code.
 * Type: Bricolage Grotesque display, Outfit text, JetBrains Mono figures.
 * Flow: upload → step 1 "make it monophonic" (pull one melody line out of a full mix,
 *       pick channel + range, audition it) → step 2 ears + sketch.
 * Signature: the punch strip; holes are notes, faint dots are raw pitch.
 */
import { useTheme } from "next-themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, Copy, Download, FileHeadphone, Layers, Pause, Play, RotateCcw, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import "./styles.css";
import { decodeFile, prepare, trackPitch } from "./audio.js";
import { exportNotes, flashEstimate, foldMidi, frameVoiced, generateSketch, midiToHz, noteName, segment } from "./melody.js";
import { melodyFromChannels, RANGES, renderChannels, renderMono } from "./mono.js";
import { makeDemo } from "./demo.js";
import { displayFileName } from "./filename.js";
import { loadMusicXML, convertScore } from "./musicxml.js";
import { loadMidi } from "./midi.js";
import ScoreStage from "./ScoreStage.jsx";
import NoteEditor from "./NoteEditor.jsx";
import PunchStrip from "./PunchStrip.jsx";
import { primePianoAudio, closePianoAudio } from "./pianoAudio.js";
import Piezo from "./Piezo.jsx";
import MonoStage from "./MonoStage.jsx";

const PRESETS = {
  speaker: { maxAper: 0.35, gateDb: -40, minNoteMs: 80, minRestMs: 60, transpose: 0, fold: false, splitRepeats: true },
  piezo: { maxAper: 0.3, gateDb: -34, minNoteMs: 70, minRestMs: 50, transpose: 0, fold: true, splitRepeats: true },
};
const DEFAULT_EARS = PRESETS.speaker;
const DEMO_EARS = { ...DEFAULT_EARS, minNoteMs: 24, minRestMs: 24 };
const presetOf = (s) => Object.keys(PRESETS).find((k) => Object.keys(PRESETS[k]).every((f) => PRESETS[k][f] === s[f])) || "";
const fmt = (ms) => {
  const s = Math.max(0, ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
const SOURCE_LABEL = { song: "Full song", voice: "One voice" };
const FOCUS_LABEL = { mix: "mix", center: "centre", left: "left", right: "right" };

function Knob({ label, value, display, min, max, step, onChange, hint }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-sm">{label}</Label>
        <span className="font-mono text-sm text-primary">{display ?? value}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} />
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Keep mono options valid for this file. */
function fitMono(opts, buffer) {
  const next = { ...opts };
  const stereo = !buffer || buffer.numberOfChannels > 1;
  if (!stereo) next.focus = "mix";
  if (next.source !== "song" && next.focus === "center") next.focus = "mix";
  return next;
}

export default function App() {
  const { resolvedTheme, setTheme } = useTheme();
  const darkMode = resolvedTheme !== "light";
  const [file, setFile] = useState(null);
  const [track, setTrack] = useState(null);
  const [progress, setProgress] = useState(null);
  const [ears, setEars] = useState(DEFAULT_EARS);
  const [draftEars, setDraftEars] = useState(DEFAULT_EARS);
  const [demoExact, setDemoExact] = useState(false);
  const [manualNotes, setManualNotes] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorClosing, setEditorClosing] = useState(false);
  const [editorLoadProgress, setEditorLoadProgress] = useState(0);
  const editorLoadSource = useRef(null);
  const closingLoadFrame = useRef(0);
  const [editorDraft, setEditorDraft] = useState(null);
  const [editorDuration, setEditorDuration] = useState(null);
  const [editorSelected, setEditorSelected] = useState(null);
  const editorRef = useRef(null);
  useEffect(() => {
    if (!editorOpen) { closePianoAudio(); setEditorDraft(null); setEditorDuration(null); setEditorSelected(null); setEditorLoading(false); setEditorClosing(false); editorLoadSource.current = null; }
    return () => {
      if (editorOpen) closePianoAudio();
      if (closingLoadFrame.current) {cancelAnimationFrame(closingLoadFrame.current);closingLoadFrame.current=0;}
    };
  }, [editorOpen]);
  const [visibleSeconds, setVisibleSeconds] = useState([0, 0]);
  const updateVisibleSeconds = useCallback(next => setVisibleSeconds(old => old[0] === next[0] && old[1] === next[1] ? old : next), []);
  const [speed, setSpeed] = useState(1);
  const [draftSpeed, setDraftSpeed] = useState(1);
  const [score, setScore] = useState(null);
  const [scoreFileName, setScoreFileName] = useState("");
  const [scorePart, setScorePart] = useState("");
  const [scoreWarning, setScoreWarning] = useState("");
  const [confirmReload, setConfirmReload] = useState(false);
  const [section, setSection] = useState([0, 0]);
  const [draftSection, setDraftSection] = useState([0, 0]);
  const [format, setFormat] = useState("lines");
  const [board, setBoard] = useState("uno");
  const [customFlash, setCustomFlash] = useState("32");
  const [staccato, setStaccato] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [pin, setPin] = useState("8");
  const [playing, setPlaying] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stage, setStage] = useState("mono");
  const [mono, setMonoState] = useState({ source: "song", focus: "mix", range: "mid", wide: false, pitchLimits: [31, 107] });
  const [pitchLimits, setPitchLimits] = useState([31, 107]);
  const [draftWide, setDraftWide] = useState(false);
  const inputRef = useRef(null);
  const fileRequest = useRef(0);
  const scoreInputRef = useRef(null);
  const ctxRef = useRef(null);
  const sources = useRef([]);
  const clock = useRef({ ms: () => null, kind: null });
  const stopTimer = useRef(null);
  const runId = useRef(0);
  const monoRef = useRef(mono);
  const sourceDuration = file?.scoreNotes ? file.scoreDuration : file ? file.buffer.duration * 1000 : 0;
  const durationMs = manualNotes && stage === "edit" ? manualNotes.duration : sourceDuration;
  const set = (key) => (v) => setDraftEars((s) => ({ ...s, [key]: v }));

  const analyze = useCallback(async (buffer, opts, preserve = false, fallback = null) => {
    const id = ++runId.current;
    const alive = (p) => {
      if (id !== runId.current) return false;
      setProgress(p);
    };
    if (!preserve) setTrack(null);
    setProgress(0);
    try {
      const r = RANGES[opts.range];
      const limits = opts.wide ? opts.pitchLimits.map(midiToHz) : null;
      let tr;
      if (opts.source === "song") {
        const channels = await renderChannels(buffer);
        if (id !== runId.current) return;
        tr = await melodyFromChannels(channels, { focus: opts.focus, range: limits || r.song, weight: r.weight }, alive);
      } else {
        const x = await prepare(buffer, opts.focus, opts.wide);
        if (id !== runId.current) return;
        tr = await trackPitch(x, alive, { minHz: limits?.[0] ?? r.voice[0], maxHz: limits?.[1] ?? r.voice[1] });
      }
      if (id !== runId.current) return;
      setTrack(tr);
      setDemoExact(false);
      setProgress(null);
    } catch (err) {
      if (id !== runId.current) return;
      console.warn(err);
      setProgress(null);
      if (preserve && fallback) {
        monoRef.current = fallback;
        setMonoState(fallback);
        setPitchLimits(fallback.pitchLimits);
        setDraftWide(fallback.wide);
        toast.error("Couldn't recheck the melody. Previous settings and notes were kept.");
      } else toast.error("Couldn't find a melody in that file.");
    }
  }, []);

  const setMono = (next) => {
    const fitted = fitMono(next, file?.buffer);
    stop();
    monoRef.current = fitted;
    setMonoState(fitted);
    if (file) analyze(file.buffer, fitted);
  };

  const setWideRange = (changes) => {
    const previous = monoRef.current;
    const next = { ...previous, ...changes };
    stop();
    monoRef.current = next;
    setMonoState(next);
    if (file) analyze(file.buffer, next, true, previous);
  };

  const load = useCallback(
    async (name, loader) => {
      const request = ++fileRequest.current;
      stop();
      runId.current++;
      setFile(null);
      setTrack(null);
      setStage("mono");
      setManualNotes(null); setEditorOpen(false); setSpeed(1); setDraftSpeed(1);
      setDemoExact(false);
      setEars(DEFAULT_EARS);
      setDraftEars(DEFAULT_EARS);
      setProgress(0);
      let buffer;
      try {
        buffer = await loader();
      } catch (err) {
        if (request !== fileRequest.current) return;
        console.warn(err);
        setProgress(null);
        toast.error("Couldn't read that file. Try an MP3, WAV or OGG.");
        return;
      }
      if (request !== fileRequest.current) return;
      setFile({ name, buffer });
      setSection([0, buffer.duration * 1000]);
      setDraftSection([0, buffer.duration * 1000]);
      setDraftWide(monoRef.current.wide);
      setPitchLimits(monoRef.current.pitchLimits);
      const fitted = fitMono(monoRef.current, buffer);
      monoRef.current = fitted;
      setMonoState(fitted);
      await analyze(buffer, fitted);
    },
    [analyze],
  );

  const openScore = async (f) => {
    const request = ++fileRequest.current;
    try {
      const parsed = /\.(mid|midi)$/i.test(f.name) ? await loadMidi(f) : await loadMusicXML(f);
      if (request !== fileRequest.current) return;
      stop(); runId.current++;
      setManualNotes(null); setEditorOpen(false); setSpeed(1); setDraftSpeed(1);
      setScore(parsed); setScoreFileName(f.name); setScorePart(parsed.parts[0].id); setScoreWarning("");
      setFile(null); setTrack(null); setProgress(null); setStage("score");
    } catch (e) {
      if (request === fileRequest.current) {
        if (!file && !track) setProgress(null);
        toast.error(e.message || "Could not read this MusicXML or MIDI file.");
      }
    }
  };
  const onFiles = (files) => {
    const f = files?.[0];
    if (f) { if (/\.(mxl|musicxml|xml|mid|midi)$/i.test(f.name)) openScore(f); else load(f.name, () => decodeFile(f)); }
  };
  const convertSelectedScore = () => {
    try {
      const result = convertScore(score, scorePart);
      if (!result.notes.some(n => n.midi >= 0)) throw new Error("This voice has no playable notes.");
      const selected = score.parts.find(p => p.id === scorePart);
      stop(); setManualNotes(null); setEditorOpen(false); setSpeed(1); setDraftSpeed(1); setDemoExact(false); setFile({ name:scoreFileName, scoreNotes:result.notes, scoreDuration:result.durationMs, scoreLabel:selected.label });
      setTrack({ sheet: true }); setEars(DEMO_EARS); setDraftEars(DEMO_EARS); setDraftWide(false);
      setSection([0,result.durationMs]); setDraftSection([0,result.durationMs]);
      setScoreWarning(result.overlaps ? "Overlapping notes were reduced to the highest note for the buzzer." : "");
      setStage("edit");
    } catch (e) { toast.error(e.message || "Could not convert this score."); }
  };

  const notes = useMemo(() => {
    if (!track) return [];
    if (manualNotes && stage === "edit") return manualNotes.notes.map(n => {
      if (n.midi < 0) return n;
      const shifted = Math.max(0, Math.min(155, n.midi + ears.transpose - manualNotes.transpose));
      const midi = foldMidi(shifted, ears.fold);
      return { ...n, midi, freq: midi === n.midi ? n.freq : midiToHz(midi) };
    });
    if ((demoExact && file?.demoNotes) || file?.scoreNotes) {
      const sourceNotes = file.scoreNotes || file.demoNotes;
      if (stage === "mono") return sourceNotes;
      const out = [];
      for (const n of sourceNotes) {
        const midi = n.midi < 0 ? -1 : foldMidi(n.midi + ears.transpose, ears.fold);
        const note = { ...n, midi, freq: midi < 0 ? 0 : midi === n.midi ? n.freq : midiToHz(midi) };
        const last = out[out.length - 1];
        if (!file.scoreNotes && n.dur < ears.minNoteMs && last) { last.dur += n.dur; continue; }
        if (!file.scoreNotes && !ears.splitRepeats && last && last.midi === midi) { last.dur += n.dur; continue; }
        out.push(note);
      }
      return out;
    }
    const settings = stage === "mono" ? DEFAULT_EARS : ears;
    return segment(track, settings);
  }, [track, ears, stage, mono.source, file, demoExact, manualNotes]);
  const stripNotes = useMemo(() => editorOpen && editorDraft ? editorDraft.filter(n => Number.isFinite(n.start) && n.start >= 0 && Number.isFinite(n.dur) && n.dur > 0) : notes, [editorOpen, editorDraft, notes]);
  const stripDuration = useMemo(() => editorOpen && editorDraft ? stripNotes.reduce((end, n) => Math.max(end, n.start + n.dur), editorDuration ?? durationMs) : durationMs, [editorOpen, editorDraft, stripNotes, durationMs, editorDuration]);
  useEffect(() => {
    if (!editorOpen || !editorLoading) return;
    const source = editorLoadSource.current;
    if (!source) return;
    const prepared = new Array(source.length);
    let index = 0, frame = 0, cancelled = false;
    const step = () => {
      if (cancelled) return;
      const end = Math.min(source.length,index+256);
      for (; index<end; index++) prepared[index] = {...source[index],id:index+1};
      setEditorLoadProgress(source.length ? Math.round(index / source.length * 100) : 100);
      if (index < source.length) frame=requestAnimationFrame(step);
      else {
        editorLoadSource.current = null;
        setEditorDraft(prepared);
        setEditorSelected(prepared.length ? 1 : null);
        setEditorLoading(false);
      }
    };
    frame=requestAnimationFrame(step);
    return () => { cancelled=true; if (frame) cancelAnimationFrame(frame); };
  }, [editorOpen,editorLoading]);
  const exported = useMemo(() => {
    const clipped = exportNotes(notes, section[0], section[1], !!file?.scoreNotes || !!manualNotes);
    let carry = 0;
    return clipped.map(n => { const want = n.dur * 1000 / speed + carry; const us = Math.max(1, Math.round(want)); carry = want - us; return { ...n, us, ms: us / 1000 }; });
  }, [notes, section, file?.scoreNotes, manualNotes, speed]);
  const title = file ? `${file.name.replace(/\.[^.]+$/, "").replace(/[\r\n\u2028\u2029]/g, " ")} for Arduino tone()` : "";
  const sketch = useMemo(
    () =>
      exported.length
        ? generateSketch(exported, { pin: pin || "8", format, staccato, repeat, title, speaker: !ears.fold })
        : "",
    [exported, pin, format, staccato, repeat, title, ears.fold],
  );
  const flash = flashEstimate(exported, format);
  const boardBytes = board === "uno" ? 32256 : board === "mega" ? 253952 : (Number(customFlash)>0 ? Number(customFlash)*1024 : null);
  const noteCount = exported.filter((n) => n.midi >= 0).length;

  function stop() {
    sources.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    sources.current = [];
    clearTimeout(stopTimer.current);
    clock.current = { ms: () => null, kind: null };
    setPlaying(null);
  }

  const reloadSetup = () => {
    fileRequest.current++; runId.current++; stop();
    setFile(null); setTrack(null); setProgress(null); setStage("mono");
    setScore(null); setScoreFileName(""); setScorePart(""); setScoreWarning("");
    setDemoExact(false); setManualNotes(null); setEditorOpen(false); setEditorDraft(null); setEditorSelected(null);
    setSpeed(1); setDraftSpeed(1); setEars(DEFAULT_EARS); setDraftEars(DEFAULT_EARS);
    const resetMono = { source:"song", focus:"mix", range:"mid", wide:false, pitchLimits:[31,107] };
    monoRef.current = resetMono; setMonoState(resetMono); setDraftWide(false); setPitchLimits([31,107]);
    setSection([0,0]); setDraftSection([0,0]); setFormat("lines"); setStaccato(false); setRepeat(false); setPin("8"); setDragOver(false);
    setVisibleSeconds([0,0]); setConfirmReload(false);
    document.getElementById("root")?.scrollTo({ top:0, behavior:"smooth" });
  };

  async function play(kind, from) {
    if (!file) return;
    stop();
    const ctx = ctxRef.current || (ctxRef.current = new AudioContext());
    await ctx.resume();
    const [lo, hi] = stage === "mono" ? [0, durationMs] : section;
    const start = Math.max(lo, Math.min(from ?? lo, hi - 50));
    const end = hi;
    const t0 = ctx.currentTime + 0.06;
    const rate = kind === "buzzer" ? speed : 1;
    if (kind === "buzzer") {
      const osc = ctx.createOscillator();
      osc.type = "square";
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, 0);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6000;
      osc.connect(gain).connect(lp).connect(ctx.destination);
      for (const n of notes) {
        const a = Math.max(n.start, start);
        const b = Math.min(n.start + n.dur, end);
        if (b <= a) continue;
        const at = t0 + (a - start) / (1000 * rate);
        if (n.midi < 0) gain.gain.setValueAtTime(0, at);
        else {
          osc.frequency.setValueAtTime(n.freq, at);
          gain.gain.setValueAtTime(0.07, at);
          if (staccato) gain.gain.setValueAtTime(0, at + ((b - a) * 0.88) / (1000 * rate));
        }
      }
      const stopAt = t0 + (end - start) / (1000 * rate);
      gain.gain.setValueAtTime(0, stopAt);
      osc.start(t0);
      osc.stop(stopAt + 0.05);
      sources.current = [osc];
    } else {
      const buf = kind === "mono" ? renderMono(track, (f) => frameVoiced(track, f, ears)) : file.buffer;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(t0, start / 1000, Math.max(0.05, (end - start) / 1000));
      sources.current = [src];
    }
    clock.current = { kind, ms: () => start + Math.max(0, ctx.currentTime - t0) * 1000 * rate };
    setPlaying(kind);
    stopTimer.current = setTimeout(stop, (end - start) / rate + 200);
  }

  useEffect(() => () => stop(), []);

  const copyText = async (text) => {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* Try the fallback for browsers without clipboard permission. */ }
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    let success = false;
    try { success = document.execCommand("copy"); } catch { /* Clipboard unavailable. */ }
    ta.remove();
    return success;
  };
  const copy = async () => {
    if (!(await copyText(sketch))) { toast.error("Copy failed. Try downloading the .ino file instead."); return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const baseName = (file?.name || "Melody").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Melody";
  const firstLetter = baseName.match(/\p{L}/u)?.[0] || "M";
  const filename = `${firstLetter.toUpperCase()}_mp3toTone.ino`;
  const [nameCopied, setNameCopied] = useState(false);
  const copyName = async () => {
    if (!(await copyText(filename))) { toast.error("Could not copy the filename. You can download the .ino file instead."); return; }
    setNameCopied(true); setTimeout(() => setNameCopied(false), 1600);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([sketch], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const busy = progress != null;
  const preset = presetOf(draftEars);
  const dirty = draftSpeed !== speed || JSON.stringify(draftEars) !== JSON.stringify(ears) || JSON.stringify(draftSection) !== JSON.stringify(section) || (!file?.scoreNotes && (draftWide !== mono.wide || (draftWide && JSON.stringify(pitchLimits) !== JSON.stringify(mono.pitchLimits))));
  const applyEars = () => {
    if (file?.scoreNotes && file.scoreNotes.some(n => n.midi >= 0 && (n.midi + draftEars.transpose < 0 || n.midi + draftEars.transpose > 155))) {
      toast.error("That transposition would put a note outside the representable tone range. Choose a smaller shift.");
      return;
    }
    stop();
    setEars(draftEars);
    setSpeed(draftSpeed);
    setSection(draftSection);
    if (!file?.scoreNotes && (draftWide !== mono.wide || (draftWide && JSON.stringify(pitchLimits) !== JSON.stringify(mono.pitchLimits)))) setWideRange({ wide: draftWide, pitchLimits });
  };
  const consoleToggle =
    "border-console-dim/40! bg-transparent! text-console-dim! hover:text-console-text! data-[state=on]:bg-brass/25! data-[state=on]:text-console-text!";

  return (
    <main
      className="@container min-h-screen bg-background text-foreground"
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <Toaster richColors />
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Start over?</AlertDialogTitle><AlertDialogDescription>This clears the current song and any unsaved note edits. Download the sketch first if you want to keep it.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={reloadSetup}>Start over</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a"
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input ref={scoreInputRef} type="file" accept=".musicxml,.xml,.mxl,.mid,.midi,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,audio/midi,audio/x-midi" className="hidden" onChange={(e)=>{ onFiles(e.target.files); e.target.value=""; }} />
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-8 px-6 py-10 @3xl:px-12">
        <div className="flex flex-wrap items-center justify-end gap-4">
          <Button type="button" variant="outline" size="sm" onClick={() => file || score || progress != null ? setConfirmReload(true) : reloadSetup()}><RotateCcw /> Reload</Button>
          <div className="flex items-center gap-3">
            <Label htmlFor="dark-mode" className="cursor-pointer text-sm">Dark mode</Label>
            <Switch id="dark-mode" aria-label="Dark mode" checked={darkMode} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} />
          </div>
        </div>
        <header className="flex flex-col-reverse items-start justify-between gap-6 @3xl:flex-row @3xl:items-center">
          <div className="grid min-w-0 gap-3">
            <p className="font-mono text-sm text-primary">
              pin {pin || "8"} · {ears.fold ? "piezo" : "speaker"} · monophonic
            </p>
            <h1 className="font-display text-6xl leading-[0.92] font-semibold tracking-tight @3xl:text-8xl">
              mp3 <span className="text-primary">→</span> tone()
            </h1>
            <p className="max-w-md text-lg text-muted-foreground">Drop a song. Get its melody as an Arduino sketch.<br /><span className="maker-credit">made by William Jr.</span></p>
          </div>
          <div className={playing === "buzzer" ? "" : "idle-breathe"}>
            <Piezo clock={clock} notes={notes} playing={playing} />
          </div>
        </header>

        {stage === "score" && score ? (
          <ScoreStage name={scoreFileName} score={score} selected={scorePart} setSelected={setScorePart} onConvert={convertSelectedScore} onReplace={()=>scoreInputRef.current?.click()} onAudio={()=>inputRef.current?.click()} />
        ) : !file && !busy ? (
          <section
            data-over={dragOver}
            className="dropzone grid place-items-center gap-4 rounded-2xl border-2 border-dashed border-brass-deep/50 bg-brass/15 px-6 py-16 text-center"
          >
            <AudioLines className="size-10 text-primary" />
            <div>
              <p className="font-display text-2xl font-semibold">Drop an MP3, MusicXML or MIDI here</p>
              <p className="mt-1 text-muted-foreground">Audio is made monophonic. MusicXML and MIDI read notes directly.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button type="button" size="lg" onClick={() => inputRef.current?.click()}>
                <Upload /> Choose audio
              </Button>
              <Button type="button" size="lg" variant="outline" onClick={() => scoreInputRef.current?.click()}><Upload /> Upload MusicXML / MIDI</Button>
              <Button type="button" size="lg" variant="outline" onClick={() => {
                stop(); runId.current++; fileRequest.current++;
                setManualNotes(null); setEditorOpen(false); setSpeed(1); setDraftSpeed(1);
                const demo = makeDemo();
                const options = { source: "voice", focus: "mix", range: "mid", wide: false, pitchLimits: [31, 107] };
                monoRef.current = options; setMonoState(options); setDraftWide(false); setPitchLimits(options.pitchLimits);
                setFile({ name: "Determination Flute by Toby fox.wav", buffer: demo.buffer, demoNotes: demo.notes });
                setTrack(demo.track); setDemoExact(true); setProgress(null); setStage("mono");
                setEars(DEMO_EARS); setDraftEars(DEMO_EARS);
                setSection([0, demo.buffer.duration * 1000]); setDraftSection([0, demo.buffer.duration * 1000]);
              }}>
                <Sparkles /> Try a demo tune
              </Button>
            </div>
          </section>
        ) : stage === "mono" ? (
          <MonoStage
            file={file}
            mono={mono}
            setMono={setMono}
            track={track}
            progress={progress}
            notes={notes}
            ears={ears}
            clock={clock}
            playing={playing}
            onPlay={play}
            onStop={stop}
            onReplace={() => inputRef.current?.click()}
            onMusicXML={() => scoreInputRef.current?.click()}
            onDone={() => {
              stop();
              if (!demoExact) { setEars(DEFAULT_EARS); setDraftEars(DEFAULT_EARS); }
              setStage("edit");
            }}
            fmt={fmt}
          />
        ) : (
          <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <FileHeadphone className="size-5 shrink-0 text-primary" />
                <span className="min-w-0 max-w-full truncate font-medium" title={file?.name}>{displayFileName(file?.name)}</span>
                <span className="font-mono text-sm text-muted-foreground">{fmt(durationMs)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    stop();
                    setStage(file?.scoreNotes ? "score" : "mono");
                  }}
                >
                  <Layers /> {file?.scoreNotes ? file.scoreLabel : `${SOURCE_LABEL[mono.source]} · ${FOCUS_LABEL[mono.focus]} · ${mono.wide ? "custom pitch range" : mono.range}`}
                </Button>
                <Button type="button" variant="link" size="sm" onClick={() => file?.scoreNotes ? scoreInputRef.current?.click() : inputRef.current?.click()}>
                  Replace
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={!track || busy} onClick={() => (playing === "buzzer" ? stop() : play("buzzer"))}>
                  {playing === "buzzer" ? <Pause /> : <Play />} {playing === "buzzer" ? "Stop" : "Play as buzzer"}
                </Button>
                {!file?.scoreNotes && <Button type="button" variant="outline" onClick={() => (playing === "original" ? stop() : play("original"))}>
                  {playing === "original" ? <Pause /> : <Play />} Original
                </Button>}
              </div>
            </div>
            {file?.scoreNotes && scoreWarning && <p className="text-sm text-foreground">⚠ {scoreWarning}</p>}
            {file?.scoreNotes && score?.warnings.map(w => <p key={w} className="text-sm text-foreground">⚠ {w}</p>)}
            {busy && <p role="status" className="text-sm text-primary">Rechecking the melody for the new pitch range… {Math.round(progress * 100)}%</p>}
            <PunchStrip
              notes={stripNotes}
              track={file?.scoreNotes ? null : track}
              settings={ears}
              durationMs={stripDuration}
              range={editorOpen ? [0, stripDuration] : section}
              clock={clock}
              playing={playing}
              onSeek={(ms) => { if (!busy && !editorOpen) play("buzzer", ms); }}
              onSelectNote={editorOpen && !editorLoading && !editorClosing ? setEditorSelected : undefined}
              onEditNote={editorOpen && !editorLoading && !editorClosing ? (change) => editorRef.current?.editFromStrip(change) : undefined}
              selectedNoteId={editorSelected}
              onViewChange={updateVisibleSeconds}
            />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pl-10 text-sm text-muted-foreground">
              <StripTime visibleSeconds={visibleSeconds} clock={clock} playing={playing} />
              <span>
                <b className="font-mono text-foreground">{noteCount}</b> notes
              </span>
              <span>
                <b className="font-mono text-foreground">{exported.length - noteCount}</b> rests
              </span>
              <span>
                <b className="font-mono text-foreground">≈{(flash / 1024).toFixed(1)} KB</b> flash
              </span>
              <span>{editorClosing ? "Closing the editor…" : editorLoading ? "Preparing the editor…" : editorOpen ? "Drag to reorder; resize shifts later notes and changes length." : file?.scoreNotes || manualNotes ? "Click the strip to play from there." : "Faint dots are raw pitch. Click the strip to play from there."}</span>
              {editorOpen && editorSelected != null && <span className="font-mono text-primary">Editing {noteName(editorDraft?.find(n => n.id === editorSelected)?.midi ?? -1)}</span>}
              <Button type="button" variant="outline" size="sm" disabled={busy || editorClosing} onClick={() => {
                stop();
                if (!editorOpen) {
                  try { primePianoAudio(); } catch { /* editing still works without audio */ }
                  editorLoadSource.current=notes; setEditorLoadProgress(0); setEditorDraft(null); setEditorDuration(durationMs); setEditorSelected(null); setEditorLoading(true); setEditorOpen(true);
                } else if (editorRef.current) {
                  editorRef.current.cancel();
                } else {
                  // Closing while preparation is still running: cancel the
                  // pending loader and show the same closing state.
                  editorLoadSource.current=null; setEditorLoading(false); setEditorClosing(true);
                  closingLoadFrame.current=requestAnimationFrame(() => {
                    closingLoadFrame.current=requestAnimationFrame(() => {
                      closingLoadFrame.current=0;setEditorOpen(false);setEditorDraft(null);setEditorSelected(null);
                    });
                  });
                }
              }}>{editorOpen ? "Close note editor" : "Add / edit notes"}</Button>
            </div>
            {editorOpen && editorLoading && <div role="status" className="grid gap-3 rounded-2xl bg-card p-6 text-sm text-muted-foreground ring-1 ring-border"><div className="flex items-center justify-between gap-3"><span>Preparing your notes…</span><span className="font-mono">{editorLoadProgress}%</span></div><Progress value={editorLoadProgress} aria-label="Preparing editor" /></div>}
            {editorOpen && editorClosing && !editorDraft && <div role="status" className="grid gap-3 rounded-2xl bg-card p-6 text-sm text-muted-foreground ring-1 ring-border"><span>Closing editor…</span><Progress aria-label="Closing editor" /></div>}
            {editorOpen && !editorLoading && editorDraft && <NoteEditor ref={editorRef} sourceNotes={editorDraft} totalDuration={durationMs} selected={editorSelected} setSelected={setEditorSelected} onDraftChange={setEditorDraft} onDurationChange={setEditorDuration} onClosingChange={setEditorClosing} onCancel={() => { setEditorOpen(false); setEditorDraft(null); setEditorSelected(null); }} onSave={(updated, duration) => {
              stop();
              const wasFull = section[1] >= durationMs - 1;
              setManualNotes({notes:updated, duration, transpose:ears.transpose});
              if (wasFull) { setSection([section[0],duration]); setDraftSection([draftSection[0],duration]); }
              else if (section[1] > duration) { setSection([Math.min(section[0],duration),duration]); setDraftSection([Math.min(draftSection[0],duration),duration]); }
              setEditorOpen(false); setEditorDraft(null); setEditorSelected(null);
            }} />}
            {manualNotes && <div className="flex flex-wrap items-center gap-3 pl-10 text-sm text-muted-foreground"><span>Manual notes are active. Detection changes won’t replace them.</span><Button type="button" variant="link" size="sm" onClick={() => { stop(); setManualNotes(null); setEditorOpen(false); setSection([0,sourceDuration]); setDraftSection([0,sourceDuration]); }}>Use detected notes</Button></div>}
          </section>
        )}

        {file && track && stage === "edit" && !editorOpen && (
          <section className="grid items-start gap-6 @5xl:grid-cols-[320px_minmax(0,1fr)]">
            <div className="grid gap-6 rounded-2xl bg-card p-6 ring-1 ring-border">
              <div className="grid gap-1">
                <h2 className="font-display text-2xl font-semibold">{file?.scoreNotes ? "Buzzer settings" : "Ears"}</h2>
                <p className="text-sm text-muted-foreground">{file?.scoreNotes ? "Adjust the score for your buzzer, then apply your changes." : "How the tool hears your melody. Adjust the controls, then apply them together to avoid lag."}</p>
              </div>
              <div className="grid gap-2">
                <Label className="text-sm">Start from</Label>
                <ToggleGroup type="single" value={preset} onValueChange={(v) => v && setDraftEars(PRESETS[v])} variant="outline" size="sm" className="w-full">
                  <ToggleGroupItem value="speaker" className="flex-1">
                    Speaker
                  </ToggleGroupItem>
                  <ToggleGroupItem value="piezo" className="flex-1">
                    Piezo
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-sm text-muted-foreground">
                  {preset === "piezo"
                    ? "Notes folded into C4–C7 so a tiny buzzer can play them."
                    : preset === "speaker"
                      ? "The song's real pitch, low notes and all. Best on a small speaker."
                      : "Custom ears. Pick a preset to start over."}
                </p>
              </div>
              {!file?.scoreNotes && <><Knob
                label="Pitch strictness"
                value={Math.round((1 - draftEars.maxAper) * 100)}
                display={`${Math.round((1 - draftEars.maxAper) * 100)}%`}
                min={40}
                max={95}
                step={1}
                onChange={(v) => set("maxAper")(1 - v / 100)}
                hint={
                  mono.source === "song"
                    ? "How clearly the melody must stand out from the band to count."
                    : "How clear a sound must be to count as a note. Higher skips noise and breath."
                }
              />
              <Knob label="Silence gate" value={draftEars.gateDb} display={`${draftEars.gateDb} dB`} min={-60} max={-10} step={1} onChange={set("gateDb")} hint="Anything quieter than this is treated as silence." />
              <Knob label="Shortest note" value={draftEars.minNoteMs} display={`${draftEars.minNoteMs} ms`} min={24} max={300} step={2} onChange={set("minNoteMs")} hint="Notes shorter than this get merged or dropped. Raise it to kill blips." />
              <Knob label="Bridge gaps under" value={draftEars.minRestMs} display={`${draftEars.minRestMs} ms`} min={12} max={300} step={2} onChange={set("minRestMs")} hint="Pauses shorter than this are filled by the previous note." />
              </>}
              <Knob label="Speed" value={draftSpeed} display={`${draftSpeed.toFixed(1)}×`} min={0.1} max={2} step={0.1} onChange={v => setDraftSpeed(Math.round(v * 10) / 10)} hint="Slower or faster buzzer playback and sketch. Original audio stays unchanged." />
              <Knob
                label="Transpose"
                value={draftEars.transpose}
                display={`${draftEars.transpose > 0 ? "+" : ""}${draftEars.transpose} st`}
                min={-24}
                max={24}
                step={1}
                onChange={set("transpose")}
                hint="Shift every note up or down. 12 steps is one octave."
              />
              <div className="grid gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <Label className="text-sm">Export section</Label>
                  <span className="font-mono text-sm text-primary">
                    {fmt(draftSection[0])}–{fmt(draftSection[1])}
                  </span>
                </div>
                <Slider value={draftSection} min={0} max={Math.max(1, durationMs)} step={50} minStepsBetweenThumbs={5} onValueChange={setDraftSection} aria-label="Export section" />
                <p className="text-sm text-muted-foreground">Drag the ends to export only part of the song.</p>
              </div>
              <div className="grid gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <Label htmlFor="fold" className="text-sm">
                      Fold into buzzer range (C4–C7)
                    </Label>
                    <p className="text-sm text-muted-foreground">Moves too-low or too-high notes by octaves so a piezo can play them.</p>
                  </div>
                  <Switch id="fold" checked={draftEars.fold} onCheckedChange={set("fold")} />
                </div>
                {!file?.scoreNotes && <><div className="flex items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <Label htmlFor="split" className="text-sm">
                      Split repeated notes
                    </Label>
                    <p className="text-sm text-muted-foreground">Same pitch played twice stays two notes instead of one long one.</p>
                  </div>
                  <Switch id="split" checked={draftEars.splitRepeats} onCheckedChange={set("splitRepeats")} />
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <Label htmlFor="wide-range" className="text-sm">Wider pitch range</Label>
                    <p className="text-sm text-muted-foreground">Search for lower and higher notes. Changes recheck the song.</p>
                  </div>
                  <Switch id="wide-range" aria-label="Wider pitch range" checked={draftWide} disabled={busy} onCheckedChange={setDraftWide} />
                </div>
                {draftWide && (
                  <div className="grid gap-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <Label className="text-sm">Pitch range</Label>
                      <span className="font-mono text-sm text-primary">{noteName(pitchLimits[0])} to {noteName(pitchLimits[1])}</span>
                    </div>
                    <Slider aria-label="Pitch range" value={pitchLimits} min={31} max={107} step={1} minStepsBetweenThumbs={12} disabled={busy} onValueChange={setPitchLimits} />
                    <p className="text-sm text-muted-foreground">Drag both ends. Broader searches can pick up harmonics or noise; narrow the range if the melody jumps. {draftEars.fold ? "Buzzer folding is on and may shift notes by octaves." : ""}</p>
                  </div>
                )}</>}
              </div>
              <Button type="button" disabled={!dirty || busy} onClick={applyEars}>Apply ears settings</Button>
              {dirty && <p className="text-sm text-muted-foreground">Changes are pending. Apply when you’re finished.</p>}
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setDraftEars(DEFAULT_EARS); setDraftSpeed(1); setDraftWide(false); setDraftSection([0, durationMs]); }}>
                  Reset ears
                </Button>
                <span className="text-sm text-muted-foreground">Reset pending settings.</span>
              </div>
            </div>

            <div className="grid min-w-0 overflow-hidden rounded-2xl bg-console text-console-text">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-console-dim/20 px-4 py-3">
                <span className="min-w-0 break-all font-mono text-sm text-console-dim">{filename}</span>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" aria-label="Copy filename" onClick={copyName}>{nameCopied ? "Copied name" : "Copy name"}</Button>
                  <Button type="button" size="sm" disabled={!sketch || busy} onClick={copy}>
                    {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-console-dim/40! bg-transparent! text-console-text! hover:bg-console-text/10!"
                    disabled={!sketch || busy}
                    onClick={download}
                  >
                    <Download /> .ino
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3">
                <ToggleGroup type="single" value={format} onValueChange={(v) => v && setFormat(v)} variant="outline" size="sm">
                  <ToggleGroupItem value="lines" className={consoleToggle}>
                    tone + delay
                  </ToggleGroupItem>
                  <ToggleGroupItem value="arrays" className={consoleToggle}>
                    PROGMEM
                  </ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup type="single" value={staccato ? "s" : "l"} onValueChange={(v) => v && setStaccato(v === "s")} variant="outline" size="sm">
                  <ToggleGroupItem value="l" className={consoleToggle}>
                    Legato
                  </ToggleGroupItem>
                  <ToggleGroupItem value="s" className={consoleToggle}>
                    Staccato
                  </ToggleGroupItem>
                </ToggleGroup>
                <label className="ml-2 flex items-center gap-2 text-sm text-console-dim">
                  pin
                  <Input
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^0-9A]/gi, "").slice(0, 3))}
                    className="h-8 w-14 border-console-dim/40! bg-transparent! font-mono text-console-text!"
                    aria-label="Buzzer pin"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-console-dim">
                  <Switch checked={repeat} onCheckedChange={setRepeat} aria-label="Repeat forever" className="data-[state=unchecked]:bg-console-dim/40!" /> loop
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3 px-4 pb-3 text-sm text-console-dim">
                <label htmlFor="board-flash">Board flash</label>
                <NativeSelect id="board-flash" aria-label="Board flash" value={board} onChange={e=>setBoard(e.target.value)} className="w-auto border-console-dim/40! bg-transparent! text-console-text!">
                  <NativeSelectOption value="uno">Uno R3 · 31.5 KiB usable</NativeSelectOption>
                  <NativeSelectOption value="mega">Mega 2560 · 248 KiB usable</NativeSelectOption>
                  <NativeSelectOption value="custom">Other · set usable flash</NativeSelectOption>
                </NativeSelect>
                {board==="custom" && <label className="flex items-center gap-2">KiB <Input aria-label="Usable flash KiB" type="number" min="1" step="1" value={customFlash} onChange={e=>setCustomFlash(e.target.value)} className="h-8 w-24 border-console-dim/40! bg-transparent! text-console-text!" /></label>}
                <span>≈{(flash/1024).toFixed(1)} KiB estimated{boardBytes ? ` of ${(boardBytes/1024).toFixed(1)} KiB` : ''}. Compile to verify; PROGMEM is for AVR boards.</span>
              </div>
              {boardBytes && flash > boardBytes*.9 && (
                <p className="mx-4 mb-2 rounded-md bg-signal/20 px-3 py-2 text-sm">
                  This estimate is near or above the selected board’s usable flash. Compile in the Arduino IDE for the actual size. {format === "lines" ? "Try PROGMEM arrays on AVR or trim the section." : "Trim the section or choose a board with more flash."}
                </p>
              )}
              <pre className="code-scroll max-h-[640px] min-h-[320px] overflow-auto px-4 pb-6 font-mono text-sm leading-relaxed">
                {sketch ? <Code text={sketch} /> : <span className="text-console-dim">{"// No notes found. Lower the pitch strictness or silence gate."}</span>}
              </pre>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

const Code = memo(function Code({ text }) {
  const lines = text.split("\n");
  const shown = lines.length > 2500 ? [...lines.slice(0, 2500), `// … ${lines.length - 2500} more lines in Copy / .ino`] : lines;
  return shown.map((line, i) => {
    const c = line.indexOf("//");
    const code = c >= 0 ? line.slice(0, c) : line;
    const comment = c >= 0 ? line.slice(c) : "";
    return (
      <div key={i}>
        {code.split(/(\b\d+\b)/).map((part, j) =>
          /^\d+$/.test(part) ? (
            <span key={j} className="text-console-num">
              {part}
            </span>
          ) : (
            part
          ),
        )}
        {comment && <span className="text-console-dim">{comment}</span>}
        {!line && "\u00a0"}
      </div>
    );
  });
});

function StripTime({ visibleSeconds, clock, playing }) {
  const [playhead, setPlayhead] = useState(null);
  useEffect(() => {
    if (!playing) { setPlayhead(null); return; }
    const tick = () => { const ms = clock.current?.ms?.(); setPlayhead(ms == null ? null : Math.floor(ms / 1000)); };
    tick(); const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [clock, playing]);
  const time = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <span aria-label="Visible song time"><b className="font-mono text-foreground">{time(visibleSeconds[0])} to {time(visibleSeconds[1])}</b> of song{playhead != null && <> · <b className="font-mono text-foreground">{time(playhead)}</b> playing</>}</span>;
}
