import { describe, expect, it } from 'vitest';
import { JOURNAL_EXPORT_TEXTS } from './journal-exports.js';
import { fillText } from './timetable-prints.js';

// Design review of 17 November 2026 (W8): `packages/calc` gives `expected`, the lessons a result
// counts, and `held`, the lessons held (expected ≤ held, outcome.ts). The note of the exported
// journal read them the other way round: "based on 7 of 2 lessons".
describe('the note of a result in an exported journal', () => {
  it.each([
    ['en', 'based on 2 of 7 lessons'],
    ['ru', 'по 2 из 7 уроков'],
    ['uz', '7 ta darsdan 2 tasi asosida'],
  ] as const)('names the lessons counted, then the lessons held, in %s', (language, text) => {
    expect(fillText(JOURNAL_EXPORT_TEXTS[language].basedOn, { expected: '2', held: '7' })).toBe(
      text,
    );
  });
});
