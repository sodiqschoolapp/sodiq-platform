import {
  EXPORT_TEXTS,
  STUDENT_EXPORT_COLUMNS,
  STUDENT_LIST_EXPORT_COLUMNS,
  type Role,
  type StudentDetail,
  type StudentListItem,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const uid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/students';
const grade = (n: number) => en.setup.subjects.grade.replace('{{grade}}', String(n));

// All names are invented. Task 2.4a, pull request #67.
const OTKIR: StudentListItem = {
  id: uid(1),
  uid: '2607001',
  firstName: 'Oʻtkir',
  lastName: 'Rahimov',
  paternalName: 'Anvarovich',
  sex: 'male',
  grade: 7,
  startsOn: '2026-09-02',
  photoId: null,
  consentMissing: null,
  status: 'active',
  planned: null,
  version: 1,
};

const ZARINA: StudentListItem = {
  id: uid(2),
  uid: '2507014',
  firstName: 'Zarina',
  lastName: 'Saidova',
  paternalName: null,
  sex: 'female',
  grade: 8,
  startsOn: '2026-11-02',
  photoId: null,
  consentMissing: null,
  status: null,
  planned: null,
  version: 1,
};

// Task 2.4b-1: an inactive student, who left on 30 September.
const LOLA: StudentListItem = {
  id: uid(3),
  uid: '2607030',
  firstName: 'Lola',
  lastName: 'Karimova',
  paternalName: null,
  sex: 'female',
  grade: 7,
  startsOn: '2026-09-02',
  photoId: null,
  consentMissing: null,
  status: 'inactive',
  planned: null,
  version: 2,
};

const detailOf = (row: StudentListItem, fields: Partial<StudentDetail> = {}): StudentDetail => ({
  ...row,
  contact: { phone: '+998901234567', email: null },
  identity: {
    birthDate: '2014-03-02',
    documentType: 'birth_certificate',
    documentNumber: 'I-TN1234567',
    jshshir: '31403141234567',
    address: 'Navoiy koʻchasi 5',
    region: 'tashkent_city',
  },
  identityHidden: false,
  financial: {
    contracts: [{ id: uid(31), number: 'SQ-2026/017', signedOn: '2026-08-20' }],
    scholarship: { type: 'merit', coverage: 'partial', amount: 1500000 },
    previousSchool: '12-maktab',
    diagnosticScore: 74,
    consentSignedOn: null,
  },
  statuses: [{ status: 'active', from: '2026-09-02', until: null, cause: 'start', reason: null }],
  canEdit: true,
  canArchive: false,
  canRestoreGraduated: false,
  deletable: false,
  today: '2026-10-10',
  ...fields,
});

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

/** The cells of each row, without the checkbox column of the bulk actions (task 2.4b-1). */
const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')]
      .filter((cell) => cell.querySelector('input[type="checkbox"]') === null)
      .map((cell) => cell.textContent ?? ''),
  );

/** The relatives of Oʻtkir (task 2.5a): his mother, the main contact. */
const MOTHER = {
  relatives: [
    {
      relativeId: uid(40),
      fullName: 'Dilfuza Rahimova',
      phone: '+998901112233',
      extraPhones: [],
      relationship: 'mother',
      mainContact: true,
      portalAccess: null,
      receivesNotices: null,
      identity: null,
    },
  ],
  canEdit: false,
};

function openList(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
  detail: Partial<StudentDetail> = {},
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/people/students': () =>
      json({
        students: [OTKIR, ZARINA],
        canArchive: role === 'academic_vice_principal' || role === 'super_admin',
        exportGroups: [],
        readsFinancial: false,
        today: '2026-10-10',
      }),
    [`GET /api/people/students/${OTKIR.id}`]: () => json(detailOf(OTKIR, detail)),
    // Task 2.5a: the Relatives tab of the Contact readers.
    [`GET /api/people/students/${OTKIR.id}/relatives`]: () => json(MOTHER),
    ...extra,
  });
}

// docs/spec/04-people.md, Student record: "Student list columns, in this
// order: checkbox, number, photo, UID, name and surname, class ..., groups,
// tutor, status"; the photo comes with 2.4b.
describe('the student list', () => {
  it('lists the students with the columns of the spec and no phone', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.students.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()).toEqual([
      [
        // The photo column (task 2.4b-2): the initials while there is no photo.
        'OR',
        '2607001',
        'Rahimov Oʻtkir',
        en.people.students.gradeNoClass.replace('{{grade}}', grade(7)),
        '—',
        '—',
        en.people.students.statuses.active,
      ],
      [
        'ZS',
        '2507014',
        'Saidova Zarina',
        en.people.students.gradeNoClass.replace('{{grade}}', grade(8)),
        '—',
        '—',
        en.people.students.notStarted,
      ],
    ]);
    expect(document.body.textContent).not.toContain('+998');
  });

  it.each(['Ўткир', "o'tkir", 'OTKIR', '2607001'])(
    'finds a student by a look-alike spelling or the UID: %s (answer 18)',
    async (typed) => {
      openList('academic_vice_principal');
      renderApp(`${PATH}?q=${encodeURIComponent(typed)}`);
      await waitFor(() => {
        expect(rowsDrawn()).toHaveLength(1);
      });
      expect(rowsDrawn()[0]?.[2]).toBe('Rahimov Oʻtkir');
    },
  );

  it('filters by grade', async () => {
    openList('principal');
    renderApp(`${PATH}?f=${encodeURIComponent(JSON.stringify({ grade: '8' }))}`);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[2]).toBe('Saidova Zarina');
  });

  it('is in Russian', async () => {
    openList('principal', {}, 'ru');
    renderApp(PATH, 'ru');
    await screen.findByRole('heading', { name: ru.people.students.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()[0]?.[3]).toBe(
      ru.people.students.gradeNoClass.replace(
        '{{grade}}',
        ru.setup.subjects.grade.replace('{{grade}}', '7'),
      ),
    );
    expect(rowsDrawn()[0]?.[6]).toBe(ru.people.students.statuses.active);
  });

  it('offers the add button to the Academic Vice Principal and not to the Principal', async () => {
    openList('principal');
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.students.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(screen.queryByRole('button', { name: en.people.students.add })).toBeNull();
  });
});

