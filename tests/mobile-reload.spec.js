import { expect, test } from '@playwright/test';
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>${'Flute'.repeat(40)}</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
test('long filenames are shortened on mobile without changing the original filename',async({page})=>{
 await page.setViewportSize({width:320,height:700});await page.goto('/');const name='a'.repeat(100)+'.musicxml';
 await page.locator('input[accept*=".musicxml"]').setInputFiles({name,mimeType:'application/xml',buffer:Buffer.from(xml)});
 await expect(page.getByRole('heading',{name:'Choose a melody'})).toBeVisible();
 const title=page.locator('[title]').filter({hasText:'…'}).first();await expect(title).toHaveAttribute('title',name);expect(Array.from(await title.innerText()).length).toBeLessThanOrEqual(60);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 const result=page.locator('[title]').filter({hasText:'…'}).first();await expect(result).toHaveAttribute('title',name);expect(Array.from(await result.innerText()).length).toBeLessThanOrEqual(60);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
test('reload asks before discarding and returns to setup',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Try a demo tune'}).click();await page.getByRole('button',{name:'Read this melody'}).click();
 await page.getByRole('button',{name:'Add / edit notes'}).click();await page.getByRole('button',{name:'Piano key G5'}).click();
 await page.getByRole('button',{name:'Reload'}).click();await expect(page.getByRole('alertdialog')).toBeVisible();
 await page.getByRole('alertdialog').getByRole('button',{name:'Cancel'}).click();await expect(page.getByRole('region',{name:'Note editor'})).toBeVisible();
 await page.getByRole('button',{name:'Reload'}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Start over'}).click();
 await expect(page.getByRole('button',{name:'Choose audio'})).toBeVisible();await expect(page.getByRole('region',{name:'Note editor'})).toHaveCount(0);
 await page.getByRole('button',{name:'Try a demo tune'}).click();await expect(page.getByText('187 notes in one line.',{exact:false})).toBeVisible();
});
