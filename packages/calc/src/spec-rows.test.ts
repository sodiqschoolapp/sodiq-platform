import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Task 4.3, Done when: "every row of the two edge-case tables has a test". A row with a part in
// the calculation module is tested in this package (the file and `describe` named); every other
// row names the task of docs/build-plan.md that owns it (decision 9 of the plan, confirmed at
// review). A new or changed row of either file fails here until it is placed. Widening this list
// later is a Look first change (CLAUDE.md, Stop and wait for the owner).
const EXEMPTIONS: Readonly<Record<string, string>> = {
  'A student with a year-long physical education exemption falls ill for three days.':
    'outcome.test.ts "edge/exemptions: exempt lessons in the result"; conflicts and cells 8.5',
  'Full exemption for chosen slots of one day.': '8.5',
  'Slots 5–7 on Friday are exempted, then Friday becomes a shortened day and a lesson moves into slot 6.':
    '8.5',
  'An exemption was entered for the wrong student, or the student came back ten days early and nobody changed it.':
    'outcome.test.ts "edge/exemptions: exempt lessons in the result"; end and void 8.5',
  'A certificate for 1–10 October arrives on 20 October. On 3 October the student was marked present with a classwork score, and the lessons are locked.':
    'outcome.test.ts "edge/exemptions: exempt lessons in the result"; preview and lock 8.5',
  'The range starts in a closed quarter and ends in an open one.': '8.5',
  'A surgery exemption runs from May to September.': '8.5, 9.5b',
  'Nine students from five classes go to an olympiad. In flu week forty certificates arrive.':
    '8.5',
  'A Tutor recorded "illness, certificate" for three absences, but there is no exemption.': '8.5',
  'The reason is a diagnosis and the document is a medical certificate.': '8.5',
  "An exemption is created at 11:40 for today's remaining lessons, or changes last week's marks.":
    '8.5',
  'A student with an exemption transfers, leaves, or moves to another branch.':
    'outcome.test.ts "edge/exemptions: exempt lessons in the result" and "edge/calculation: a result at leaving"; 8.5',
  'The Academic Vice Principal is away for three weeks.': '8.5',
  'Someone tries to type 4 or 5 in a cell.': '8.5',
};

const CALCULATION: Readonly<Record<string, string>> = {
  'A result lands exactly on a boundary. Weights 10 · 50 · 40, attendance 100, classworks 10, 10 and 25 out of 30, homework 29 out of 80: the exact result is 49.5, grade 3. Ordinary computer arithmetic can give 49.4999 and grade 2.':
    'daily.test.ts, quarter.test.ts',
  'Which value gives the grade?': 'grade.test.ts; ranking 9.3a',
  'A part has a weight but no data: no homework was given all quarter.':
    'quarter.test.ts; checklist 9.2a; closing record 9.2b',
  'Nothing at all was entered for a student.':
    'outcome.test.ts "edge/calculation: nothing entered"',
  'A student attends one lesson of forty, with no graded work, and gets 100. Another is absent all quarter and gets 0, grade 2, without ever being assessed.':
    'outcome.test.ts "edge/calculation: a result on attendance alone"; checklist 9.2a',
  'A student joined late, returned, or started the subject mid-quarter and has few lessons.':
    'outcome.test.ts "edge/calculation: few lessons"; whole-journal decisions 9.2a',
  "The lesson score (AVG) of a lesson where one student has no classwork number, or has numbers for only some of the lesson's classworks.":
    'daily.test.ts',
  'A lesson has three classworks: 100%, 50% and 60%. The only other classwork of the quarter is 90%.':
    'daily.test.ts, quarter.test.ts',
  'The month switch in the journal.': '6.2',
  'The rating exam.': 'quarter.test.ts; entry and history 8.2',
  'A student is exempt on the exam day.':
    'quarter.test.ts; record.test.ts "finalQuarterRecord" (pending refuses the closing record)',
  'The exam is not held for one group this quarter.': 'quarter.test.ts; the "not held" mark 8.2',
  'A student left the school before the quarter ended.':
    'outcome.test.ts "edge/calculation: a result at leaving", record.test.ts; 8.6, 9.3a',
  'A student moved from one group to another in week 6.': 'quarter.test.ts; 8.6',
  'A student moved to a class that does not study the subject.':
    'outcome.test.ts "edge/calculation: left the subject"; decision at closing 9.2a',
  'A student moved between branches mid-quarter.':
    'outcome.test.ts "edge/calculation: a result at leaving"; 8.6',
  'A student left and came back in the same quarter.':
    'outcome.test.ts "edge/calculation: left and came back"; closed cells 8.6',
  'Two students both show 84.': '9.3a',
  'One student has 9 subjects, another 11.': '9.3a',
  'The year result when quarters show 50, 50, 49, 50 but are exactly 49.5, 49.5, 49.4, 49.5.':
    'year.test.ts; outcome.test.ts "outcomeForYear"',
  "Ma'naviyat soati and the Homework slot.": 'quarter.test.ts (quarterAttendanceAverage)',
  'Quarterly weights are changed in week 7.': '9.1',
  'The value of "late" is changed from 50 to 75.': '9.1, 9.2b',
  '"Rating exam" is switched off, or a subject becomes attendance only, in week 5.': '8.2',
  "The early-warning list compares a mid-quarter figure without the exam against last quarter's final with the exam.":
    '9.4a',
  'An extra Saturday lesson where only 9 of 22 come.': 'daily.test.ts, quarter.test.ts',
  'A bug is found after results were closed and exported.':
    'record.test.ts, version.test.ts; the tool and "apply with a reason" 9.2c',
};

/** The first cell of every body row of the file's table. */
function casesOf(file: string): string[] {
  const text = readFileSync(
    new URL(`../../../docs/spec/edge-cases/${file}`, import.meta.url),
    'utf8',
  );
  return text
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Case |'))
    .filter((line) => !line.startsWith('| --- '))
    .map((line) => line.slice(2, line.indexOf(' | ')));
}

describe.each([
  ['exemptions.md', EXEMPTIONS, 14],
  ['calculation.md', CALCULATION, 27],
] as const)('edge-cases/%s', (file, pinned, count) => {
  const cases = casesOf(file);

  it(`has the ${count} rows the list was made from`, () => {
    expect(cases).toHaveLength(count);
  });

  it('places every row of the spec in the list, and nothing else', () => {
    expect([...cases].sort()).toEqual(Object.keys(pinned).sort());
  });

  it('names a test or an owning task for every row', () => {
    for (const covered of Object.values(pinned)) {
      expect(covered).toMatch(/\.test\.ts|\b\d+\.\d+[a-z]?\b/);
    }
  });
});
