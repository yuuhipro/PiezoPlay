import { expect, test } from '@playwright/test';

test('playback follows smoothly and reuses the rendered strip during scrolling', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(() => {
    window.__stripPaints=0;
    const clear=CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){window.__stripPaints++; return clear.apply(this,args);};
    window.__clockOffset=0;
    const descriptor=Object.getOwnPropertyDescriptor(BaseAudioContext.prototype,'currentTime');
    Object.defineProperty(BaseAudioContext.prototype,'currentTime',{configurable:true,get(){return descriptor.get.call(this)+window.__clockOffset;}});
  });
  const events=Array.from({length:547},()=>'<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note>').join('');
  const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>5</divisions></attributes><direction><sound tempo="120"/></direction>${events}</measure></part></score-partwise>`;
  await page.goto('/');
  await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'large.xml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await page.getByRole('button',{name:'Convert to buzzer'}).click();
  const sc=page.locator('.strip-scroll');
  await expect(page.getByLabel('Visible song time')).toContainText('0:00 to');
  await sc.evaluate(el=>{el.scrollLeft=35*90;});
  await expect(page.getByLabel('Visible song time')).toContainText('0:35 to');
  await page.getByRole('button',{name:'Play as buzzer'}).click();
  await expect(page.getByLabel('Visible song time')).toContainText('0:00 to');
  await expect(page.getByLabel('Visible song time')).toContainText('playing');
  const metrics=await page.evaluate(async () => {
    const sc=document.querySelector('.strip-scroll');
    window.__clockOffset=3.3;
    for(let i=0;i<5;i++) await new Promise(requestAnimationFrame);
    const before=window.__stripPaints, positions=[sc.scrollLeft];
    for(let i=0;i<30;i++) {
      window.__clockOffset+=.14;
      await new Promise(requestAnimationFrame);
      positions.push(sc.scrollLeft);
    }
    for(let i=0;i<3;i++) await new Promise(requestAnimationFrame);
    const canvas=sc.querySelector('canvas'), pps=90;
    const noteIndex=Math.ceil((sc.scrollLeft+12)/18);
    const worldX=noteIndex*18+3;
    const left=parseFloat(canvas.style.left), scale=canvas.width/canvas.getBoundingClientRect().width;
    const pixel=canvas.getContext('2d').getImageData(Math.round((worldX-left)*scale),Math.round(130*scale),1,1).data;
    return {repaints:window.__stripPaints-before,positions,pixel:[...pixel],left,buffer:canvas.getBoundingClientRect().width,viewport:sc.clientWidth};
  });
  const steps=metrics.positions.slice(1).map((x,i)=>x-metrics.positions[i]);
  expect(metrics.positions.at(-1)-metrics.positions[0]).toBeGreaterThan(250);
  expect(Math.max(...steps)).toBeLessThan(30);
  expect(metrics.repaints).toBeLessThanOrEqual(6);
  expect(metrics.buffer).toBeGreaterThan(metrics.viewport);
  expect(Math.max(...metrics.pixel.slice(0,3))).toBeLessThan(110);
  await page.getByRole('button',{name:'Stop',exact:false}).click();
  await expect(page.getByLabel('Visible song time')).not.toContainText('playing');
  // Seeking after scrolling still uses song coordinates, not the buffer's origin.
  await page.evaluate(() => {window.__clockOffset=0;});
  await sc.scrollIntoViewIfNeeded();
  await sc.evaluate(el=>{el.scrollLeft=95*90;});
  await expect(page.getByLabel('Visible song time')).toContainText('1:35 to');
  await sc.evaluate(el=>{el.scrollLeft=35*90;});
  await expect(page.getByLabel('Visible song time')).toContainText('0:35 to');
  await page.waitForTimeout(80);
  const box=await sc.boundingBox();
  await page.mouse.click(box.x+100,box.y+130);
  await expect(page.getByLabel('Visible song time')).toContainText('0:36 playing');
  await page.getByRole('button',{name:'Stop',exact:false}).click();
});
