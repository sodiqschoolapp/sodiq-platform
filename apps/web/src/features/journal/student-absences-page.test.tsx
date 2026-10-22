import type { StudentAbsences } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const OXFORD = uid(20);
const CAMBRIDGE = uid(21);

// All names are invented.
const ANSWER: StudentAbsences = {
  classId: OXFORD,
  from: '2026-10-26',
  to: '2026-10-27',
  classes: [
    { id: OXFORD, name: '7 Oxford' },
    { id: CAMBRIDGE, name: '7 Cambridge' },
  ],
  days: [
    {
      student: {
        id: uid(101),
        uid: '0000101',
        firstName: 'Ali',
        lastName: 'Zokirov',
        paternalName: null,
      },
      date: '2026-10-27',
      lessons: [
        {
          id: uid(60),
          start: 480,
          subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
          mark: 0,
        },
      ],
      presentEarlier: true,
      reason: null,
      canEdit: true,
    },
    {
      student: {
        id: uid(102),
        uid: '0000102',
        firstName: 'Lola',
        lastName: 'Bakirova',
        paternalName: null,
      },
      date: '2026-10-26',
      lessons: [],
      presentEarlier: false,
      reason: {
        studentId: uid(102),
        date: '2026-10-26',
        category: 'family',
        note: 'Wedding',
        changedBy: { accountId: uid(90), login: 'nodira.k', name: 'Karimova Nodira' },
        changedAt: '2026-10-26T05:00:00.000Z',
      },
      canEdit: true,
    },
  ],
};

function open(
  role: 'tutor' | 'head_tutor' | 'teacher' = 'tutor',
  language: 'en' | 'ru' = 'en',
  answer: StudentAbsences = ANSWER,
  path = '/journal/student-absences',
) {
  const calls = fakeApi({
    'GET /api/auth/session': () =>
      json(sessionOf({ language, assignments: [{ role, branchId: NORTH.id }] })),
    'GET /api/journal/student-absences': () => json(answer),
    [`PUT /api/journal/student-absences/${uid(101)}/2026-10-27`]: (body) =>
      json({
        studentId: uid(101),
        date: '2026-10-27',
        ...(body as object),
        changedBy: { accountId: uid(91), login: 'tutor', name: 'Tutor Name' },
        changedAt: '2026-10-27T06:00:00.000Z',
      }),
    'GET /api/journal/journals': () => json({ years: [], yearId: null, journals: [] }),
  });
  renderApp(path, language);
  return calls;
}

const rows = () => [...document.querySelectorAll('tbody tr')];

// docs/spec/edge-cases/journal.md, "A Tutor records why a student was absent"; task 6.3.
describe('Student absences', () => {
  it('lists the days with the lessons missed, the sign of a day at school earlier and the reason', async () => {
    open();
    await screen.findByRole('heading', { name: en.journal.absences.title });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    const [first, second] = rows();
    expect(first?.textContent).toContain('Zokirov');
    expect(first?.textContent).toContain('08:00 Mathematics (0)');
    expect(first?.textContent).toContain(en.journal.absences.atSchoolEarlier);
    expect(first?.textContent).toContain(en.journal.absences.none);
    expect(second?.textContent).toContain(en.journal.absences.categories.family);
    expect(second?.textContent).toContain('Wedding');
  });

  it('sets the reason of a day from the side panel', async () => {
    const calls = open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: /Zokirov/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.journal.absences.setReason }));
    const form = await screen.findByRole('form', { name: en.journal.absences.setReason });
    fireEvent.change(within(form).getByRole('combobox', { name: en.journal.absences.category }), {
      target: { value: 'illness' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: en.journal.absences.note }), {
      target: { value: 'Fever' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.find((call) => call.route.startsWith('PUT /api/journal/student-absences/'))?.body,
      ).toEqual({ category: 'illness', note: 'Fever' });
    });
  });

  it('asks for a reason before saving none', async () => {
    const calls = open();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: /Zokirov/ }));
    fireEvent.click(await screen.findByRole('button', { name: en.journal.absences.setReason }));
    const form = await screen.findByRole('form', { name: en.journal.absences.setReason });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await within(form).findByText(en.journal.absences.noCategory, { selector: '[id]' });
    expect(calls.some((call) => call.route.startsWith('PUT '))).toBe(false);
  });

  it('reads the class chosen from the address and offers the classes, in Russian', async () => {
    const calls = open('head_tutor', 'ru', {
      ...ANSWER,
      days: ANSWER.days.map((day) => ({ ...day, canEdit: false })),
    });
    await screen.findByRole('heading', { name: ru.journal.absences.title });
    fireEvent.change(await screen.findByRole('combobox', { name: ru.journal.absences.class }), {
      target: { value: CAMBRIDGE },
    });
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.route === 'GET /api/journal/student-absences' &&
            call.query === `?classId=${CAMBRIDGE}`,
        ),
      ).toBe(true);
    });
  });

  it('gives no way to change a day the reader may not edit', async () => {
    open('head_tutor', 'en', {
      ...ANSWER,
      days: ANSWER.days.map((day) => ({ ...day, canEdit: false })),
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: /Zokirov/ }));
    await screen.findByText(en.journal.absences.atSchoolEarlier, { selector: 'dt' });
    expect(screen.queryByRole('button', { name: en.journal.absences.setReason })).toBeNull();
  });

  it('is linked from the Journals page for the roles that read the reasons', async () => {
    open('tutor', 'en', ANSWER, '/journal');
    await screen.findByRole('link', { name: en.journal.absences.title });
  });

  it('is not linked from the Journals page for a Teacher', async () => {
    open('teacher', 'en', ANSWER, '/journal');
    await screen.findByRole('heading', { name: en.journal.page.title });
    expect(screen.queryByRole('link', { name: en.journal.absences.title })).toBeNull();
  });
});
