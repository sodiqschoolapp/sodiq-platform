import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Task 4.3, Done when: "every row of the two edge-case tables has a test". A row with a part in
// the calculation module is tested in this package (`tests`: the file, and the `describe` when
// one names the row); every row without one, and the parts of a row this module cannot hold,
// name the task of docs/build-plan.md that owns them (`tasks`; decision 9 of the plan, confirmed
// at review). Each row is pinned by its case text and a hash of its rule text, so a new or
// changed row fails here until it is placed again. Widening this list later is a Look first
// change (CLAUDE.md, Stop and wait for the owner).
interface Row {
  readonly case: string;
  /** The first 16 hex digits of the SHA-256 of the row's rule cell. */
  readonly rule: string;
  readonly tests: readonly (readonly [string] | readonly [string, string])[];
  readonly tasks: readonly string[];
}

// Task 8.6, pull request #224: the rows whose part is the journal's (the results that follow
// the student across journals, the result at leaving) name the API tests of that task, from
// this folder.
const FOLLOW = '../../../apps/api/src/modules/journal/results-follow.test.ts';
const LEAVING = '../../../apps/api/src/modules/journal/leaving-results.test.ts';

const EXEMPTIONS: readonly Row[] = [
  {
    case: 'A student with a year-long physical education exemption falls ill for three days.',
    rule: 'f1d9e11b8a099bbc',
    tests: [['outcome.test.ts', 'edge/exemptions: exempt lessons in the result']],
    tasks: ['8.5'],
  },
  {
    case: 'Full exemption for chosen slots of one day.',
    rule: '02771b318c4cf5b6',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: 'Slots 5–7 on Friday are exempted, then Friday becomes a shortened day and a lesson moves into slot 6.',
    rule: 'bfd4541d84af7707',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: 'An exemption was entered for the wrong student, or the student came back ten days early and nobody changed it.',
    rule: 'a07d9da6517f0cdb',
    tests: [['outcome.test.ts', 'edge/exemptions: exempt lessons in the result']],
    tasks: ['8.5'],
  },
  {
    case: 'A certificate for 1–10 October arrives on 20 October. On 3 October the student was marked present with a classwork score, and the lessons are locked.',
    rule: 'ed1444f12d9e3816',
    tests: [['outcome.test.ts', 'edge/exemptions: exempt lessons in the result']],
    tasks: ['8.5'],
  },
  {
    case: 'The range starts in a closed quarter and ends in an open one.',
    rule: 'f31e1926e056f340',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: 'A surgery exemption runs from May to September.',
    rule: '83ee5d105cf76a21',
    tests: [],
    tasks: ['8.5', '9.5b'],
  },
  {
    case: 'Nine students from five classes go to an olympiad. In flu week forty certificates arrive.',
    rule: 'c01fef5ab93eb137',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: 'A Tutor recorded "illness, certificate" for three absences, but there is no exemption.',
    rule: '546f917a6d36eaaf',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: 'The reason is a diagnosis and the document is a medical certificate.',
    rule: 'fb32ebd33ac86a56',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: "An exemption is created at 11:40 for today's remaining lessons, or changes last week's marks.",
    rule: '9f74c953a3037404',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: 'A student with an exemption transfers, leaves, or moves to another branch.',
    rule: '2edbc3e693d8522e',
    tests: [
      ['outcome.test.ts', 'edge/exemptions: exempt lessons in the result'],
      ['outcome.test.ts', 'edge/calculation: a result at leaving'],
    ],
    tasks: ['8.5'],
  },
  {
    case: 'The Academic Vice Principal is away for three weeks.',
    rule: 'ea9a408d601a6d97',
    tests: [],
    tasks: ['8.5'],
  },
  {
    case: 'Someone tries to type 4 or 5 in a cell.',
    rule: '5f04d4d880b2df13',
    tests: [],
    tasks: ['8.5'],
  },
];

