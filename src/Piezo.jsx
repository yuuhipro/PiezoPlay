import { useEffect, useMemo, useRef, useState } from "react";
import { noteName } from "./melody.js";
import { firstVisibleNote, notesAreWindowable } from "./visibleNotes.js";

export default function Piezo({ clock, notes, playing }) {
  const [note, setNote] = useState(null);
  const last = useRef(null);
  const windowable = useMemo(() => notesAreWindowable(notes), [notes]);
  useEffect(() => {
    if (playing !== "buzzer") {
      last.current = null;
      setNote(null);
      return;
    }
    let raf;
    const loop = () => {
      const ms = clock.current?.ms?.();
      let hit = null;
      if (ms != null && clock.current.kind === "buzzer") {
        const first=firstVisibleNote(notes,ms,windowable);
        for (let i=first; i<notes.length; i++) {
          const n=notes[i];
          if (windowable && n.start>ms) break;
          if (ms>=n.start && ms<n.start+n.dur && n.midi>=0) {hit=n;break;}
        }
      }
      if (hit !== last.current) {
        last.current = hit;
        setNote(hit);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, notes, playing, windowable]);
  const period = note ? Math.max(0.35, Math.min(1.6, 320 / note.freq)) : 0;
  return (
    <div className="relative grid size-44 shrink-0 place-items-center" aria-live="off">
      {note &&
        [0, 1, 2].map((i) => (
          <span
            key={`${note.start}-${i}`}
            className="piezo-ring absolute inset-0 rounded-full border-2 border-brass-deep"
            style={{ animationDuration: `${period * 2}s`, animationDelay: `${(i * period * 2) / 3}s` }}
          />
        ))}
      <div className={`piezo-disc relative grid size-40 place-items-center rounded-full ${note ? "is-live" : ""}`}>
        <div className="grid size-26 place-items-center rounded-full bg-background/80 text-center ring-1 ring-brass-deep/40">
          <div>
            <div className="font-display text-3xl leading-none font-semibold">{note ? noteName(note.midi) : "off"}</div>
            <div className="mt-1 font-mono text-sm text-muted-foreground">{note ? `${note.freq} Hz` : "0 Hz"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
