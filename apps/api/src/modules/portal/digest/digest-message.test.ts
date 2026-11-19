import { DIGEST_TEXTS } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import {
  CHILD_RULE,
  SECTION_SIGNS,
  childText,
  digestText,
  escapeHtml,
  digestMessages,
  splitDigest,
  type ChildBlocks,
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
      '📅 <b>Attendance</b>',
      'Attended 18 of 20 lessons.',
      '• 3 Nov, Mathematics — absent',
      '• 4 Nov, Mathematics — present (corrected)',
      '• 2 Nov, Mathematics — removed',
      '',
      '📝 <b>Grades</b>',
      '• 3 Nov, Mathematics, Classwork 1 — <b>8/10</b>',
      '• 3 Nov, Mathematics, Homework · Fractions — <b>5/5</b> (corrected)',
      '',
      '💬 <b>Teachers’ comments</b>',
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
      '<b>Kamron</b>\n\n📅 <b>Attendance</b>\nAttended all 4 lessons on time.',
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

  it('opens with the date in bold and says what the digest covers, without the school name', () => {
    expect(digestText('en', '2026-11-04', [part]).split('\n').slice(0, 2)).toEqual([
      '<b>Digest of 4 November</b>',
      'Since the previous digest',
    ]);
    expect(digestText('uz', '2026-11-17', [part], true).split('\n').slice(0, 2)).toEqual([
      '<b>Xabarnoma, 17-noyabr</b>',
      'Telegram ulanganidan beri',
    ]);
    expect(digestText('ru', '2026-11-17', [part]).split('\n').slice(0, 2)).toEqual([
      '<b>Сводка на 17 ноября</b>',
      'С прошлой сводки',
    ]);
    for (const language of ['uz', 'ru', 'en'] as const)
      expect(digestText(language, '2026-11-17', [part])).not.toMatch(/Sodiq|Школа/u);
  });

  it('parts two children by a rule above the second name, and only between them', () => {
    const second: ChildPart = { ...part, firstName: 'Laylo', className: '3-B' };
    const text = digestText('en', '2026-11-04', [part, second]);
    expect(text.split(CHILD_RULE).length).toBe(2);
    expect(text).toContain(`\n\n${CHILD_RULE}\n<b>Laylo</b> · 3-B\n`);
    expect(digestText('en', '2026-11-04', [part])).not.toContain(CHILD_RULE);
  });

  // Owner, 19 November 2026: a title alone ("10-mashq") does not say whether the work was done
  // in class or at home.
  it('names the kind of every work, a titled one too, in each language', () => {
    const titled = (kind: 'classwork' | 'homework', title: string | null): ChildPart => ({
      ...part,
      marks: [],
      comments: [],
      scores: [
        {
          date: '2026-11-17',
          subject: maths,
          work: { kind, position: 2, title },
          score: 9,
          total: 10,
          state: 'new',
        },
      ],
    });
    const line = (language: 'uz' | 'ru' | 'en', one: ChildPart) =>
      childText(language, one)
        .split('\n')
        .find((row) => row.startsWith('• '));
    expect(line('uz', titled('classwork', '10-mashq'))).toBe(
      '• 17-noy, Matematika, Sinf ishi · 10-mashq — <b>9/10</b>',
    );
    expect(line('uz', titled('homework', '10-mashq'))).toBe(
      '• 17-noy, Matematika, Uy vazifasi · 10-mashq — <b>9/10</b>',
    );
    expect(line('ru', titled('homework', '10-mashq'))).toContain('Домашняя работа · 10-mashq');
    expect(line('en', titled('classwork', '10-mashq'))).toContain('Classwork · 10-mashq');
    // A work without a title keeps its kind and number.
    expect(line('uz', titled('homework', null))).toContain('Uy vazifasi 2');
    // A typed title is escaped like every value.
    expect(line('en', titled('classwork', 'A & <b>'))).toContain('Classwork · A &amp; &lt;b&gt;');
  });

  it('writes every text in each of the three languages', () => {
    for (const language of ['uz', 'ru', 'en'] as const) {
      const text = digestText(language, '2026-11-04', [part]);
      expect(text).toContain(part.firstName);
      expect(text).toContain(maths[language]);
      expect(text).toContain(
        `${SECTION_SIGNS.attendance} <b>${DIGEST_TEXTS[language].attendanceHeading}</b>`,
      );
      expect(text).toContain(
        `${SECTION_SIGNS.grades} <b>${DIGEST_TEXTS[language].gradesHeading}</b>`,
      );
      expect(text).toContain(
        `${SECTION_SIGNS.comments} <b>${DIGEST_TEXTS[language].commentsHeading}</b>`,
      );
    }
  });

  /** A child of invented lines, each naming its child by letter: `• A0-3 …`. */
  const kid = (letter: string, sizes: readonly number[]): ChildBlocks => ({
    name: `<b>${letter}</b> · 7-A`,
    sections: sizes.map((size, section) => [
      `${SECTION_SIGNS.grades} <b>H${letter}${String(section)}</b>`,
      ...Array.from(
        { length: size },
        (_, line) => `• ${letter}${String(section)}-${String(line)} ${'x'.repeat(50)}`,
      ),
    ]),
  });
  const top = '<b>Digest of 4 November</b>\nSince the previous digest';

  /**
   * Every message within the limit, none opening with the rule or closing on a name alone, and
   * every line of a child read below that child's own name in the same message.
   */
  const expectEachLineUnderItsChild = (
    messages: readonly string[],
    children: readonly ChildBlocks[],
    limit: number,
  ): void => {
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(limit);
      expect(message.startsWith(CHILD_RULE)).toBe(false);
      const lines = message.split('\n');
      expect(children.some((child) => lines.at(-1) === child.name)).toBe(false);
      expect(lines.at(-1)).not.toMatch(/<b>H[A-Z]\d<\/b>$/u);
      let owner: string | null = null;
      for (const line of lines) {
        if (children.some((child) => child.name === line)) {
          owner = line;
          continue;
        }
        const letter = /^• ([A-Z])\d/u.exec(line)?.[1] ?? /<b>H([A-Z])\d<\/b>$/u.exec(line)?.[1];
        if (letter !== undefined) expect(owner).toBe(`<b>${letter}</b> · 7-A`);
      }
    }
  };

  /** Every line of the children once, in order, leaving out a repeated name or heading. */
  const expectEveryLineOnce = (
    messages: readonly string[],
    children: readonly ChildBlocks[],
  ): void => {
    const sent = messages
      .join('\n')
      .split('\n')
      .filter((line) => line.startsWith('• '));
    const written = children.flatMap((child) =>
      child.sections.flatMap((lines) => lines.filter((line) => line.startsWith('• '))),
    );
    expect(sent).toEqual(written);
  };

  it('sends one message while the digest fits, the same text as the whole digest', () => {
    const second: ChildPart = { ...part, firstName: 'Laylo', className: '3-B' };
    expect(digestMessages('en', '2026-11-04', [part, second])).toEqual([
      digestText('en', '2026-11-04', [part, second]),
    ]);
  });

  // Review of pull request #355: the second child's name closed the first message and its
  // sections opened the next one, with no child named.
  it("keeps a child's part whole in one message when it fits, its name with its sections", () => {
    const children = [kid('A', [60, 60]), kid('B', [20, 20])];
    const messages = splitDigest(top, children, 4096);
    expect(messages.length).toBeGreaterThan(1);
    const opening = messages.find((message) => message.includes(children[1]?.name ?? '-'));
    expect(opening?.startsWith(`${children[1]?.name ?? '-'}\n\n`)).toBe(true);
    expect(opening).toContain('<b>HB0</b>');
    expect(opening).toContain('<b>HB1</b>');
    expectEachLineUnderItsChild(messages, children, 4096);
    expectEveryLineOnce(messages, children);
  });

  it('opens every message of a part cut in pieces with the name, and repeats a cut heading', () => {
    const children = [kid('A', [3]), kid('B', [80, 2]), kid('C', [1])];
    const messages = splitDigest(top, children, 1000);
    const ofB = messages.filter((message) => message.includes('• B'));
    expect(ofB.length).toBeGreaterThan(2);
    for (const message of ofB) expect(message.startsWith('<b>B</b> · 7-A\n\n')).toBe(true);
    // A message that goes on with section 0 of B repeats its heading under the name.
    for (const message of ofB.filter((one) => one.includes('• B0-')))
      expect(message.split('\n')[2]).toBe(`${SECTION_SIGNS.grades} <b>HB0</b>`);
    expectEachLineUnderItsChild(messages, children, 1000);
    expectEveryLineOnce(messages, children);
  });

  it('keeps each line under its own child at every limit, for real parts too', () => {
    const shapes: readonly (readonly ChildBlocks[])[] = [
      [kid('A', [60, 60]), kid('B', [20, 20])],
      [kid('A', [3]), kid('B', [80, 2]), kid('C', [1])],
      [kid('A', [1, 1, 1]), kid('B', [1]), kid('C', [40, 40, 40])],
    ];
    for (const children of shapes) {
      for (const limit of [200, 333, 500, 777, 1000, 2048, 4096]) {
        const messages = splitDigest(top, children, limit);
        expectEachLineUnderItsChild(messages, children, limit);
        expectEveryLineOnce(messages, children);
      }
    }
    // Real parts: each line of Laylo's (her lessons only on 5 Nov) is read below her name.
    const laylo: ChildPart = {
      ...part,
      firstName: 'Laylo',
      className: '3-B',
      marks: Array.from({ length: 30 }, () => ({
        date: '2026-11-05',
        subject: history,
        mark: 0,
        state: 'new' as const,
      })),
      scores: [],
      comments: [],
    };
    for (const limit of [150, 400, 900]) {
      for (const message of digestMessages('en', '2026-11-04', [part, laylo], false, limit)) {
        expect(message.length).toBeLessThanOrEqual(limit);
        let owner: string | null = null;
        for (const line of message.split('\n')) {
          if (line.startsWith('<b>Kamron</b>') || line.startsWith('<b>Laylo</b>')) owner = line;
          if (line.startsWith('• 5 Nov')) expect(owner).toBe('<b>Laylo</b> · 3-B');
          if (/^• [234] Nov/u.test(line)) expect(owner).toBe('<b>Kamron</b> · 7-A');
        }
      }
    }
  });

  it('never opens a message with the rule between children', () => {
    const children = [kid('A', [10]), kid('B', [10])];
    const messages = splitDigest(top, children, 700);
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) expect(message.startsWith(CHILD_RULE)).toBe(false);
    expect(messages.some((message) => message.startsWith('<b>B</b> · 7-A'))).toBe(true);
    // Beside another child in one message, the rule stands above the name.
    const both = splitDigest(top, [kid('A', [1]), kid('B', [1])], 4096);
    expect(both).toHaveLength(1);
    expect(both[0]).toContain(`\n\n${CHILD_RULE}\n<b>B</b> · 7-A\n\n`);
  });

  it('keeps every tag and entity whole when a line must be cut, under the name and heading', () => {
    const long = `— <i>${escapeHtml('a&b<c '.repeat(40))}</i>`;
    const child: ChildBlocks = { name: '<b>A</b> · 7-A', sections: [['💬 <b>H</b>', long]] };
    const messages = splitDigest(top, [child], 80);
    const pieces = messages.filter((message) => !message.includes('Digest of'));
    expect(pieces.length).toBeGreaterThan(1);
    // No message closes on the name and the heading with nothing under them.
    expect(messages.every((message) => !message.endsWith('💬 <b>H</b>'))).toBe(true);
    for (const message of pieces) {
      expect(message.length).toBeLessThanOrEqual(80);
      expect(message.startsWith('<b>A</b> · 7-A\n\n💬 <b>H</b>\n')).toBe(true);
      const piece = message.split('\n').slice(3).join('\n');
      expect(piece).not.toMatch(/[<>]/u);
      // Every `&` opens a whole entity.
      expect(piece).not.toMatch(/&(?!(?:amp|lt|gt);)/u);
    }
    expect(visible(pieces.map((message) => message.split('\n').slice(3).join('\n')).join(''))).toBe(
      visible(long),
    );
  });
});
