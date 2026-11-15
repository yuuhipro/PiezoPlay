import { unzipSync, strFromU8 } from 'fflate';
import { midiToHz } from './melody.js';

const MAX_BYTES = 64 * 1024 * 1024;
const children = (el, name) => Array.from(el?.children || []).filter(x => x.localName === name);
const child = (el, name) => children(el, name)[0];
const text = (el, name) => child(el, name)?.textContent?.trim() || '';
const number = (el, name, fallback = 0) => { const v = Number(text(el, name)); return Number.isFinite(v) && text(el, name) !== '' ? v : fallback; };

function readZip(bytes) {
  // Refuse oversized zip members before decompressing, including zip bombs.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This MXL archive is not a valid ZIP file.');
  let pos = view.getUint32(eocd + 16, true), total = 0, count = view.getUint16(eocd + 10, true);
  if (count > 1000) throw new Error('This MXL archive has too many files.');
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error('This MXL archive is incomplete.');
    total += view.getUint32(pos + 24, true);
    if (total > MAX_BYTES) throw new Error('The uncompressed MXL exceeds the 64 MiB browser safety limit.');
    pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
  return unzipSync(bytes);
}

function xmlDoc(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    // MusicXML commonly includes a public DOCTYPE; discard it without fetching a DTD.
    if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('XML entity definitions are not supported.');
    xml = xml.replace(/<!DOCTYPE[^>]*>/i, '');
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Could not read this MusicXML file.');
  return doc;
}

