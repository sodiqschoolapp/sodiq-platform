import { DIGEST_TEXTS } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { childText, digestText, splitText, summaryLine, type ChildPart } from './digest-message.js';

const maths = { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' };

const part: ChildPart = {
  firstName: 'Kamron',
  className: '7-A',
  summary: { marked: 20, attended: 18, late: 1, unmarked: 0 },
  marks: [
    { date: '2026-11-03', subject: maths, mark: 0, state: 'new' },
    { date: '2026-11-04', subject: maths, mark: 1, state: 'corrected' },
    { date: '2026-11-02', subject: maths, mark: null, state: 'removed' },
  ],
  scores: [
    {
      date: '2026-11-03',
      subject: maths,
      work: { kind: 'classwork', position: 1, title: null },
      score: 8,
      total: 10,
      state: 'new',
    },
    {
      date: '2026-11-03',
      subject: maths,
      work: { kind: 'homework', position: 2, title: 'Fractions' },
      score: 5,
      total: 5,
      state: 'corrected',
    },
  ],
  comments: [{ date: '2026-11-03', subject: maths, body: 'Well done', state: 'new' }],
};

// Task 11.5, pull request #299: `10`, What it holds ("Attended all 20 lessons on time", "Attended
// 18 of 20 lessons"; "marked corrected or removed"), Language and Privacy.
describe('the text of the digest', () => {
  it('words the summary line from the counts', () => {
    const en = DIGEST_TEXTS.en;
    expect(summaryLine(en, { marked: 20, attended: 20, late: 0, unmarked: 0 })).toBe(
      'Attendance: attended all 20 lessons on time.',
    );
    expect(summaryLine(en, { marked: 20, attended: 20, late: 2, unmarked: 0 })).toBe(
      'Attendance: attended all 20 lessons, 2 late.',
    );
    expect(summaryLine(en, { marked: 20, attended: 18, late: 0, unmarked: 3 })).toBe(
      'Attendance: attended 18 of 20 lessons.',
    );
    expect(summaryLine(en, { marked: 0, attended: 0, late: 0, unmarked: 4 })).toBe(
      'Attendance: 4 lessons held, attendance not yet entered.',
    );
    expect(summaryLine(en, { marked: 0, attended: 0, late: 0, unmarked: 0 })).toBe(
      'Attendance: no lessons in this period.',
    );
  });

  it('names the child by first name and class, and marks corrections and removals', () => {
    expect(childText('en', part).split('\n')).toEqual([
      'Kamron, 7-A',
      'Attendance: attended 18 of 20 lessons.',
      'Absences and late arrivals:',
      '• Mathematics, 3 Nov: absent',
      '• Mathematics, 4 Nov: present (corrected)',
      '• Mathematics, 2 Nov: removed',
      'Grades:',
      '• Mathematics, Classwork 1, 3 Nov: 8/10',
      '• Mathematics, Fractions, 3 Nov: 5/5 (corrected)',
      'Comments:',
      '• Mathematics, 3 Nov: «Well done»',
    ]);
  });

  it('writes every text in each of the three languages', () => {
    for (const language of ['uz', 'ru', 'en'] as const) {
      const text = digestText(language, '2026-11-04', [part]);
      expect(text).toContain(part.firstName);
      expect(text).toContain(maths[language]);
      expect(text).toContain(DIGEST_TEXTS[language].gradesHeading);
    }
  });

  it('splits only above the limit, between parts first, then at line ends', () => {
    expect(splitText('short')).toEqual(['short']);
    const block = (letter: string) => `${letter.repeat(30)}\n${letter.repeat(30)}`;
    const text = [block('a'), block('b'), block('c')].join('\n\n');
    const messages = splitText(text, 70);
    expect(messages).toEqual([block('a'), block('b'), block('c')]);
    expect(splitText(`${'x'.repeat(40)}\n${'y'.repeat(40)}`, 50)).toEqual([
      'x'.repeat(40),
      'y'.repeat(40),
    ]);
    for (const message of splitText('z'.repeat(120), 50))
      expect(message.length).toBeLessThanOrEqual(50);
  });
});
