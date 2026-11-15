import { expect, test } from '@playwright/test';

test('provided flute tune stays exact, and ears changes wait for apply', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button',{name:'Try a demo tune'}).click();
  await expect(page.getByRole('radio',{name:'One voice'})).toBeChecked();
  await expect(page.getByText('187 notes in one line.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Read this melody'}).click();
  const code = page.locator('pre');
  await expect(code).toContainText('187 notes, 0 rests, 0:50 long');
  const original = await code.innerText();
  const pairs = [...original.matchAll(/tone\(BUZZER, (\d+)\); delay\((\d+)\)/g)];
  expect(pairs.length).toBe(187);
  expect(pairs.slice(0,5).map(x=>[+x[1],+x[2]])).toEqual([[740,36],[740,252],[698,36],[698,228],[622,264]]);
  expect(pairs.reduce((a,x)=>a + Number(x[2]),0)).toBe(50136);
  const sw = page.getByRole('switch',{name:'Fold into buzzer range (C4–C7)'});
  await sw.click();
  await expect(page.getByText('Changes are pending.',{exact:false})).toBeVisible();
  expect(await code.innerText()).toBe(original);
  await page.getByRole('button',{name:'Apply ears settings'}).click();
  await expect(page.getByText('Changes are pending.',{exact:false})).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button',{name:'.ino',exact:false}).click();
  expect((await downloadPromise).suggestedFilename()).toBe('D_mp3toTone.ino');
});

test('one-voice mode reads an uploaded single-note audio file', async ({page}) => {
  const sr=16000, n=sr, b=Buffer.alloc(44+n*2);
  b.write('RIFF',0); b.writeUInt32LE(36+n*2,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(sr,24); b.writeUInt32LE(sr*2,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++) b.writeInt16LE(Math.round(14000*Math.sin(2*Math.PI*440*i/sr)),44+i*2);
  await page.goto('/');
  await page.locator('input[accept*="audio/*"]').setInputFiles({name:'flute.wav',mimeType:'audio/wav',buffer:b});
  await page.getByRole('radio',{name:'One voice'}).click();
  const read = page.getByRole('button',{name:'Read this melody'});
  await expect(read).toBeEnabled(); await read.click();
  await expect(page.locator('pre')).toContainText('440');
  await expect(page.getByText('F_mp3toTone.ino')).toBeVisible();
});
