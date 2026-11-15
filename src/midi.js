// Standard MIDI Files (format 0 and 1). Track and channel become selectable melodies.
const LIMIT = 64 * 1024 * 1024;
export async function loadMidi(file) {
  if (file.size > LIMIT) throw new Error('This MIDI file exceeds the 64 MiB browser safety limit.');
  const b = new Uint8Array(await file.arrayBuffer()); let pos = 0;
  const fail = () => { throw new Error('This MIDI file is invalid or incomplete.'); };
  const u8 = end => { if (pos >= end) fail(); return b[pos++]; };
  const u16 = end => u8(end) * 256 + u8(end);
  const u32 = end => u16(end) * 65536 + u16(end);
  const tag = end => String.fromCharCode(u8(end),u8(end),u8(end),u8(end));
  const variable = end => { let v=0; for(let i=0;i<4;i++){let x=u8(end);v=v*128+(x&127);if(!(x&128))return v;} fail(); };
  if (tag(b.length) !== 'MThd') fail();
  const hlen = u32(b.length); if (hlen < 6 || hlen > b.length - pos) fail();
  const hEnd=pos+hlen, format=u16(hEnd), trackCount=u16(hEnd), division=u16(hEnd); pos=hEnd;
  if (format === 2) throw new Error('MIDI format 2 contains separate songs and is not supported. Export as format 0 or 1.');
  if (format > 2 || trackCount < 1 || trackCount > Math.floor((b.length-pos)/8) || (format === 0 && trackCount !== 1)) fail();
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI is not supported. Export a beat-based MIDI file.');
  if (!division) fail();
  const warnings = new Set(), tempos = [{tick:0, us:500000}], tracks=[];
  let totalTick=0, hasTempo=false;
  for(let ti=0; ti<trackCount; ti++) {
    if(tag(b.length)!=='MTrk') fail(); const len=u32(b.length),end=pos+len; if(end>b.length) fail();
    let tick=0, running=null, name='', ended=false;
    const notes=[], open=new Map();
    while(pos<end) {
      tick += variable(end); if (!Number.isSafeInteger(tick)) fail();
      let status=u8(end), first=null;
      if(status<0x80) { if(running===null) fail(); first=status; status=running; }
      else if(status<0xf0) running=status;
      if(status===0xff) {
        running=null; const type=u8(end), size=variable(end); if(size>end-pos) fail();
        if(type===0x03) name=new TextDecoder().decode(b.subarray(pos,pos+Math.min(size,200))).replace(/[\x00-\x1f]/g,' ').trim();
        if(type===0x51 && size===3) { const us=b[pos]*65536+b[pos+1]*256+b[pos+2];if(!us) fail();tempos.push({tick,us}); hasTempo=true; }
        pos+=size;
        if(type===0x2f) { if(size!==0) fail(); ended=true; break; }
      } else if(status===0xf0 || status===0xf7) {running=null;const size=variable(end);if(size>end-pos)fail();pos+=size;}
      else if(status>=0x80 && status<0xf0) {
        const op=status>>4, channel=status&15, needed=(op===0xc||op===0xd)?1:2;
        const a=first===null?u8(end):first, d=needed===2?u8(end):0; if(a>=128 || d>=128)fail();
        const key=`${channel}:${a}`;
        if(op===9 && d>0) { if(!open.has(key))open.set(key,{items:[],head:0}); open.get(key).items.push({start:tick,midi:a,channel}); }
        else if(op===8 || (op===9 && d===0)) { const q=open.get(key); if(q && q.head<q.items.length) {let note=q.items[q.head++];if(tick>note.start)notes.push({...note,end:tick});if(q.head===q.items.length)open.delete(key);} else warnings.add('Some note-off events had no matching note and were skipped.'); }
        else if(op===0xe) warnings.add('Pitch bends are not applied; the buzzer uses the written MIDI notes.');
        else if(op===0xb && a===64) warnings.add('Sustain pedal effects are not applied.');
      } else fail();
    }
    if(!ended) warnings.add('A track has no end marker; using its last event.');
    for(const queue of open.values()) for(let j=queue.head;j<queue.items.length;j++) {const note=queue.items[j];if(tick>note.start)notes.push({...note,end:tick}); warnings.add('Some unfinished notes were ended at the track boundary.'); }
    totalTick=Math.max(totalTick,tick); pos=end;
    const channels=new Map();
    for(const n of notes) { if(n.channel===9){ warnings.add('Drum channel 10 is skipped; a buzzer needs pitched notes.');continue;} if(!channels.has(n.channel))channels.set(n.channel,[]);channels.get(n.channel).push(n); }
    for(const [ch, events] of channels) tracks.push({ id:`midi-${ti}-${ch}`, label:`${name || `Track ${ti+1}`} · channel ${ch+1}`, events:events.map(n=>({ ...n, start:n.start/division,end:n.end/division })) });
  }
  if(!tracks.length)throw new Error('No pitched notes found in this MIDI file.');
  tempos.sort((a,b)=>a.tick-b.tick); const unique=[];
  for(const t of tempos){if(unique.length&&unique[unique.length-1].tick===t.tick)unique[unique.length-1]=t;else unique.push(t);}
  for(let i=0;i<unique.length;i++)unique[i].ms=i?unique[i-1].ms+(unique[i].tick-unique[i-1].tick)*unique[i-1].us/(1000*division):0;
  const toMs=q=>{const tick=q*division;let a=0,z=unique.length-1;while(a<z){let m=Math.ceil((a+z)/2);if(unique[m].tick<=tick)a=m;else z=m-1;}return unique[a].ms+(tick-unique[a].tick)*unique[a].us/(1000*division);};
  if(!hasTempo) warnings.add('Default tempo is 120 BPM when no tempo is specified.');
  return { parts:tracks, warnings:[...warnings], toMs, totalQuarters:totalTick/division, kind:'MIDI' };
}
