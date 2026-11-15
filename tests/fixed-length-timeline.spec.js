import { expect, test } from '@playwright/test';
import { placeDraggedNote, prepareDragPlacement, previewDraggedNote } from '../src/timeline.js';

test('reordering preserves duration and turns leading, middle and trailing gaps into editable rests', () => {
  const source = [
    {id:1,midi:60,freq:262,start:120,dur:300},
    {id:2,midi:64,freq:330,start:600,dur:250},
    {id:3,midi:67,freq:392,start:900,dur:100}
  ];
  for (const target of [0,120,300,600,1000,2000]) {
    const result = placeDraggedNote(source, source[0], target, 1200);
    const cached = prepareDragPlacement(source,source[0],1200);
    expect(previewDraggedNote(cached,target,source[0].midi).start).toBeCloseTo(result.note.start,9);
    let end=0;
    for (const n of result.items) {
      expect(n.start).toBeCloseTo(end,8);
      expect(n.dur).toBeGreaterThan(0);
      end=n.start+n.dur;
    }
    expect(end).toBeCloseTo(1200,8);
    expect(new Set(result.items.map(n=>n.id)).size).toBe(result.items.length);
    expect(result.items.filter(n=>n.midi<0).reduce((sum,n)=>sum+n.dur,0)).toBeCloseTo(550,8);
    for (const n of source) {
      const moved=result.items.find(x=>x.id===n.id);
      expect([moved.dur,moved.freq,moved.midi]).toEqual([n.dur,n.freq,n.midi]);
    }
  }
});

test('invalid timings do not get silently rewritten', () => {
  const a={id:1,midi:60,freq:262,start:0,dur:500};
  expect(placeDraggedNote([a,{...a,id:2,start:400}],a,700,1000)).toBeNull();
  expect(placeDraggedNote([a,{...a,id:2,start:NaN}],a,700,1000)).toBeNull();
});

test('repeated moves and fractional notes never grow the song or create holes', () => {
  let events=Array.from({length:150},(_,i)=>({id:i+1,midi:60+i%7,freq:300+i,start:i/3,dur:1/3}));
  for (let i=0;i<30;i++) {
    const note=events.find(n=>n.id===1+i%3);
    events=placeDraggedNote(events,note,(i*7)%50,50).items;
    let end=0;
    for (const event of events) {
      expect(event.start).toBeCloseTo(end,8);
      end=event.start+event.dur;
    }
    expect(end).toBeCloseTo(50,8);
    expect(events.length).toBe(150);
  }
});
