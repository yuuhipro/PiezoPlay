// Viewport windowing for a monophonic timeline, inspired by react-window's
// render-only-visible strategy: https://github.com/bvaughn/react-window
// This is an independent implementation, with a safe full-scan fallback for
// invalid or overlapping in-progress edits.
export function notesAreWindowable(notes) {
  let lastStart=-Infinity, lastEnd=-Infinity;
  for (const n of notes) {
    const end=n.start+n.dur;
    if (!Number.isFinite(n.start) || !Number.isFinite(end) || n.start<lastStart || end<lastEnd) return false;
    lastStart=n.start; lastEnd=end;
  }
  return true;
}
export function firstVisibleNote(notes, startMs, windowable) {
  if (!windowable) return 0;
  let low=0, high=notes.length;
  while (low<high) {
    const mid=(low+high)>>>1;
    if (notes[mid].start+notes[mid].dur < startMs) low=mid+1;
    else high=mid;
  }
  return low;
}
