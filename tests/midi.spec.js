import { expect, test } from '@playwright/test';
const be16=x=>[(x>>8)&255,x&255]; const be32=x=>[(x>>>24)&255,(x>>>16)&255,(x>>>8)&255,x&255];
const vlq=x=>{let a=[x&127];while(x>>=7)a.unshift((x&127)|128);return a;};
const chunk=(name, data)=>[...Buffer.from(name),...be32(data.length),...data];
const make=(format,tracks,division=480)=>Buffer.from([...chunk('MThd',[...be16(format),...be16(tracks.length),...be16(division)]),...tracks.flatMap(t=>chunk('MTrk',t))]);
const end=[0,0xff,0x2f,0];
const one=[0,0xff,3,5,...Buffer.from('Piano'),0,0xff,0x51,3,7,161,32,0,0x90,60,100,...vlq(480),0x80,60,0,0,0xff,0x51,3,15,66,64,0,0x90,62,100,...vlq(480),62,0,...end];
async function upload(page,filename,data){await page.goto('/');await page.locator('input[accept*=".midi"]').setInputFiles({name:filename,mimeType:'audio/midi',buffer:data});await expect(page.getByRole('heading',{name:'Choose a melody'})).toBeVisible();}
test('MIDI format 0 reads notes, tempo changes and running status',async({page})=>{
 await upload(page,'song.mid',make(0,[one]));
 await expect(page.getByRole('combobox',{name:'Track and channel'})).toContainText('Piano · channel 1');
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 262); delay(500);');
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 294); delay(1000);');
 await expect(page.getByText('S_mp3toTone.ino')).toBeVisible();
});
test('MIDI format 1 selects tracks, handles rests and overlapping notes',async({page})=>{
 let tempo=[0,0xff,0x51,3,7,161,32,...vlq(1440),0xff,0x2f,0];
 let music=[0,0xff,3,5,...Buffer.from('Flute'),...vlq(480),0x90,60,90,0,0x90,67,90,...vlq(480),0x80,60,0,0,0x80,67,0,...end];
 let bass=[0,0xff,3,4,...Buffer.from('Bass'),0,0x91,48,80,...vlq(480),0x81,48,0,...end];
 await upload(page,'orchestra.midi',make(1,[tempo,music,bass]));
 const sel=page.getByRole('combobox',{name:'Track and channel'});
 await expect(sel.locator('option')).toHaveCount(2);
 await sel.selectOption('midi-1-0');await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await expect(page.getByText('Overlapping notes were reduced',{exact:false})).toBeVisible();
 await expect(page.locator('pre')).toContainText('noTone(BUZZER); delay(500);');
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 392); delay(500);');
});
test('rejects unsupported formats and broken data',async({page})=>{
 await page.goto('/'); const input=page.locator('input[accept*=".midi"]');
 await input.setInputFiles({name:'broken.mid',mimeType:'audio/midi',buffer:Buffer.from('broken')});
 await expect(page.getByText('This MIDI file is invalid or incomplete.')).toBeVisible();
 await input.setInputFiles({name:'type2.mid',mimeType:'audio/midi',buffer:make(2,[one])});
 await expect(page.getByText('MIDI format 2 contains separate songs',{exact:false})).toBeVisible();
});
test('warns when pitched music uses sustain or pitch bending',async({page})=>{
 let t=[0,0xb0,64,127,0,0xe0,0,64,...one];
 await upload(page,'pedal.mid',make(0,[t]));
 await expect(page.getByText('Sustain pedal effects are not applied.')).toBeVisible();
 await expect(page.getByText('Pitch bends are not applied',{exact:false})).toBeVisible();
});

test('converts low and high MIDI notes without a pitch warning',async({page})=>{
 let midi=[0,0x90,12,100,...vlq(480),0x80,12,0,0,0x90,127,100,...vlq(480),0x80,127,0,...end];
 await upload(page,'extreme.mid',make(0,[midi]));
 await expect(page.getByText('Notes outside C1 to B8')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Proceed anyway'})).toHaveCount(0);
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 16); delay(500);');
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 12544); delay(500);');
});
test('converts notes below C1 in a selected MIDI track',async({page})=>{
 const safe=[0,0x90,60,100,...vlq(480),0x80,60,0,...end];
 const low=[0,0x91,0,100,...vlq(480),0x81,0,0,...end];
 await upload(page,'two.mid',make(1,[safe,low]));
 await page.getByRole('combobox',{name:'Track and channel'}).selectOption('midi-1-1');
 await expect(page.getByText('Notes outside C1 to B8')).toHaveCount(0);
 await page.getByRole('button',{name:'Convert to buzzer'}).click();
 await expect(page.locator('pre')).toContainText('tone(BUZZER, 8); delay(500);');
});
