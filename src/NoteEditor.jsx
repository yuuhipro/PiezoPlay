import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Plus, Trash2, Undo2, Merge, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { midiToHz, noteName } from './melody.js';
import { placeDraggedNote, resizeNoteRipple, mergeAdjacentNotes, canMergeAdjacentNotes } from './timeline.js';
import { playPianoFrequency } from './pianoAudio.js';

const WHITE = [0,2,4,5,7,9,11], BLACK = [1,3,6,8,10];
const PAGE = 20;
const fmt = n => (n / 1000).toFixed(2);
const fmtDuration = n => n > 0 && n < .001 ? n.toPrecision(3) : String(Number(n.toFixed(3)));

const NoteEditor = forwardRef(function NoteEditor({ sourceNotes, totalDuration, onSave, onCancel, selected, setSelected, onDraftChange, onDurationChange, onClosingChange }, ref) {
  const [items, setItems] = useState(() => sourceNotes);
  const nextId = useRef(sourceNotes.length+1);
  const [page,setPage] = useState(0);
  const selectedNote = items.find(n=>n.id===selected);
  const [octave,setOctave] = useState(()=>Math.max(-1,Math.min(11,Math.floor((sourceNotes.find(n=>n.midi>=0)?.midi ?? 60)/12)-1)));
  const [error,setError] = useState('');
  const [audioError,setAudioError] = useState('');
  const [closing,setClosing] = useState(null);
  const closingRef = useRef(false);
  const operationFrame = useRef(0);
  const itemsRef = useRef(items);
  const durationRef = useRef(totalDuration);
  const historyRef = useRef([]);
  const [historySize,setHistorySize] = useState(0);
  itemsRef.current = items;
  useEffect(()=>()=>{if (operationFrame.current) cancelAnimationFrame(operationFrame.current);},[]);
  // Source notes are chronological; only re-sort when a start time changes.
  const sorted = items;
  const currentPage = Math.min(page,Math.max(0,Math.ceil(sorted.length/PAGE)-1));
  const listRef = useRef(null);
  useEffect(() => {
    // Keep the keys and fields instant; coalesce rapid edits before repainting the strip.
    const timer = setTimeout(() => onDraftChange(items), 100);
    return () => clearTimeout(timer);
  }, [items, onDraftChange]);
  useEffect(() => {
    const index = sorted.findIndex(n => n.id === selected);
    if (index < 0) return;
    setPage(Math.floor(index / PAGE));
    const n = sorted[index];
    if (n.midi >= 0) setOctave(Math.max(-1, Math.min(11, Math.floor(n.midi / 12) - 1)));
  }, [selected, sorted]);
  useEffect(() => {
    const list = listRef.current, active = list?.querySelector('[aria-pressed="true"]');
    if (!list || !active) return;
    const bounds = list.getBoundingClientRect(), rect = active.getBoundingClientRect();
    if (rect.top < bounds.top) list.scrollTop -= bounds.top - rect.top;
    else if (rect.bottom > bounds.bottom) list.scrollTop += rect.bottom - bounds.bottom;
  }, [selected, currentPage]);
  const commit = (next, immediate = false, nextDuration = durationRef.current) => {
    const current = itemsRef.current;
    if (nextDuration === durationRef.current && (next === current || (next.length === current.length && next.every((n,i) =>
      n.id === current[i].id && n.midi === current[i].midi && n.freq === current[i].freq &&
      Object.is(n.start,current[i].start) && Object.is(n.dur,current[i].dur))))) return false;
    historyRef.current.push({items:current, selected, duration:durationRef.current});
    if (historyRef.current.length > 60) historyRef.current.shift();
    setHistorySize(historyRef.current.length);
    itemsRef.current = next;
    setItems(next);
    if (nextDuration !== durationRef.current) {
      durationRef.current = nextDuration;
      onDurationChange(nextDuration);
    }
    if (immediate) onDraftChange(next);
    return true;
  };
  const undo = () => {
    const entry = historyRef.current.pop();
    if (!entry) return;
    setHistorySize(historyRef.current.length);
    itemsRef.current = entry.items;
    setItems(entry.items);
    setSelected(entry.selected);
    durationRef.current = entry.duration;
    onDurationChange(entry.duration);
    setError('');
    onDraftChange(entry.items);
  };
  const patch = (changes) => {
    setError('');
    const next = itemsRef.current.map(n => n.id === selected ? { ...n, ...changes } : n);
    if (Object.hasOwn(changes, 'start')) next.sort((a,b) => (Number.isFinite(a.start) ? a.start : Infinity) - (Number.isFinite(b.start) ? b.start : Infinity) || a.id - b.id);
    commit(next);
  };
  const cancel = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    onClosingChange(true);
    setClosing({mode:'cancel',progress:0});
    const total = historyRef.current.length;
    const release = () => {
      for (let i=0; i<8 && historyRef.current.length; i++) historyRef.current.pop();
      const progress = total ? Math.round((total-historyRef.current.length)/total*100) : 100;
      setClosing({mode:'cancel',progress});
      if (historyRef.current.length) operationFrame.current=requestAnimationFrame(release);
      else onCancel();
    };
    // Allow the closing status to paint before releasing session history.
    operationFrame.current=requestAnimationFrame(() => {operationFrame.current=requestAnimationFrame(release);});
  };
  // Commit each strip gesture once, avoiding list and canvas rebuilds on pointer moves.
  useImperativeHandle(ref, () => ({
    cancel,
    editFromStrip({ id, start, dur, midi, mode }) {
      setError('');
      const current = itemsRef.current, original = current.find(n => n.id === id);
      if (!original) return;
      const result = mode === 'move'
        ? placeDraggedNote(current, {...original, midi, freq:midiToHz(midi)}, start, durationRef.current)
        : resizeNoteRipple(current, id, dur, durationRef.current);
      if (!result) { setError('Fix invalid or overlapping times before dragging.'); return; }
      // Keep the strip current between back-to-back gestures, without rebuilding
      // it on every pointer move.
      commit(result.items, true, result.duration ?? durationRef.current);
    }
  }), [onDraftChange, onDurationChange, selected, onCancel, onClosingChange]);
  const select = n => {setSelected(n.id);if(n.midi>=0)setOctave(Math.max(-1,Math.min(11,Math.floor(n.midi/12)-1)));};
  const playKey = midi => {
    try {
      playPianoFrequency(midiToHz(midi), () => setAudioError('Audio preview is unavailable. Check your browser audio settings.'));
      setAudioError('');
    } catch { setAudioError('Audio preview is unavailable. Check your browser audio settings.'); }
    if (selectedNote) patch({midi,freq:midiToHz(midi)});
  };
  const add = () => {
    const id=nextId.current++, midi=Math.max(0,Math.min(155,(octave+1)*12));
    const next = (v => {
      const index = v.findIndex(n => n.id === selected);
      const insertAt = index < 0 ? v.length : index + 1;
      const start = index < 0 ? v.reduce((end,n)=>Math.max(end,n.start+n.dur),0) : v[index].start + v[index].dur;
      const note = {id,midi,freq:midiToHz(midi),start,dur:250};
      return [...v.slice(0, insertAt), note, ...v.slice(insertAt).map(n => ({...n, start:n.start+250}))];
    })(itemsRef.current);
    commit(next);
    setSelected(id);setError('');
  };
  const remove = () => {if (commit(itemsRef.current.filter(n=>n.id!==selected))) setSelected(null);setError('');};
  const canMerge = canMergeAdjacentNotes(items,selected);
  const merge = () => {
    const result=mergeAdjacentNotes(itemsRef.current,selected);
    if (!result) return;
    if (commit(result.items,true)) setSelected(result.note.id);
    setError('');
  };
  const save = () => {
    if (closingRef.current) return;
    closingRef.current=true; onClosingChange(true); setError('');
    setClosing({mode:'save',progress:0});
    const snapshot=itemsRef.current, result=[];
    let index=0, cursor=0, hasNote=false;
    const fail = message => { closingRef.current=false; setClosing(null); onClosingChange(false); setError(message); };
    const process = () => {
      const end=Math.min(snapshot.length,index+512);
      for (;index<end;index++) {
        const n=snapshot[index];
        if (!Number.isFinite(n.start)||n.start<0||!Number.isFinite(n.dur)||n.dur<=0) return fail('Enter a start time of 0 or more and a duration greater than 0.');
        if (n.start < cursor-0.0000001) return fail('Notes and rests cannot overlap. Adjust their start times or durations.');
        if (n.start>cursor+0.0000001) result.push({midi:-1,freq:0,start:cursor,dur:n.start-cursor});
        result.push({midi:n.midi,freq:n.midi<0?0:n.freq,start:n.start,dur:n.dur});
        if (n.midi>=0) hasNote=true;
        cursor=n.start+n.dur;
      }
      setClosing({mode:'save',progress:snapshot.length ? Math.round(index/snapshot.length*100) : 100});
      if (index<snapshot.length) {operationFrame.current=requestAnimationFrame(process);return;}
      if (!hasNote) return fail('Keep at least one note.');
      if (cursor < durationRef.current-0.0000001) result.push({midi:-1,freq:0,start:cursor,dur:durationRef.current-cursor});
      onSave(result,Math.max(cursor,durationRef.current));
    };
    operationFrame.current=requestAnimationFrame(() => {operationFrame.current=requestAnimationFrame(process);});
  };
  const key = (pc,black) => {
    const midi=(octave+1)*12+pc, disabled=midi<0||midi>155;
    return <button key={pc} type="button" aria-label={`Piano key ${noteName(midi)}`} aria-pressed={selectedNote?.midi===midi} disabled={disabled} onClick={()=>playKey(midi)} className={black?'piano-key piano-key-black':'piano-key piano-key-white'} style={black?{left:`${([0,1,3,4,5][BLACK.indexOf(pc)]+1)*100/7}%`}:undefined}><span>{black ? noteName(midi).replace(/-?\d+$/, "") : noteName(midi)}</span></button>;
  };
  return <section aria-label="Note editor" aria-busy={!!closing} className="grid min-w-0 gap-6 rounded-2xl bg-card p-6 ring-1 ring-border @3xl:p-8">
    {closing && <div role="status" className="grid gap-3 text-sm text-muted-foreground"><div className="flex items-center justify-between gap-3"><span>{closing.mode==='save' ? 'Saving your notes…' : 'Closing editor…'}</span><span className="font-mono">{closing.progress}%</span></div><Progress value={closing.progress} aria-label={closing.mode==='save' ? 'Saving editor' : 'Closing editor'} /></div>}
    {!closing && <fieldset className="grid min-w-0 gap-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-sm text-primary">MELODY EDITOR</p><h2 className="font-display text-3xl font-semibold">Make it your own</h2><p className="text-sm text-muted-foreground">Drag a note to reorder it; drag its right edge to resize. Resizing shifts later notes and changes the song length.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={cancel}>Cancel</Button><Button onClick={save}>Done / Save</Button></div></div>
    <div className="grid min-w-0 gap-6 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex items-center justify-between gap-2"><Label>Notes and rests</Label><Button variant="outline" size="sm" onClick={add}><Plus /> Add note</Button></div>
        <div ref={listRef} className="grid max-h-72 min-w-0 gap-1 overflow-auto rounded-lg bg-muted p-2" role="list" aria-label="Notes and rests">
          {sorted.slice(currentPage*PAGE,(currentPage+1)*PAGE).map((n,i)=><button type="button" key={n.id} onClick={()=>select(n)} aria-pressed={n.id===selected} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground"><span className="font-mono">{currentPage*PAGE+i+1}. {noteName(n.midi)}</span><span className="font-mono">{fmt(n.start)}s · {fmtDuration(n.dur)}ms</span></button>)}
          {!sorted.length && <p className="p-3 text-sm text-muted-foreground">Add a note to begin.</p>}
        </div>
        <div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)} aria-label="Previous notes"><ChevronLeft /> Previous</Button><span className="text-sm text-muted-foreground">{currentPage+1} / {Math.max(1,Math.ceil(sorted.length/PAGE))}</span><Button variant="outline" size="sm" disabled={(currentPage+1)*PAGE>=sorted.length} onClick={()=>setPage(currentPage+1)} aria-label="Next notes">Next <ChevronRight /></Button></div>
      </div>
      <div className="grid min-w-0 content-start gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><Label>Pitch</Label><p className="font-mono text-sm text-primary">{selectedNote ? noteName(selectedNote.midi) : 'Select a note'}</p></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label="Lower octave" disabled={octave<=-1} onClick={()=>setOctave(o=>o-1)}><ChevronLeft /></Button><span className="font-mono text-sm">Octave {octave}</span><Button variant="outline" size="sm" aria-label="Higher octave" disabled={octave>=11} onClick={()=>setOctave(o=>o+1)}><ChevronRight /></Button></div></div>
        <div className="piano" role="group" aria-label={`Piano octave ${octave}`}><div className="piano-white-row">{WHITE.map(pc=>key(pc,false))}</div>{BLACK.map(pc=>key(pc,true))}</div>
        <p className="text-sm text-muted-foreground">Tap a key to hear it and change the selected note.</p>
        {audioError && <p role="alert" className="text-sm text-destructive">{audioError}</p>}
        <div className="grid grid-cols-2 gap-3"><div className="grid gap-2"><Label htmlFor="note-start">Start (ms)</Label><Input id="note-start" type="number" min="0" step="any" inputMode="decimal" disabled={!selectedNote} value={Number.isFinite(selectedNote?.start) ? selectedNote.start : ''} onChange={e=>patch({start:e.target.value===''?NaN:Number(e.target.value)})}/></div><div className="grid gap-2"><Label htmlFor="note-duration">Duration (ms)</Label><Input id="note-duration" type="number" min="0" step="any" inputMode="decimal" disabled={!selectedNote} value={Number.isFinite(selectedNote?.dur) ? selectedNote.dur : ''} onChange={e=>patch({dur:e.target.value===''?NaN:Number(e.target.value)})}/></div></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={!selectedNote} onClick={()=>patch({midi:-1,freq:0})}>Make rest</Button><Button variant="outline" size="sm" disabled={!selectedNote} onClick={remove}><Trash2 /> Delete selected</Button><Button variant="outline" size="sm" disabled={!historySize} onClick={undo}><Undo2 /> Undo</Button><Button variant="outline" size="sm" disabled={!canMerge} onClick={merge} title="Merge touching notes of the same pitch"><Merge /> Merge notes</Button></div>
        <p className="text-sm text-muted-foreground">Times are at 1× speed. Empty gaps become rests; notes can’t overlap. Very short times are rounded to microseconds in the sketch.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
    </fieldset>}
  </section>;
});

export default NoteEditor;
