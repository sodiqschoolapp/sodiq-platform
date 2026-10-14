import {
  EXPORT_TEXTS,
  STUDENT_EXPORT_COLUMNS,
  STUDENT_LIST_EXPORT_COLUMNS,
  type Role,
  type StudentDetail,
  type SchoolClass,
  type StudentListItem,
} from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { schoolDateText } from '@/lib/dates';
import { ru } from '@/i18n/locales/ru';
import { savedRecordPanel } from '@/testing/new-record';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import {
  actionsAreLast,
  edit,
  panelActionNames,
  panelActions,
  savedInPanel,
} from '@/testing/panel';

const uid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/students';

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
  // Task 3.1b: in 7 Oxford with its Tutor.
  class: {
    id: uid(50),
    grade: 7,
    name: 'Oxford',
    language: 'uz',
    from: '2026-09-02',
    until: '2027-06-01',
  },
  plannedClass: null,
  tutor: { firstName: 'Dilnoza', lastName: 'Tursunova' },
  actingTutor: null,
  groups: [],
  version: 2,
  opens: true,
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
  class: null,
  // Task 3.1b: joins 8 Princeton on the start date.
  plannedClass: {
    id: uid(51),
    grade: 8,
    name: 'Princeton',
    language: 'ru',
    from: '2026-11-02',
    until: '2027-06-01',
  },
  tutor: null,
  actingTutor: null,
  groups: [],
  version: 1,
  opens: true,
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
  class: null,
  plannedClass: null,
  tutor: null,
  actingTutor: null,
  groups: [],
  version: 2,
  opens: true,
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
  mainRoom: null,
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

/** The classes of the branch (task 3.1b): 7 Oxford, 8 Princeton, an archived 7 Yale. */
const schoolClass = (n: number, fields: Partial<SchoolClass>): SchoolClass => ({
  id: uid(n),
  academicYearId: uid(60),
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
  ...fields,
});
const CLASSES: SchoolClass[] = [
  schoolClass(50, {}),
  schoolClass(51, { grade: 8, name: 'Princeton', language: 'ru' }),
  schoolClass(52, { name: 'Yale', archived: true }),
];

