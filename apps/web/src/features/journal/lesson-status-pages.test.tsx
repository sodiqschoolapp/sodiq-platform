import type { Discipline, OrphanLessons } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e700-0000-7000-8000-${String(n).padStart(12, '0')}`;

const SUBJECT = {
  id: uid(10),
  names: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
  colour: 'blue' as const,
};
const UNIT = { kind: 'class' as const, id: uid(20), name: '7 Oxford' };

// All names are invented. Task 8.7, pull request #225: the counts per teacher (07, Lesson
// status; 08, Journal discipline) and the orphan lessons (edge/journal, Locks).
const COUNTS: Discipline = {
  from: '2026-10-12',
  to: '2026-10-27',
  departments: [{ id: uid(30), names: { uz: 'STEAM', ru: 'STEAM', en: 'STEAM' } }],
  teachers: [
    {
      teacher: { id: uid(40), name: 'Karimova Aziza' },
      held: 3,
      notStarted: 0,
      inProgress: 1,
      complete: 1,
      lockedIncomplete: 1,
      noAttendance: 1,
      noTopic: 2,
      worksMissing: 1,
      unplanned: 0,
      lateEntries: 4,
    },
  ],
};

const ORPHANS: OrphanLessons = {
  lessons: [
    {
      lesson: {
        id: uid(50),
        journalId: uid(51),
        date: '2026-10-12',
        start: 480,
        unit: UNIT,
        subject: SUBJECT,
        status: 'locked_incomplete',
      },
      teacher: { id: uid(41), name: 'Rahimov Bobur' },
      assignment: null,
    },
  ],
  teachers: [{ id: uid(42), name: 'Yusupova Dilnoza' }],
};

const vice = () =>
  json(sessionOf({ assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }] }));

describe('the counts per teacher', () => {
  it('shows each teacher’s counts for the range and the department of the address', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': vice,
      'GET /api/journal/discipline': () => json(COUNTS),
    });
    renderApp('/journal/discipline?from=2026-10-12&to=2026-10-27&department=' + uid(30));
    await screen.findByRole('heading', { name: en.journal.discipline.title });
    await waitFor(() => {
      const rows = [...document.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
      );
      expect(rows).toEqual([['Karimova Aziza', '3', '0', '1', '1', '1', '1', '2', '1', '0', '4']]);
    });
    const query = calls.find((call) => call.route === 'GET /api/journal/discipline')?.query ?? '';
    expect(new URLSearchParams(query).get('from')).toBe('2026-10-12');
    expect(new URLSearchParams(query).get('departmentId')).toBe(uid(30));
  });

  it('tells a refused range in words', async () => {
    fakeApi({
      'GET /api/auth/session': vice,
      'GET /api/journal/discipline': () =>
        json(
          {
            error: {
              code: 'discipline_range',
              message: 'ENGLISH TEXT FOR THE DEVELOPER',
              requestId: 'test-request',
            },
          },
          409,
        ),
    });
    renderApp('/journal/discipline?from=2026-09-01&to=2026-12-31');
    expect(await screen.findByText(en.errors.discipline_range)).not.toBeNull();
  });
});

describe('the orphan lessons', () => {
  it('lists the lessons and assigns a teacher with days and a reason', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': vice,
      'GET /api/journal/orphans': () => json(ORPHANS),
      [`POST /api/journal/orphans/${uid(50)}/assign`]: () =>
        json({
          id: uid(60),
          teacher: { id: uid(42), name: 'Yusupova Dilnoza' },
          reason: 'Completes the lesson',
          days: 2,
          openUntil: '2026-10-29T19:00:00.000Z',
          assignedAt: '2026-10-27T07:00:00.000Z',
        }),
    });
    renderApp(`/journal/orphans?open=${uid(50)}`);
    const panel = await screen.findByRole('form', {
      name: /Assign a teacher to/,
    });
    fireEvent.change(within(panel).getByLabelText(en.journal.orphans.days), {
      target: { value: '2' },
    });
    fireEvent.change(within(panel).getByLabelText(en.journal.orphans.reason), {
      target: { value: 'Completes the lesson' },
    });
    fireEvent.submit(panel);
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === `POST /api/journal/orphans/${uid(50)}/assign`)
          .map((call) => call.body),
      ).toEqual([{ staffId: uid(42), days: 2, reason: 'Completes the lesson' }]);
    });
    await waitFor(() => {
      const rows = [...document.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
      );
      expect(rows[0]?.slice(1, 3)).toEqual([
        'Rahimov Bobur',
        en.journal.lessonStatus.locked_incomplete,
      ]);
    });
  });

  it('says when no lesson is orphan', async () => {
    fakeApi({
      'GET /api/auth/session': vice,
      'GET /api/journal/orphans': () => json({ lessons: [], teachers: [] }),
    });
    renderApp('/journal/orphans');
    expect(await screen.findByText(en.journal.orphans.empty)).not.toBeNull();
  });
});