describe('the profile of a student', () => {
  it('shows the Principal the identity behind a logged show, and the contract tab', async () => {
    const calls = openList(
      'principal',
      {
        [`POST /api/people/students/${OTKIR.id}/identity`]: () =>
          json({
            birthDate: '2014-03-02',
            documentType: 'birth_certificate',
            documentNumber: 'I-TN1234567',
            jshshir: '31403141234567',
            address: 'Navoiy koʻchasi 5',
            region: 'tashkent_city',
          }),
      },
      'en',
      { identity: null, identityHidden: true, canEdit: false },
    );
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: en.people.students.showIdentity });
    expect(within(panel).getAllByText(en.people.students.hidden)).toHaveLength(2);
    expect(within(panel).queryByRole('form')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: en.people.students.showIdentity }));
    expect(await within(panel).findByText('31403141234567')).toBeDefined();
    expect(calls.filter((call) => call.route.endsWith('/identity'))).toHaveLength(1);

    fireEvent.click(within(panel).getByRole('radio', { name: en.people.students.tabs.contract }));
    expect(await within(panel).findByText(/SQ-2026\/017/)).toBeDefined();
    expect(within(panel).getByText(en.people.students.noConsent)).toBeDefined();
  });

  // Issue #39, hand test of 13 October 2026, finding 5: each tab holds only
  // its own content; the status, the record and the UID belong to Overview.
  it('switches the whole panel with its tabs', async () => {
    openList('academic_vice_principal', {}, 'en', { canEdit: true });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const titles = () => [...panel.querySelectorAll('h3')].map((title) => title.textContent);
    const tabs = await within(panel).findByRole('radiogroup');

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.overview }));
    await waitFor(() => {
      expect(titles()).toEqual(
        expect.arrayContaining([
          en.people.students.statusTitle,
          en.people.students.recordTitle,
          en.people.students.uidTitle,
        ]),
      );
    });

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.contract }));
    expect(await within(panel).findByText(/SQ-2026\/017/)).toBeDefined();
    expect(titles()).not.toContain(en.people.students.statusTitle);
    expect(titles()).not.toContain(en.people.students.recordTitle);
    expect(titles()).not.toContain(en.people.students.uidTitle);
    expect(within(panel).queryByRole('form')).toBeNull();

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.relatives }));
    expect(await within(panel).findByText('Dilfuza Rahimova')).toBeDefined();
    expect(titles()).not.toContain(en.people.students.statusTitle);
    expect(titles()).not.toContain(en.people.students.recordTitle);
  });

  it('asks before a tab takes typed changes of the record away', async () => {
    openList('academic_vice_principal', {}, 'en', { canEdit: true });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const tabs = await within(panel).findByRole('radiogroup');
    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.overview }));
    const record = await within(panel).findByRole('form', { name: 'Oʻtkir Rahimov' });
    const field = within(record).getByLabelText(en.people.students.firstName);
    fireEvent.change(field, { target: { value: 'Oʻtkirbek' } });

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.contract }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(within(panel).getByLabelText<HTMLInputElement>(en.people.students.firstName).value).toBe(
      'Oʻtkirbek',
    );
  });

  it('draws only the groups a Head Tutor reads: no contract tab, no documents', async () => {
    openList('head_tutor', {}, 'en', {
      identity: null,
      financial: null,
      canEdit: false,
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    expect(await within(panel).findByText('+998 90 123 45 67')).toBeDefined();
    // The Overview and the Relatives tab (task 2.5a), no contract tab.
    const tabs = await within(panel).findByRole('radiogroup');
    expect(
      within(tabs)
        .getAllByRole('radio')
        .map((one) => one.closest('label')?.textContent),
    ).toEqual([en.people.students.tabs.overview, en.people.students.tabs.relatives]);
    expect(within(panel).queryByText(en.people.students.birthDate)).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en.people.students.showIdentity }),
    ).toBeNull();
  });
});