const CALCULATION: readonly Row[] = [
  {
    case: 'A result lands exactly on a boundary. Weights 10 · 50 · 40, attendance 100, classworks 10, 10 and 25 out of 30, homework 29 out of 80: the exact result is 49.5, grade 3. Ordinary computer arithmetic can give 49.4999 and grade 2.',
    rule: '49d1711be3b64309',
    tests: [['daily.test.ts'], ['quarter.test.ts']],
    tasks: [],
  },
  {
    case: 'Which value gives the grade?',
    rule: '5b613fe1c843087e',
    tests: [['grade.test.ts']],
    tasks: ['9.3a'],
  },
  {
    case: 'A part has a weight but no data: no homework was given all quarter.',
    rule: '43b92562942131a3',
    tests: [['quarter.test.ts']],
    tasks: ['9.2a', '9.2b'],
  },
  {
    case: 'Nothing at all was entered for a student.',
    rule: '211fd039e5ff7f57',
    tests: [['outcome.test.ts', 'edge/calculation: nothing entered']],
    tasks: [],
  },
  {
    case: 'A student attends one lesson of forty, with no graded work, and gets 100. Another is absent all quarter and gets 0, grade 2, without ever being assessed.',
    rule: '8e642cc2ed2d09ad',
    tests: [['outcome.test.ts', 'edge/calculation: a result on attendance alone']],
    tasks: ['9.2a'],
  },
  {
    case: 'A student joined late, returned, or started the subject mid-quarter and has few lessons.',
    rule: '0cd55d3e800d539b',
    tests: [
      ['outcome.test.ts', 'edge/calculation: few lessons'],
      [
        FOLLOW,
        'few lessons (edge/calculation: "A student joined late, returned, or started the subject mid-quarter")',
      ],
    ],
    tasks: ['9.2a'],
  },
  {
    case: "The lesson score (AVG) of a lesson where one student has no classwork number, or has numbers for only some of the lesson's classworks.",
    rule: 'cfb7cb8f78766fac',
    tests: [['daily.test.ts']],
    tasks: [],
  },
  {
    case: 'A lesson has three classworks: 100%, 50% and 60%. The only other classwork of the quarter is 90%.',
    rule: '95db9798c784c9ff',
    tests: [['daily.test.ts'], ['quarter.test.ts']],
    tasks: [],
  },
  {
    case: 'The month switch in the journal.',
    rule: '58ad560644aa1432',
    tests: [],
    tasks: ['6.2'],
  },
  {
    case: 'The rating exam.',
    rule: '761938e5a4d376d5',
    tests: [['quarter.test.ts']],
    tasks: ['8.2'],
  },
  {
    case: 'A student is exempt on the exam day.',
    rule: '2752f9afb985a4a4',
    tests: [['quarter.test.ts'], ['record.test.ts', 'finalQuarterRecord']],
    tasks: ['8.2'],
  },
  {
    case: 'The exam is not held for one group this quarter.',
    rule: '9d8fa9058f21246d',
    tests: [['quarter.test.ts']],
    tasks: ['8.2'],
  },
  {
    case: 'A student left the school before the quarter ended.',
    rule: '0b0a146ef2523bb3',
    tests: [
      ['outcome.test.ts', 'edge/calculation: a result at leaving'],
      ['record.test.ts', 'finalQuarterRecord'],
      [LEAVING, 'the results at leaving (edge/calculation, a result at leaving)'],
    ],
    tasks: ['9.3a'],
  },
  {
    case: 'A student moved from one group to another in week 6.',
    rule: 'b7f2c00beea21144',
    tests: [
      ['quarter.test.ts'],
      [FOLLOW, 'week 6 (edge/calculation: "A student moved from one group to another in week 6")'],
    ],
    tasks: [],
  },
  {
    case: 'A student moved to a class that does not study the subject.',
    rule: '02f48b8d176aa010',
    tests: [
      ['outcome.test.ts', 'edge/calculation: left the subject'],
      [
        FOLLOW,
        'few lessons (edge/calculation: "A student joined late, returned, or started the subject mid-quarter")',
      ],
    ],
    tasks: ['9.2a'],
  },
  {
    case: 'A student moved between branches mid-quarter.',
    rule: 'c52890768004ab6d',
    tests: [
      ['outcome.test.ts', 'edge/calculation: a result at leaving'],
      [
        FOLLOW,
        'between branches (edge/calculation: "A student moved between branches mid-quarter")',
      ],
    ],
    tasks: [],
  },
  {
    case: 'A student left and came back in the same quarter.',
    rule: '4c98735163831736',
    tests: [
      ['outcome.test.ts', 'edge/calculation: left and came back'],
      [
        FOLLOW,
        'left and came back (edge/calculation: "A student left and came back in the same quarter")',
      ],
    ],
    tasks: [],
  },
  {
    case: 'Two students both show 84.',
    rule: '516e218420b303d1',
    tests: [],
    tasks: ['9.3a'],
  },
  {
    case: 'One student has 9 subjects, another 11.',
    rule: 'c4e1342d21804188',
    tests: [],
    tasks: ['9.3a'],
  },
  {
    case: 'The year result when quarters show 50, 50, 49, 50 but are exactly 49.5, 49.5, 49.4, 49.5.',
    rule: '1f8f7d059eb7861e',
    tests: [['year.test.ts'], ['outcome.test.ts', 'outcomeForYear']],
    tasks: [],
  },
  {
    case: "Ma'naviyat soati and the Homework slot.",
    rule: '5ce304d5c63eb1c0',
    tests: [['quarter.test.ts']],
    tasks: [],
  },
  {
    case: 'Quarterly weights are changed in week 7.',
    rule: '8a4391cf8aa7892f',
    tests: [],
    tasks: ['9.1'],
  },
  {
    case: 'The value of "late" is changed from 50 to 75.',
    rule: '271b38a52aece454',
    tests: [],
    tasks: ['9.1', '9.2b'],
  },
  {
    case: '"Rating exam" is switched off, or a subject becomes attendance only, in week 5.',
    rule: '5ff84a7acdd69a18',
    tests: [],
    tasks: ['8.2'],
  },
  {
    case: "The early-warning list compares a mid-quarter figure without the exam against last quarter's final with the exam.",
    rule: 'e6baf0416ba3e304',
    tests: [
      [
        'early-warning.test.ts',
        'currentWorkFigure: attendance, classwork, homework, no exam (edge/calculation)',
      ],
    ],
    tasks: ['9.4a'],
  },
  {
    case: 'A bug is found after results were closed and exported.',
    rule: '54d51e86e47f56ec',
    tests: [['record.test.ts', 'recalculateAndCompare'], ['version.test.ts']],
    tasks: ['9.2c'],
  },
];

