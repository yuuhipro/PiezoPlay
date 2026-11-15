import { expect, test } from "@playwright/test";

function wave(hz) {
  const sampleRate = 16000, n = sampleRate * 2, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i=0; i<n; i++) buf.writeInt16LE(Math.round(14000 * Math.sin(2 * Math.PI * hz * i / sampleRate)), 44 + i*2);
  return buf;
}
for (const [hz, label] of [[55, 'A1'], [3520, 'A7']]) {
  test(`detects ${label} with wider range`, async ({page}) => {
    await page.goto('/');
    await page.locator('input[accept*="audio/*"]').setInputFiles({name:`${label}.wav`, mimeType:'audio/wav', buffer:wave(hz)});
    await page.getByRole('radio', {name:'One voice'}).click();
    const read = page.getByRole('button', {name:'Read this melody'});
    await expect(read).toBeEnabled({timeout:30000});
    await read.click();
    const sw = page.getByRole('switch', {name:'Wider pitch range'});
    await expect(sw).toHaveAttribute('data-state', 'unchecked');
    await sw.click();
    await page.getByRole('button', {name:'Apply ears settings'}).click();
    await expect(sw).toBeEnabled({timeout:30000});
    await expect(page.locator('body')).toContainText(`// ${label}`, {timeout:30000});
    const thumbs = page.locator('[data-slot="slider"]:has([aria-valuemax="107"]) [role=slider]');
    await expect(thumbs).toHaveCount(2);
    await thumbs.first().focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', {name:'Apply ears settings'}).click();
    await expect(sw).toBeEnabled({timeout:30000});
    await expect(thumbs.first()).toHaveAttribute('aria-valuenow','32');
    await sw.click();
    await expect(sw).toHaveAttribute('data-state', 'unchecked');
  });
}
