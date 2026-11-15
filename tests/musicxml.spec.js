import { expect, test } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
const xml = `<?xml version="1.0"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Flute</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>2</divisions></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note><note><rest/><duration>2</duration><voice>1</voice></note><note><pitch><step>D</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><tie type="start"/></note><direction><sound tempo="60"/></direction><note><pitch><step>D</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><voice>1</voice><tie type="stop"/></note></measure></part>
<part id="P2"><measure number="1"><attributes><divisions>2</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note><note><rest/><duration>6</duration><voice>1</voice></note></measure></part></score-partwise>`;
async function upload(page, name, buffer) {
 await page.goto('/'); await page.locator('input[accept*=".musicxml"]').setInputFiles({name,mimeType:'application/octet-stream',buffer});
 await expect(page.getByRole('heading',{name:'Choose a melody'})).toBeVisible();
}
test('converts exact notes, rests, tempo change and ties',async({page})=>{
 await upload(page,'test.musicxml',Buffer.from(xml));
 await expect(page.getByRole('combobox',{name:'Instrument and voice'})).toHaveValue('P1|1|1');
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 const code=page.locator('pre'); await expect(code).toContainText('tone(BUZZER, 262); delay(500);');
 await expect(code).toContainText('noTone(BUZZER); delay(500);');
 await expect(code).toContainText('tone(BUZZER, 311); delay(1500);');
 await expect(code).toContainText('2 notes, 1 rests');
 await expect(page.getByRole('heading',{name:'Buzzer settings'})).toBeVisible();
 await expect(page.getByText('Pitch strictness',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Original'})).toHaveCount(0);
 const dl=page.waitForEvent('download'); await page.getByRole('button',{name:'.ino',exact:false}).click(); expect((await dl).suggestedFilename()).toBe('T_mp3toTone.ino');
});
test('supports compressed MuseScore MXL and warns when reducing chords',async({page})=>{
 const zip=zipSync({'META-INF/container.xml':strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'),'score.musicxml':strToU8(xml)});
 await upload(page,'test.mxl',Buffer.from(zip));
 await page.getByRole('combobox',{name:'Instrument and voice'}).selectOption('P2|1|1');
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await expect(page.getByText('Overlapping notes were reduced', {exact:false})).toBeVisible();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 392); delay(500);');
});
test('warns about alternate endings and rejects invalid files without replacing current work',async({page})=>{
 const repeated=xml.replace('</measure></part>','<barline><ending number="1" type="start"/><repeat direction="backward"/></barline></measure></part>');
 await upload(page,'repeat.xml',Buffer.from(repeated));
 await expect(page.getByText('Alternate endings are not expanded.',{exact:false})).toBeVisible();
 await page.locator('input[accept*=".musicxml"]').setInputFiles({name:'bad.xml',mimeType:'application/xml',buffer:Buffer.from('<invalid>')});
 await expect(page.getByText('Could not read this MusicXML file.')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Choose a melody'})).toBeVisible();
});

test('expands simple repeat barlines',async({page})=>{
 const repeated=xml.replace('</measure></part>','<barline><repeat direction="backward"/></barline></measure></part>');
 await upload(page,'repeat.xml',Buffer.from(repeated));
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 const code=await page.locator('pre').innerText();
 expect((code.match(/tone\(BUZZER, 262\); delay\(500\);/g)||[]).length).toBe(2);
 expect(code).toContain('4 notes, 2 rests');
});
test('preserves leading and trailing rests',async({page})=>{
 const simple=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><rest/><duration>1</duration></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note><note><rest/><duration>1</duration></note></measure></part></score-partwise>`;
 await upload(page,'undertale-music.xml',Buffer.from(simple));
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 const code=await page.locator('pre').innerText();
 expect(code).toContain('1 notes, 2 rests');
 expect((code.match(/noTone\(BUZZER\); delay\(500\);/g)||[]).length).toBe(2);
 const dl=page.waitForEvent('download');await page.getByRole('button',{name:'.ino',exact:false}).click();expect((await dl).suggestedFilename()).toBe('U_mp3toTone.ino');
});

test('PROGMEM preserves notes longer than 65535 ms',async({page})=>{
 const simple=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><direction><sound tempo="1"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note></measure></part></score-partwise>`;
 await upload(page,'long.xml',Buffer.from(simple));
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await page.getByRole('radio',{name:'PROGMEM'}).click();
 const code=page.locator('pre');
 await expect(code).toContainText('const uint32_t durations[] PROGMEM');
 await expect(code).toContainText('120000');
 await expect(code).toContainText('pgm_read_dword(&durations[i])');
 await page.getByRole('radio',{name:'Staccato'}).click();
 await expect(code).toContainText('(d / 8UL) * 7UL');
});

test('converts low and high MusicXML pitches without a pitch warning',async({page})=>{
 const simple=`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>0</octave></pitch><duration>1</duration></note><note><pitch><step>B</step><octave>9</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
 await upload(page,'extreme.musicxml',Buffer.from(simple));
 await expect(page.getByText('Notes outside C1 to B8')).toHaveCount(0);
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 16); delay(500);');
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 15804); delay(500);');
});
