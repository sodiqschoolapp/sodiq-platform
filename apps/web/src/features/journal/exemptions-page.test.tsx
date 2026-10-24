import type { Exemption, ExemptionPreview } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

const uid = (n: number): string => `0199e000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// All names are invented.
const EXEMPTION: Exemption = {
  id: uid(1),
  batchId: uid(2),
  student: {
    id: uid(10),
    uid: '2600007',
    firstName: 'Malika',
    lastName: 'Rahimova',
    paternalName: null,
    className: '7 Oxford',
  },
  kind: 'temporary',
  subjects: null,
  startDate: '2026-10-12',
  endDate: '2026-10-20',
  slots: null,
  category: 'illness',
  document: null,
  grantedBy: { accountId: uid(90), login: 'dilnoza.s', name: 'Saidova Dilnoza' },
  grantedAt: '2026-10-21T05:00:00.000Z',
  state: 'ended',
  endCause: null,
  voided: null,
  movedFrom: false,
  version: 1,
};

const PREVIEW: ExemptionPreview = {
  yearEnd: '2027-05-31',
  students: [
    {
      studentId: uid(10),
      auto: [
        {
          lessonId: uid(20),
          date: '2026-10-12',
          start: '08:00',
          subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
          mark: 0,
          numbers: 0,
          locked: true,
        },
      ],
      choose: [
        {
          lessonId: uid(21),
          date: '2026-10-19',
          start: '08:00',
          subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
          mark: 1,
          numbers: 0,
          locked: true,
        },
      ],
      reopen: [],
      overlap: null,
    },
  ],
};

const CLASS = {
  id: uid(30),
  academicYearId: uid(31),
  yearName: '2026–2027',
  yearStatus: 'current',
  grade: 7,
  name: 'Oxford',
  language: 'uz',
  mainRoom: null,
  maxSize: 25,
  students: 1,
  tutor: null,
  acting: null,
  archived: false,
  version: 0,
};

function open(role: 'academic_vice_principal' | 'principal') {
  const calls = fakeApi({
    'GET /api/auth/session': () => json(sessionOf({ assignments: [{ role, branchId: NORTH.id }] })),
    'GET /api/exemptions': () => json({ today: '2026-10-21', items: [EXEMPTION], more: 0 }),
    [`GET /api/exemptions/${EXEMPTION.id}/reason`]: () =>
      json({ id: EXEMPTION.id, category: 'illness', detail: 'A certificate from the clinic' }),
    'GET /api/classes': () => json({ classes: [CLASS] }),
    [`GET /api/classes/${CLASS.id}/members`]: () =>
      json({
        members: [
          {
            id: uid(40),
            studentId: uid(10),
            uid: '2600007',
            firstName: 'Malika',
            lastName: 'Rahimova',
            from: '2026-09-01',
            until: '2027-06-01',
            state: 'current',
          },
        ],
        freeToday: 24,
        freeLeast: 24,
        today: '2026-10-21',
      }),
    'POST /api/exemptions/preview': () => json(PREVIEW),
    'POST /api/exemptions': () => json({ batchId: uid(2), exemptions: [EXEMPTION] }),
  });
  renderApp('/journal/exemptions', 'en');
  return calls;
}

const posts = (calls: ReturnType<typeof fakeApi>, route: string) =>
  calls.filter((call) => call.route === route);

// docs/spec/07-journal.md, Exemptions and Problem cases; docs/spec/edge-cases/exemptions.md
// (task 8.5).
describe('the Exemptions page', () => {
  // `07`, Problem cases: "lists all of them with filters (class, kind, subject, in force, ending
  // this week)" (spec review of the code, should-fix 9). Today is Wednesday 21 October.
  it('filters by class, subject and ending this week', async () => {
    const PE = {
      id: uid(50),
      name: { uz: 'Jismoniy tarbiya', ru: 'Физкультура', en: 'Physical education' },
    };
    const MATHS = { id: uid(51), name: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' } };
    const items: Exemption[] = [
      EXEMPTION,
      {
        ...EXEMPTION,
        id: uid(3),
        student: { ...EXEMPTION.student, id: uid(11), lastName: 'Karimov', className: '7 Kent' },
        subjects: [PE],
        startDate: '2026-10-19',
        endDate: '2026-10-23',
        state: 'in_force',
      },
      {
        ...EXEMPTION,
        id: uid(4),
        student: { ...EXEMPTION.student, id: uid(12), lastName: 'Saidov' },
        subjects: [MATHS],
        startDate: '2026-10-26',
        endDate: '2026-10-30',
        state: 'coming',
      },
    ];
    fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }] })),
      'GET /api/exemptions': () => json({ today: '2026-10-21', items, more: 0 }),
    });
    renderApp('/journal/exemptions', 'en');
    const names = () =>
      [...document.querySelectorAll('tbody tr')].map(
        (row) => /(Rahimova|Karimov|Saidov)/.exec(row.textContent ?? '')?.[1],
      );
    await waitFor(() => {
      expect(names()).toHaveLength(3);
    });
    const choose = (label: string, value: string) => {
      fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
    };
    choose(en.journal.exemptions.class, '7 Kent');
    await waitFor(() => {
      expect(names()).toEqual(['Karimov']);
    });
    choose(en.journal.exemptions.class, '');
    choose(en.journal.exemptions.scope, MATHS.id);
    await waitFor(() => {
      expect(names().sort()).toEqual(['Rahimova', 'Saidov']);
    });
    choose(en.journal.exemptions.scope, '');
    choose(en.journal.exemptions.state, 'ending_this_week');
    await waitFor(() => {
      expect(names()).toEqual(['Karimov']);
    });
  });

  it('lists the exemptions and opens the reason on a click only', async () => {
    const calls = open('principal');
    expect(await screen.findByRole('heading', { name: en.journal.exemptions.title })).toBeDefined();
    expect(screen.queryByRole('button', { name: en.journal.exemptions.new })).toBeNull();
    const row = await waitFor(() => {
      const found = [...document.querySelectorAll('tbody tr')].find((one) =>
        one.textContent?.includes('Rahimova'),
      );
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    expect(posts(calls, `GET /api/exemptions/${EXEMPTION.id}/reason`)).toHaveLength(0);
    fireEvent.click(within(row).getAllByRole('button')[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: en.journal.exemptions.showReason }));
    expect(await screen.findByText('A certificate from the clinic')).toBeDefined();
    expect(posts(calls, `GET /api/exemptions/${EXEMPTION.id}/reason`)).toHaveLength(1);
  });

  it('enters an exemption after the preview, with a choice for the lesson with a present mark', async () => {
    const calls = open('academic_vice_principal');
    fireEvent.click(await screen.findByRole('button', { name: en.journal.exemptions.new }));
    const dialog = await screen.findByRole('form', { name: en.journal.exemptions.new });
    fireEvent.change(
      await within(dialog).findByRole('combobox', { name: en.journal.exemptions.class }),
      { target: { value: CLASS.id } },
    );
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Rahimova Malika' }));
    fireEvent.change(within(dialog).getByLabelText(en.journal.exemptions.startDate), {
      target: { value: '2026-10-12' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.journal.exemptions.endDate), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(within(dialog).getByLabelText(en.journal.exemptions.detail), {
      target: { value: 'A certificate from the clinic' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.journal.exemptions.check }));
    await waitFor(() => {
      expect(posts(calls, 'POST /api/exemptions/preview')).toHaveLength(1);
    });
    const save = await within(dialog).findByRole('button', { name: en.journal.exemptions.save });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(dialog).getByRole('radio', { name: en.journal.exemptions.choice.exempt }),
    );
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(posts(calls, 'POST /api/exemptions')).toHaveLength(1);
    });
    expect(posts(calls, 'POST /api/exemptions')[0]?.body).toMatchObject({
      studentIds: [uid(10)],
      kind: 'temporary',
      subjectIds: null,
      startDate: '2026-10-12',
      endDate: '2026-10-20',
      slots: null,
      category: 'illness',
      choices: [{ studentId: uid(10), lessonId: uid(21), choice: 'exempt' }],
    });
    expect(await screen.findByText(en.journal.exemptions.created)).toBeDefined();
  });
});