describe('adding a student', () => {
  async function fillAndSave() {
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.uid, '2606001');
    type(en.people.students.lastName, 'Rahimov');
    type(en.people.students.firstName, "O'tkir");
    type(en.people.students.sex, 'male');
    type(en.people.students.birthDate, '2014-03-02');
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    type(en.people.students.contractNumber, 'SQ-2026/099');
    type(en.people.students.contractSignedOn, '2026-08-20');
    // Task 2.5a: the relative, typed phone first.
    type(en.people.relatives.phone, '+998 90 111 22 33');
    type(en.people.relatives.fullName, 'Dilfuza Rahimova');
    type(en.people.relatives.relationship, 'mother');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    return form;
  }

  // Finding 25 of the hand test of 13 October 2026 (task 2.7b-1, decision 7).
  it('names the set of the grade in the UID warning when the server names it', async () => {
    openList('academic_vice_principal', {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/students': () =>
        Response.json(
          {
            error: {
              code: 'uid_set_mismatch',
              message: 'x',
              requestId: 'r',
              details: [{ path: 'uid', code: 'uid_set', message: 'x', expected: '2607' }],
            },
          },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    await fillAndSave();

    const dialog = await screen.findByRole('alertdialog', { name: en.people.students.setTitle });
    expect(
      within(dialog).getByText(
        en.people.students.setTextNamed.replace('{{grade}}', '7').replace('{{set}}', '2607'),
      ),
    ).toBeDefined();
  });

  // Owner's answer to finding 27 (task 2.7b-1, decision 3): a list of names
  // inside a message is a list, surname first.
  it('names the students of the same name and date of birth surname first', async () => {
    openList('academic_vice_principal', {
      'POST /api/people/students/check': () =>
        json({
          sameNameAndBirth: [
            {
              id: uid(41),
              uid: '2607041',
              firstName: 'Oʻtkir',
              lastName: 'Rahimov',
              status: 'active',
            },
          ],
          elsewhere: false,
        }),
    });
    renderApp(PATH);
    await fillAndSave();

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Rahimov Oʻtkir (2607041)')).toBeDefined();
  });

  it('warns about a student of the same name elsewhere, then about the UID set, and saves when told to', async () => {
    let posts = 0;
    const calls = openList('academic_vice_principal', {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: true }),
      'POST /api/people/students': (body) => {
        posts += 1;
        return (body as { confirmUidSet: boolean }).confirmUidSet
          ? json(detailOf({ ...OTKIR, id: uid(9), uid: '2606001' }), 201)
          : Response.json(
              { error: { code: 'uid_set_mismatch', message: 'x', requestId: 'r' } },
              { status: 409 },
            );
      },
    });
    renderApp(PATH);
    await fillAndSave();

    const first = await screen.findByRole('alertdialog');
    expect(within(first).getByText(en.people.students.duplicateElsewhere)).toBeDefined();
    expect(posts).toBe(0);
    fireEvent.click(within(first).getByRole('button', { name: en.people.students.saveAnyway }));

    const second = await screen.findByRole('alertdialog', {
      name: en.people.students.setTitle,
    });
    // No set named by the server: the text without it (task 2.7b-1).
    expect(within(second).getByText(en.people.students.setText)).toBeDefined();
    fireEvent.click(within(second).getByRole('button', { name: en.people.students.saveAnyway }));
    await waitFor(() => {
      expect(posts).toBe(2);
    });
    const sent = calls.filter((call) => call.route === 'POST /api/people/students');
    expect(sent.map((call) => (call.body as { confirmUidSet: boolean }).confirmUidSet)).toEqual([
      false,
      true,
    ]);
    expect(sent[0]?.body).toMatchObject({
      uid: '2606001',
      firstName: 'Oʻtkir',
      grade: 7,
      phone: null,
      scholarship: { type: 'none', coverage: null, amount: null },
      contract: { number: 'SQ-2026/099', signedOn: '2026-08-20' },
    });
  });

  it('names the student of this branch who holds the UID, and says only "another branch" otherwise', async () => {
    let elsewhere = false;
    openList('academic_vice_principal', {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/students': () =>
        Response.json(
          {
            error: {
              code: 'student_value_taken',
              message: 'x',
              requestId: 'r',
              details: [
                elsewhere
                  ? { path: 'uid', code: 'held_elsewhere', message: 'x' }
                  : { path: 'uid', code: 'already_exists', message: 'x', recordId: OTKIR.id },
              ],
            },
          },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const form = await fillAndSave();
    expect(
      await within(form).findByText(
        en.people.students.takenHere.replace('{{student}}', 'Rahimov Oʻtkir (2607001)'),
      ),
    ).toBeDefined();
    elsewhere = true;
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.people.students.takenElsewhere)).toBeDefined();
  });
});

describe('editing a student', () => {
  it('says "another student of this branch" for a holder the list does not hold, and reads the list again', async () => {
    const calls = openList('academic_vice_principal', {
      [`PUT /api/people/students/${OTKIR.id}`]: () =>
        Response.json(
          {
            error: {
              code: 'student_value_taken',
              message: 'x',
              requestId: 'r',
              details: [
                { path: 'jshshir', code: 'already_exists', message: 'x', recordId: uid(5) },
              ],
            },
          },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await within(panel).findByRole('form', { name: 'Oʻtkir Rahimov' });
    const lists = () => calls.filter((call) => call.route === 'GET /api/people/students').length;
    const before = lists();
    fireEvent.change(within(form).getByLabelText(en.people.students.jshshir), {
      target: { value: '31403141234568' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.people.students.takenHereUnknown)).toBeDefined();
    await waitFor(() => {
      expect(lists()).toBeGreaterThan(before);
    });
  });
});

// Task 2.4b-1, pull request #68: docs/spec/04-people.md, Movements;
// docs/spec/edge-cases/students-classes-groups.md.
describe('leaving, return and delete', () => {
  const LEFT_DETAIL = (fields: Partial<StudentDetail> = {}) =>
    detailOf(OTKIR, {
      status: 'active',
      planned: { status: 'inactive', from: '2026-10-21' },
      version: 2,
      statuses: [
        { status: 'active', from: '2026-09-02', until: '2026-10-21', cause: 'start', reason: null },
        {
          status: 'inactive',
          from: '2026-10-21',
          until: null,
          cause: 'leaving',
          reason: 'Moved to another city',
        },
      ],
      canArchive: true,
      ...fields,
    });

  it('records a leaving after a confirmation naming the student, with the version read', async () => {
    let left = false;
    const calls = openList('academic_vice_principal', {
      [`GET /api/people/students/${OTKIR.id}`]: () =>
        json(left ? LEFT_DETAIL() : detailOf(OTKIR, { canArchive: true, deletable: true })),
      [`POST /api/people/students/${OTKIR.id}/leaving`]: () => {
        left = true;
        return json(LEFT_DETAIL());
      },
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await within(panel).findByRole('form', { name: en.people.students.leaveTitle });
    fireEvent.change(within(form).getByLabelText(en.people.students.lastDay), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Moved to another city' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.leaveConfirmTitle,
    });
    expect(within(dialog).getByText('Oʻtkir Rahimov')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.leaveAction }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/leaving'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/leaving'))?.body).toEqual({
      lastDay: '2026-10-20',
      reason: 'Moved to another city',
      version: 1,
    });
    expect(
      await within(panel).findByRole('button', { name: en.people.students.cancelLeaving }),
    ).toBeDefined();
    expect(within(panel).getByText(/Moved to another city/)).toBeDefined();
  });

  it('shows no change to a reader without the archive right, and the cause without a reason', async () => {
    openList('head_tutor', {}, 'en', {
      ...LEFT_DETAIL({ canArchive: false }),
      identity: null,
      financial: null,
      canEdit: false,
      statuses: [
        { status: 'active', from: '2026-09-02', until: '2026-10-21', cause: 'start', reason: null },
        { status: 'inactive', from: '2026-10-21', until: null, cause: 'leaving', reason: null },
      ],
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    expect(await within(panel).findByText(en.people.students.causes.leaving)).toBeDefined();
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en.people.students.cancelLeaving }),
    ).toBeNull();
  });

  it('marks a scheduled leaving in the list, in Russian too', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal', 'ru')),
      'GET /api/people/students': () =>
        json({
          students: [{ ...OTKIR, planned: { status: 'inactive', from: '2026-10-21' }, version: 2 }],
          canArchive: true,
          exportGroups: [],
          readsFinancial: false,
          today: '2026-10-10',
        }),
    });
    renderApp(PATH, 'ru');
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[6]).toContain(ru.people.students.statuses.active);
    expect(rowsDrawn()[0]?.[6]).toContain(ru.people.students.inactiveFrom.split(' ')[0] ?? '');
  });

  it('brings an inactive student back with a new contract', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students': () =>
        json({
          students: [LOLA],
          canArchive: true,
          exportGroups: [],
          readsFinancial: false,
          today: '2026-10-10',
        }),
      [`GET /api/people/students/${LOLA.id}`]: () =>
        json(
          detailOf(LOLA, {
            canArchive: true,
            statuses: [
              {
                status: 'active',
                from: '2026-09-02',
                until: '2026-10-01',
                cause: 'start',
                reason: null,
              },
              {
                status: 'inactive',
                from: '2026-10-01',
                until: null,
                cause: 'leaving',
                reason: 'Moved',
              },
            ],
          }),
        ),
      [`POST /api/people/students/${LOLA.id}/return`]: () =>
        json(detailOf({ ...LOLA, status: 'active', version: 3 }, { canArchive: true })),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Karimova Lola', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Lola Karimova' });
    expect(
      await within(panel).findByRole('form', { name: en.people.students.undoTitle }),
    ).toBeDefined();
    const form = within(panel).getByRole('form', { name: en.people.students.returnTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.returnFrom, '2026-10-05');
    type(en.people.students.grade, '8');
    type(en.people.students.contractNumber, 'SQ-2026/120');
    type(en.people.students.contractSignedOn, '2026-10-05');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    // A return cannot be undone: it asks first, naming the student.
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.returnConfirmTitle,
    });
    expect(calls.some((call) => call.route.endsWith('/return'))).toBe(false);
    expect(within(dialog).getByText('Lola Karimova')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.returnTitle }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/return'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/return'))?.body).toEqual({
      from: '2026-10-05',
      grade: 8,
      contract: { number: 'SQ-2026/120', signedOn: '2026-10-05' },
      reason: null,
      version: 2,
    });
  });

  it('reads the student again when someone else changed it (edge: "student changed, reload")', async () => {
    let reads = 0;
    openList('academic_vice_principal', {
      [`GET /api/people/students/${OTKIR.id}`]: () => {
        reads += 1;
        return json(detailOf(OTKIR, { canArchive: true }));
      },
      [`POST /api/people/students/${OTKIR.id}/leaving`]: () =>
        Response.json(
          { error: { code: 'student_changed', message: 'x', requestId: 'r' } },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await within(panel).findByRole('form', { name: en.people.students.leaveTitle });
    fireEvent.change(within(form).getByLabelText(en.people.students.lastDay), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Moved' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: en.people.students.leaveAction,
      }),
    );
    await waitFor(() => {
      expect(reads).toBeGreaterThan(1);
    });
    expect(await screen.findByText(en.errors.student_changed)).toBeDefined();
  });

  it('records a leaving for ticked rows and names the refused ones', async () => {
    const calls = openList('academic_vice_principal', {
      [`POST /api/people/students/${OTKIR.id}/leaving`]: () => json(LEFT_DETAIL()),
      [`POST /api/people/students/${ZARINA.id}/leaving`]: () =>
        Response.json(
          { error: { code: 'leaving_before_start', message: 'x', requestId: 'r' } },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    for (const box of screen.getAllByRole('checkbox').slice(1)) {
      fireEvent.click(box);
    }
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.bulkLeave }));
    const title = en.people.students.bulkLeaveTitle_other.replace('{{n}}', '2');
    const form = await screen.findByRole('form', { name: title });
    fireEvent.change(within(form).getByLabelText(en.people.students.lastDay), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Moved' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Saidova Zarina')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.leaveAction }));
    expect(
      await screen.findByText(
        en.people.students.bulkRefused.replace('{{names}}', 'Saidova Zarina'),
        { exact: false },
      ),
    ).toBeDefined();
    expect(calls.filter((call) => call.route.endsWith('/leaving'))).toHaveLength(2);
  });

  it('offers "Restore this student" for an inactive holder of the document, and opens them', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students': () =>
        json({
          students: [OTKIR, LOLA],
          canArchive: true,
          exportGroups: [],
          readsFinancial: false,
          today: '2026-10-10',
        }),
      [`GET /api/people/students/${LOLA.id}`]: () => json(detailOf(LOLA, { canArchive: true })),
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/students': () =>
        Response.json(
          {
            error: {
              code: 'student_value_taken',
              message: 'x',
              requestId: 'r',
              details: [
                { path: 'jshshir', code: 'already_exists', message: 'x', recordId: LOLA.id },
              ],
            },
          },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.uid, '2607044');
    type(en.people.students.lastName, 'Karimova');
    type(en.people.students.firstName, 'Lola');
    type(en.people.students.sex, 'female');
    type(en.people.students.birthDate, '2014-03-02');
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    type(en.people.students.jshshir, '31403141234567');
    type(en.people.students.contractNumber, 'SQ-2026/130');
    type(en.people.students.contractSignedOn, '2026-08-20');
    type(en.people.relatives.phone, '+998 90 111 22 33');
    type(en.people.relatives.fullName, 'Dilfuza Rahimova');
    type(en.people.relatives.relationship, 'mother');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.restoreThis }));
    // The refused new student is not saved: leaving it asks first.
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: en.unsent.leave }),
    );
    expect(await screen.findByRole('complementary', { name: 'Lola Karimova' })).toBeDefined();
  });

  it('offers no "Restore this student" for an active holder of the document', async () => {
    openList('academic_vice_principal', {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/students': () =>
        Response.json(
          {
            error: {
              code: 'student_value_taken',
              message: 'x',
              requestId: 'r',
              details: [
                { path: 'jshshir', code: 'already_exists', message: 'x', recordId: OTKIR.id },
              ],
            },
          },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.uid, '2607045');
    type(en.people.students.lastName, 'Rahimov');
    type(en.people.students.firstName, 'Aziz');
    type(en.people.students.sex, 'male');
    type(en.people.students.birthDate, '2014-03-02');
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    type(en.people.students.jshshir, '31403141234567');
    type(en.people.students.contractNumber, 'SQ-2026/132');
    type(en.people.students.contractSignedOn, '2026-08-20');
    type(en.people.relatives.phone, '+998 90 111 22 33');
    type(en.people.relatives.fullName, 'Dilfuza Rahimova');
    type(en.people.relatives.relationship, 'mother');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(
      await within(form).findByText(
        en.people.students.takenHere.replace('{{student}}', 'Rahimov Oʻtkir (2607001)'),
      ),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: en.people.students.restoreThis })).toBeNull();
  });

  it('says that a UID of a deleted student is never given again', async () => {
    openList('academic_vice_principal', {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/students': () =>
        Response.json(
          {
            error: {
              code: 'student_value_taken',
              message: 'x',
              requestId: 'r',
              details: [{ path: 'uid', code: 'uid_released', message: 'x' }],
            },
          },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.uid, '2607044');
    type(en.people.students.lastName, 'Rahimov');
    type(en.people.students.firstName, 'Aziz');
    type(en.people.students.sex, 'male');
    type(en.people.students.birthDate, '2014-03-02');
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    type(en.people.students.contractNumber, 'SQ-2026/131');
    type(en.people.students.contractSignedOn, '2026-08-20');
    type(en.people.relatives.phone, '+998 90 111 22 33');
    type(en.people.relatives.fullName, 'Dilfuza Rahimova');
    type(en.people.relatives.relationship, 'mother');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await within(form).findByText(en.people.students.uidReleased)).toBeDefined();
  });

  it('deletes a student created twice after a confirmation, and says so in the panel', async () => {
    const calls = openList(
      'academic_vice_principal',
      {
        [`POST /api/people/students/${OTKIR.id}/delete`]: () => new Response(null, { status: 204 }),
      },
      'en',
      { canArchive: true, deletable: true },
    );
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await within(panel).findByRole('form', { name: en.people.students.deleteTitle });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Created twice' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.deleteConfirmTitle,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.deleteAction }));
    expect(await within(panel).findByText(en.people.students.deleted)).toBeDefined();
    expect(calls.find((call) => call.route.endsWith('/delete'))?.body).toEqual({
      reason: 'Created twice',
      version: 1,
    });
  });
});

