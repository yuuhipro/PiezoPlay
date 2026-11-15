import { displayFileName } from './filename.js';
import { FileMusic, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

export default function ScoreStage({ name, score, selected, setSelected, onConvert, onReplace, onAudio }) {
  return <section className="grid gap-6 rounded-2xl bg-brass/15 p-6 ring-1 ring-brass-deep/30 @3xl:p-8">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="grid gap-1"><p className="font-mono text-sm text-primary">{score.kind === "MIDI" ? "MIDI · digital notes" : "MusicXML · sheet music"}</p><h2 className="font-display text-3xl font-semibold">Choose a melody</h2></div>
      <div className="flex min-w-0 max-w-full items-center gap-2"><FileMusic className="shrink-0 text-primary"/><span className="min-w-0 truncate" title={name}>{displayFileName(name)}</span></div>
    </div>
    <div className="grid max-w-xl gap-3">
      <Label htmlFor="score-part">{score.kind === "MIDI" ? "Track and channel" : "Instrument and voice"}</Label>
      <NativeSelect className="max-w-full" id="score-part" value={selected} onChange={e=>setSelected(e.target.value)} aria-label={score.kind === "MIDI" ? "Track and channel" : "Instrument and voice"}>
        {score.parts.map(p=><NativeSelectOption value={p.id} key={p.id}>{p.label}</NativeSelectOption>)}
      </NativeSelect>
      <p className="text-sm text-muted-foreground">A buzzer plays one note at a time. If notes overlap in this selection, the highest note plays.</p>
      {score.warnings.map(w=><p key={w} className="text-sm text-foreground">⚠ {w}</p>)}
    </div>
    <div className="flex flex-wrap gap-3"><Button onClick={onConvert}>Convert to buzzer <ArrowRight /></Button><Button variant="outline" onClick={onReplace}>Choose another file</Button><Button variant="ghost" onClick={onAudio}>Choose audio instead</Button></div>
  </section>;
}
