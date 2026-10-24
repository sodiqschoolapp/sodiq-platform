import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Task 8.5, Done when: "every row of the 'Problem cases' table has a test" (decision 6 of pull
// request #223, Look first). Every row of `07`, Exemptions, Problem cases, and of
// `edge/exemptions` is placed: the tests that check it (a file of the repository and a
// `describe` in it), and the task of docs/build-plan.md that owns a part this task cannot hold.
// Each row is pinned by its case text and a hash of its rule text, as `spec-rows.test.ts` of
// `packages/calc` does, so a new or changed row fails here until it is placed again.
interface Row {
  readonly case: string;
  /** The first 16 hex digits of the SHA-256 of the row's rule cell. */
  readonly rule: string;
  readonly tests: readonly (readonly [string, string])[];
  readonly tasks: readonly string[];
}

const ROUTES = 'apps/api/src/modules/journal/exemptions.test.ts';
const DATABASE = 'apps/api/src/modules/journal/exemptions.database.test.ts';
const PAGE = 'apps/web/src/features/journal/exemptions-page.test.tsx';
const GRID = 'apps/web/src/features/journal/journal-page.test.tsx';
const CALC = 'packages/calc/src/outcome.test.ts';

const PROBLEM_CASES: readonly Row[] = [
  {
    case: 'The exemption is entered after the fact, for example a certificate arrives a week later.',
    rule: '32a98b0b8a5c9ece',
    tests: [[ROUTES, 'a late certificate (07, Problem cases; edge/exemptions, row 5)']],
    tasks: [],
  },
  {
    case: 'The student returns early, or the exemption must be longer.',
    rule: '0bc791eb9cc75483',
    tests: [[ROUTES, 'a void and an end (edge/exemptions, row 4)']],
    tasks: [],
  },
  {
    case: 'Two exemptions would overlap.',
    rule: '99292391155edee4',
    tests: [
      [ROUTES, 'the overlap (07, Problem cases: "Two exemptions would overlap")'],
      [DATABASE, 'the overlap (edge/exemptions, row 1)'],
    ],
    tasks: [],
  },
  {
    case: 'The dates fall in a closed quarter.',
    rule: '397a8839d8eade9c',
    tests: [],
    // No quarter closes before 9.2b (decision 6): its From line refuses the closed part.
    tasks: ['9.2b'],
  },
  {
    case: 'A teacher finds a student missing for a reason that deserves an exemption.',
    rule: '240a90b9ec8ea6bf',
    tests: [[ROUTES, 'a late certificate (07, Problem cases; edge/exemptions, row 5)']],
    tasks: [],
  },
  {
    case: 'An exempt student takes part in the lesson anyway.',
    rule: '9aa64d41b7c2f844',
    tests: [[ROUTES, 'the journal (07, In the journal)']],
    tasks: [],
  },
  {
    case: 'Exemptions are used too freely.',
    rule: 'e0e60049ebfd073f',
    tests: [
      [PAGE, 'the Exemptions page'],
      [ROUTES, 'the reason and the document (edge/exemptions, row 10)'],
    ],
    tasks: [],
  },
  {
    case: 'An exemption ends.',
    rule: '606727563846886c',
    tests: [
      [ROUTES, 'the teaching home (edge/exemptions, row 11; 07, "An exemption ends")'],
      [DATABASE, 'who is expected (edge/00-definitions)'],
    ],
    tasks: [],
  },
  {
    case: 'A student leaves during the day for a competition, or falls ill and is allowed to go home.',
    rule: 'c072d7bad41bd587',
    tests: [
      [DATABASE, 'who is expected (edge/00-definitions)'],
      [DATABASE, 'the overlap (edge/exemptions, row 1)'],
    ],
    tasks: [],
  },
];

const EDGE_ROWS: readonly Row[] = [
  {
    case: 'A student with a year-long physical education exemption falls ill for three days.',
    rule: 'f1d9e11b8a099bbc',
    tests: [
      [DATABASE, 'the overlap (edge/exemptions, row 1)'],
      [DATABASE, 'who is expected (edge/00-definitions)'],
      [CALC, 'edge/exemptions: exempt lessons in the result'],
    ],
    tasks: [],
  },
  {
    case: 'Full exemption for chosen slots of one day.',
    rule: '02771b318c4cf5b6',
    tests: [[DATABASE, 'the shape']],
    tasks: [],
  },
  {
    case: 'Slots 5–7 on Friday are exempted, then Friday becomes a shortened day and a lesson moves into slot 6.',
    rule: 'bfd4541d84af7707',
    tests: [[DATABASE, 'who is expected (edge/00-definitions)']],
    tasks: [],
  },
  {
    case: 'An exemption was entered for the wrong student, or the student came back ten days early and nobody changed it.',
    rule: 'a07d9da6517f0cdb',
    tests: [
      [ROUTES, 'a void and an end (edge/exemptions, row 4)'],
      [ROUTES, 'the edit (edge/exemptions, row 4)'],
    ],
    tasks: [],
  },
  {
    case: 'A certificate for 1–10 October arrives on 20 October. On 3 October the student was marked present with a classwork score, and the lessons are locked.',
    rule: 'ed1444f12d9e3816',
    tests: [
      [ROUTES, 'a late certificate (07, Problem cases; edge/exemptions, row 5)'],
      [ROUTES, "at the same moment as a cell save (the plan's lock)"],
    ],
    tasks: [],
  },
  {
    case: 'The range starts in a closed quarter and ends in an open one.',
    rule: 'f31e1926e056f340',
    tests: [],
    tasks: ['9.2b'],
  },
  {
    case: 'A surgery exemption runs from May to September.',
    rule: '83ee5d105cf76a21',
    tests: [[DATABASE, 'the shape']],
    // The rollover's "to renew" list.
    tasks: ['9.5b'],
  },
  {
    case: 'Nine students from five classes go to an olympiad. In flu week forty certificates arrive.',
    rule: 'c01fef5ab93eb137',
    tests: [[ROUTES, 'a batch (edge/exemptions, row 8)']],
    tasks: [],
  },
  {
    case: 'A Tutor recorded "illness, certificate" for three absences, but there is no exemption.',
    rule: '546f917a6d36eaaf',
    tests: [[ROUTES, 'the absences with a reason and no exemption (edge/exemptions, row 9)']],
    tasks: [],
  },
  {
    case: 'The reason is a diagnosis and the document is a medical certificate.',
    rule: 'fb32ebd33ac86a56',
    tests: [
      [ROUTES, 'the reason and the document (edge/exemptions, row 10)'],
      [ROUTES, 'the journal grid (07, In the journal; Effect on totals)'],
    ],
    // The journal exports leave the detail and the document out.
    tasks: ['8.9'],
  },
  {
    case: "An exemption is created at 11:40 for today's remaining lessons, or changes last week's marks.",
    rule: '9f74c953a3037404',
    tests: [
      [ROUTES, 'the notices (edge/exemptions, row 11)'],
      [ROUTES, 'the teaching home (edge/exemptions, row 11; 07, "An exemption ends")'],
    ],
    // The cells changing live for an open journal.
    tasks: ['8.3b'],
  },
  {
    case: 'A student with an exemption transfers, leaves, or moves to another branch.',
    rule: '2edbc3e693d8522e',
    tests: [[ROUTES, 'a leaving and a branch move (edge/exemptions, row 12)']],
    tasks: [],
  },
  {
    case: 'The Academic Vice Principal is away for three weeks.',
    rule: 'ea9a408d601a6d97',
    tests: [[ROUTES, 'who enters them (edge/exemptions, row 13)']],
    tasks: [],
  },
  {
    case: 'Someone tries to type 4 or 5 in a cell.',
    rule: '5f04d4d880b2df13',
    tests: [
      [DATABASE, 'the cells (edge/exemptions, row 14: "Someone tries to type 4 or 5")'],
      [ROUTES, 'the journal (07, In the journal)'],
      [GRID, 'a journal'],
    ],
    tasks: [],
  },
];

const root = new URL('../../../../../', import.meta.url);

/** The rows of a Markdown table, the case and the hash of its rule. */
function rowsOf(text: string): { case: string; rule: string }[] {
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

const journal = readFileSync(new URL('docs/spec/07-journal.md', root), 'utf8');
const problemCases = journal.slice(
  journal.indexOf('### Problem cases'),
  journal.indexOf('## Calculation rules'),
);
const edge = readFileSync(new URL('docs/spec/edge-cases/exemptions.md', root), 'utf8');

describe.each([
  ['07-journal.md, Exemptions, Problem cases', problemCases, PROBLEM_CASES],
  ['edge-cases/exemptions.md', edge, EDGE_ROWS],
] as const)('%s', (_name, text, pinned) => {
  it('places every row of the spec, case and rule unchanged, and nothing else', () => {
    expect(rowsOf(text)).toEqual(pinned.map((row) => ({ case: row.case, rule: row.rule })));
  });

  it.each(pinned.map((row) => [row.case, row] as const))(
    'names a test or an owning task for %s',
    (_case, row) => {
      expect(row.tests.length + row.tasks.length).toBeGreaterThan(0);
      for (const task of row.tasks) expect(task).toMatch(/^\d+\.\d+[a-z]?$/);
      for (const [file, name] of row.tests) {
        const url = new URL(file, root);
        expect(existsSync(url), `${file} exists`).toBe(true);
        const source = readFileSync(url, 'utf8');
        const quoted = [`'${name.replace(/'/g, "\\'")}'`, `"${name}"`];
        expect(
          quoted.some((one) => source.includes(`describe(${one}`)),
          `${file} has describe ${name}`,
        ).toBe(true);
      }
    },
  );
});
