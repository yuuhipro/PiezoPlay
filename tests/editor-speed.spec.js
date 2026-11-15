import { expect, test } from '@playwright/test';
const score=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
async function open(page) {await page.goto('/');await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'melody.xml',mimeType:'application/xml',buffer:Buffer.from(score)});await page.getByRole('button',{name:'Convert to buzzer'}).click();}
const speed = page=>page.locator('[data-slot="slider"][aria-label="Speed"] [role="slider"]');
test('edit pitch, add note, save and reopen',async({page})=>{
 await open(page); await page.getByRole('button',{name:'Add / edit notes'}).click();
 await page.getByRole('button',{name:'Piano key D4'}).click();
 await page.getByRole('button',{name:'Add note',exact:true}).click();
 await page.getByRole('button',{name:'Piano key G4'}).click();
 await page.getByRole('button',{name:'Done / Save'}).click();
 await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
 const code=page.locator('pre'); await expect(code).toContainText('tone(BUZZER, 294); delay(500);');
 await expect(code).toContainText('tone(BUZZER, 392); delay(250);');
 await expect(code).toContainText('3 notes');
 await page.getByRole('button',{name:'Add / edit notes'}).click();await expect(page.getByRole('button',{name:'1. D4 0.00s · 500ms'})).toBeVisible();
});
test('speed applies only on demand and changes export duration',async({page})=>{
 await open(page); const code=page.locator('pre');await expect(code).toContainText('tone(BUZZER, 262); delay(500);');
 await speed(page).focus(); await page.keyboard.press('End');await expect(code).toContainText('delay(500)');
 await page.getByRole('button',{name:'Apply ears settings'}).click();await expect(code).toContainText('tone(BUZZER, 262); delay(250);');
 await speed(page).focus();await page.keyboard.press('Home');await page.getByRole('button',{name:'Apply ears settings'}).click();await expect(code).toContainText('tone(BUZZER, 262); delay(5000);');
 await speed(page).focus();await page.keyboard.press('ArrowRight');await page.getByRole('button',{name:'Apply ears settings'}).click();await expect(code).toContainText('tone(BUZZER, 262); delay(2500);');
});
test('changing speed keeps manual notes and export formatting',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Add / edit notes'}).click();await page.getByRole('button',{name:'Piano key D4'}).click();await page.getByRole('button',{name:'Done / Save'}).click();
 await speed(page).focus();await page.keyboard.press('End');await page.getByRole('button',{name:'Apply ears settings'}).click();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 294); delay(250);');
 await page.getByRole('radio',{name:'PROGMEM'}).click();await expect(page.locator('pre')).toContainText('294, 330');await expect(page.locator('pre')).toContainText('250, 250');
});

test('buzzer preview uses the same 2x speed as the sketch',async({page})=>{
 await page.addInitScript(()=>{
   window.__freqEvents=[];
   const old=AudioContext.prototype.createOscillator;
   AudioContext.prototype.createOscillator=function(){const osc=old.call(this), set=osc.frequency.setValueAtTime.bind(osc.frequency);osc.frequency.setValueAtTime=(v,t)=>{window.__freqEvents.push([v,t]);return set(v,t)};return osc;};
 });
 await open(page);await speed(page).focus();await page.keyboard.press('End');await page.getByRole('button',{name:'Apply ears settings'}).click();
 await page.getByRole('button',{name:'Play as buzzer'}).click();
 await expect.poll(()=>page.evaluate(()=>window.__freqEvents.length)).toBeGreaterThanOrEqual(2);
 const data=await page.evaluate(()=>window.__freqEvents);
 expect(data[0][0]).toBe(262);expect(data[1][0]).toBe(330);expect(data[1][1]-data[0][1]).toBeCloseTo(.25,3);
 await page.getByRole('button',{name:'Stop',exact:false}).click();
});