const here = new URL('./', import.meta.url);

/** The case and rule cells of every body row of the file's table. */
function rowsOf(file: string): { case: string; rule: string }[] {
  const text = readFileSync(
    new URL(`../../../docs/spec/edge-cases/${file}`, import.meta.url),
    'utf8',
  );
  return text
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Case |'))
    .filter((line) => !line.startsWith('| --- '))
    .map((line) => {
      const split = line.indexOf(' | ');
      const rule = line.slice(split + 3, line.length - 2);
      return {
        case: line.slice(2, split),
        rule: createHash('sha256').update(rule).digest('hex').slice(0, 16),
      };
    });
}

describe.each([
  ['exemptions.md', EXEMPTIONS],
  ['calculation.md', CALCULATION],
] as const)('edge-cases/%s', (file, pinned) => {
  const rows = rowsOf(file);

  it('places every row of the spec, case and rule unchanged, and nothing else', () => {
    expect(rows).toEqual(pinned.map((row) => ({ case: row.case, rule: row.rule })));
  });

  it.each(pinned.map((row) => [row.case, row] as const))(
    'names a test or an owning task for %s',
    (_case, row) => {
      expect(row.tests.length + row.tasks.length).toBeGreaterThan(0);
      for (const task of row.tasks) expect(task).toMatch(/^\d+\.\d+[a-z]?$/);
      for (const [testFile, describeName] of row.tests) {
        const url = new URL(testFile, here);
        expect(existsSync(url), `${testFile} exists`).toBe(true);
        if (describeName === undefined) continue;
        const text = readFileSync(url, 'utf8');
        const quoted = `'${describeName.replace(/'/g, "\\'")}'`;
        expect(
          new RegExp(`describe\\(\\s*${quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text),
          `${testFile} has describe ${describeName}`,
        ).toBe(true);
      }
    },
  );
});
