import type { Subject } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { offeredSubjects } from './offered-subjects';

const STEAM = '01980000-0000-7000-8000-000000000001';
const NATIONAL = '01980000-0000-7000-8000-000000000002';

/** The fields the choice reads; the rest of a subject plays no part in it. */
const subject = (
  id: string,
  fields: {
    departmentId: string;
    grades: number[];
    archived?: boolean;
    moveTo?: string;
  },
): Subject =>
  ({
    id,
    departmentId: fields.departmentId,
    departmentMove:
      fields.moveTo === undefined ? null : { departmentId: fields.moveTo, startsOn: '2026-11-09' },
    archivedAt: fields.archived === true ? '2026-10-01T09:00:00.000Z' : null,
    grades: fields.grades,
  }) as unknown as Subject;

const choice = (subjects: readonly Subject[], held: readonly string[] = []) =>
  offeredSubjects(subjects, STEAM, held).map((one) => [one.id, one.grades]);

// Task 9.4e, decision 1 (04, Academic): "a teacher's subjects come from one department,
// except subjects taught only in grades 0–4, which may come from any department".
describe('the subjects a Teaching form offers', () => {
  it('offers the subjects of the department with every grade', () => {
    expect(choice([subject('maths', { departmentId: STEAM, grades: [0, 1, 5, 7] })])).toEqual([
      ['maths', [0, 1, 5, 7]],
    ]);
  });

  it('offers a subject of another department with its grades 0–4 only', () => {
    expect(
      choice([
        subject('native', { departmentId: NATIONAL, grades: [0, 1, 2, 3, 4, 5, 6] }),
        subject('history', { departmentId: NATIONAL, grades: [5, 6, 7] }),
      ]),
    ).toEqual([['native', [0, 1, 2, 3, 4]]]);
  });

  it("reads a planned move's department, as the server's rule does", () => {
    expect(
      choice([
        subject('moving', { departmentId: NATIONAL, grades: [7], moveTo: STEAM }),
        subject('leaving', { departmentId: STEAM, grades: [7], moveTo: NATIONAL }),
      ]),
    ).toEqual([['moving', [7]]]);
  });

  it('leaves out an archived subject unless the record holds it', () => {
    const archived = [
      subject('old', { departmentId: STEAM, grades: [7], archived: true }),
      subject('oldPrimary', { departmentId: NATIONAL, grades: [1, 7], archived: true }),
    ];
    expect(choice(archived)).toEqual([]);
    expect(choice(archived, ['old', 'oldPrimary'])).toEqual([
      ['old', [7]],
      ['oldPrimary', [1]],
    ]);
  });

  it('keeps a held subject of another department with no grade 0–4 as it is', () => {
    expect(
      choice([subject('history', { departmentId: NATIONAL, grades: [5, 6] })], ['history']),
    ).toEqual([['history', [5, 6]]]);
  });
});
