import { expect, test } from '@playwright/test';

const score = `<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;

async function open(page, xml=score) {
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'notes.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
}
async function drag(page, x1, y1, x2, y2) {
  const canvas = page.getByRole('img',{name:/Punch strip/});
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x+x1,b.y+y1); await page.mouse.down();
  await page.mouse.move(b.x+x2,b.y+y2,{steps:5}); await page.mouse.up();
}

test('piano keys preview the right frequencies and work even without a selection', async ({page}) => {
  await page.addInitScript(() => {
    window.__preview = []; window.__starts=0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function() {
      const oscillator=create.call(this);
      const set=oscillator.frequency.setValueAtTime.bind(oscillator.frequency);
      oscillator.frequency.setValueAtTime=(f,t)=>{window.__preview.push(f);return set(f,t);};
      const start=oscillator.start.bind(oscillator);
      oscillator.start=(t)=>{window.__starts++;return start(t);};
      return oscillator;
    };
  });
  await open(page);
  expect(await page.evaluate(()=>window.__starts)).toBe(3);
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await page.getByRole('button',{name:'Piano key F#4'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__preview)).toEqual([294,370]);
  await expect(page.getByRole('button',{name:'1. F#4 0.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Delete selected'}).click();
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__preview)).toEqual([294,370,294]);
  expect(await page.evaluate(()=>window.__starts)).toBe(3);
  await expect(page.getByRole('button',{name:'1. E4 0.50s · 500ms'})).toHaveAttribute('aria-pressed','false');
});

test('audio failure is visible without blocking pitch editing', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window,'AudioContext',{value:undefined,configurable:true});
    Object.defineProperty(window,'webkitAudioContext',{value:undefined,configurable:true});
  });
  await open(page);
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await expect(page.getByRole('alert')).toContainText('Audio preview is unavailable');
  await expect(page.getByRole('button',{name:'1. D4 0.00s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 294); delay(500);');
});

test('dragging across neighbours changes the order and snaps to the boundary', async ({page}) => {
  await open(page);
  // The first C crosses E's midpoint and snaps directly after E.
  await drag(page,20,173,70,173);
  await expect(page.getByRole('button',{name:'1. E4 0.00s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'2. C4 0.50s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'3. Rest 1.00s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'4. G4 1.50s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  const code=await page.locator('pre').innerText();
  expect(code.indexOf('tone(BUZZER, 330); delay(500);')).toBeLessThan(code.indexOf('tone(BUZZER, 262); delay(500);'));
  expect(code).toContain('3 notes, 1 rests, 0:02 long');
});

test('dragging an earlier note left across a neighbour preserves their durations', async ({page}) => {
  await open(page);
  // E4's row is y=115 and the note's body lies near x=65.
  await drag(page,65,115,20,115);
  await expect(page.getByRole('button',{name:'1. E4 0.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'2. C4 0.50s · 500ms'})).toBeVisible();
});

test('dragging a note to the end leaves no hole and keeps the saved song length', async ({page}) => {
  await open(page);
  await drag(page,20,173,195,173);
  await expect(page.getByRole('button',{name:'1. E4 0.00s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'2. Rest 0.50s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'3. G4 1.00s · 500ms'})).toBeVisible();
  await expect(page.getByRole('button',{name:'4. C4 1.50s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  await expect(page.locator('pre')).toContainText('3 notes, 1 rests, 0:02 long');
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('button',{name:'4. C4 1.50s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'2. Rest 0.50s · 500ms'}).click();
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await expect(page.getByRole('button',{name:'2. D4 0.50s · 500ms'})).toBeVisible();
});

test('dragged notes snap to a nearby neighbour in an empty gap', async ({page}) => {
  await open(page);
  await page.getByRole('button',{name:'3. Rest 1.00s · 500ms'}).click();
  await page.getByRole('button',{name:'Delete selected'}).click();
  await page.waitForTimeout(150);
  await drag(page,155,83,100,83);
  await expect(page.getByRole('button',{name:'3. G4 1.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'4. Rest 1.50s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'4. Rest 1.50s · 500ms'}).click();
  await expect(page.getByLabel('Duration (ms)')).toHaveValue('500');
});

test('touch can move a note across a neighbour', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await open(page);
  const canvas=page.getByRole('img',{name:/Punch strip/});
  await canvas.scrollIntoViewIfNeeded();
  const b=await canvas.boundingBox();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+20,y:b.y+173,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+70,y:b.y+173,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByRole('button',{name:'2. C4 0.50s · 500ms'})).toHaveAttribute('aria-pressed','true');
});

test('long scrollable strips retain a sharp backing canvas and select notes after scrolling', async ({page}) => {
  const long = score.replace('<duration>1</duration>', '<duration>1200</duration>');
  await page.setViewportSize({width:390,height:844});
  await open(page,long);
  const sc=page.locator('.strip-scroll');
  await sc.scrollIntoViewIfNeeded();
  await sc.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await expect.poll(()=>sc.evaluate(el=>el.scrollLeft)).toBeGreaterThan(10000);
  const dimensions=await page.getByRole('img',{name:/Punch strip/}).evaluate(el=>({bitmap:el.width,css:el.getBoundingClientRect().width,dpr:Math.min(devicePixelRatio||1,2),parent:el.parentElement.getBoundingClientRect().width}));
  expect(dimensions.bitmap/dimensions.css).toBeGreaterThanOrEqual(dimensions.dpr-.02);
  expect(dimensions.parent).toBeGreaterThan(10000);
  // Scroll back just enough to find E4, then click its visible location.
  const state=await sc.evaluate(el=>{const canvas=el.querySelector('canvas'); const parent=canvas.parentElement; return {left:el.scrollLeft, width:parent.getBoundingClientRect().width};});
  const pxPerSec=(state.width-24)/601.5;
  const x=600*pxPerSec-state.left+10;
  const box=await sc.boundingBox();
  await page.mouse.click(box.x+x,box.y+115);
  await expect(page.getByText('Editing E4')).toBeVisible();
});
