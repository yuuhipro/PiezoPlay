import { expect, test } from '@playwright/test';

const score=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
async function load(page, xml=score) {
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'notes.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
}
async function open(page) {
  await load(page);
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
}

test('undo pitch changes, add, delete, rests and timing fields in order', async ({page}) => {
  await load(page);
  await expect(page.getByText('Buzzer settings',{exact:true})).toBeVisible();
  await expect(page.locator('pre')).toBeVisible();
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
  await expect(page.getByText('Buzzer settings',{exact:true})).toHaveCount(0);
  await expect(page.locator('pre')).toHaveCount(0);
  const undo=page.getByRole('button',{name:'Undo',exact:true});
  await expect(undo).toBeDisabled();
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await page.getByRole('button',{name:'Piano key F4'}).click();
  await undo.click();
  await expect(page.getByRole('button',{name:'1. D4 0.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await undo.click();
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await expect(undo).toBeDisabled();
  const merge=page.getByRole('button',{name:'Merge notes',exact:true});
  await expect(merge).toBeDisabled();
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await expect(page.getByRole('button',{name:'2. C4 0.50s · 250ms'})).toBeVisible();
  await expect(merge).toBeEnabled();
  await merge.click();
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 750ms'})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'2. E4 0.75s · 500ms'})).toBeVisible();
  await undo.click();
  await expect(page.getByRole('button',{name:'2. C4 0.50s · 250ms'})).toHaveAttribute('aria-pressed','true');
  await undo.click();
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Delete selected'}).click();
  await expect(page.getByRole('button',{name:'1. E4 0.50s · 500ms'})).toBeVisible();
  await undo.click();
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 500ms'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Make rest'}).click();
  await expect(page.getByRole('button',{name:'1. Rest 0.00s · 500ms'})).toBeVisible();
  await expect(merge).toBeDisabled();
  await undo.click();
  await page.getByLabel('Duration (ms)').fill('250');
  await expect(page.getByLabel('Duration (ms)')).toHaveValue('250');
  await undo.click();
  await expect(page.getByLabel('Duration (ms)')).toHaveValue('500');
  await expect(undo).toBeDisabled();
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await page.getByRole('button',{name:'1. C4 0.00s · 500ms'}).click();
  await merge.click();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByText('Buzzer settings',{exact:true})).toBeVisible();
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 262); delay(750);');
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 330); delay(500);');
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 750ms'})).toBeVisible();
  await expect(undo).toBeDisabled();
});

test('undo a resize and reorder, then save the original song', async ({page}) => {
  await open(page);
  const canvas=page.getByRole('img',{name:/Punch strip/});
  async function drag(x1,y1,x2,y2) {
    await canvas.scrollIntoViewIfNeeded();
    const box=await canvas.boundingBox();
    await page.mouse.move(box.x+x1,box.y+y1);await page.mouse.down();
    await page.mouse.move(box.x+x2,box.y+y2,{steps:4});await page.mouse.up();
  }
  await drag(88,115,106,115);
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 700ms'})).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('button',{name:'2. E4 0.50s · 500ms'})).toBeVisible();
  await drag(20,173,70,173);
  await expect(page.getByRole('button',{name:'1. E4 0.00s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('button',{name:'1. C4 0.00s · 500ms'})).toBeVisible();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.locator('pre')).toContainText('3 notes, 1 rests, 0:02 long');
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeDisabled();
});

test('loading bar reflects incremental preparation and only a page of notes is mounted', async ({page}) => {
  const entries=Array.from({length:2500},(_,i)=>`<note><pitch><step>${i%2?'D':'C'}</step><octave>4</octave></pitch><duration>1</duration></note>`).join('');
  const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>10</divisions></attributes><direction><sound tempo="120"/></direction>${entries}</measure></part></score-partwise>`;
  await load(page,xml);
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('status').filter({hasText:'Preparing your notes'})).toBeVisible();
  await expect(page.getByRole('progressbar',{name:'Preparing editor'})).toBeVisible();
  await expect(page.locator('pre')).toHaveCount(0);
  await page.evaluate(() => {
    window.__closingSeen=false;
    const observer=new MutationObserver(records=>{
      if (records.some(r=>[...r.addedNodes].some(n=>n.textContent?.includes('Closing editor…')))) window.__closingSeen=true;
    });
    observer.observe(document.body,{childList:true,subtree:true});
  });
  await page.getByRole('button',{name:'Close note editor'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__closingSeen)).toBe(true);
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  await expect(page.getByText('Buzzer settings',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
  await expect(page.getByRole('list',{name:'Notes and rests'}).getByRole('button')).toHaveCount(20);
  await page.getByRole('button',{name:'Next notes'}).click();
  await expect(page.getByRole('button',{name:'21. C4 1.00s · 50ms'})).toBeVisible();
  await page.getByRole('button',{name:'Previous notes'}).click();
  await page.getByRole('button',{name:'1. C4 0.00s · 50ms'}).click();
  await page.getByRole('button',{name:'Piano key G4'}).click();
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('status').filter({hasText:'Saving your notes'})).toBeVisible();
  await expect(page.getByRole('progressbar',{name:'Saving editor'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveAttribute('aria-busy','true');
  await expect(page.getByRole('button',{name:'Close note editor'})).toBeDisabled();
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  await expect(page.locator('pre')).toContainText('2500 notes');
  await expect(page.locator('pre')).toContainText('tone(BUZZER, 392); delay(50);');
});
