// Frames → notes → Arduino sketch.

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (m) => (m < 0 ? "rest" : `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`);
export const midiToHz = (m) => Math.round(440 * 2 ** ((m - 69) / 12));
export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);

const FOLD_LO = 60; // C4
const FOLD_HI = 96; // C7
export function foldMidi(m, fold) {
  if (!fold || m < 0) return m;
  while (m < FOLD_LO) m += 12;
  while (m > FOLD_HI) m -= 12;
  return m;
}

export function frameVoiced(track, f, s) {
  const gate = track.peak * 10 ** (s.gateDb / 20);
  return track.f0[f] > 0 && track.aper[f] <= s.maxAper && track.rms[f] >= gate;
}

export function segment(track, s) {
  const n = track.frames;
  if (!n) return [];
  const raw = new Int16Array(n);
  for (let p = 0; p < n; p++)
    raw[p] = frameVoiced(track, p, s) ? foldMidi(Math.round(hzToMidi(track.f0[p])) + s.transpose, s.fold) : -1;
  // Shorter window for instruments preserves quick notes while rejecting single-frame flicker.
  const med = new Int16Array(n);
  const win = [];
  for (let p = 0; p < n; p++) {
    win.length = 0;
    const radius = track.kind === "piano" ? 1 : 2;
    for (let d = -radius; d <= radius; d++) win.push(raw[Math.min(n - 1, Math.max(0, p + d))]);
    win.sort((a, b) => a - b);
    med[p] = win[radius];
  }
  const hop = track.hopMs;
  const minNote = Math.max(1, Math.round(s.minNoteMs / hop));
  const minRest = Math.max(1, Math.round(s.minRestMs / hop));
  const rms = track.rms;
  let segs = [];
  let cur = { midi: med[0], a: 0, b: 1 };
  for (let p = 1; p < n; p++) {
    const split =
      s.splitRepeats &&
      med[p] >= 0 &&
      med[p] === cur.midi &&
      p - cur.a >= minNote &&
      p >= 3 &&
      ((rms[p] > 1.6 * Math.min(rms[p - 2], rms[p - 3]) &&
        rms[p] > rms[p + 1 < n ? p + 1 : p] * 0.8) ||
       (track.kind === "piano" && p >= 4 && rms[p - 2] < rms[p - 4] * 0.90 &&
        rms[p] > rms[p - 2] * 1.07 && rms[p] > track.peak * 0.05));
    if (med[p] !== cur.midi || split) {
      segs.push(cur);
      cur = { midi: med[p], a: p, b: p + 1 };
    } else cur.b = p + 1;
  }
  segs.push(cur);
  const merge = (list) => {
    const out = [];
    for (const x of list) {
      const last = out[out.length - 1];
      if (last && last.midi === x.midi && !x.split) last.b = x.b;
      else out.push({ ...x });
    }
    return out;
  };
  for (let p = 1; p < segs.length; p++) if (segs[p].midi === segs[p - 1].midi) segs[p].split = true;
  segs = segs.map((x, i) => {
    if (x.midi >= 0 && x.b - x.a < minNote) {
      const prev = segs[i - 1];
      return { ...x, midi: prev && prev.midi >= 0 && prev.b === x.a ? prev.midi : -1, split: false };
    }
    return x;
  });
  segs = merge(segs);
  segs = merge(segs.map((x) => (x.midi >= 0 && x.b - x.a < minNote ? { ...x, midi: -1, split: false } : x)));
  const out = [];
  for (const x of segs) {
    const last = out[out.length - 1];
    if ((x.midi < 0 && x.b - x.a < minRest && last && last.midi >= 0) || (last && last.midi === x.midi && !x.split)) last.b = x.b;
    else out.push({ ...x });
  }
  return out.map((x) => ({
    midi: x.midi,
    freq: x.midi >= 0 ? midiToHz(x.midi) : 0,
    start: x.a * hop,
    dur: (x.b - x.a) * hop,
  }));
}

/** Clip to the export section, trim edge rests, round to whole ms without drift. */
export function exportNotes(notes, from, to, preserveRests = false) {
  const out = [];
  for (const nt of notes) {
    const a = Math.max(nt.start, from);
    const b = Math.min(nt.start + nt.dur, to);
    if (b <= a) continue;
    out.push({ ...nt, start: a, dur: b - a });
  }
  if (!preserveRests) {
    while (out.length && out[0].midi < 0) out.shift();
    while (out.length && out[out.length - 1].midi < 0) out.pop();
  }
  return out;
}

