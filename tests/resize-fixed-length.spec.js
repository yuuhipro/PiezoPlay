import { expect, test } from '@playwright/test';
import { resizeNoteRipple, mergeAdjacentNotes } from '../src/timeline.js';

const N=(id,midi,start,dur)=>({id,midi,freq:midi<0?0:262,start,dur});

test('ripple-resizing shifts later events and reverses without drift', () => {
  const original=[N(1,60,0,500),N(2,64,500,500),N(3,-1,1000,500),N(4,67,1500,500)];
  const longer=resizeNoteRipple(original,2,700,2000);
  expect(longer.items.map(n=>[n.midi,n.start,n.dur])).toEqual([[60,0,500],[64,500,700],[-1,1200,500],[67,1700,500]]);
  expect(longer.duration).toBe(2200);
  const restored=resizeNoteRipple(longer.items,2,500,longer.duration);
  expect(restored.items.map(n=>[n.midi,n.start,n.dur])).toEqual(original.map(n=>[n.midi,n.start,n.dur]));
  expect(restored.duration).toBe(2000);
});

test('extensions and shortening shift subsequent notes and change total length', () => {
  const original=[N(1,60,0,400),N(2,-1,400,100),N(3,62,500,300)];
  const extended=resizeNoteRipple(original,1,800,1000);
  expect(extended.items.map(n=>[n.midi,n.start,n.dur])).toEqual([[60,0,800],[-1,800,100],[62,900,300]]);
  expect(extended.duration).toBe(1400);
  const shorter=resizeNoteRipple(extended.items,1,200,extended.duration);
  expect(shorter.items.map(n=>[n.midi,n.start,n.dur])).toEqual([[60,0,200],[-1,200,100],[62,300,300]]);
  expect(shorter.duration).toBe(800);
});

test('fractional notes and implicit gaps survive resize cycles', () => {
  const items=[N(1,60,0,.0005),N(2,62,.001,1)];
  const longer=resizeNoteRipple(items,1,.0008,1.001).items;
  expect(longer[0].dur).toBeCloseTo(.0008,9);
  expect(longer.at(-1).start).toBeCloseTo(.0013,9);
  const restored=resizeNoteRipple(longer,1,.0005,1.0013).items;
  expect(restored[0].dur).toBeCloseTo(.0005,9);
  expect(restored.at(-1).start+restored.at(-1).dur).toBeCloseTo(1.001,9);
});

const score=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
async function open(page) {
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'notes.xml',mimeType:'application/xml',buffer:Buffer.from(score)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
}
async function drag(page,x1,x2,y=115) {
  const canvas=page.getByRole('img',{name:/Punch strip/});
  await canvas.scrollIntoViewIfNeeded();
  const b=await canvas.boundingBox();
  await page.mouse.move(b.x+x1,b.y+y); await page.mouse.down();
  await page.mouse.move(b.x+x2,b.y+y,{steps:3}); await page.mouse.up();
}

test('back-to-back resize and reverse leave the song and following notes unchanged', async ({page}) => {
  await open(page);
  await drag(page,88,106);
  await drag(page,106,88);
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'3. Rest 1.00s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'4. G4 1.50s · 500ms'})).toBeVisible();
  await drag(page,88,133);
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 1000ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'3. Rest 1.50s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'4. G4 2.00s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  await expect(page.locator('pre')).toContainText('3 notes, 1 rests, 0:02 long');
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 330); delay(500);');
});

test('merging only joins touching notes with identical pitch', () => {
  const a=[N(1,60,0,250),N(2,60,250,500),N(3,62,750,500)];
  const result=mergeAdjacentNotes(a,2);
  expect(result.items.map(n=>[n.midi,n.start,n.dur])).toEqual([[60,0,750],[62,750,500]]);
  expect(result.note.id).toBe(1);
  expect(mergeAdjacentNotes(a,3)).toBeNull();
  expect(mergeAdjacentNotes([a[0],{...a[1],start:260}],1)).toBeNull();
  expect(mergeAdjacentNotes([a[0],N(4,-1,250,10),{...a[1],start:260}],1)).toBeNull();
});

test('closing unloads an unsaved editor session, reopening loads fresh notes', async ({page}) => {
  await open(page);
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await page.getByRole('button',{name:'Close note editor'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
});

test('a large score survives repeated back-to-back resizes without growing', async ({page}) => {
  const entries=Array.from({length:547},()=>'<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note>').join('');
  const large=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>2</divisions></attributes><direction><sound tempo="120"/></direction>${entries}</measure></part></score-partwise>`;
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'large.xml',mimeType:'application/xml',buffer:Buffer.from(large)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
  await expect(page.locator('pre')).toContainText('547 notes, 547 rests');
  const before=await page.locator('pre').innerText();
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
  await drag(page,20,29,130); await drag(page,29,20,130);
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 250ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'2. Rest 0.25s · 250ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  expect(await page.locator('pre').innerText()).toBe(before);
});
