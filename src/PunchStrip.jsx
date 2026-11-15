import { useEffect, useMemo, useRef, useState } from "react";
import { foldMidi, frameVoiced, hzToMidi, noteName } from "./melody.js";
import { prepareDragPlacement, previewDraggedNote } from "./timeline.js";
import { firstVisibleNote, notesAreWindowable } from "./visibleNotes.js";

const PAD = 22;

function cssColor(name, alpha = 1) {
  const el = document.createElement("span");
  el.style.color = `color-mix(in oklch, var(${name}) ${Math.round(alpha * 100)}%, transparent)`;
  document.body.appendChild(el);
  const c = getComputedStyle(el).color;
  el.remove();
  return c;
}

/** Music-box punch strip: holes are notes, faint dots are the raw pitch the tool heard. */
export default function PunchStrip({ notes, track, settings, durationMs, range, clock, playing, onSeek, onSelectNote, onEditNote, selectedNoteId, onViewChange, height = 260, label = "Punch strip" }) {
  const canvasRef = useRef(null);
  const scrollRef = useRef(null);
  const headRef = useRef(null);
  const gesture = useRef(null);
  const gestureFrame = useRef(0);
  const [preview, setPreview] = useState(null);
  const [cursor, setCursor] = useState("pointer");
  const pxPerSec = useMemo(
    () => Math.min(90, 30000 / Math.max(1, durationMs / 1000) / (window.devicePixelRatio || 1)),
    [durationMs],
  );
  const width = Math.max(600, Math.ceil((durationMs / 1000) * pxPerSec) + 24);
  const windowable = useMemo(() => notesAreWindowable(notes), [notes]);
  const [lo, hi] = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const n of notes) if (n.midi >= 0) { min = Math.min(min, n.midi); max = Math.max(max, n.midi); }
    if (!Number.isFinite(min)) return [60, 84];
    let a = min - 2;
    let b = max + 2;
    if (b - a < 14) {
      const mid = (a + b) / 2;
      a = Math.floor(mid - 7);
      b = Math.ceil(mid + 7);
    }
    return [a, b];
  }, [notes]);
  const yOf = (m) => {
    const h = height - PAD * 2;
    return PAD + h - ((m - lo + 0.5) / (hi - lo + 1)) * h;
  };
  const row = (height - PAD * 2) / (hi - lo + 1);
  const { labels, noteCount } = useMemo(() => {
    const used = new Set();
    let count = 0;
    for (const n of notes) if (n.midi >= 0) { used.add(n.midi); count++; }
    const labels = [], wanted = [];
    for (let m = lo; m <= hi; m++) if (m % 12 === 0) wanted.push(m);
    [...used].sort((a,b) => b-a).forEach(m => wanted.push(m));
    for (const m of wanted) if (labels.every(l => Math.abs(yOf(l)-yOf(m)) >= 16)) labels.push(m);
    return { labels, noteCount:count };
  }, [notes,lo,hi,height]);
  useEffect(() => () => { if (gestureFrame.current) cancelAnimationFrame(gestureFrame.current); }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    const sc = scrollRef.current;
    if (!cv || !sc) return;
    const colors = () => ({
      brass:cssColor("--color-brass"), deep:cssColor("--color-brass-deep"),
      hole:cssColor("--color-hole"), dots:cssColor("--color-hole",.28),
      octave:cssColor("--color-brass-deep",.18), veil:cssColor("--color-background",.62),
      strongTick:cssColor("--color-brass-deep",.55), softTick:cssColor("--color-brass-deep",.25),
    });
    let palette = colors();
    let bufferedWidth=0, overscan=0, paintedLeft=-Infinity, paintedRight=-Infinity;
    const paint = () => {
    // Keep a bounded overscan buffer in the song's coordinate space. The
    // browser scrolls this bitmap; only redraw when the viewport nears an edge.
    const viewWidth = Math.max(1, bufferedWidth);
    const left = Math.max(0, Math.min(width-viewWidth, sc.scrollLeft-overscan));
    const right = left + viewWidth;
    paintedLeft=left; paintedRight=right;
    cv.style.left=`${left}px`;
    cv.style.width=`${viewWidth}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, 8192 / viewWidth, Math.sqrt(8000000 / (viewWidth * height)));
    const bitmapWidth = Math.round(viewWidth * dpr), bitmapHeight = Math.round(height * dpr);
    if (cv.width !== bitmapWidth) cv.width = bitmapWidth;
    if (cv.height !== bitmapHeight) cv.height = bitmapHeight;
    const g = cv.getContext("2d", {alpha:false});
    g.setTransform(dpr, 0, 0, dpr, -left * dpr, 0);
    const { brass,deep,hole,dots,octave,veil,strongTick,softTick } = palette;
    g.clearRect(left, 0, viewWidth, height);
    g.fillStyle = brass;
    g.fillRect(0, 0, width, height);
    g.fillStyle = deep;
    g.fillRect(0, 0, width, 2);
    g.fillRect(0, height - 2, width, 2);
    g.fillStyle = hole;
    g.beginPath();
    for (let x = 10 + Math.max(0, Math.floor((left - 10) / 18)) * 18; x < Math.min(width,right + 18); x += 18) {
      g.roundRect(x, 7, 7, 8, 2);
      g.roundRect(x, height - 15, 7, 8, 2);
    }
    g.fill();
    g.fillStyle = octave;
    for (let m = lo; m <= hi; m++) if (m % 12 === 0) g.fillRect(0, yOf(m) - 0.5, width, 1);
    const tickStep = Math.max(1, Math.ceil(4 / pxPerSec));
    for (let s = Math.max(0, Math.floor(left / pxPerSec / tickStep) * tickStep); s * 1000 <= durationMs && s * pxPerSec <= right; s += tickStep) {
      g.fillStyle = s % 5 === 0 ? strongTick : softTick;
      g.fillRect(s * pxPerSec, PAD, 1, height - PAD * 2);
    }
    if (track) {
      g.fillStyle = dots;
      const step = Math.max(1, Math.round(2 / ((track.hopMs / 1000) * pxPerSec)));
      const frameStart = Math.max(0, Math.floor(left / pxPerSec * 1000 / track.hopMs / step) * step);
      const frameEnd = Math.min(track.frames, Math.ceil(right / pxPerSec * 1000 / track.hopMs) + step);
      for (let f = frameStart; f < frameEnd; f += step) {
        if (!frameVoiced(track, f, settings)) continue;
        const m = hzToMidi(track.f0[f]) + settings.transpose;
        const m2 = m + foldMidi(Math.round(m), settings.fold) - Math.round(m);
        if (m2 < lo - 0.5 || m2 > hi + 0.5) continue;
        g.fillRect((f * track.hopMs * pxPerSec) / 1000, yOf(m2) - 1, 1.5, 2);
      }
    }
    g.fillStyle = hole;
    const h = Math.min(13, Math.max(4, row * 0.78));
    let batch = 0;
    g.beginPath();
    const startIndex = firstVisibleNote(notes,(left - 4) / pxPerSec * 1000,windowable);
    for (let i=startIndex; i<notes.length; i++) {
      const n=notes[i];
      if (windowable && n.start * pxPerSec / 1000 > right) break;
      if (n.midi < 0) continue;
      const x = (n.start / 1000) * pxPerSec;
      const w = Math.max(3, (n.dur / 1000) * pxPerSec - 2);
      if (x + w < left || x > right) continue;
      g.roundRect(x, yOf(n.midi) - h / 2, w, h, h / 2);
      if (++batch === 1000) { g.fill(); g.beginPath(); batch = 0; }
    }
    if (batch) g.fill();
    g.fillStyle = veil;
    g.fillRect(0, 0, (range[0] / 1000) * pxPerSec, height);
    const x1 = (range[1] / 1000) * pxPerSec;
    g.fillRect(x1, 0, width - x1, height);
    };
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); }); };
    const resize = () => {
      const visible=Math.max(1,sc.clientWidth);
      overscan=Math.min(512,Math.max(96,Math.round(visible*.5)));
      bufferedWidth=Math.min(width,visible+overscan*2);
      paintedLeft=-Infinity; paintedRight=-Infinity;
      schedule();
    };
    const onScroll = () => {
      const left=sc.scrollLeft, right=left+sc.clientWidth;
      const guard=Math.min(64,overscan/4);
      if ((paintedLeft>0 && left<paintedLeft+guard) ||
          (paintedRight<width && right>paintedRight-guard) ||
          !Number.isFinite(paintedLeft)) schedule();
    };
    resize();
    const observer = new MutationObserver(() => { palette = colors(); schedule(); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(sc);
    sc.addEventListener("scroll", onScroll, { passive:true });
    return () => { observer.disconnect(); resizeObserver.disconnect(); sc.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [notes, track, settings, durationMs, range[0], range[1], width, height, lo, hi, pxPerSec, row, windowable]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !onViewChange) return;
    let frame = 0;
    const report = () => {
      frame = 0;
      const start = Math.max(0, Math.min(durationMs, sc.scrollLeft / pxPerSec * 1000));
      const end = Math.max(start, Math.min(durationMs, (sc.scrollLeft + sc.clientWidth) / pxPerSec * 1000));
      onViewChange([Math.floor(start / 1000), Math.ceil(end / 1000)]);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(report); };
    sc.addEventListener("scroll", schedule, { passive:true });
    const observer = new ResizeObserver(schedule);
    observer.observe(sc);
    report();
    return () => { sc.removeEventListener("scroll", schedule); observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [onViewChange, durationMs, pxPerSec, width]);

  useEffect(() => {
    if (!onSelectNote || selectedNoteId == null) return;
    const selected = notes.find(n => n.id === selectedNoteId && n.midi >= 0);
    const sc = scrollRef.current;
    if (!selected || !sc || !Number.isFinite(selected.start)) return;
    const x = selected.start * pxPerSec / 1000;
    if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 16) sc.scrollLeft = Math.max(0, x - sc.clientWidth * .3);
  }, [selectedNoteId, notes, pxPerSec, onSelectNote]);

  useEffect(() => {
    if (!playing) {
      if (headRef.current) headRef.current.style.opacity="0";
      return;
    }
    let raf;
    const loop = () => {
      const ms = clock.current?.ms?.();
      const head = headRef.current;
      const sc = scrollRef.current;
      if (head && sc) {
        if (ms == null) head.style.opacity = "0";
        else {
          const x = (ms / 1000) * pxPerSec;
          head.style.opacity = "1";
          head.style.transform = `translateX(${x}px)`;
          if (x > sc.scrollLeft + sc.clientWidth * 0.7) sc.scrollLeft = x - sc.clientWidth * 0.7;
          else if (x < sc.scrollLeft) sc.scrollLeft = Math.max(0,x - sc.clientWidth * 0.3);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock, pxPerSec, playing]);

  const selectedNote = preview || (onSelectNote && selectedNoteId != null ? notes.find(n => n.id === selectedNoteId && n.midi >= 0) : null);
  const selectedHeight = Math.min(13, Math.max(4, row * 0.78));
  const hitNote = (x, y) => {
    let best = null, bestScore = Infinity;
    const first = firstVisibleNote(notes,(x-12) / pxPerSec * 1000,windowable);
    for (let i=first; i<notes.length; i++) {
      const n=notes[i];
      if (windowable && n.start * pxPerSec / 1000 > x+8) break;
      if (n.midi < 0 || !Number.isFinite(n.start) || !Number.isFinite(n.dur) || n.dur <= 0) continue;
      const start = n.start * pxPerSec / 1000, end = start + Math.max(3, n.dur * pxPerSec / 1000 - 2);
      const dx = Math.max(start - x, 0, x - end), dy = Math.abs(yOf(n.midi) - y);
      if (dx > 8 || dy > Math.max(10, Math.min(14, row * .55))) continue;
      const score = dx * dx + dy * dy;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best;
  };
  const point = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const parent = e.currentTarget.parentElement.getBoundingClientRect();
    return { x: e.clientX - parent.left, y: e.clientY - rect.top };
  };
  const isEdge = (n, x) => {
    const start = n.start * pxPerSec / 1000;
    const end = start + Math.max(3, n.dur * pxPerSec / 1000 - 2);
    return Math.abs(x - end) <= 7 && (end - start >= 14 || n.id === selectedNoteId);
  };
  const updateGesture = (pointerId, p) => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const dx = p.x - drag.x, dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    const ms = Math.round(dx / pxPerSec * 1000);
    if (drag.resize) {
      drag.result = { ...drag.note, mode:'resize', dur: Math.max(.000000001, drag.note.dur + ms) };
      setPreview(drag.result);
    } else {
      const start = Math.max(0, drag.note.start + ms);
      const midi = Math.max(0, Math.min(155, drag.note.midi - Math.round(dy / row)));
      drag.result = { ...drag.note, start, midi, mode:'move' };
      setPreview(previewDraggedNote(drag.prepared, start, midi) || drag.note);
    }
  };
  return (
    <div className="flex">
      <div className="relative w-10 shrink-0" style={{ height }} aria-hidden>
        {labels.map((m) => (
          <span key={m} className="absolute right-2 -translate-y-1/2 font-mono text-sm text-muted-foreground" style={{ top: yOf(m) }}>
            {noteName(m)}
          </span>
        ))}
      </div>
      <div ref={scrollRef} className="strip-scroll relative min-w-0 flex-1 overflow-x-auto rounded-lg" style={{ height: height + 12 }}>
        <div className="relative" style={{ width, height }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${label} with ${noteCount} notes. ${onSelectNote ? "Tap a note to edit it. Drag it to move; drag its right edge to resize. Use the note list for keyboard access." : "Click to play from a point."}`}
            className="absolute top-0 block"
            style={{ height, cursor: onSelectNote ? cursor : "pointer", touchAction: onSelectNote ? "none" : "auto" }}
            onPointerDown={e => {
              if (!onSelectNote || !onEditNote || e.button !== 0) return;
              const {x,y} = point(e), note = hitNote(x,y);
              if (!note) return;
              const resize = isEdge(note,x);
              gesture.current = { pointerId:e.pointerId, x, y, note, resize, prepared:resize ? null : prepareDragPlacement(notes,note,durationMs), moved:false, result:null };
              onSelectNote(note.id);
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
            }}
            onPointerMove={e => {
              if (gesture.current) {
                gesture.current.pending = {id:e.pointerId, point:point(e)};
                if (!gestureFrame.current) gestureFrame.current = requestAnimationFrame(() => {
                  gestureFrame.current = 0;
                  const pending = gesture.current?.pending;
                  if (pending) updateGesture(pending.id,pending.point);
                });
                return;
              }
              if (!onSelectNote) return;
              const {x,y} = point(e), n = hitNote(x,y);
              setCursor(n ? (isEdge(n,x) ? "ew-resize" : "grab") : "pointer");
            }}
            onPointerUp={e => {
              const drag = gesture.current;
              if (!drag || drag.pointerId !== e.pointerId) return;
              if (gestureFrame.current) cancelAnimationFrame(gestureFrame.current);
              gestureFrame.current = 0;
              updateGesture(e.pointerId,point(e));
              if (drag.moved && drag.result) onEditNote(drag.result);
              gesture.current = null;
              setPreview(null);
            }}
            onPointerCancel={() => { if (gestureFrame.current) cancelAnimationFrame(gestureFrame.current); gestureFrame.current = 0; gesture.current = null; setPreview(null); }}
            onClick={(e) => {
              if (!onSelectNote) onSeek((point(e).x / pxPerSec) * 1000);
            }}
          />
          {selectedNote && <div aria-hidden className="pointer-events-none absolute rounded-sm border-2 border-foreground" style={{ left: selectedNote.start * pxPerSec / 1000 - 1, top: yOf(selectedNote.midi) - selectedHeight / 2 - 2, width: Math.max(5, selectedNote.dur * pxPerSec / 1000 + 1), height: selectedHeight + 4 }}><div className="absolute -right-1 -top-1 h-[calc(100%+8px)] w-1.5 rounded-sm bg-foreground" /></div>}
          <div ref={headRef} className="pointer-events-none absolute top-0 left-0 h-full w-0.5 bg-signal opacity-0 shadow-[0_0_10px_var(--color-signal)]" />
        </div>
      </div>
    </div>
  );
}