export const flashEstimate = (notes, format) => {
  const fractional = notes.some(n => (n.us ?? Math.round(n.ms * 1000)) % 1000 !== 0);
  return format === "lines" ? notes.length * (fractional ? 24 : 18) + 600 : notes.length * (fractional ? 8 : 6) + 700;
};

const fmtTime = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function generateSketch(notes, o) {
  const pin = o.pin;
  const total = notes.reduce((t, nt) => t + nt.ms, 0);
  const count = notes.filter((nt) => nt.midi >= 0).length;
  const head = [
    `// ${o.title}`,
    `// ${count} notes, ${notes.length - count} rests, ${fmtTime(total)} long`,
    o.speaker
      ? `// Speaker: pin ${pin} -> 100 ohm resistor -> speaker -> GND (natural pitch)`
      : `// Piezo buzzer: + to pin ${pin}, - to GND`,
    "",
  ];
  const tail = (call) =>
    o.repeat
      ? ["void setup() {", "}", "", "void loop() {", `  ${call}`, "  delay(1000);", "}"]
      : ["void setup() {", `  ${call}`, "}", "", "void loop() {", "}"];
  const micro = nt => nt.us ?? Math.max(1, Math.round(nt.ms * 1000));
  const wait = us => {
    const ms = Math.floor(us / 1000), rest = us % 1000;
    return [ms ? `delay(${ms});` : '', rest ? `delayMicroseconds(${rest});` : ''].filter(Boolean).join(' ');
  };
  if (o.format === "lines") {
    const body = notes.map((nt) => {
      const us = micro(nt);
      if (nt.midi < 0) return `  noTone(BUZZER); ${wait(us)}`.padEnd(40) + "// rest";
      if (o.staccato && us % 1000 !== 0) {
        const active = Math.max(1, Math.floor(us * .875));
        return `  tone(BUZZER, ${nt.freq}); ${wait(active)} noTone(BUZZER); ${wait(us - active)}`.padEnd(40) + `// ${noteName(nt.midi)}`;
      }
      const prefix = o.staccato ? `tone(BUZZER, ${nt.freq}, ${Math.max(1, Math.round(nt.ms * 0.88))});` : `tone(BUZZER, ${nt.freq});`;
      return `  ${prefix} ${wait(us)}`.padEnd(40) + `// ${noteName(nt.midi)}`;
    });
    return [...head, `const int BUZZER = ${pin};`, "", "void playMelody() {", ...body, "  noTone(BUZZER);", "}", "", ...tail("playMelody();"), ""].join("\n");
  }
  const chunk = (vals) => {
    const rows = [];
    for (let i = 0; i < vals.length; i += 12) rows.push("  " + vals.slice(i, i + 12).join(", "));
    return rows.join(",\n");
  };
  const fractional = notes.some(nt => micro(nt) % 1000 !== 0);
  const play = o.staccato
    ? ["    if (f) tone(BUZZER, f, (d / 8UL) * 7UL + (d % 8UL) * 7UL / 8UL);", "    else noTone(BUZZER);"]
    : ["    if (f) tone(BUZZER, f);", "    else noTone(BUZZER);"];
  // AVR pointers are 16-bit and a single giant array may exceed an AVR object
  // limit. Partition larger scores and use far reads on devices with RAMPZ.
  if (notes.length > 4096) {
    const blockSize=4096, blocks=Math.ceil(notes.length/blockSize), declarations=[];
    const defs=[
      {name:'melody',type:'uint16_t',value:nt=>nt.freq},
      {name:'durations',type:'uint32_t',value:nt=>Math.floor(micro(nt)/1000)},
      ...(fractional ? [{name:'durationMicros',type:'uint16_t',value:nt=>micro(nt)%1000}] : []),
    ];
    for (const def of defs) for(let b=0;b<blocks;b++) {
      const values=notes.slice(b*blockSize,(b+1)*blockSize).map(def.value);
      declarations.push(`const ${def.type} ${def.name}_${b}[] PROGMEM = {`,chunk(values),'};','');
    }
    const reader=def=>[
      `${def.type} read_${def.name}(uint32_t index) {`,
      `  uint16_t offset = (uint16_t)(index % ${blockSize}UL);`,
      `  switch (index / ${blockSize}UL) {`,
      ...Array.from({length:blocks},(_,b)=>[
        `    case ${b}UL:`,
        '#if defined(RAMPZ)',
        `      return pgm_read_${def.type==='uint32_t'?'dword':'word'}_far(pgm_get_far_address(${def.name}_${b}) + (uint32_t)offset * sizeof(${def.type}));`,
        '#else',
        `      return pgm_read_${def.type==='uint32_t'?'dword':'word'}(&${def.name}_${b}[offset]);`,
        '#endif',
      ]).flat(),
      '    default: return 0;',
      '  }',
      '}','',
    ];
    return [
      ...head, '#include <avr/io.h>', '#include <avr/pgmspace.h>', '',
      `const int BUZZER = ${pin};`, `const uint32_t NOTE_COUNT = ${notes.length}UL;`, '',
      ...declarations, ...defs.flatMap(reader),
      ...(fractional ? ['void waitParts(uint32_t ms, uint16_t us) {','  if (ms) delay(ms);','  if (us) delayMicroseconds(us);','}',''] : []),
      'void playMelody() {','  for (uint32_t i = 0; i < NOTE_COUNT; i++) {',
      '    uint16_t f = read_melody(i);','    uint32_t d = read_durations(i);',
      ...(fractional ? [
        '    uint16_t u = read_durationMicros(i);',
        ...(o.staccato ? [
          '    if (f) {',
          '      uint32_t activeMs = (d / 8UL) * 7UL + (d % 8UL) * 7UL / 8UL;',
          '      uint16_t activeUs = (((d % 8UL) * 7UL % 8UL) * 1000UL + u * 7UL) / 8UL;',
          '      activeMs += activeUs / 1000; activeUs %= 1000;',
          '      uint32_t restMs = d - activeMs; int16_t restUs = (int16_t)u - (int16_t)activeUs;',
          '      if (restUs < 0) { restMs--; restUs += 1000; }',
          '      tone(BUZZER, f); waitParts(activeMs, activeUs); noTone(BUZZER); waitParts(restMs, restUs);',
          '    } else { noTone(BUZZER); waitParts(d, u); }',
        ] : ['    if (f) tone(BUZZER, f); else noTone(BUZZER);','    waitParts(d, u);'])
      ] : [...play,'    delay(d);']),
      '  }','  noTone(BUZZER);','}', '',...tail('playMelody();'),'',
    ].join('\n');
  }
  return [
    ...head,
    "#include <avr/pgmspace.h>",
    "",
    `const int BUZZER = ${pin};`,
    `const uint16_t NOTE_COUNT = ${notes.length};`,
    "",
    "// frequency in Hz (0 = rest)",
    "const uint16_t melody[] PROGMEM = {",
    chunk(notes.map((nt) => nt.freq)),
    "};",
    "",
    "// duration in ms",
    "const uint32_t durations[] PROGMEM = {",
    chunk(notes.map((nt) => Math.floor(micro(nt) / 1000))),
    "};",
    "",
    ...(fractional ? ["// fractional duration in microseconds", "const uint16_t durationMicros[] PROGMEM = {", chunk(notes.map(nt => micro(nt) % 1000)), "};", "", "void waitParts(uint32_t ms, uint16_t us) {", "  if (ms) delay(ms);", "  if (us) delayMicroseconds(us);", "}", ""] : []),
    "void playMelody() {",
    "  for (uint16_t i = 0; i < NOTE_COUNT; i++) {",
    "    uint16_t f = pgm_read_word(&melody[i]);",
    "    uint32_t d = pgm_read_dword(&durations[i]);",
    ...(fractional ? [
      "    uint16_t u = pgm_read_word(&durationMicros[i]);",
      ...(o.staccato ? [
        "    if (f) {",
        "      uint32_t activeMs = (d / 8UL) * 7UL + (d % 8UL) * 7UL / 8UL;",
        "      uint16_t activeUs = (((d % 8UL) * 7UL % 8UL) * 1000UL + u * 7UL) / 8UL;",
        "      activeMs += activeUs / 1000; activeUs %= 1000;",
        "      uint32_t restMs = d - activeMs; int16_t restUs = (int16_t)u - (int16_t)activeUs;",
        "      if (restUs < 0) { restMs--; restUs += 1000; }",
        "      tone(BUZZER, f); waitParts(activeMs, activeUs); noTone(BUZZER); waitParts(restMs, restUs);",
        "    } else { noTone(BUZZER); waitParts(d, u); }"
      ] : ["    if (f) tone(BUZZER, f); else noTone(BUZZER);", "    waitParts(d, u);"])
    ] : [...play, "    delay(d);"]),
    "  }",
    "  noTone(BUZZER);",
    "}",
    "",
    ...tail("playMelody();"),
    "",
  ].join("\n");
}
