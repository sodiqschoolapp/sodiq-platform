import { DIGEST_TEXTS } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import {
  CHILD_RULE,
  childText,
  digestText,
  escapeHtml,
  splitText,
  summaryLine,
  type ChildPart,
} from './digest-message.js';

const maths = { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' };
const history = { uz: 'Tarix', ru: 'История', en: 'History' };

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
  comments: [
    { date: '2026-11-03', subject: maths, body: 'Well done', state: 'new' },
    { date: '2026-11-03', subject: maths, body: 'Neat\n  work', state: 'corrected' },
    { date: '2026-11-04', subject: history, body: null, state: 'removed' },
  ],
};

/** The visible text of a Telegram HTML message: tags dropped, entities read back. */
const visible = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');

// Task 11.5, pull request #299: `10`, What it holds ("Attended all 20 lessons on time", "Attended
// 18 of 20 lessons"; "marked corrected or removed"), Language and Privacy. The layout: bold
// headings, the date first on each line, the comments of one lesson under one line.
describe('the text of the digest', () => {
  it('words the summary line from the counts, one lesson in the singular', () => {
    const en = DIGEST_TEXTS.en;
    expect(summaryLine(en, { marked: 20, attended: 20, late: 0, unmarked: 0 })).toBe(
      'Attended all 20 lessons on time.',
    );
    expect(summaryLine(en, { marked: 20, attended: 20, late: 2, unmarked: 0 })).toBe(
      'Attended all 20 lessons; late for 2.',
    );
    expect(summaryLine(en, { marked: 20, attended: 18, late: 0, unmarked: 3 })).toBe(
      'Attended 18 of 20 lessons.',
    );
    expect(summaryLine(en, { marked: 3, attended: 0, late: 0, unmarked: 0 })).toBe(
      'Missed all 3 lessons.',
    );
    expect(summaryLine(en, { marked: 0, attended: 0, late: 0, unmarked: 4 })).toBe(
      '4 lessons held; attendance not entered yet.',
    );
    expect(summaryLine(en, { marked: 0, attended: 0, late: 0, unmarked: 0 })).toBe(
      'No lessons in this period.',
    );
    expect(summaryLine(en, { marked: 1, attended: 1, late: 0, unmarked: 0 })).toBe(
      'Attended the lesson on time.',
    );
    expect(summaryLine(en, { marked: 1, attended: 1, late: 1, unmarked: 0 })).toBe(
      'Attended the lesson, but was late.',
    );
    expect(summaryLine(en, { marked: 1, attended: 0, late: 0, unmarked: 0 })).toBe(
      'Missed the lesson.',
    );
    expect(summaryLine(DIGEST_TEXTS.uz, { marked: 1, attended: 1, late: 1, unmarked: 0 })).toBe(
      'Darsga keldi, lekin kechikdi.',
    );
  });

  it('gives Russian counts their plural form', () => {
    const ru = DIGEST_TEXTS.ru;
    const all = (lessons: number) =>
      summaryLine(ru, { marked: lessons, attended: lessons, late: 0, unmarked: 0 });
    expect(all(21)).toBe('Посещены все 21 урок, без опозданий.');
    expect(all(22)).toBe('Посещены все 22 урока, без опозданий.');
    expect(all(12)).toBe('Посещены все 12 уроков, без опозданий.');
    expect(summaryLine(ru, { marked: 21, attended: 18, late: 0, unmarked: 0 })).toBe(
      'Посещено 18 из 21 урока.',
    );
    expect(summaryLine(ru, { marked: 20, attended: 18, late: 0, unmarked: 0 })).toBe(
      'Посещено 18 из 20 уроков.',
    );
  });

  it('names the child by first name and class, and marks corrections and removals', () => {
    expect(childText('en', part).split('\n')).toEqual([
      '<b>Kamron</b> · 7-A',
      '',
      '<b>Attendance</b>',
      'Attended 18 of 20 lessons.',
      '• 3 Nov, Mathematics — absent',
      '• 4 Nov, Mathematics — present (corrected)',
      '• 2 Nov, Mathematics — removed',
      '',
      '<b>Grades</b>',
      '• 3 Nov, Mathematics, Classwork 1 — <b>8/10</b>',
      '• 3 Nov, Mathematics, Fractions — <b>5/5</b> (corrected)',
      '',
      '<b>Teachers’ comments</b>',
      '• 3 Nov, Mathematics',
      '— <i>Well done</i>',
      '— <i>Neat work</i> (corrected)',
      '• 4 Nov, History',
      '— comment removed',
    ]);
  });

  it('always holds the attendance, and leaves out an empty list of grades or comments', () => {
    const quiet: ChildPart = {
      firstName: 'Kamron',
      className: null,
      summary: { marked: 4, attended: 4, late: 0, unmarked: 0 },
      marks: [],
      scores: [],
      comments: [],
    };
    expect(childText('en', quiet)).toBe(
      '<b>Kamron</b>\n\n<b>Attendance</b>\nAttended all 4 lessons on time.',
    );
  });

  it('escapes every value typed by a person, so a comment cannot carry markup', () => {
    const typed: ChildPart = {
      ...part,
      firstName: 'Ali<b>',
      className: '7 & 8',
      scores: [],
      marks: [],
      comments: [
        { date: '2026-11-03', subject: maths, body: '<a href="x">see</a> & more', state: 'new' },
      ],
    };
    const text = digestText('en', '2026-11-04', [typed]);
    expect(text).toContain('<b>Ali&lt;b&gt;</b> · 7 &amp; 8');
    expect(text).toContain('<i>&lt;a href="x"&gt;see&lt;/a&gt; &amp; more</i>');
    expect(text).not.toContain('<a ');
    expect(escapeHtml('a<b>&c')).toBe('a&lt;b&gt;&amp;c');
  });

  it('opens with the school and the date, and says what the first digest covers', () => {
    expect(digestText('en', '2026-11-04', [part]).split('\n').slice(0, 2)).toEqual([
      '<b>Sodiq School</b>',
      'Digest of 4 November · since the previous digest',
    ]);
    expect(digestText('uz', '2026-11-17', [part], true).split('\n').slice(0, 2)).toEqual([
      '<b>Sodiq maktabi</b>',
      'Xabarnoma, 17-noyabr · Telegram ulanganidan beri',
    ]);
    expect(digestText('ru', '2026-11-17', [part]).split('\n')[1]).toBe(
      'Сводка на 17 ноября · с прошлой сводки',
    );
  });

  it('parts two children by a rule above the second name, and only between them', () => {
    const second: ChildPart = { ...part, firstName: 'Laylo', className: '3-B' };
    const text = digestText('en', '2026-11-04', [part, second]);
    expect(text.split(CHILD_RULE).length).toBe(2);
    expect(text).toContain(`\n\n${CHILD_RULE}\n<b>Laylo</b> · 3-B\n`);
    expect(digestText('en', '2026-11-04', [part])).not.toContain(CHILD_RULE);
  });

  it('writes every text in each of the three languages', () => {
    for (const language of ['uz', 'ru', 'en'] as const) {
      const text = digestText(language, '2026-11-04', [part]);
      expect(text).toContain(part.firstName);
      expect(text).toContain(maths[language]);
      expect(text).toContain(`<b>${DIGEST_TEXTS[language].gradesHeading}</b>`);
      expect(text).toContain(`<b>${DIGEST_TEXTS[language].attendanceHeading}</b>`);
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

  it('never opens a message with the rule between children', () => {
    const second: ChildPart = { ...part, firstName: 'Laylo', className: '3-B' };
    const text = digestText('en', '2026-11-04', [part, second]);
    const messages = splitText(text, text.indexOf(CHILD_RULE));
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) expect(message.startsWith(CHILD_RULE)).toBe(false);
    expect(messages.some((message) => message.startsWith('<b>Laylo</b>'))).toBe(true);
  });

  it("never opens a message with the rule when a child's part is itself cut at line ends", () => {
    const second: ChildPart = { ...part, firstName: 'Laylo', className: '3-B' };
    const text = digestText('en', '2026-11-04', [part, second]);
    const messages = splitText(text, 60);
    expect(messages.length).toBeGreaterThan(2);
    for (const message of messages) {
      expect(message.startsWith(CHILD_RULE)).toBe(false);
      expect(message.length).toBeLessThanOrEqual(60);
    }
    expect(messages).toContain('<b>Laylo</b> · 3-B');
  });

  it('keeps every tag and entity whole when a line must be cut', () => {
    const long = `— <i>${escapeHtml('a&b<c '.repeat(40))}</i>`;
    const messages = splitText(long, 50);
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(50);
      expect(message).not.toMatch(/[<>]/u);
      // Every `&` opens a whole entity.
      expect(message).not.toMatch(/&(?!(?:amp|lt|gt);)/u);
    }
    expect(visible(messages.join(''))).toBe(visible(long));
  });
});