function openList(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
  detail: Partial<StudentDetail> = {},
) {
  return fakeApi({
    'GET /api/classes': () => json({ classes: CLASSES }),
    'GET /api/setup/academic-years': () =>
      json({
        years: [
          {
            id: uid(60),
            name: '2026–2027',
            startDate: '2026-09-01',
            endDate: '2027-05-31',
            status: 'current',
            quarters: [],
          },
        ],
      }),
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
        '7 Oxford',
        '—',
        'Tursunova Dilnoza',
        en.people.students.statuses.active,
      ],
      [
        'ZS',
        '2507014',
        'Saidova Zarina',
        en.people.students.classFrom
          .replace('{{class}}', '8 Princeton')
          .replace('{{date}}', schoolDateText('2026-11-02', 'en')),
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
    expect(rowsDrawn()[0]?.[3]).toBe('7 Oxford');
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
  // its own content; the status belongs to Overview. The record's actions are
  // the panel's, at the bottom under every tab (task 2.7c-2b-2b, decision 7).
  it('switches the whole panel with its tabs', async () => {
    openList('academic_vice_principal', {}, 'en', { canEdit: true });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const titles = () => [...panel.querySelectorAll('h3')].map((title) => title.textContent);
    const tabs = await within(panel).findByRole('radiogroup');

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.overview }));
    await waitFor(() => {
      expect(titles()).toContain(en.people.students.statusTitle);
    });
    // The panel reads first: no form until its button is pressed.
    expect(titles()).not.toContain(en.people.students.recordTitle);
    expect(titles()).not.toContain(en.people.students.uidTitle);
    expect(within(panel).queryByRole('form')).toBeNull();
    const actions = [en.form.edit, en.people.students.uidTitle];
    expect(panelActionNames(panel)).toEqual(actions);
    expect(actionsAreLast(panel)).toBe(true);

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.contract }));
    expect(await within(panel).findByText(/SQ-2026\/017/)).toBeDefined();
    expect(titles()).not.toContain(en.people.students.statusTitle);
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(panelActionNames(panel)).toEqual(actions);

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.relatives }));
    expect(await within(panel).findByText('Dilfuza Rahimova')).toBeDefined();
    expect(titles()).not.toContain(en.people.students.statusTitle);
    expect(panelActionNames(panel)).toEqual(actions);
    expect(actionsAreLast(panel)).toBe(true);
  });

  it('opens the record form behind Edit in the place of the tabs, and closes it with "Saved."', async () => {
    const calls = openList(
      'academic_vice_principal',
      {
        [`PUT /api/people/students/${OTKIR.id}`]: () => json(detailOf(OTKIR, { canEdit: true })),
      },
      'en',
      { canEdit: true },
    );
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('radiogroup');
    const form = await edit(panel, 'Oʻtkir Rahimov');
    expect(within(panel).queryByRole('radiogroup')).toBeNull();
    expect(panelActions(panel)).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.closest('form')).toBe(form);
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.cancel }));
    await waitFor(() => {
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    expect(calls.some((call) => call.route.startsWith('PUT'))).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.form.edit }),
      );
    });

    const again = await edit(panel, 'Oʻtkir Rahimov');
    fireEvent.click(within(again).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);
    expect(calls.filter((call) => call.route.startsWith('PUT'))).toHaveLength(1);
    expect(within(panel).getByRole('radiogroup')).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.form.edit }),
      );
    });
  });

  it("shows the father's name in the read view with the label of its form", async () => {
    openList('principal', {}, 'en', { paternalName: 'Sherzod oʻgʻli', canEdit: false });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const term = await within(panel).findByText(en.people.students.paternalName, {
      selector: 'dt',
    });
    expect(term.nextElementSibling?.textContent).toBe('Sherzod oʻgʻli');
    // The Principal edits nothing: no Edit and no opener.
    expect(panelActions(panel)).toBeNull();
  });

  it('asks before a tab takes typed changes of a relative away, and closes the form when the person leaves', async () => {
    openList(
      'academic_vice_principal',
      {
        [`GET /api/people/students/${OTKIR.id}/relatives`]: () =>
          json({ ...MOTHER, canEdit: true }),
      },
      'en',
      { canEdit: true },
    );
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const tabs = await within(panel).findByRole('radiogroup');
    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.relatives }));
    fireEvent.click(await within(panel).findByRole('button', { name: en.people.relatives.add }));
    const form = await within(panel).findByRole('form', {
      name: en.people.relatives.formLabel.replace('{{name}}', 'Oʻtkir Rahimov'),
    });
    fireEvent.change(within(form).getByLabelText(en.people.relatives.fullName), {
      target: { value: 'Nodir Rahimov' },
    });

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.overview }));
    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(within(panel).getByLabelText<HTMLInputElement>(en.people.relatives.fullName).value).toBe(
      'Nodir Rahimov',
    );

    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.overview }));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.leave }));
    expect(
      await within(panel).findByRole('heading', { name: en.people.students.statusTitle }),
    ).toBeDefined();
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(panelActionNames(panel)).toContain(en.form.edit);

    // Back on the Relatives tab the add form is closed, not kept open.
    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.relatives }));
    expect(
      await within(panel).findByRole('button', { name: en.people.relatives.add }),
    ).toBeDefined();
    expect(within(panel).queryByRole('form')).toBeNull();
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
  async function fillAndSave(classId?: string) {
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.people.students.newTitle }),
    ).getByRole('form', { name: en.people.students.newTitle });
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
    if (classId !== undefined) {
      type(en.people.students.class, classId);
    }
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

  // Task 3.1b, decision 2: the class of a new student, of the grade chosen.
  it('offers a new student the classes of the grade and sends the one chosen', async () => {
    const calls = openList('academic_vice_principal', {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/students': () => json(detailOf({ ...OTKIR, id: uid(9) }), 201),
      [`GET /api/people/students/${uid(9)}`]: () => json(detailOf({ ...OTKIR, id: uid(9) })),
    });
    renderApp(PATH);
    const form = await fillAndSave(uid(50));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/students')).toBe(true);
    });
    expect(calls.find((call) => call.route === 'POST /api/people/students')?.body).toMatchObject({
      grade: 7,
      startsOn: '2026-09-02',
      classId: uid(50),
    });
    expect(form).toBeDefined();
  });

  it('offers the classes of the grade in the year of the start date and drops a choice no longer offered', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = within(
      await screen.findByRole('complementary', { name: en.people.students.newTitle }),
    ).getByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    const classField = await within(form).findByLabelText<HTMLSelectElement>(
      en.people.students.class,
    );
    // Not 8 Princeton (another grade), not the archived Yale.
    expect([...classField.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      en.people.students.noClassYet,
      '7 Oxford · 2026–2027',
    ]);
    type(en.people.students.class, uid(50));
    expect(classField.value).toBe(uid(50));
    type(en.people.students.grade, '8');
    await waitFor(() => {
      expect(classField.value).toBe('');
    });
    // A start date in no year offers no class.
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2027-08-01');
    await waitFor(() => {
      expect(classField.querySelectorAll('option')).toHaveLength(1);
    });
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

  /** A list that holds the new student once it is saved, as the server's does. */
  function openSaving(
    readsFinancial: boolean,
    consentMissing: boolean,
    status: StudentListItem['status'] = 'active',
  ) {
    const NEW: StudentListItem = { ...OTKIR, id: uid(9), uid: '2606001', consentMissing, status };
    let saved: StudentListItem[] = [];
    const list = (query: string) =>
      json({
        // As the server reads the consent list: the active students without consent.
        students: [ZARINA, ...saved].filter(
          (row) =>
            !query.includes('consent=missing') ||
            (row.status === 'active' && row.consentMissing === true),
        ),
        canArchive: true,
        exportGroups: [],
        readsFinancial,
        today: '2026-10-10',
      });
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students': () => list(calls.at(-1)?.query ?? ''),
      [`GET /api/people/students/${NEW.id}`]: () => json(detailOf(NEW)),
      [`GET /api/people/students/${NEW.id}/relatives`]: () => json(MOTHER),
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/students': () => {
        saved = [NEW];
        return json(detailOf(NEW), 201);
      },
    });
    return calls;
  }

  // Pull request #81, decision 4: the saved student is shown in the panel.
  it('shows the saved student in the side panel', async () => {
    openSaving(false, false);
    renderApp(PATH);
    await fillAndSave();
    const panel = await savedRecordPanel(en.people.students.newTitle);
    expect(panel.getAttribute('aria-label')).toBe('Oʻtkir Rahimov');
  });

  // Pull request #81, correction 1: the consent filter is turned off only when
  // it would hide the saved student.
  it('turns the consent filter off for a saved student with consent, and keeps it for one without', async () => {
    const filtered = `${PATH}?f=${encodeURIComponent(JSON.stringify({ consent: 'missing' }))}`;
    openSaving(true, false);
    const { router } = renderApp(filtered);
    await fillAndSave();
    expect((await savedRecordPanel(en.people.students.newTitle)).getAttribute('aria-label')).toBe(
      'Oʻtkir Rahimov',
    );
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ open: uid(9) });
    });
    cleanup();

    openSaving(true, true);
    const second = renderApp(filtered);
    await fillAndSave();
    await savedRecordPanel(en.people.students.newTitle);
    await waitFor(() => {
      expect(second.router.state.location.search).toEqual({
        f: { consent: 'missing' },
        open: uid(9),
      });
    });
    cleanup();

    // Without consent but not active yet (a start date after today): not in
    // the consent list either, so the filter goes.
    openSaving(true, true, null);
    const third = renderApp(filtered);
    await fillAndSave();
    await savedRecordPanel(en.people.students.newTitle);
    await waitFor(() => {
      expect(third.router.state.location.search).toEqual({ open: uid(9) });
    });
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
    const form = await edit(panel, 'Oʻtkir Rahimov');
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
    // Leave school and Delete are the danger actions at the bottom (decision 5).
    await waitFor(() => {
      expect(panelActionNames(panel)).toEqual([
        en.form.edit,
        en.people.students.uidTitle,
        en.people.students.leaveTitle,
        en.people.students.deleteAction,
      ]);
    });
    const leave = within(panelActions(panel) ?? panel).getByRole('button', {
      name: en.people.students.leaveTitle,
    });
    expect(leave.getAttribute('data-variant')).toBe('destructive');
    const form = await edit(panel, en.people.students.leaveTitle, en.people.students.leaveTitle);
    // The status and its history above the form.
    expect(
      within(panel).getByRole('heading', { name: en.people.students.statusTitle }),
    ).toBeDefined();
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
      version: OTKIR.version,
    });
    expect(
      await within(panel).findByRole('button', { name: en.people.students.cancelLeaving }),
    ).toBeDefined();
    expect(within(panel).getByText(/Moved to another city/)).toBeDefined();
    // "Leave school" is gone: "Saved." and the focus on the status heading.
    await savedInPanel(panel);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('heading', { name: en.people.students.statusTitle }),
      );
    });
  });

  it('keeps a typed leaving when its confirmation is cancelled', async () => {
    const calls = openList('academic_vice_principal', {}, 'en', { canArchive: true });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(panel, en.people.students.leaveTitle, en.people.students.leaveTitle);
    fireEvent.change(within(form).getByLabelText(en.people.students.lastDay), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Moved' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.leaveConfirmTitle,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(form.isConnected).toBe(true);
    expect(within(form).getByLabelText<HTMLInputElement>(en.people.students.reason).value).toBe(
      'Moved',
    );
    expect(calls.some((call) => call.route.endsWith('/leaving'))).toBe(false);
  });

  it('records a leaving from the Relatives tab and comes back to Overview with the focus on the status', async () => {
    let left = false;
    openList('academic_vice_principal', {
      [`GET /api/people/students/${OTKIR.id}`]: () =>
        json(left ? LEFT_DETAIL() : detailOf(OTKIR, { canArchive: true })),
      [`POST /api/people/students/${OTKIR.id}/leaving`]: () => {
        left = true;
        return json(LEFT_DETAIL());
      },
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const tabs = await within(panel).findByRole('radiogroup');
    fireEvent.click(within(tabs).getByRole('radio', { name: en.people.students.tabs.relatives }));
    await within(panel).findByText('Dilfuza Rahimova');
    const form = await edit(panel, en.people.students.leaveTitle, en.people.students.leaveTitle);
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
    await savedInPanel(panel);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('heading', { name: en.people.students.statusTitle }),
      );
    });
    expect(
      within(within(panel).getByRole('radiogroup')).getByRole<HTMLInputElement>('radio', {
        name: en.people.students.tabs.overview,
      }).checked,
    ).toBe(true);
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
    // Inactive after a leaving: Undo and Return at the bottom, no Leave.
    await waitFor(() => {
      expect(panelActionNames(panel)).toEqual([
        en.form.edit,
        en.people.students.uidTitle,
        en.people.students.undoTitle,
        en.people.students.returnTitle,
      ]);
    });
    const form = await edit(panel, en.people.students.returnTitle, en.people.students.returnTitle);
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
    await savedInPanel(panel);
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
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(panel, en.people.students.leaveTitle, en.people.students.leaveTitle);
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
    // Still active: the form stays open with the refusal under it.
    expect(await within(form).findByText(en.errors.student_changed)).toBeDefined();
  });

  it('closes a leaving form whose action is gone after the re-read, and keeps the refusal at the bottom', async () => {
    let reads = 0;
    openList('academic_vice_principal', {
      // Someone else recorded a leaving in between.
      [`GET /api/people/students/${OTKIR.id}`]: () => {
        reads += 1;
        return json(reads === 1 ? detailOf(OTKIR, { canArchive: true }) : LEFT_DETAIL());
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
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(panel, en.people.students.leaveTitle, en.people.students.leaveTitle);
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
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    const actions = panelActions(panel);
    expect(actions).not.toBeNull();
    expect(within(actions ?? panel).getByText(en.errors.student_changed)).toBeDefined();
    expect(panelActionNames(panel)).toContain(en.people.students.cancelLeaving);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('heading', { name: en.people.students.statusTitle }),
      );
    });
  });

  it('closes a delete refused because the student changed and now holds data, with the refusal at the bottom', async () => {
    let reads = 0;
    openList('academic_vice_principal', {
      [`GET /api/people/students/${OTKIR.id}`]: () => {
        reads += 1;
        return json(
          reads === 1
            ? detailOf(OTKIR, { canArchive: true, deletable: true })
            : LEFT_DETAIL({ deletable: false }),
        );
      },
      [`POST /api/people/students/${OTKIR.id}/delete`]: () =>
        Response.json(
          { error: { code: 'student_changed', message: 'x', requestId: 'r' } },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(panel, en.people.students.deleteTitle, en.people.students.deleteAction);
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Created twice' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    fireEvent.click(
      within(
        await screen.findByRole('alertdialog', { name: en.people.students.deleteConfirmTitle }),
      ).getByRole('button', { name: en.people.students.deleteAction }),
    );
    await waitFor(() => {
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    expect(within(panelActions(panel) ?? panel).getByText(en.errors.student_changed)).toBeDefined();
    expect(panelActionNames(panel)).not.toContain(en.people.students.deleteAction);
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
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(await screen.findByRole('complementary', { name: title })).getByRole(
      'form',
      { name: title },
    );
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
    // Done, the panel closes, the ticked rows stay listed and the search box has the focus.
    expect(screen.queryByRole('complementary')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: en.list.search }));
    });
  });

  it('asks before "Leave school" takes the place of a record with typed changes', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.click(screen.getByText('Rahimov Oʻtkir', { selector: 'button' }));
    const record = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(record).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(record, 'Oʻtkir Rahimov');
    fireEvent.change(within(form).getByLabelText(en.people.students.lastName), {
      target: { value: 'Rahimova' },
    });
    for (const box of screen.getAllByRole('checkbox').slice(1, 3)) {
      fireEvent.click(box);
    }
    const title = en.people.students.bulkLeaveTitle_other.replace('{{n}}', '2');

    fireEvent.click(screen.getByRole('button', { name: en.people.students.bulkLeave }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: en.unsent.stay }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.getByRole('complementary', { name: 'Oʻtkir Rahimov' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: en.people.students.bulkLeave }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: en.unsent.leave }),
    );
    expect(await screen.findByRole('complementary', { name: title })).toBeDefined();
    expect(screen.queryByRole('complementary', { name: 'Oʻtkir Rahimov' })).toBeNull();
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
    // In the side panel beside the list (task 2.7c-2a), not above it.
    const form = within(
      await screen.findByRole('complementary', { name: en.people.students.newTitle }),
    ).getByRole('form', { name: en.people.students.newTitle });
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
    // The holder takes the place of the new form in the one side panel, with the focus.
    const holder = await screen.findByRole('complementary', { name: 'Lola Karimova' });
    expect(screen.queryByRole('complementary', { name: en.people.students.newTitle })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).toBe(
      within(holder).getByRole('heading', { name: 'Lola Karimova' }),
    );
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
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(panel, en.people.students.deleteTitle, en.people.students.deleteAction);
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Created twice' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.deleteConfirmTitle,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.deleteAction }));
    const line = await within(panel).findByText(en.people.students.deleted);
    // The panel's buttons are gone: the line has the focus.
    await waitFor(() => {
      expect(document.activeElement).toBe(line);
    });
    expect(calls.find((call) => call.route.endsWith('/delete'))?.body).toEqual({
      reason: 'Created twice',
      version: OTKIR.version,
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
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(
      panel,
      en.people.students.restoreTitle,
      en.people.students.restoreTitle,
    );
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
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(panel, en.people.students.undoTitle, en.people.students.undoTitle);
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
    // Done with no form open: "Saved." at the bottom, the focus on the status heading.
    await savedInPanel(panel);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('heading', { name: en.people.students.statusTitle }),
      );
    });
  });

  // Issue #39, hand test of 13 October 2026, finding 18 (task 2.7b-2, decision
  // 7): "Saved." stays after a UID correction; since task 2.7c-2b-2b the form
  // closes and says so in the bottom row, and opens again with an empty reason.
  it('says "Saved." after a UID correction, shows the new UID, and opens again with an empty reason', async () => {
    let detail = detailOf(OTKIR, { canEdit: true });
    const calls = openOne('academic_vice_principal', OTKIR, detail, {
      [`GET /api/people/students/${OTKIR.id}`]: () => json(detail),
      [`PUT /api/people/students/${OTKIR.id}/uid`]: (body) => {
        detail = { ...detail, uid: (body as { uid: string }).uid, version: detail.version + 1 };
        return json(detail);
      },
    });
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const label = en.people.students.uidLabel.replace('{{name}}', 'Oʻtkir Rahimov');
    const form = await edit(panel, label, en.people.students.uidTitle);
    fireEvent.change(within(form).getByLabelText(en.people.students.uid), {
      target: { value: '2606077' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Typed wrong' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    await savedInPanel(panel);
    expect(calls.find((call) => call.route.endsWith('/uid'))?.body).toEqual({
      uid: '2606077',
      reason: 'Typed wrong',
      confirmUidSet: false,
    });
    const term = await within(panel).findByText(en.people.students.uid, { selector: 'dt' });
    await waitFor(() => {
      expect(term.nextElementSibling?.textContent).toBe('2606077');
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.people.students.uidTitle }),
      );
    });
    const again = await edit(panel, label, en.people.students.uidTitle);
    expect(within(again).getByLabelText<HTMLInputElement>(en.people.students.uid).value).toBe(
      '2606077',
    );
    expect(within(again).getByLabelText<HTMLInputElement>(en.people.students.reason).value).toBe(
      '',
    );
  });

  it("asks before a UID of another grade's set, and keeps the correction open with what was typed when the person declines", async () => {
    const calls = openOne('academic_vice_principal', OTKIR, detailOf(OTKIR, { canEdit: true }), {
      [`PUT /api/people/students/${OTKIR.id}/uid`]: () =>
        Response.json(
          { error: { code: 'uid_set_mismatch', message: 'x', requestId: 'r' } },
          { status: 409 },
        ),
    });
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('heading', { name: en.people.students.statusTitle });
    const form = await edit(
      panel,
      en.people.students.uidLabel.replace('{{name}}', 'Oʻtkir Rahimov'),
      en.people.students.uidTitle,
    );
    fireEvent.change(within(form).getByLabelText(en.people.students.uid), {
      target: { value: '2509077' },
    });
    fireEvent.change(within(form).getByLabelText(en.people.students.reason), {
      target: { value: 'Typed wrong' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', { name: en.people.students.setTitle });
    expect(within(dialog).getByText('2509077')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirm.cancel }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(form.isConnected).toBe(true);
    expect(within(form).getByLabelText<HTMLInputElement>(en.people.students.uid).value).toBe(
      '2509077',
    );
    expect(calls.filter((call) => call.route.endsWith('/uid'))).toHaveLength(1);
    expect(panelActions(panel)).toBeNull();
  });

  // Issue #39, hand test of 13 October 2026, findings 26 and 29 (task 2.7b-2).
  it('names the two buttons of the dialog apart, keeps the leaving, and draws no "Leave school" form while one is scheduled', async () => {
    const scheduled = detailOf(OTKIR, {
      canArchive: true,
      planned: { status: 'inactive', from: '2026-10-21' },
      version: 2,
      statuses: [
        { status: 'active', from: '2026-09-02', until: '2026-10-21', cause: 'start', reason: null },
        { status: 'inactive', from: '2026-10-21', until: null, cause: 'leaving', reason: 'Moved' },
      ],
    });
    const calls = openOne('academic_vice_principal', OTKIR, scheduled);
    renderApp(`${PATH}?open=${OTKIR.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const cancel = await within(panel).findByRole('button', {
      name: en.people.students.cancelLeaving,
    });
    expect(within(panel).queryByRole('form', { name: en.people.students.leaveTitle })).toBeNull();

    fireEvent.click(cancel);
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.students.cancelConfirmTitle,
    });
    expect(
      within(dialog).getByRole('button', { name: en.people.students.cancelLeaving }),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.keepLeaving }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(calls.some((call) => call.route.endsWith('/leaving/cancel'))).toBe(false);
    // Nothing was saved, so nothing says so (spec review of the build).
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(panelActions(panel)?.textContent).not.toContain(en.form.saved);
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
    expect(
      within(panelActions(panel) ?? panel).getByRole('button', {
        name: ru.people.students.returnTitle,
      }),
    ).toBeDefined();
    expect(
      await edit(panel, ru.people.students.returnTitle, ru.people.students.returnTitle),
    ).toBeDefined();
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

  it('sends the columns of the list, never the photo; the headings are the file’s', async () => {
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
          // Task 3.1b: the Tutor joined the file; task 3.2b the groups (decision 2 of #92).
          text !== en.people.staff.photo.column,
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

// Task 3.1b, pull request #89: the class of a student in the list, its
// filters, "Put into a class" of ticked rows (decisions 5 and 9), the class
// of a new student (decision 2) and the Academic block of the record.
describe('the classes of the students', () => {
  it('filters by a class the rows name, by "No class" and by language', async () => {
    openList('principal');
    const shown = async (filters: Record<string, string>) => {
      cleanup();
      renderApp(`${PATH}?f=${encodeURIComponent(JSON.stringify(filters))}`);
      await screen.findByRole('heading', { name: en.people.students.title });
      await new Promise((resolve) => setTimeout(resolve, 50));
      return rowsDrawn().map((row) => row[2]);
    };
    await waitFor(async () => {
      expect(await shown({ class: uid(51) })).toEqual(['Saidova Zarina']);
    });
    expect(await shown({ language: 'uz' })).toEqual(['Rahimov Oʻtkir']);
    renderApp(PATH);
    const select = await screen.findByLabelText(en.people.students.class, { selector: 'select' });
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      en.list.all,
      '7 Oxford',
      '8 Princeton',
      en.people.students.noClass,
    ]);
  });

  it('puts the ticked students into a class of their grade from a date', async () => {
    const calls = openList('academic_vice_principal', {
      [`POST /api/classes/${uid(50)}/members`]: () =>
        json({ members: [], freeToday: 23, freeLeast: 23, today: '2026-10-10' }, 201),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    const [first] = screen.getAllByRole('checkbox').slice(1);
    fireEvent.click(first as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: en.classes.putIntoClass }));
    const title = en.classes.placeTitle_one.replace('{{n}}', '1');
    const form = await within(await screen.findByRole('complementary', { name: title })).findByRole(
      'form',
      { name: title },
    );
    const choice = within(form).getByLabelText<HTMLSelectElement>(en.classes.name);
    // Classes of the grade ticked, active: not 8 Princeton, not the archived Yale.
    expect([...choice.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      en.classes.chooseClass,
      '7 Oxford · 2026–2027',
    ]);
    fireEvent.change(choice, { target: { value: uid(50) } });
    // Decision 6: the latest of today, the year's start and the students' start dates.
    expect(within(form).getByLabelText<HTMLInputElement>(en.classes.from).value).toBe('2026-10-10');
    fireEvent.change(within(form).getByLabelText(en.classes.from), {
      target: { value: '2026-10-12' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(await screen.findByText(en.classes.placed_one.replace('{{n}}', '1'))).toBeDefined();
    expect(
      calls.find((call) => call.route === `POST /api/classes/${uid(50)}/members`)?.body,
    ).toEqual({ students: [{ id: OTKIR.id, version: OTKIR.version }], from: '2026-10-12' });
  });

  it('asks for students of one grade', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    for (const box of screen.getAllByRole('checkbox').slice(1)) {
      fireEvent.click(box);
    }
    fireEvent.click(await screen.findByRole('button', { name: en.classes.putIntoClass }));
    const title = en.classes.placeTitle_other.replace('{{n}}', '2');
    const panel = await screen.findByRole('complementary', { name: title });
    expect(await within(panel).findByText(en.classes.oneGradeOnly)).toBeDefined();
  });

  it('shows the Academic block: the class, its Tutor and its main classroom, in Russian too', async () => {
    for (const language of ['en', 'ru'] as const) {
      cleanup();
      openList('principal', {}, language, { mainRoom: '204' });
      renderApp(PATH, language);
      fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
      const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
      const texts = language === 'en' ? en : ru;
      const block = (
        await within(panel).findByRole('heading', { name: texts.people.students.academic })
      ).closest('section');
      expect(block).not.toBeNull();
      const terms = [...(block?.querySelectorAll('dl > div') ?? [])].map((row) => [
        row.querySelector('dt')?.textContent,
        row.querySelector('dd')?.textContent,
      ]);
      expect(terms).toEqual([
        [texts.people.students.class, '7 Oxford'],
        // Task 3.2b: the groups of the student, none here.
        [texts.people.students.groups, '—'],
        [texts.people.students.tutor, 'Tursunova Dilnoza'],
        [texts.people.students.mainRoom, '204'],
      ]);
    }
  });
});

// Task 3.1c, pull request #90: the Tutor reads the whole list and opens the
// rows the server marks (`opens`, decision 8); the export of a Tutor names
// the rows the server left out (decision 5).
describe('the student list of a Tutor', () => {
  it('opens only the rows the server marks, in the table', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('tutor')),
      'GET /api/people/students': () =>
        json({
          students: [OTKIR, { ...ZARINA, opens: false }],
          canArchive: false,
          exportGroups: ['basic'],
          readsFinancial: false,
          today: '2026-10-10',
        }),
      [`GET /api/people/students/${OTKIR.id}`]: () => json(detailOf(OTKIR)),
      [`GET /api/people/students/${OTKIR.id}/relatives`]: () => json(MOTHER),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(document.querySelector(`[data-open-row="${ZARINA.id}"]`)).toBeNull();
    const open = document.querySelector<HTMLButtonElement>(`[data-open-row="${OTKIR.id}"]`);
    expect(open).not.toBeNull();
    open?.click();
    expect(await screen.findByRole('complementary')).toBeDefined();
  });

  it('says how many rows the server left out of the file', async () => {
    class FileUrl extends URL {
      static override createObjectURL = (): string => 'blob:file';
      static override revokeObjectURL = (): void => undefined;
    }
    vi.stubGlobal('URL', FileUrl);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('tutor')),
      'GET /api/people/students': () =>
        json({
          students: [OTKIR, { ...ZARINA, opens: false }],
          canArchive: false,
          exportGroups: ['basic'],
          readsFinancial: false,
          today: '2026-10-10',
        }),
      'POST /api/people/students/export': (body) =>
        new Response(new Blob(['PK']), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'X-Export-Columns': (body as { columns: string[] }).columns.join(','),
            'X-Export-Rows-Left-Out': '1',
          },
        }),
    });
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole('button', { name: en.list.export }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/students/export')).toBe(true);
    });
    expect(
      await screen.findByText('1 row is not in the file, because it is outside your classes.'),
    ).toBeDefined();
    vi.restoreAllMocks();
  });
});
