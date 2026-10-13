import type { Role, StudentDetail, StudentListItem } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
        today: '2026-10-10',
      }),
    [`GET /api/people/students/${OTKIR.id}`]: () => json(detailOf(OTKIR, detail)),
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
        '2607001',
        'Oʻtkir Rahimov',
        en.people.students.gradeNoClass.replace('{{grade}}', grade(7)),
        '—',
        '—',
        en.people.students.statuses.active,
      ],
      [
        '2507014',
        'Zarina Saidova',
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
      expect(rowsDrawn()[0]?.[1]).toBe('Oʻtkir Rahimov');
    },
  );

  it('filters by grade', async () => {
    openList('principal');
    renderApp(`${PATH}?f=${encodeURIComponent(JSON.stringify({ grade: '8' }))}`);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[1]).toBe('Zarina Saidova');
  });

  it('is in Russian', async () => {
    openList('principal', {}, 'ru');
    renderApp(PATH, 'ru');
    await screen.findByRole('heading', { name: ru.people.students.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()[0]?.[2]).toBe(
      ru.people.students.gradeNoClass.replace(
        '{{grade}}',
        ru.setup.subjects.grade.replace('{{grade}}', '7'),
      ),
    );
    expect(rowsDrawn()[0]?.[5]).toBe(ru.people.students.statuses.active);
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
    fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
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

  it('draws only the groups a Head Tutor reads: no contract tab, no documents', async () => {
    openList('head_tutor', {}, 'en', {
      identity: null,
      financial: null,
      canEdit: false,
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    expect(await within(panel).findByText('+998901234567')).toBeDefined();
    // One tab draws no control: the Overview alone.
    expect(within(panel).queryByRole('radiogroup')).toBeNull();
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
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    return form;
  }

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
        en.people.students.takenHere.replace('{{student}}', 'Oʻtkir Rahimov (2607001)'),
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
    fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
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
    fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
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
    fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
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
          today: '2026-10-10',
        }),
    });
    renderApp(PATH, 'ru');
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(1);
    });
    expect(rowsDrawn()[0]?.[5]).toContain(ru.people.students.statuses.active);
    expect(rowsDrawn()[0]?.[5]).toContain(ru.people.students.inactiveFrom.split(' ')[0] ?? '');
  });

  it('brings an inactive student back with a new contract', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students': () =>
        json({ students: [LOLA], canArchive: true, today: '2026-10-10' }),
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
    fireEvent.click(await screen.findByText('Lola Karimova', { selector: 'button' }));
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
    fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
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
    expect(within(dialog).getByText('Zarina Saidova')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.students.leaveAction }));
    expect(
      await screen.findByText(
        en.people.students.bulkRefused.replace('{{names}}', 'Zarina Saidova'),
        { exact: false },
      ),
    ).toBeDefined();
    expect(calls.filter((call) => call.route.endsWith('/leaving'))).toHaveLength(2);
  });

  it('offers "Restore this student" for an inactive holder of the document, and opens them', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
      'GET /api/people/students': () =>
        json({ students: [OTKIR, LOLA], canArchive: true, today: '2026-10-10' }),
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
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    expect(
      await within(form).findByText(
        en.people.students.takenHere.replace('{{student}}', 'Oʻtkir Rahimov (2607001)'),
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
        json({ students: [row], canArchive: detail.canArchive, today: '2026-10-10' }),
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
          json({ students: [OTKIR, GRADUATED], canArchive: true, today: '2026-10-10' }),
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
      fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
      expect(
        await within(form).findByText(
          en.people.students.takenHere.replace('{{student}}', 'Nodira Ergasheva (2607040)'),
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