export async function loadMusicXML(file) {
  if (file.size > MAX_BYTES) throw new Error('The score exceeds the 64 MiB browser safety limit.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let xml;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let zip; try { zip = readZip(bytes); } catch (e) { throw new Error(e.message || 'Cannot open this MXL archive.'); }
    const container = zip['META-INF/container.xml'];
    if (!container) throw new Error('MXL archive is missing its container file.');
    const manifest = xmlDoc(strFromU8(container));
    const entry = manifest.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
    if (!entry || !zip[entry]) throw new Error('MXL archive does not contain its declared score.');
    xml = strFromU8(zip[entry]);
  } else xml = new TextDecoder().decode(bytes);
  const doc = xmlDoc(xml), root = doc.documentElement;
  if (root.localName !== 'score-partwise') throw new Error('Please export a partwise MusicXML score (.musicxml, .xml or .mxl).');
  const partNames = new Map();
  for (const p of children(child(root, 'part-list'), 'score-part')) partNames.set(p.getAttribute('id'), text(p, 'part-name') || 'Instrument');
  const source = children(root, 'part');
  if (!source.length) throw new Error('No instrument parts found in this score.');
  const warnings = new Set(), rawParts = [];
  let measureCount = 0;
  for (const part of source) {
    let divisions = 1, transpose = 0;
    const measures = [];
    for (const measure of children(part, 'measure')) {
      let cursor = 0, end = 0, previousStart = 0;
      const events = [], tempos = [];
      const forward = [...measure.getElementsByTagNameNS('*','repeat')].some(r=>r.getAttribute('direction')==='forward');
      const backward = [...measure.getElementsByTagNameNS('*','repeat')].find(r=>r.getAttribute('direction')==='backward');
      const ending = !!measure.getElementsByTagNameNS('*','ending').length;
      const jump = !!measure.querySelector('sound[dacapo], sound[dalsegno], sound[tocoda], sound[segno], sound[coda]');
      if (ending) warnings.add('Alternate endings are not expanded. Export an unfolded score for exact playback.');
      if (jump) warnings.add('Jump markings are not expanded. Export an unfolded score for exact playback.');
      for (const e of Array.from(measure.children)) {
        if (e.localName === 'attributes') {
          divisions = number(e, 'divisions', divisions);
          if (!(divisions > 0)) throw new Error('Invalid divisions value in score.');
          const trans = child(e, 'transpose');
          if (trans) transpose = number(trans, 'chromatic', 0) + 12 * number(trans, 'octave-change', 0);
        } else if (e.localName === 'backup') cursor = Math.max(0, cursor - number(e, 'duration') / divisions);
        else if (e.localName === 'forward') { cursor += number(e, 'duration') / divisions; end = Math.max(end, cursor); }
        else if (e.localName === 'direction') {
          const sound = child(e, 'sound'); let bpm = Number(sound?.getAttribute('tempo'));
          if (!bpm) {
            const metro = e.getElementsByTagNameNS('*','metronome')[0];
            const units = {whole:4, half:2, quarter:1, eighth:.5, '16th':.25};
            const beat = text(metro, 'beat-unit'), per = number(metro, 'per-minute', 0), dots = children(metro, 'beat-unit-dot').length;
            if (per && units[beat]) bpm = per * units[beat] * (2 - 1 / 2 ** dots);
          }
          if (bpm > 0 && bpm <= 1000) tempos.push({ q: Math.max(0, cursor + number(e,'offset')/divisions), bpm });
        } else if (e.localName === 'note') {
          const duration = number(e, 'duration') / divisions;
          if (child(e, 'grace')) { warnings.add('Grace notes are skipped.'); continue; }
          const chord = !!child(e, 'chord'), start = chord ? previousStart : cursor;
          if (!chord) { previousStart = start; cursor += duration; }
          end = Math.max(end, cursor, start + duration);
          if (!(duration > 0)) continue;
          const pitch = child(e, 'pitch');
          if (!pitch) { if (!child(e, 'rest')) warnings.add('Unpitched percussion is skipped.'); continue; }
          const step = text(pitch,'step'), octave = number(pitch,'octave', NaN), alter = number(pitch,'alter', 0);
          if (!Number.isInteger(alter) || !Number.isInteger(transpose)) throw new Error('Microtonal notes or transpositions are not supported.');
          const semis = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
          const midi = (octave + 1) * 12 + semis[step] + alter + transpose;
          if (!Number.isInteger(midi) || midi < 0 || midi > 131) throw new Error('This MusicXML pitch is outside the supported C-1 to B9 notation range.');
          const ties = children(e,'tie').map(x=>x.getAttribute('type'));
          const voice = text(e, 'voice') || '1', staff = text(e, 'staff') || '1';
          events.push({ start, end:start+duration, midi, voice, staff, tieStop:ties.includes('stop'), tieStart:ties.includes('start') });
        }
      }
      measures.push({ events, tempos, end, forward, backward:!!backward, repeatTimes:Math.max(2, Number(backward?.getAttribute("times")) || 2), ending });
    }
    measureCount = Math.max(measureCount, measures.length);
    rawParts.push({ id:part.getAttribute('id'), name:partNames.get(part.getAttribute('id')) || 'Instrument', measures });
  }
  const anyEndings = rawParts.some(p=>p.measures.some(m=>m.ending));
  let nesting = 0, nestedRepeats = false;
  for (const m of rawParts[0].measures) {
    if (m.forward && ++nesting > 1) nestedRepeats = true;
    if (m.backward) nesting = Math.max(0, nesting - 1);
  }
  if (nestedRepeats) warnings.add('Nested repeats are not expanded. Export an unfolded score for exact playback.');
  const order = [], attempts = new Map(); let repeatStart = 0, i = 0;
  while (i < measureCount) {
    const m = rawParts[0].measures[i];
    if (m?.forward && !attempts.has(i)) repeatStart = i;
    order.push(i);
    if (order.length > Math.max(1000000, measureCount * 8)) throw new Error('This score expands beyond the browser safety limit for repeated measures.');
    if (!anyEndings && !nestedRepeats && m?.backward) {
      const count = attempts.get(i) || 1;
      if (count < m.repeatTimes) { attempts.set(i,count+1); i = repeatStart; continue; }
      attempts.delete(i); repeatStart = i+1;
    }
    i++;
  }
  let total = 0;
  const playback = order.map(index => {
    const start = total;
    total += Math.max(0, ...rawParts.map(p => p.measures[index]?.end || 0));
    return { index, start };
  });
  const tempoMap = [];
  // Tempo changes in the first part are authoritative; use other parts only where missing.
  for (const p of rawParts) playback.forEach(({index,start}) => p.measures[index]?.tempos.forEach(t => tempoMap.push({ q: start + t.q, bpm:t.bpm })));
  tempoMap.sort((a,b)=>a.q-b.q);
  const tempos = [{q:0,bpm:120}];
  for (const t of tempoMap) {
    if (Math.abs(t.q-tempos[tempos.length-1].q) < 1e-7) {
      if (t.q === 0 && tempos.length === 1 && tempos[0].defaultTempo !== false) tempos[0] = { ...t, defaultTempo:false };
      else if (Math.abs(tempos[tempos.length-1].bpm - t.bpm) > .01) warnings.add('Conflicting tempo markings at the same point: using the first part’s marking.');
    } else tempos.push(t);
  }
  for (let k=0;k<tempos.length;k++) tempos[k].ms = k ? tempos[k-1].ms + (tempos[k].q-tempos[k-1].q)*60000/tempos[k-1].bpm : 0;
  const toMs = q => { let a=0,b=tempos.length-1; while(a<b){ const m=Math.ceil((a+b)/2); if(tempos[m].q <= q) a=m; else b=m-1; } return tempos[a].ms + (q-tempos[a].q)*60000/tempos[a].bpm; };
  const parts = rawParts.flatMap(p => {
    const groups = new Map();
    playback.forEach(({index,start})=>p.measures[index]?.events.forEach(e=>{ const key = `${e.staff}|${e.voice}`; if (!groups.has(key)) groups.set(key,[]); groups.get(key).push({...e,start:e.start+start,end:e.end+start}); }));
    return [...groups].map(([key,events]) => { const [staff,voice]=key.split('|'); return { id:`${p.id}|${staff}|${voice}`, label:`${p.name} · staff ${staff} · voice ${voice}`, events }; });
  });
  if (!parts.length) throw new Error('No pitched notes found. Choose a score with at least one melody.');
  if (!tempoMap.length) warnings.add('No tempo marking found; using 120 BPM.');
  return { parts, warnings:[...warnings], toMs, totalQuarters:total };
}

