// Prepare once per gesture; pointer moves can then find a destination in
// logarithmic time without rebuilding thousands of notes on every frame.
export function prepareDragPlacement(items, dragged, durationMs = 0) {
  let restId = -1;
  for (const n of items) if (typeof n.id === 'number' && n.id <= restId) restId = n.id - 1;
  const events = [];
  let cursor = 0;
  for (const n of items) {
    if (!Number.isFinite(n.start) || n.start < 0 || !Number.isFinite(n.dur) || n.dur <= 0 || n.start < cursor - 1e-7) return null;
    if (n.start > cursor + 1e-7) events.push({id:restId--, midi:-1, freq:0, start:cursor, dur:n.start-cursor});
    events.push(n);
    cursor = n.start + n.dur;
  }
  if (Number.isFinite(durationMs) && durationMs > cursor + 1e-7) {
    events.push({id:restId--, midi:-1, freq:0, start:cursor, dur:durationMs-cursor});
  }
  if (!events.some(n => n.id === dragged.id)) return null;
  const other = events.filter(n => n.id !== dragged.id);
  const prefix = new Float64Array(other.length + 1);
  for (let i=0; i<other.length; i++) prefix[i+1] = prefix[i] + other[i].dur;
  return {other,prefix,dragged};
}

function dragIndex(prepared, desiredStart) {
  if (!prepared || !Number.isFinite(desiredStart)) return -1;
  const {other,dragged} = prepared;
  const center = Math.max(0, desiredStart) + dragged.dur / 2;
  const movingLeft = desiredStart < dragged.start;
  let lo=0, hi=other.length;
  while (lo<hi) {
    const mid=(lo+hi) >>> 1, boundary=other[mid].start + other[mid].dur / 2;
    if (movingLeft ? center <= boundary : center < boundary) hi=mid;
    else lo=mid+1;
  }
  return lo;
}

export function previewDraggedNote(prepared, desiredStart, midi) {
  const index = dragIndex(prepared,desiredStart);
  return index < 0 ? null : {...prepared.dragged,midi,start:prepared.prefix[index]};
}

// Fill implicit gaps with editable rests before reordering. Rearranging the
// resulting sequence preserves every event's duration and the overall length.
export function placeDraggedNote(items, dragged, desiredStart, durationMs = 0) {
  const prepared = prepareDragPlacement(items,dragged,durationMs);
  const index = dragIndex(prepared,desiredStart);
  if (index < 0) return null;
  const {other} = prepared;
  const ordered = [...other.slice(0,index), dragged, ...other.slice(index)];
  let cursor = 0;
  let note;
  const next = ordered.map(n => {
    const placed = { ...n, start:cursor };
    cursor += n.dur;
    if (n.id === dragged.id) note = placed;
    return placed;
  });
  return { items:next, note };
}

// Ripple the following events by exactly the duration delta. Reversing a
// resize restores both their positions and the total duration.
export function resizeNoteRipple(items, id, requestedDuration, durationMs = 0) {
  if (!Number.isFinite(requestedDuration)) return null;
  let cursor=0;
  for (const n of items) {
    if (!Number.isFinite(n.start) || n.start<0 || !Number.isFinite(n.dur) || n.dur<=0 || n.start<cursor-1e-7) return null;
    cursor=n.start+n.dur;
  }
  const index=items.findIndex(n=>n.id===id);
  if (index<0 || items[index].midi<0) return null;
  const original=items[index], dur=Math.max(.000000001,requestedDuration), delta=dur-original.dur;
  const next=items.slice();
  next[index]={...original,dur};
  for (let i=index+1;i<next.length;i++) next[i]={...next[i],start:next[i].start+delta};
  const baseline=Math.max(cursor, Number.isFinite(durationMs) ? durationMs : 0);
  return {items:next,note:next[index],duration:Math.max(0,baseline+delta)};
}

// Join only a touching, identical-pitch neighbour. A rest or a gap is music
// too, so it must not be silently removed.
function mergeIndex(items,id) {
  const index=items.findIndex(n=>n.id===id);
  if (index<0 || items[index].midi<0) return -1;
  const note=items[index];
  const valid=(a,b)=>a && b && a.midi>=0 && a.midi===b.midi &&
    Number.isFinite(a.start) && Number.isFinite(a.dur) && a.dur>0 &&
    Number.isFinite(b.start) && Number.isFinite(b.dur) && b.dur>0 &&
    Math.abs(a.start+a.dur-b.start)<1e-7;
  return valid(note,items[index+1]) ? index : valid(items[index-1],note) ? index-1 : -1;
}
export function canMergeAdjacentNotes(items,id) {
  return mergeIndex(items,id)>=0;
}
export function mergeAdjacentNotes(items, id) {
  const first=mergeIndex(items,id);
  if (first<0) return null;
  const merged={...items[first],dur:items[first].dur+items[first+1].dur};
  return {items:[...items.slice(0,first),merged,...items.slice(first+2)],note:merged};
}