// Code review of pull request #68, finding 3: every action of the Status
// section at the web level, the graduated offer by reader, and a Russian case.
describe('the Status section', () => {
  const GRADUATED: StudentListItem = {
    ...LOLA,
    id: uid(4),
    uid: '2607040',
    firstName: 'Nodira',
    lastName: 'Ergasheva',
    status: 'graduated',
  };
  const graduatedDetail = (fields: Partial<StudentDetail> = {}) =>
    detailOf(GRADUATED, {
      statuses: [
        { status: 'active', from: '2025-09-02', until: '2026-06-01', cause: 'start', reason: null },
        { status: 'graduated', from: '2026-06-01', until: null, cause: 'graduation', reason: null },
      ],
      ...fields,
    });

  function openOne(
    role: Role,
    row: StudentListItem,
    detail: StudentDetail,
    extra: Record<string, (body: unknown) => Response> = {},
    language: 'en' | 'ru' = 'en',
  ) {
    return fakeApi({
      'GET /api/auth/session': () => json(sessionAs(role, language)),
      'GET /api/people/students': () =>
        json({
          students: [row],
          canArchive: detail.canArchive,
          exportGroups: [],
          readsFinancial: false,
          today: '2026-10-10',
        }),
      [`GET /api/people/students/${row.id}`]: () => json(detail),
      ...extra,
    });
  }

  it('restores a graduated student for the Super Admin after a confirmation naming the student', async () => {
    const calls = openOne(
      'super_admin',
      GRADUATED,
      graduatedDetail({ canRestoreGraduated: true }),
      {
        [`POST /api/people/students/${GRADUATED.id}/restore`]: () =>
          json(detailOf({ ...GRADUATED, status: 'active', version: 3 })),
      },
    );
    renderApp(`${PATH}?open=${GRADUATED.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Nodira Ergasheva' });
    const form = await within(panel).findByRole('form', { name: en.people.students.restoreTitle });
    expect(
      within(form).getByLabelText<HTMLInputElement>(en.people.students.restoreFrom).value,
    ).toBe('2026-06-01');
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Graduated by mistake' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.restoreConfirmTitle,
    });
    expect(within(dialog).getByText('Nodira Ergasheva')).toBeDefined();
    expect(calls.some((call) => call.route.endsWith('/restore'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.restoreTitle }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/restore'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/restore'))?.body).toEqual({
      from: '2026-06-01',
      reason: 'Graduated by mistake',
      version: 2,
    });
  });

  it('draws no restore without canRestoreGraduated in the answer', async () => {
    openOne('academic_vice_principal', GRADUATED, graduatedDetail({ canArchive: true }));
    renderApp(`${PATH}?open=${GRADUATED.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Nodira Ergasheva' });
    expect(
      await within(panel).findByRole('heading', { name: en.people.students.statusTitle }),
    ).toBeDefined();
    expect(within(panel).queryByRole('form', { name: en.people.students.restoreTitle })).toBeNull();
  });

  it('sends "Undo leaving" with its reason and the version read', async () => {
    const left = detailOf(LOLA, {
      canArchive: true,
      statuses: [
        { status: 'active', from: '2026-09-02', until: '2026-10-01', cause: 'start', reason: null },
        { status: 'inactive', from: '2026-10-01', until: null, cause: 'leaving', reason: 'Moved' },
      ],
    });
    const calls = openOne('academic_vice_principal', LOLA, left, {
      [`POST /api/people/students/${LOLA.id}/leaving/undo`]: () =>
        json(detailOf({ ...LOLA, status: 'active', version: 3 }, { canArchive: true })),
    });
    renderApp(`${PATH}?open=${LOLA.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Lola Karimova' });
    const form = await within(panel).findByRole('form', { name: en.people.students.undoTitle });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Entered for the wrong student' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/leaving/undo'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/leaving/undo'))?.body).toEqual({
      reason: 'Entered for the wrong student',
      version: 2,
    });
  });

  it('cancels a scheduled leaving through its confirmation', async () => {
    const scheduled = detailOf(OTKIR, {
      canArchive: true,
      planned: { status: 'inactive', from: '2026-10-21' },
      version: 2,
      statuses: [
        { status: 'active', from: '2026-09-02', until: '2026-10-21', cause: 'start', reason: null },
        { status: 'inactive', from: '2026-10-21', until: null, cause: 'leaving', reason: 'Moved' },
      ],
    });
    const calls = openOne('academic_vice_principal', OTKIR, scheduled, {
      [`POST /api/people/students/${OTKIR.id}/leaving/cancel`]: () =>
        json(detailOf(OTKIR, { canArchive: true, version: 3 })),
    });
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    fireEvent.click(
      await within(panel).findByRole('button', { name: en.people.students.cancelLeaving }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.cancelConfirmTitle,
    });
    expect(calls.some((call) => call.route.endsWith('/leaving/cancel'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.cancelLeaving }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/leaving/cancel'))).toBe(true);
    });
    expect(calls.find((call) => call.route.endsWith('/leaving/cancel'))?.body).toEqual({
      version: 2,
    });
  });

  it.each([
    ['super_admin', true],
    ['academic_vice_principal', false],
  ] as const)(
    'offers "Restore this student" for a graduated holder to a %s: %s',
    async (role, offered) => {
      fakeApi({
        'GET /api/auth/session': () => json(sessionAs(role)),
        'GET /api/people/students': () =>
          json({
            students: [OTKIR, GRADUATED],
            canArchive: true,
            exportGroups: [],
            readsFinancial: false,
            today: '2026-10-10',
          }),
        'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
        'POST /api/people/students': () =>
          Response.json(
            {
              error: {
                code: 'student_value_taken',
                message: 'x',
                requestId: 'r',
                details: [
                  {
                    path: 'documentNumber',
                    code: 'already_exists',
                    message: 'x',
                    recordId: GRADUATED.id,
                  },
                ],
              },
            },
            { status: 409 },
          ),
      });
      renderApp(PATH);
      await waitFor(() => {
        expect(rowsDrawn()).toHaveLength(2);
      });
      fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
      const form = await screen.findByRole('form', { name: en.people.students.newTitle });
      const type = (label: string, value: string) => {
        fireEvent.change(within(form).getByLabelText(label), { target: { value } });
      };
      type(en.people.students.uid, '2607046');
      type(en.people.students.lastName, 'Ergasheva');
      type(en.people.students.firstName, 'Nodira');
      type(en.people.students.sex, 'female');
      type(en.people.students.birthDate, '2008-04-04');
      type(en.people.students.grade, '11');
      type(en.people.students.startsOn, '2026-09-02');
      type(en.people.students.documentType, 'passport');
      type(en.people.students.documentNumber, 'AB1234567');
      type(en.people.students.contractNumber, 'SQ-2026/140');
      type(en.people.students.contractSignedOn, '2026-08-20');
      type(en.people.relatives.phone, '+998 90 111 22 33');
      type(en.people.relatives.fullName, 'Dilfuza Rahimova');
      type(en.people.relatives.relationship, 'mother');
      fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
      expect(
        await within(form).findByText(
          en.people.students.takenHere.replace('{{student}}', 'Ergasheva Nodira (2607040)'),
        ),
      ).toBeDefined();
      expect(screen.queryByRole('button', { name: en.people.students.restoreThis }) !== null).toBe(
        offered,
      );
    },
  );

  it('is in Russian', async () => {
    openOne(
      'academic_vice_principal',
      LOLA,
      detailOf(LOLA, {
        canArchive: true,
        statuses: [
          {
            status: 'active',
            from: '2026-09-02',
            until: '2026-10-01',
            cause: 'start',
            reason: null,
          },
          {
            status: 'inactive',
            from: '2026-10-01',
            until: null,
            cause: 'leaving',
            reason: 'Переезд',
          },
        ],
      }),
      {},
      'ru',
    );
    renderApp(`${PATH}?open=${LOLA.id}`, 'ru');
    const panel = await screen.findByRole('complementary', { name: 'Lola Karimova' });
    expect(
      await within(panel).findByRole('heading', { name: ru.people.students.statusTitle }),
    ).toBeDefined();
    expect(
      within(panel).getByText(
        ru.people.students.causeReason
          .replace('{{cause}}', ru.people.students.causes.leaving)
          .replace('{{reason}}', 'Переезд'),
      ),
    ).toBeDefined();
    expect(within(panel).getByRole('form', { name: ru.people.students.returnTitle })).toBeDefined();
  });
});

// Task 2.4b-2, pull request #70: the export by groups of readers, the consent
// list (answer 23) and the photo column.
describe('the export of the student list', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function openExport(
    exportGroups: string[],
    written: (columns: string[]) => string[] = (columns) => columns,
  ) {
    class FileUrl extends URL {
      static override createObjectURL = (): string => 'blob:file';
      static override revokeObjectURL = (): void => undefined;
    }
    vi.stubGlobal('URL', FileUrl);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    return fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students': () =>
        json({
          students: [OTKIR, ZARINA],
          canArchive: false,
          exportGroups,
          readsFinancial: exportGroups.includes('financial'),
          today: '2026-10-10',
        }),
      'POST /api/people/students/export': (body) =>
        new Response(new Blob(['PK']), {
          status: 200,
          headers: {
            'Content-Type': XLSX,
            'X-Export-Columns': written((body as { columns: string[] }).columns).join(','),
          },
        }),
    });
  }

  const sentColumns = (calls: ReturnType<typeof fakeApi>) =>
    (
      calls.filter((call) => call.route === 'POST /api/people/students/export').at(-1)?.body as
        { columns: string[] } | undefined
    )?.columns;

  const exported = async (calls: ReturnType<typeof fakeApi>, count: number) => {
    fireEvent.click(screen.getByRole('button', { name: en.list.export }));
    await waitFor(() => {
      expect(
        calls.filter((call) => call.route === 'POST /api/people/students/export'),
      ).toHaveLength(count);
    });
  };

  it('sends the columns of the list, never the photo, groups or tutor; the headings are the file’s', async () => {
    const calls = openExport(['basic', 'contact', 'identity', 'financial']);
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const exportedHeadings = [...document.querySelectorAll('thead th')]
      .filter((cell) => cell.querySelector('input') === null)
      .map((cell) => cell.textContent ?? '')
      .filter(
        (text) =>
          ![
            en.people.staff.photo.column,
            en.people.students.groups,
            en.people.students.tutor,
          ].includes(text),
      );
    expect(exportedHeadings).toEqual(
      STUDENT_LIST_EXPORT_COLUMNS.map((key) => EXPORT_TEXTS.en.students.columns[key]),
    );
    await exported(calls, 1);
    expect(sentColumns(calls)).toEqual([...STUDENT_LIST_EXPORT_COLUMNS]);
    vi.restoreAllMocks();
  });

  it('adds the columns of a group chosen under "Also export", in the order of the file', async () => {
    const calls = openExport(['basic', 'contact', 'identity', 'financial']);
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: en.list.exportAlso }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemcheckbox')
        .map((item) => item.textContent),
    ).toEqual([
      en.people.students.exportGroups.basic,
      en.people.students.exportGroups.contact,
      en.people.students.exportGroups.identity,
      en.people.students.exportGroups.financial,
    ]);
    fireEvent.click(
      within(menu).getByRole('menuitemcheckbox', { name: en.people.students.exportGroups.contact }),
    );
    fireEvent.click(
      within(menu).getByRole('menuitemcheckbox', {
        name: en.people.students.exportGroups.identity,
      }),
    );
    fireEvent.keyDown(menu, { key: 'Escape' });
    await exported(calls, 1);
    expect(sentColumns(calls)).toEqual([
      ...STUDENT_LIST_EXPORT_COLUMNS,
      'phone',
      'email',
      // Task 2.5b-2: the relatives come with the Contact group.
      'mainContactName',
      'mainContactRelationship',
      'mainContactPhone',
      'mainContactExtraPhones',
      'otherRelatives',
      'birthDate',
      'documentType',
      'documentNumber',
      'jshshir',
      'address',
      'region',
    ]);
    // Every column of the file is in one of the groups or the list (the shared order).
    expect(STUDENT_EXPORT_COLUMNS).toEqual(expect.arrayContaining(sentColumns(calls) ?? []));
    vi.restoreAllMocks();
  });

  it('offers the Principal only the groups the server names, and names a column left out in words', async () => {
    const calls = openExport(['basic', 'financial'], (columns) =>
      columns.filter((column) => column !== 'consentSignedOn'),
    );
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: en.list.exportAlso }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitemcheckbox')
        .map((item) => item.textContent),
    ).toEqual([en.people.students.exportGroups.basic, en.people.students.exportGroups.financial]);
    fireEvent.click(
      within(menu).getByRole('menuitemcheckbox', {
        name: en.people.students.exportGroups.financial,
      }),
    );
    fireEvent.keyDown(menu, { key: 'Escape' });
    await exported(calls, 1);
    const status = await screen.findByText(
      en.list.exportColumnsLeftOut.replace('{{columns}}', en.people.students.consentSignedOn),
    );
    expect(status.textContent).not.toContain('consentSignedOn');
    vi.restoreAllMocks();
  });

  it('draws no Export button for a reader the server gives no group', async () => {
    openList('head_tutor');
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(screen.queryByRole('button', { name: en.list.export })).toBeNull();
    expect(screen.queryByRole('button', { name: en.list.exportAlso })).toBeNull();
  });
});

describe('the consent list', () => {
  const WITHOUT: StudentListItem = { ...OTKIR, consentMissing: true };
  const SIGNED: StudentListItem = { ...ZARINA, consentMissing: false, status: 'active' };

  function openConsent(
    readsFinancial: boolean,
    students: StudentListItem[],
    language: 'en' | 'ru',
  ) {
    return fakeApi({
      'GET /api/auth/session': () => json(sessionAs('principal', language)),
      'GET /api/people/students': () =>
        json({
          students,
          canArchive: false,
          exportGroups: readsFinancial ? ['basic', 'financial'] : [],
          readsFinancial,
          today: '2026-10-10',
        }),
    });
  }

  it('asks the server for the active students without consent, for a Financial reader', async () => {
    const calls = openConsent(true, [WITHOUT, SIGNED], 'en');
    renderApp(`${PATH}?f=${encodeURIComponent(JSON.stringify({ consent: 'missing' }))}`);
    await waitFor(() => {
      expect(calls.some((call) => call.query === '?consent=missing')).toBe(true);
    });
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[2])).toEqual(['Rahimov Oʻtkir']);
    });
    expect(screen.getByRole('combobox', { name: en.people.students.consent })).toBeTruthy();
  });

  it('offers the filter in Russian, also on an empty list', async () => {
    openConsent(true, [], 'ru');
    renderApp(PATH, 'ru');
    const filter = await screen.findByRole('combobox', { name: ru.people.students.consent });
    expect(
      within(filter).getByRole('option', { name: ru.people.students.activeNoConsent }),
    ).toBeTruthy();
  });

  it('offers no consent filter, and asks for no consent list, without the Financial group', async () => {
    const calls = openConsent(false, [OTKIR, ZARINA], 'en');
    renderApp(`${PATH}?f=${encodeURIComponent(JSON.stringify({ consent: 'missing' }))}`);
    await screen.findByRole('heading', { name: en.people.students.title });
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'GET /api/people/students')).toBe(true);
    });
    expect(screen.queryByRole('combobox', { name: en.people.students.consent })).toBeNull();
    expect(calls.some((call) => (call.query ?? '').includes('consent'))).toBe(false);
  });
});

describe('student photos', () => {
  const PHOTO_ID = uid(61);
  const PIXEL = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==',
    ),
    (char) => char.charCodeAt(0),
  );

  const photoCell = (name: string) =>
    [...document.querySelectorAll('tbody tr')]
      .find((row) => row.textContent.includes(name))
      ?.querySelectorAll('td')[1];

  it('shows the photo in the list, and the initials where there is none', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students': () =>
        json({
          students: [{ ...OTKIR, photoId: PHOTO_ID }, ZARINA],
          canArchive: true,
          exportGroups: [],
          readsFinancial: false,
          today: '2026-10-10',
        }),
      [`GET /api/people/students/${OTKIR.id}/photo`]: () =>
        new Response(new Blob([PIXEL], { type: 'image/png' }), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        }),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(photoCell('Rahimov Oʻtkir')?.querySelector('img')?.getAttribute('src')).toMatch(
        /^data:image\/png;base64,/,
      );
    });
    expect(photoCell('Saidova Zarina')?.querySelector('img')).toBeNull();
    expect(photoCell('Saidova Zarina')?.textContent).toBe('ZS');
    expect(calls.filter((call) => call.route.endsWith('/photo')).map((call) => call.route)).toEqual(
      [`GET /api/people/students/${OTKIR.id}/photo`],
    );
  });

  it('offers to add a photo in the panel to an editor', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    expect(within(panel).getByRole('button', { name: en.people.staff.photo.add })).toBeTruthy();
  });

  it('gives a reader who may not edit no photo buttons', async () => {
    openList('principal', {}, 'en', { canEdit: false });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('region', { name: en.people.staff.photo.title });
    expect(within(panel).queryByRole('button', { name: en.people.staff.photo.add })).toBeNull();
  });
});

// Task 2.6a, pull request #75: "History" opens the Audit log about the
// student, for the readers of the log only.
describe('the History link of a student', () => {
  it('opens the log about the student for the Academic Vice Principal', async () => {
    openList('academic_vice_principal');
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const link = await within(panel).findByRole('link', { name: en.audit.history });
    expect(link.getAttribute('href')).toBe(`/audit?person=student%3A${OTKIR.id}`);
  });

  it('is not shown to a role that does not read the log', async () => {
    openList('spiritual_vice_principal');
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('region', { name: en.people.staff.photo.title });
    expect(within(panel).queryByRole('link', { name: en.audit.history })).toBeNull();
  });
});

// Task 2.6b, pull request #76: "Personal data report" on the panel, for the
// Super Admin only (decision 3).
describe('the personal data report link of a student', () => {
  it('opens the report of the student for the Super Admin', async () => {
    openList('super_admin');
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const link = await within(panel).findByRole('link', { name: en.people.report.link });
    expect(link.getAttribute('href')).toBe(`/people/report/student/${OTKIR.id}`);
  });

  it.each(['principal', 'academic_vice_principal'] as const)('is not shown to %s', async (role) => {
    openList(role);
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('link', { name: en.audit.history });
    expect(within(panel).queryByRole('link', { name: en.people.report.link })).toBeNull();
  });
});
