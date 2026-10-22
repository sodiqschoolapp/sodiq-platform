import type { Role, StaffReport, StudentReport } from '@sodiq/shared';
import { createMemoryHistory } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, createShell } from '@/app/shell';
import { createI18n } from '@/i18n/i18n';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, noLive, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import { ThemeStore } from '@/theme/theme';

const uid = (n: number): string => `0199f100-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STUDENT = uid(1);
const PATH = `/people/report/student/${STUDENT}`;
const ROUTE = `POST /api/people/students/${STUDENT}/report`;

// All names, numbers and addresses are invented. Task 2.6b, pull request #76:
// the personal data report of a person (edge/people-roles-accounts, Personal
// data and the audit log: "The Super Admin can produce a personal data report
// per person").
const REPORT: StudentReport = {
  kind: 'student',
  producedAt: '2026-10-10T18:55:00.000Z',
  producedBy: 'Karimova Aziza',
  branch: { id: NORTH.id, name: NORTH.name, timeZone: 'Asia/Tashkent' },
  entries: [
    {
      id: uid(11),
      occurredAt: '2026-10-09T05:00:00.000Z',
      branchId: NORTH.id,
      action: 'student.edit',
      actor: { id: uid(21), name: 'Saidova Dilnoza' },
      assignment: { id: uid(31), role: 'academic_vice_principal' },
      person: null,
      record: { type: 'student', id: STUDENT, name: 'Ismoilova Gulnoza' },
      oldValue: { address: 'Yunusobod 7' },
      newValue: { address: 'Chilonzor 9' },
      details: null,
      reason: null,
      hidden: [],
    },
  ],
  entriesLeftOut: { count: 3, oldestAt: '2026-01-05T05:00:00.000Z' },
  student: {
    id: STUDENT,
    uid: '2607701',
    uids: [{ uid: '2607701', heldFrom: '2026-09-01T05:00:00.000Z', releasedAt: null }],
    firstName: 'Gulnoza',
    lastName: 'Ismoilova',
    paternalName: 'Anvarovna',
    sex: 'female',
    grade: 7,
    startsOn: '2026-09-02',
    photoId: null,
    phone: null,
    email: null,
    birthDate: '2013-04-11',
    documentType: 'birth_certificate',
    documentNumber: 'I-TN 0012346',
    jshshir: null,
    address: 'Chilonzor 9',
    region: 'tashkent_city',
    previousSchool: null,
    diagnosticScore: 71,
    consentSignedOn: null,
    scholarship: { type: 'none', coverage: null, amount: null },
    contracts: [{ number: 'PD-2026/1', signedOn: '2026-08-20' }],
    merged: [],
    statuses: [{ status: 'active', from: '2026-09-02', until: null, cause: 'start', reason: null }],
    account: { createdAt: '2026-09-01T05:00:00.000Z', switchedOn: false },
  },
  // Task 6.1c: the marks and attendance.
  journal: {
    cells: [
      {
        id: uid(61),
        branch: NORTH.name,
        lesson: {
          date: '2026-10-12',
          startsAt: '2026-10-12T03:00:00.000Z',
          subject: { uz: 'Matematika', ru: 'Математика', en: 'Mathematics' },
          taughtTo: '7 Oxford',
          cancelled: false,
        },
        attendance: false,
        workKind: 'classwork',
        total: 40,
        value: 35,
        version: 2,
        changedAt: '2026-10-12T05:00:00.000Z',
        changedHow: 'correction',
        changedBy: { accountId: uid(62), login: 'm.usmonova', name: 'Usmonova Malika' },
      },
    ],
    history: [
      {
        id: uid(63),
        branch: NORTH.name,
        changedAt: '2026-10-12T05:00:00.000Z',
        lesson: null,
        attendance: true,
        workKind: null,
        before: 1,
        after: 2,
        changedHow: 'entry',
        changedBy: { accountId: uid(62), login: 'm.usmonova', name: null },
      },
    ],
    historyLeftOut: { count: 3, oldestAt: '2026-09-02T05:00:00.000Z' },
  },
  relatives: [
    {
      id: uid(51),
      fullName: 'Rustam Ismoilov',
      phone: '+998901112233',
      extraPhones: [],
      workplace: 'Invented factory',
      email: null,
      phoneInvalidSince: null,
      archivedAt: '2026-10-01T09:00:00.000Z',
      merged: false,
      account: null,
      links: [
        {
          relationship: 'father',
          mainContact: false,
          portalAccess: true,
          receivesNotices: true,
          linkedAt: '2026-09-02T08:00:00.000Z',
          unlinkedAt: '2026-10-01T09:00:00.000Z',
        },
      ],
    },
  ],
};

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

function openReport(answer: () => Response = () => json(REPORT), language: 'en' | 'ru' = 'en') {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs('super_admin', language)),
    [ROUTE]: answer,
  });
}

const produced = (calls: { route: string }[]) => calls.filter((call) => call.route === ROUTE);

const sheet = () => screen.getByRole('main').querySelector('[data-report]') as HTMLElement;

afterEach(() => {
  vi.restoreAllMocks();
  delete document.body.dataset.printing;
});

describe('the personal data report page', () => {
  it('shows every part with the labels of the forms and the codes by name, in Russian', async () => {
    const calls = openReport(undefined, 'ru');
    renderApp(PATH, 'ru');
    await screen.findByRole('heading', { name: 'Ismoilova Gulnoza', level: 2 });
    const report = within(sheet());
    expect(report.getByRole('heading', { name: ru.people.report.recordTitle })).toBeTruthy();
    const term = (label: string) =>
      report.getAllByText(label, { selector: 'dt' })[0]?.nextElementSibling?.textContent;
    expect(term(ru.people.students.documentType)).toBe(
      ru.people.students.documentTypes.birth_certificate,
    );
    expect(term(ru.people.students.region)).toBe(ru.people.students.regions.tashkent_city);
    expect(term(ru.people.students.consentSignedOn)).toBe(ru.people.students.noConsent);
    expect(report.getByRole('heading', { name: 'Rustam Ismoilov', level: 4 })).toBeTruthy();
    expect(term(ru.people.relatives.relationship)).toContain(
      ru.people.relatives.relationships.father,
    );
    // The entry with the label of the form, the old and the new value.
    expect(
      report.getByText(`${ru.people.students.address}: Yunusobod 7 → Chilonzor 9`),
    ).toBeTruthy();
    expect(report.getByText(/PD-2026\/1/)).toBeTruthy();
    expect(produced(calls)).toHaveLength(1);
  });

  // Task 6.1c, decision 10: the marks and attendance and the journal history.
  it('shows the cells with who changed them, and the journal history with the lines left out', async () => {
    openReport();
    renderApp(PATH);
    await screen.findByRole('heading', { name: 'Ismoilova Gulnoza', level: 2 });
    const report = within(sheet());
    expect(report.getByRole('heading', { name: en.people.report.journalTitle })).toBeTruthy();
    const cell = sheet().querySelector('[data-journal="cells"] li');
    expect(cell?.textContent).toContain('Mathematics');
    expect(cell?.textContent).toContain('7 Oxford');
    expect(cell?.textContent).toContain(`${en.journal.classwork}: 35 / 40`);
    expect(cell?.textContent).toContain('Usmonova Malika');
    expect(cell?.textContent).toContain(en.journal.changes.correction);
    const line = sheet().querySelector('[data-journal="history"] li');
    // A deleted lesson, a person with no readable name by login, the mark in words.
    expect(line?.textContent).toContain(en.journal.lessonGone);
    expect(line?.textContent).toContain('m.usmonova');
    expect(line?.textContent).toContain(
      `1 (${en.journal.marks.present}) → 2 (${en.journal.marks.late})`,
    );
    expect(report.getByText(/^Older lines not shown: 3/)).toBeTruthy();
  });

  it('names the entries left out with their count and the oldest moment', async () => {
    openReport();
    renderApp(PATH);
    await screen.findByRole('heading', { name: 'Ismoilova Gulnoza', level: 2 });
    expect(
      within(sheet()).getByText((text) => text.startsWith('3 older entries, from ')),
    ).toBeTruthy();
  });

  it('produces one report for one open, also when React runs the effect twice (decision 8)', async () => {
    const calls = openReport();
    const i18n = createI18n('en');
    const shell = createShell(i18n, createMemoryHistory({ initialEntries: [PATH] }), noLive);
    render(
      <StrictMode>
        <App i18n={i18n} shell={shell} theme={new ThemeStore()} />
      </StrictMode>,
    );
    await screen.findByRole('heading', { name: 'Ismoilova Gulnoza', level: 2 });
    expect(produced(calls)).toHaveLength(1);
  });

  it('keeps the answer in no cache once the page is left', async () => {
    openReport();
    const shell = renderApp(PATH);
    await screen.findByRole('heading', { name: 'Ismoilova Gulnoza', level: 2 });
    await shell.router.navigate({ to: '/' });
    await waitFor(() => {
      expect(shell.queryClient.getMutationCache().getAll()).toHaveLength(0);
    });
    const cached = JSON.stringify(
      shell.queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    );
    expect(cached).not.toContain('I-TN 0012346');
  });

  it('prints the report alone and clears the print mode afterwards', async () => {
    openReport();
    let mode: string | undefined;
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      mode = document.body.dataset.printing;
    });
    renderApp(PATH);
    await screen.findByRole('heading', { name: 'Ismoilova Gulnoza', level: 2 });
    fireEvent.click(screen.getByRole('button', { name: en.people.report.print }));
    await waitFor(() => {
      expect(print).toHaveBeenCalledTimes(1);
    });
    expect(mode).toBe('report');
    expect(
      document.body.querySelector(':scope > [data-report-sheet] thead [data-letterhead]'),
    ).not.toBeNull();
    window.dispatchEvent(new Event('afterprint'));
    await waitFor(() => {
      expect(document.body.dataset.printing).toBeUndefined();
    });
  });

  it('shows a failure with a retry, which produces the report again', async () => {
    let asked = 0;
    const calls = openReport(() =>
      (asked += 1) === 1
        ? json({ error: { code: 'internal', message: 'down', requestId: uid(99) } }, 500)
        : json(REPORT),
    );
    renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: en.problems.retry }));
    await screen.findByRole('heading', { name: 'Ismoilova Gulnoza', level: 2 });
    expect(produced(calls)).toHaveLength(2);
  });

  it('shows no page for an unknown kind of person', async () => {
    const calls = openReport();
    renderApp(`/people/report/teacher/${STUDENT}`);
    await screen.findByRole('heading', { name: en.problems.notFoundTitle });
    expect(screen.queryByRole('heading', { name: 'Ismoilova Gulnoza' })).toBeNull();
    expect(calls.filter((call) => call.route.includes('/report'))).toHaveLength(0);
  });
});

// The staff report draws the account, the roles and the availability of every branch.
describe('the personal data report of a staff member', () => {
  it('shows the roles and the hours of each branch', async () => {
    const staffId = uid(2);
    const report: StaffReport = {
      kind: 'staff',
      producedAt: REPORT.producedAt,
      producedBy: REPORT.producedBy,
      branch: REPORT.branch,
      entries: [],
      entriesLeftOut: null,
      staff: {
        id: staffId,
        staffId: 'S-260007',
        firstName: 'Sarvinoz',
        lastName: 'Yusupova',
        fatherName: null,
        sex: 'female',
        birthDate: '1989-06-07',
        jshshir: null,
        educationLevel: 'master',
        phone: '+998932000001',
        email: null,
        admissionDate: '2026-09-01',
        contractType: 'full_time',
        contractDate: null,
        weeklyLessons: 18,
        dailyLessons: 5,
        photoId: null,
        branches: [
          { name: 'North', main: true },
          { name: 'South', main: false },
        ],
        divisions: [],
        subjects: [],
        languages: ['uz'],
        statuses: [{ status: 'active', from: '2026-09-01', until: null }],
        absences: [],
        availability: [
          {
            branch: 'South',
            from: '2026-09-01',
            until: null,
            ranges: [{ weekday: 3, startMinutes: 480, endMinutes: 780 }],
          },
        ],
      },
      sameAsRelative: null,
      account: {
        login: 's.yusupova',
        createdAt: '2026-09-01T05:00:00.000Z',
        lastSignInAt: '2026-10-09T04:00:00.000Z',
        neverUsed: false,
        language: 'uz',
        lockedAt: null,
        lockReason: null,
        mustChangePassword: false,
        passwordChangedAt: null,
        passwordResetAt: null,
        secondStepOn: true,
        roles: [
          {
            role: 'teacher',
            branch: 'South',
            from: '2026-09-01T05:00:00.000Z',
            until: null,
            subjects: [],
          },
        ],
      },
    };
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('super_admin')),
      [`POST /api/people/staff/${staffId}/report`]: () => json(report),
    });
    renderApp(`/people/report/staff/${staffId}`);
    await screen.findByRole('heading', { name: 'Yusupova Sarvinoz', level: 2 });
    const found = within(sheet());
    expect(found.getByRole('heading', { name: /^South, / })).toBeTruthy();
    expect(found.getByText('08:00–13:00')).toBeTruthy();
    expect(found.getByText('s.yusupova')).toBeTruthy();
    expect(found.getByText((text) => text.startsWith('South; '))).toBeTruthy();
    expect(found.getByText(en.roles.teacher, { selector: 'dt' })).toBeTruthy();
  });
});
