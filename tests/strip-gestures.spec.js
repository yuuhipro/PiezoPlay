import { expect, test } from '@playwright/test';

const score = `<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;

async function open(page) {
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'notes.xml', mimeType:'application/xml', buffer:Buffer.from(score)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
}

async function drag(page, x1, y1, x2, y2) {
  const box = await page.getByRole('img',{name:/Punch strip/}).boundingBox();
  await page.mouse.move(box.x+x1, box.y+y1);
  await page.mouse.down();
  await page.mouse.move(box.x+x2, box.y+y2, {steps:5});
  await page.mouse.up();
}

test('inserts after the selected note and shifts later notes and rests, including export', async ({page}) => {
  await open(page);
  await page.getByRole('button',{name:'2. E4 0.50s · 500ms'}).click();
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await expect(page.getByRole('button',{name:'3. C4 1.00s · 250ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'4. Rest 1.25s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'5. G4 1.75s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  const code = await page.locator('pre').innerText();
  expect(code).toContain('noTone(BUZZER); delay(500);');
  expect(code).toContain('tone(BUZZER, 392); delay(500);');
  expect(code).toContain('tone(BUZZER, 262); delay(250);');
  expect(code.indexOf('tone(BUZZER, 330); delay(500);')).toBeLessThan(code.indexOf('tone(BUZZER, 262); delay(250);'));
  expect(code.indexOf('tone(BUZZER, 262); delay(250);')).toBeLessThan(code.indexOf('noTone(BUZZER); delay(500);'));
  expect(code.indexOf('noTone(BUZZER); delay(500);')).toBeLessThan(code.indexOf('tone(BUZZER, 392); delay(500);'));
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('button',{name:'5. G4 1.75s · 500ms'})).toBeVisible();
});

test('inserts after a rest and handles selecting a new note across a page boundary', async ({page}) => {
  const entries = Array.from({length:22}, (_,i) => i===19 ? '<note><rest/><duration>1</duration></note>' : '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>').join('');
  const long = score.replace(/<note><pitch><step>C<\/step>[\s\S]*?<\/note><\/measure>/, `${entries}</measure>`);
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'long.xml',mimeType:'application/xml',buffer:Buffer.from(long)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await page.getByRole('button',{name:'20. Rest 9.50s · 500ms'}).click();
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await expect(page.getByRole('button',{name:'21. C4 10.00s · 250ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'22. C4 10.25s · 500ms'})).toBeVisible();
});

test('resize extends the note and moves the following events', async ({page}) => {
  await open(page);
  await drag(page, 20, 173, 38, 144);
  await expect(page.getByLabel('Start (ms)')).toHaveValue('0');
  await expect(page.getByRole('button',{name:'1. D4 0.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.getByRole('img',{name:/Punch strip/}).scrollIntoViewIfNeeded();
  // E4 ends at x=88, with 500ms of rest before the next note.
  await drag(page, 88, 115, 106, 115);
  await expect(page.getByLabel('Duration (ms)')).toHaveValue('700');
  await expect(page.getByRole('button',{name:'3. Rest 1.20s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'4. G4 1.70s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 330); delay(700);');
  await expect(page.locator('pre')).toContainText('3 notes, 1 rests, 0:02 long');
  let code=await page.locator('pre').innerText();
  expect([...code.matchAll(/delay\((\d+)\);/g)].reduce((s,m)=>s+Number(m[1]),0)).toBe(2200);
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await page.getByRole('button',{name:'2. E4 0.50s · 700ms'}).click();
  await expect(page.getByLabel('Duration (ms)')).toHaveValue('700');
  await page.getByRole('img',{name:/Punch strip/}).scrollIntoViewIfNeeded();
  await drag(page, 106, 115, 70, 115);
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 300ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'4. G4 1.30s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  code=await page.locator('pre').innerText();
  expect([...code.matchAll(/delay\((\d+)\);/g)].reduce((s,m)=>s+Number(m[1]),0)).toBe(1800);
});

test('deleting all then adding a note falls back to appending', async ({page}) => {
  await open(page);
  for (let i=0; i<4; i++) {
    if (i) await page.getByRole('list',{name:'Notes and rests'}).getByRole('button').first().click();
    await page.getByRole('button',{name:'Delete selected'}).click();
  }
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 250ms'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 262); delay(250);');
});

test('touch dragging can resize a note', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await open(page);
  const canvas = page.getByRole('img',{name:/Punch strip/});
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+88,y:box.y+115,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+106,y:box.y+115,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByLabel('Duration (ms)')).toHaveValue('700');
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 330); delay(700);');
});