test('tap a note on the strip to edit it directly, then save',async({page})=>{
 await open(page);
 await page.getByRole('button',{name:'Add / edit notes'}).click();
 const plot=page.getByRole('img',{name:/Punch strip/});
 await expect(plot).toHaveAttribute('aria-label',/Tap a note to edit/);
 // Two notes C4 and E4. The second spans 0.5 to 1s and sits at its E4 row.
 await plot.click({position:{x:60,y:101}});
 await expect(page.getByRole('button',{name:'2. E4 0.50s · 500ms'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByText('Editing E4')).toBeVisible();
 await page.getByRole('button',{name:'Piano key G4'}).click();
 await expect(page.getByText('Editing G4')).toBeVisible();
 await page.getByRole('button',{name:'Done / Save'}).click();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 392); delay(500);');
 await expect(plot).toHaveAttribute('aria-label',/Click to play/);
});
test('strip edits are temporary until saved; cancel restores the original',async({page})=>{
 await open(page);const code=page.locator('pre'), before=await code.innerText();
 await page.getByRole('button',{name:'Add / edit notes'}).click();
 const plot=page.getByRole('img',{name:/Punch strip/});await plot.click({position:{x:60,y:101}});
 await page.getByRole('button',{name:'Piano key G4'}).click();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await code.innerText()).toBe(before);
});

test('short MusicXML notes and rests can be saved without timing errors',async({page})=>{
 const tiny=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>2000</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration></note></measure></part></score-partwise>`;
 await page.goto('/');await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'tiny.musicxml',mimeType:'application/xml',buffer:Buffer.from(tiny)});await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 262); delayMicroseconds(250);');
 await expect(page.locator('pre')).toContainText('noTone(BUZZER); delayMicroseconds(250);');
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 294); delayMicroseconds(500);');
 await page.getByRole('button',{name:'Add / edit notes'}).click();
 await expect(page.getByLabel('Duration (ms)')).toHaveValue('0.25');
 await page.getByRole('button',{name:'Done / Save'}).click();
 await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
 await expect(page.locator('pre')).toContainText('delayMicroseconds(250)');
 await page.getByRole('radio',{name:'PROGMEM'}).click();
 await expect(page.locator('pre')).toContainText('const uint16_t durationMicros[] PROGMEM');
 await expect(page.locator('pre')).toContainText('250, 250, 500');
 await page.getByRole('radio',{name:'Staccato'}).click();
 await expect(page.locator('pre')).toContainText('waitParts(activeMs, activeUs)');
 await page.getByRole('radio',{name:'tone + delay'}).click();
 await page.getByRole('radio',{name:'Legato'}).click();
 await page.getByRole('button',{name:'Add / edit notes'}).click();
 const duration=page.getByLabel('Duration (ms)');await duration.fill('0');await page.getByRole('button',{name:'Done / Save'}).click();
 await expect(page.getByRole('alert')).toContainText('greater than 0');
 await duration.fill('0.125');await page.getByRole('button',{name:'Done / Save'}).click();
 await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 262); delayMicroseconds(125);');
});

test('saving a long score with fractional notes does not reject valid timing',async({page})=>{
 const entries=Array.from({length:180},(_,i)=>`<note><pitch><step>${i%2?'D':'C'}</step><octave>4</octave></pitch><duration>${i%3?1:7}</duration></note><note><rest/><duration>1</duration></note>`).join('');
 const x=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>3000</divisions></attributes><direction><sound tempo="173"/></direction>${entries}</measure></part></score-partwise>`;
 await page.goto('/');await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'fractional.xml',mimeType:'application/xml',buffer:Buffer.from(x)});
 await page.getByRole('button',{name:'Convert to buzzer'}).click();await page.getByRole('button',{name:'Add / edit notes'}).click();
 await page.getByRole('button',{name:'Done / Save'}).click();
 await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
 await expect(page.locator('pre')).toContainText('180 notes');
 await expect(page.locator('pre')).toContainText('delayMicroseconds');
});

test('selecting notes does not repaint the entire strip',async({page})=>{
 await page.addInitScript(()=>{
   window.__paintCount=0;
   const clear=CanvasRenderingContext2D.prototype.clearRect;
   CanvasRenderingContext2D.prototype.clearRect=function(...args){window.__paintCount++;return clear.apply(this,args)};
 });
 await open(page);await page.getByRole('button',{name:'Add / edit notes'}).click();
 await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
 await page.waitForTimeout(150);
 const before=await page.evaluate(()=>window.__paintCount);
 await page.getByRole('button',{name:'2. E4 0.50s · 500ms'}).click();
 await expect(page.getByText('Editing E4')).toBeVisible();
 expect(await page.evaluate(()=>window.__paintCount)).toBe(before);
});

