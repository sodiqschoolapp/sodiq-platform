import { describe, expect, it } from 'vitest';
import { namedRecords } from './key-tutor-work.js';

// Task 10.10 (decision 6 of pull request #369; code review finding 8): the ids of a request
// that the check of Tutor work reads, path by path. A route of `KEY_ROUTES` that names a
// lesson, a journal or a record of one does so under one of these names.
const A = '0199a000-0000-7000-8000-00000000000a';
const B = '0199a000-0000-7000-8000-00000000000b';

const none = {
  subjects: [],
  lessons: [],
  journals: [],
  planItems: [],
  planFiles: [],
  unlocks: [],
  planRequests: [],
};

describe('the records a key request names', () => {
  it('reads the lesson and the journal of the path, the comment target, the query and a copy’s source', () => {
    expect(
      namedRecords({
        path: `/api/journal/lessons/${A}/attendance`,
        params: { lessonId: A },
        query: {},
        body: {},
      }),
    ).toEqual({ ...none, lessons: [A] });
    expect(
      namedRecords({
        path: '/api/journal/comments',
        params: {},
        query: {},
        body: { on: { lessonId: A, studentId: B } },
      }),
    ).toEqual({ ...none, lessons: [A] });
    expect(
      namedRecords({
        path: '/api/journal/comments/history',
        params: {},
        query: { journalId: A },
        body: {},
      }),
    ).toEqual({ ...none, journals: [A] });
    expect(
      namedRecords({
        path: `/api/plans/journals/${A}/copy`,
        params: { journalId: A },
        query: {},
        body: { source: { journalId: B } },
      }),
    ).toEqual({ ...none, journals: [A, B] });
    expect(
      namedRecords({ path: '/api/plans/parallel', params: {}, query: { subjectId: A }, body: {} }),
    ).toEqual({ ...none, subjects: [A] });
  });

  it('reads a plan item, a plan file, an unlock and a plan request only on their own paths', () => {
    expect(
      namedRecords({ path: `/api/plans/items/${A}`, params: { itemId: A }, query: {}, body: {} }),
    ).toEqual({
      ...none,
      planItems: [A],
    });
    // On a journal's path the item belongs to the journal already named.
    expect(
      namedRecords({
        path: `/api/plans/journals/${A}/carried/${B}/place`,
        params: { journalId: A, itemId: B },
        query: {},
        body: {},
      }),
    ).toEqual({ ...none, journals: [A] });
    expect(
      namedRecords({ path: `/api/plans/files/${A}`, params: { fileId: A }, query: {}, body: {} }),
    ).toEqual({
      ...none,
      planFiles: [A],
    });
    expect(
      namedRecords({
        path: `/api/journal/unlocks/${A}/decide`,
        params: { unlockId: A },
        query: {},
        body: {},
      }),
    ).toEqual({ ...none, unlocks: [A] });
    expect(
      namedRecords({
        path: `/api/plans/requests/${A}/decide`,
        params: { requestId: A },
        query: {},
        body: {},
      }),
    ).toEqual({ ...none, planRequests: [A] });
  });

  it('ignores what is not an id', () => {
    expect(
      namedRecords({
        path: '/api/journal/journals',
        params: {},
        query: { lessonId: 'x' },
        body: [1, 2],
      }),
    ).toEqual(none);
  });
});