export function convertScore(score, partId) {
  const part = score.parts.find(p => p.id === partId);
  if (!part) throw new Error('Choose an instrument and voice.');
  const events = part.events, pointSet=new Set([0,score.totalQuarters]);
  for (const e of events) { pointSet.add(e.start); pointSet.add(e.end); }
  const points=[...pointSet].sort((a,b)=>a-b);
  const startMap = new Map(), endMap = new Map();
  events.forEach((e,i)=>{ if(!startMap.has(e.start))startMap.set(e.start,[]); startMap.get(e.start).push(i); if(!endMap.has(e.end))endMap.set(e.end,[]);endMap.get(e.end).push(i); });
  const active = new Set(), raw = [], heap=[]; let overlaps=false, serial=0;
  const better=(a,b)=>a.midi>b.midi || (a.midi===b.midi && a.order<b.order);
  const push = item => { let i=heap.length;heap.push(item);while(i>0){const p=(i-1)>>1;if(better(heap[p],item))break;heap[i]=heap[p];i=p;}heap[i]=item; };
  const pop = () => {const last=heap.pop();if(!heap.length)return;let i=0;while(true){let l=i*2+1;if(l>=heap.length)break;let r=l+1,b=r<heap.length&&better(heap[r],heap[l])?r:l;if(better(last,heap[b]))break;heap[i]=heap[b];i=b;}heap[i]=last;};
  for(let i=0;i<points.length-1;i++) {
    const q=points[i]; for(const id of endMap.get(q)||[])active.delete(id); for(const id of startMap.get(q)||[]) {active.add(id);push({id,midi:events[id].midi,order:serial++});}
    while(heap.length && !active.has(heap[0].id)) pop();
    const chosen=heap.length ? events[heap[0].id] : null;
    if(active.size>1) overlaps=true;
    const midi=chosen?.midi ?? -1, start=score.toMs(q), end=score.toMs(points[i+1]);
    const prev=raw[raw.length-1];
    const continued = chosen && (q > chosen.start + 1e-7 || chosen.tieStop);
    if(prev && prev.midi===midi && (midi<0 || continued)) prev.dur=end-prev.start;
    else if(end>start) raw.push({midi,freq:midi<0?0:midiToHz(midi),start,dur:end-start});
  }
  return { notes:raw, durationMs:score.toMs(score.totalQuarters), overlaps };
}
