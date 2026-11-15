import { expect, test } from '@playwright/test';
import { notesAreWindowable, firstVisibleNote } from '../src/visibleNotes.js';
test('viewport lookup skips off-screen notes and handles very long notes', () => {
  const notes=[{start:0,dur:200},{start:200,dur:10},{start:210,dur:900},{start:1110,dur:10}];
  expect(notesAreWindowable(notes)).toBe(true);
  expect(firstVisibleNote(notes,0,true)).toBe(0);
  expect(firstVisibleNote(notes,201,true)).toBe(1);
  expect(firstVisibleNote(notes,900,true)).toBe(2);
  expect(firstVisibleNote(notes,2000,true)).toBe(4);
});
test('invalid or non-monotonic ends safely fall back to full scanning', () => {
  const notes=[{start:0,dur:1000},{start:100,dur:10}];
  expect(notesAreWindowable(notes)).toBe(false);
  expect(firstVisibleNote(notes,500,false)).toBe(0);
  expect(notesAreWindowable([{start:0,dur:NaN}])).toBe(false);
});
