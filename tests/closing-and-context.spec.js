import { expect, test } from '@playwright/test';

const score=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
async function load(page, xml=score) {
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'notes.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
}
async function open(page) {
  await page.getByRole('button',{name:'Add / edit notes'}).click();
  await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
}

test('right-click is suppressed; cancel and close show loading and discard edits', async ({page}) => {
  await load(page); const before=await page.locator('pre').innerText();
  await open(page);
  for (const selector of ['main','canvas','#note-duration']) {
    const prevented=await page.locator(selector).first().evaluate(el=>{
      const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2});
      el.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  }
  await page.evaluate(() => {
    window.__closingBars=0;
    const observer=new MutationObserver(records=>{
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType===1 && (node.matches?.('[role="progressbar"][aria-label="Closing editor"]') || node.querySelector?.('[role="progressbar"][aria-label="Closing editor"]'))) window.__closingBars++;
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
  });
  await page.getByLabel('Duration (ms)').fill('250');
  await expect(page.getByLabel('Duration (ms)')).toHaveValue('250');
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__closingBars)).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  expect(await page.locator('pre').innerText()).toBe(before);
  await open(page);
  await page.getByRole('button',{name:'Piano key D4'}).click();
  await page.getByRole('button',{name:'Close note editor'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__closingBars)).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
  expect(await page.locator('pre').innerText()).toBe(before);
  await open(page);
  await page.getByLabel('Duration (ms)').fill('900');
  await page.getByRole('button',{name:'Done / Save'}).click();
  await expect(page.getByRole('alert')).toContainText('cannot overlap');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.locator('pre').innerText()).toBe(before);
});
