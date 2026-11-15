import { expect, test } from '@playwright/test';
import { loadMidi } from '../src/midi.js';
import { convertScore } from '../src/musicxml.js';
import { generateSketch } from '../src/melody.js';

const be16=x=>[(x>>8)&255,x&255];
const be32=x=>[(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255];
const chunk=(name,data)=>Buffer.concat([Buffer.from(name),Buffer.from(be32(data.length)),data]);
const vlq=x=>{const a=[x&127];while(x>>=7)a.unshift((x&127)|128);return a;};

test('MIDI and conversion handle more than 20,000 notes without truncation',async()=>{
  const count=20001;
  const events=Buffer.alloc(count*8+4);
  for(let i=0;i<count;i++) events.set([0,0x90,60,100,1,0x80,60,0],i*8);
  events.set([0,0xff,0x2f,0],count*8);
  const file=Buffer.concat([chunk('MThd',Buffer.from([...be16(0),...be16(1),...be16(480)])),chunk('MTrk',events)]);
  const parsed=await loadMidi({size:file.length,arrayBuffer:async()=>file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength)});
  expect(parsed.parts[0].events.length).toBe(count);
  const converted=convertScore(parsed,parsed.parts[0].id);
  expect(converted.notes.length).toBe(count);
  expect(converted.notes.at(-1).start+converted.notes.at(-1).dur).toBeCloseTo(converted.durationMs,5);
  const payload=Buffer.alloc(8*1024*1024,0);
  const largeTrack=Buffer.concat([Buffer.from([0,0xf0,...vlq(payload.length)]),payload,Buffer.from([0,0x90,60,100,1,0x80,60,0,0,0xff,0x2f,0])]);
  const largeFile=Buffer.concat([chunk('MThd',Buffer.from([...be16(0),...be16(1),...be16(480)])),chunk('MTrk',largeTrack)]);
  const parsedLarge=await loadMidi({size:largeFile.length,arrayBuffer:async()=>largeFile.buffer.slice(largeFile.byteOffset,largeFile.byteOffset+largeFile.byteLength)});
  expect(parsedLarge.parts[0].events.length).toBe(1);
  await expect(loadMidi({size:64*1024*1024+1})).rejects.toThrow('64 MiB');
});

test('large PROGMEM sketches use bounded blocks, wide counters and far reads',()=>{
  const notes=Array.from({length:65536},()=>({midi:60,freq:262,ms:10.25,us:10250}));
  const code=generateSketch(notes,{pin:'8',format:'arrays',staccato:false,repeat:false,title:'large',speaker:true});
  expect(code).toContain('const uint32_t NOTE_COUNT = 65536UL;');
  expect(code).toContain('const uint16_t melody_15[] PROGMEM');
  expect(code).toContain('const uint32_t durations_15[] PROGMEM');
  expect(code).toContain('const uint16_t durationMicros_15[] PROGMEM');
  expect(code).toContain('pgm_read_word_far(pgm_get_far_address(melody_15)');
  expect(code).toContain('pgm_read_dword_far(pgm_get_far_address(durations_15)');
  expect(code).toContain('for (uint32_t i = 0; i < NOTE_COUNT; i++)');
});

test('MusicXML above the old size and note caps imports; board warnings are estimates',async({page})=>{
  const count=20001, note='<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>';
  const xml=`<score-partwise><!--${'x'.repeat(8*1024*1024)}--><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>10</divisions></attributes><direction><sound tempo="120"/></direction>${note.repeat(count)}</measure></part></score-partwise>`;
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'large.musicxml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await expect(page.getByRole('heading',{name:'Choose a melody'})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
  await expect(page.locator('pre')).toContainText('20001 notes',{timeout:30000});
  await expect(page.getByText('near or above the selected board',{exact:false})).toBeVisible();
  const board=page.getByLabel('Board flash');
  await board.selectOption('mega');
  await page.getByRole('radio',{name:'PROGMEM'}).click();
  await expect(page.getByText('near or above the selected board',{exact:false})).toHaveCount(0);
  await expect(page.getByText('Compile to verify',{exact:false})).toBeVisible();
});
