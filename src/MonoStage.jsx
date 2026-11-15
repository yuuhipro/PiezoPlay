import { ArrowRight, FileHeadphone, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import PunchStrip from "./PunchStrip.jsx";
import { displayFileName } from "./filename.js";

const SOURCE_HINT = {
  song: "Pulls the strongest line out from under chords, bass and drums.",
  voice: "Already one note at a time. Read as-is.",
};
const FOCUS_HINT = {
  mix: "Both channels together.",
  center: "Only what's panned dead centre. Usually the vocal.",
  left: "Left channel only.",
  right: "Right channel only.",
};
const RANGE_HINT = {
  low: "Low voices, cello, bass leads.",
  mid: "Most vocals and lead lines.",
  high: "Whistles, flutes, high synths.",
};

function Choice({ label, value, onChange, options, hint, disabled }) {
  return (
    <div className="grid content-start gap-2">
      <Label className="text-sm">{label}</Label>
      <ToggleGroup type="single" variant="outline" size="sm" className="w-full" value={value} onValueChange={(v) => v && onChange(v)}>
        {options.map(([v, text]) => (
          <ToggleGroupItem key={v} value={v} className="flex-1" disabled={disabled?.(v)}>
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function MonoStage({ file, mono, setMono, track, progress, notes, ears, clock, playing, onPlay, onStop, onReplace, onMusicXML, onDone, fmt }) {
  const stereo = file ? file.buffer.numberOfChannels > 1 : true;
  const busy = progress != null;
  const durationMs = file ? file.buffer.duration * 1000 : 0;
  const count = notes.filter((n) => n.midi >= 0).length;
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 rounded-2xl bg-brass/15 p-6 ring-1 ring-brass-deep/30 @3xl:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="font-mono text-sm text-primary">step 1 · make it monophonic</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight">One line out of the mix</h2>
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-3">
          <FileHeadphone className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 truncate font-medium" title={file?.name}>{file ? displayFileName(file.name) : "Reading file…"}</span>
          {file && <span className="font-mono text-sm text-muted-foreground">{fmt(durationMs)}</span>}
          <Button type="button" variant="link" size="sm" onClick={onReplace}>
            Replace
          </Button>
        </div>
      </div>

      {busy || !track ? (
        <div className="relative grid h-[212px] place-items-center overflow-hidden rounded-lg bg-brass/25">
          <div className="mono-sweep pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-brass/50 to-transparent" />
          <div className="relative grid w-64 gap-3 text-center">
            <p className="font-display text-xl font-semibold">{mono.source === "song" ? "Finding the melody…" : "Listening for pitch…"}</p>
            <Progress value={Math.round((progress || 0) * 100)} />
            <p className="font-mono text-sm text-muted-foreground">{Math.round((progress || 0) * 100)}%</p>
          </div>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <PunchStrip
            notes={notes}
            track={track}
            settings={ears}
            durationMs={durationMs}
            range={[0, durationMs]}
            clock={clock}
            playing={playing}
            onSeek={(ms) => onPlay("mono", ms)}
            height={200}
            label="Monophonic melody"
          />
          <p className="pl-10 text-sm text-muted-foreground">
            <b className="font-mono text-foreground">{count}</b> notes in one line. Click the strip to hear it from there.
          </p>
        </div>
      )}

      <div className="grid gap-6 @3xl:grid-cols-3">
        <Choice
          label="What's in the file"
          value={mono.source}
          onChange={(v) => setMono({ ...mono, source: v })}
          options={[["song", "Full song"], ["voice", "One voice"]]}
          hint={SOURCE_HINT[mono.source]}
        />
        <Choice
          label="Listen to"
          value={mono.focus}
          onChange={(v) => setMono({ ...mono, focus: v })}
          options={[["mix", "Mix"], ["center", "Centre"], ["left", "Left"], ["right", "Right"]]}
          disabled={(v) => v !== "mix" && (!stereo || (v === "center" && mono.source !== "song"))}
          hint={!stereo ? "This file is already a single channel." : FOCUS_HINT[mono.focus]}
        />
        <Choice
          label="Melody range"
          value={mono.range}
          onChange={(v) => setMono({ ...mono, range: v })}
          options={[["low", "Low"], ["mid", "Mid"], ["high", "High"]]}
          disabled={() => mono.wide}
          hint={mono.wide ? "Custom pitch range is active. Change it in Ears." : RANGE_HINT[mono.range]}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!track || busy} onClick={() => (playing === "mono" ? onStop() : onPlay("mono"))}>
            {playing === "mono" ? <Pause /> : <Play />} Mono
          </Button>
          <Button type="button" variant="outline" onClick={onMusicXML}>Upload MusicXML / MIDI instead</Button>
          <Button type="button" variant="outline" disabled={!file} onClick={() => (playing === "original" ? onStop() : onPlay("original"))}>
            {playing === "original" ? <Pause /> : <Play />} Original
          </Button>
        </div>
        <Button type="button" size="lg" disabled={!track || busy} onClick={onDone}>
          Read this melody <ArrowRight />
        </Button>
      </div>
    </section>
  );
}
