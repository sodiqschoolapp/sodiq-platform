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
  statuses: [{ status: 'active', from: '2026-09-02', until: null }],
  canEdit: true,
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

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

function openList(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
  detail: Partial<StudentDetail> = {},
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/people/students': () => json({ students: [OTKIR, ZARINA], today: '2026-10-10' }),
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
        en.people.students.noClass,
        '—',
        '—',
        grade(7),
        en.people.students.statuses.active,
      ],
      [
        '2507014',
        'Zarina Saidova',
        en.people.students.noClass,
        '—',
        '—',
        grade(8),
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
    expect(rowsDrawn()[0]?.[2]).toBe(ru.people.students.noClass);
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
    fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: en.people.students.showIdentity });
    expect(within(panel).getAllByText(en.people.students.hidden)).toHaveLength(2);
    expect(within(panel).queryByRole('form')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: en.people.students.showIdentity }));
    expect(await within(panel).findByText('31403141234567')).toBeDefined();
    expect(calls.filter((call) => call.route.endsWith('/identity'))).toHaveLength(1);

    fireEvent.click(within(panel).getByRole('tab', { name: en.people.students.tabs.contract }));
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
    expect(
      within(panel)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual([en.people.students.tabs.overview]);
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
