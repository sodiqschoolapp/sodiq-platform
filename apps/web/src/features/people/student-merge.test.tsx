import {
  type Role,
  type StudentDetail,
  type StudentListItem,
  type StudentMergePreview,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { schoolDateText } from '@/lib/dates';
import { edit, panelActionNames, savedInPanel } from '@/testing/panel';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const uid = (n: number): string => `0199f200-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/students';
const texts = en.people.students.merge;

// All names are invented. edge/students-classes-groups, "The Super Admin can
// merge two records; the older UID survives". Task 3.3d, pull request #98.
const OXFORD = { id: uid(50), grade: 7, name: 'Oxford' };

const STUDENT: StudentListItem = {
  id: uid(1),
  uid: '2607001',
  mergedUids: [],
  firstName: 'Oʻtkir',
  lastName: 'Rahimov',
  paternalName: null,
  sex: 'male',
  grade: 7,
  startsOn: '2026-09-02',
  photoId: null,
  consentMissing: null,
  status: 'active',
  planned: null,
  class: { ...OXFORD, language: 'uz', from: '2026-09-02', until: '2027-06-01' },
  plannedClass: null,
  tutor: null,
  actingTutor: null,
  groups: [],
  version: 2,
  opens: true,
};

const detailOf = (fields: Partial<StudentDetail> = {}): StudentDetail => ({
  ...STUDENT,
  contact: null,
  identity: null,
  identityHidden: false,
  mainRoom: null,
  financial: null,
  diagnosticScore: null,
  readsDiagnostic: false,
  statuses: [{ status: 'active', from: '2026-09-02', until: null, cause: 'start', reason: null }],
  canEdit: true,
  canArchive: true,
  canRestoreGraduated: true,
  deletable: false,
  scheduledMoves: [],
  lastClassMove: null,
  canMoveClass: true,
  groupMoveSubjects: [],
  canMoveInPast: true,
  readsHistory: false,
  branchMove: null,
  lastBranchMove: null,
  canMoveBranch: true,
  canMerge: true,
  today: '2026-10-10',
  ...fields,
});

const side = (fields: Partial<StudentMergePreview['kept']> = {}): StudentMergePreview['kept'] => ({
  id: STUDENT.id,
  uid: STUDENT.uid,
  firstName: STUDENT.firstName,
  lastName: STUDENT.lastName,
  grade: 7,
  branch: { id: NORTH.id, name: NORTH.name },
  status: 'active',
  startsOn: '2026-09-02',
  today: '2026-10-10',
  class: { grade: 7, name: 'Oxford' },
  ...fields,
});

const OTHER = side({
  id: uid(2),
  uid: '2607044',
  firstName: 'Oʻtkir',
  lastName: 'Rahimovv',
  class: { grade: 7, name: 'Yale' },
});

const PREVIEW: StudentMergePreview = {
  kept: side(),
  merged: OTHER,
  branch: { id: NORTH.id, name: NORTH.name },
  life: [{ status: 'active', from: '2026-09-02', until: null, side: 'kept' }],
  rows: [
    {
      kind: 'class',
      side: 'merged',
      action: 'left',
      name: '7 Yale',
      from: '2026-09-10',
      until: '2027-06-01',
      cutAt: null,
    },
  ],
  carried: 2,
  filled: ['address'],
  differing: [{ field: 'sex', kept: 'male', merged: 'female' }],
  // Task 3.5b, H29: the values beside the personal fields.
  values: {
    later: 'kept',
    startsOn: { kept: '2026-09-02', merged: '2026-09-10', result: '2026-09-02' },
    grade: { kept: 7, merged: 7 },
    scholarship: {
      kept: { type: 'none', coverage: null, amount: null },
      merged: { type: 'none', coverage: null, amount: null },
    },
    contracts: [
      { side: 'kept', number: 'SQ-2026/001', signedOn: '2026-08-20' },
      { side: 'merged', number: 'SQ-2026/044', signedOn: '2026-09-01' },
    ],
    relatives: [
      { side: 'kept', fullName: 'Rahimova Dilfuza', relationship: 'mother', fate: 'stays' },
      { side: 'merged', fullName: 'Rahimov Anvar', relationship: 'father', fate: 'added' },
      {
        side: 'merged',
        fullName: 'Rahimova Dilfuza',
        relationship: 'mother',
        fate: 'already_linked',
      },
    ],
  },
  refusal: null,
  digest: 'a'.repeat(64),
};

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

function open(
  detail: StudentDetail,
  extra: Record<string, (body: unknown) => Response> = {},
  options: { role?: Role; language?: 'en' | 'ru' } = {},
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(options.role ?? 'super_admin', options.language)),
    'GET /api/people/students': () =>
      json({
        students: [STUDENT],
        canArchive: true,
        exportGroups: [],
        readsFinancial: false,
        today: '2026-10-10',
      }),
    [`GET /api/people/students/${STUDENT.id}`]: () => json(detail),
    'GET /api/people/branch-moves/incoming': () =>
      json({ moves: [], canDecide: true, today: '2026-10-10' }),
    [`GET /api/people/students/${STUDENT.id}/merge`]: () => json(PREVIEW),
    ...extra,
  });
}

/** Opens the merge form, types the other UID and shows the preview. */
async function previewed(panel: HTMLElement): Promise<HTMLElement> {
  await within(panel).findByRole('button', { name: texts.action });
  const form = await edit(panel, texts.action, texts.action);
  fireEvent.change(within(form).getByLabelText(texts.uid), { target: { value: OTHER.uid } });
  fireEvent.click(within(form).getByRole('button', { name: texts.show }));
  await within(form).findByText(texts.kept);
  return form;
}

describe('the merge of two student records', () => {
  it('offers the merge only to a reader the server lets merge', async () => {
    open(detailOf({ canMerge: false }), {}, { role: 'academic_vice_principal' });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await waitFor(() => {
      expect(panelActionNames(panel)).toContain(en.people.students.branchMoves.move);
    });
    expect(panelActionNames(panel)).not.toContain(texts.action);
  });

  it('shows the preview, asks a confirmation naming both records, and sends the digest it saw', async () => {
    let done = false;
    const calls = open(detailOf(), {
      [`GET /api/people/students/${STUDENT.id}`]: () =>
        json(done ? detailOf({ mergedUids: [OTHER.uid] }) : detailOf()),
      [`POST /api/people/students/${STUDENT.id}/merge`]: () => {
        done = true;
        return json({
          student: detailOf({ mergedUids: [OTHER.uid] }),
          branch: { id: NORTH.id, name: NORTH.name },
        });
      },
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await previewed(panel);
    expect(
      calls.find((call) => call.route === `GET /api/people/students/${STUDENT.id}/merge`)?.query,
    ).toBe(`?uid=${OTHER.uid}`);
    expect(
      within(form).getByText(
        texts.rowLeft
          .replace('{{name}}', '7 Yale')
          .replace('{{from}}', schoolDateText('2026-09-10', 'en')),
      ),
    ).toBeDefined();
    // Task 3.5b, H29 of issue #105: each value of both records and the one kept.
    const differing = within(form).getByRole('heading', { name: texts.differing }).parentElement;
    const lines = [...(differing?.querySelectorAll('li') ?? [])].map((one) => one.textContent);
    const line = (field: string, kept: string, merged: string, result: string) =>
      texts.differs
        .replace('{{field}}', field)
        .replace('{{kept}}', kept)
        .replace('{{merged}}', merged)
        .replace('{{result}}', result);
    const day = (date: string) => schoolDateText(date, 'en');
    expect(lines).toEqual([
      line(texts.fields.sex, 'Male', 'Female', 'Male'),
      line(texts.valueFields.startsOn, day('2026-09-02'), day('2026-09-10'), day('2026-09-02')),
      line(
        texts.valueFields.contracts,
        `SQ-2026/001 of ${day('2026-08-20')}`,
        `SQ-2026/044 of ${day('2026-09-01')}`,
        texts.allKept,
      ),
      line(
        texts.valueFields.relatives,
        'Rahimova Dilfuza (Mother)',
        'Rahimov Anvar (Father), Rahimova Dilfuza (Mother)',
        'Rahimova Dilfuza (Mother), Rahimov Anvar (Father)',
      ),
      texts.alreadyLinked
        .replace('{{name}}', 'Rahimova Dilfuza')
        .replace('{{relationship}}', 'Mother'),
    ]);
    fireEvent.change(within(form).getByLabelText(texts.reason), {
      target: { value: 'Created twice by mistake' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', { name: texts.confirmTitle });
    expect(
      within(dialog).getByText(
        texts.confirmText.replace('{{merged}}', OTHER.uid).replace('{{kept}}', STUDENT.uid),
      ),
    ).toBeDefined();
    expect(
      within(dialog).getByText(`Rahimovv Oʻtkir · UID ${OTHER.uid} · ${NORTH.name}`),
    ).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: texts.submit }));
    await waitFor(() => {
      expect(done).toBe(true);
    });
    expect(calls.find((call) => call.route.startsWith('POST'))?.body).toEqual({
      uid: OTHER.uid,
      reason: 'Created twice by mistake',
      digest: PREVIEW.digest,
    });
    await savedInPanel(panel);
    // The System block names the merged UID ("Also UID ...").
    expect(within(panel).getByText(OTHER.uid)).toBeDefined();
    expect(within(panel).getByText(texts.alsoUid)).toBeDefined();
  });

  // Task 9.4c: the other record's UID in any form, spaces left out.
  it('asks for a UID of letters without its spaces, and not for one longer than 20 characters', async () => {
    const calls = open(detailOf());
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    await within(panel).findByRole('button', { name: texts.action });
    const form = await edit(panel, texts.action, texts.action);
    const field = within(form).getByLabelText(texts.uid);
    expect(field.getAttribute('inputmode')).toBeNull();
    expect(within(form).getByText(en.people.students.uidFormat)).toBeDefined();
    const show = within(form).getByRole('button', { name: texts.show });
    fireEvent.change(field, { target: { value: 'A'.repeat(21) } });
    expect(show.hasAttribute('disabled')).toBe(true);
    fireEvent.change(field, { target: { value: ' si 2607 001' } });
    expect(show.hasAttribute('disabled')).toBe(false);
    fireEvent.click(show);
    await within(form).findByText(texts.kept);
    expect(
      calls.find((call) => call.route === `GET /api/people/students/${STUDENT.id}/merge`)?.query,
    ).toBe('?uid=si2607001');
  });

  // Issue #105, H13: a record whose start date is ahead reads "From <date>".
  it('shows "From <date>" for a record that starts later', async () => {
    open(detailOf(), {
      [`GET /api/people/students/${STUDENT.id}/merge`]: () =>
        json({ ...PREVIEW, merged: { ...OTHER, startsOn: '2026-10-19' } }),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await previewed(panel);
    expect(
      within(form).getByText(
        en.people.students.startsFrom.replace('{{date}}', schoolDateText('2026-10-19', 'en')),
      ),
    ).toBeDefined();
    expect(within(form).getByText(en.people.students.statuses.active)).toBeDefined();
  });

  it('shows the refusal of the preview with its day, and merges nothing', async () => {
    const calls = open(detailOf(), {
      [`GET /api/people/students/${STUDENT.id}/merge`]: () =>
        json({ ...PREVIEW, refusal: { code: 'student_merge_overlap', day: '2026-09-15' } }),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await previewed(panel);
    const alert = within(form).getByRole('alert');
    expect(within(alert).getByText(en.errors.student_merge_overlap)).toBeDefined();
    expect(
      within(alert).getByText(
        texts.refusedDay.replace('{{date}}', schoolDateText('2026-09-15', 'en')),
      ),
    ).toBeDefined();
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Twice' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await within(form).findByText(en.form.notSaved);
    expect(calls.some((call) => call.route.startsWith('POST'))).toBe(false);
  });

  it('moves the panel to the kept record when it is the other one, the form taken away first', async () => {
    open(detailOf(), {
      [`GET /api/people/students/${OTHER.id}`]: () =>
        json(detailOf({ id: OTHER.id, uid: OTHER.uid, mergedUids: [STUDENT.uid] })),
      [`POST /api/people/students/${STUDENT.id}/merge`]: () =>
        json({
          student: detailOf({ id: OTHER.id, uid: OTHER.uid, mergedUids: [STUDENT.uid] }),
          branch: { id: NORTH.id, name: NORTH.name },
        }),
    });
    const { router } = renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await previewed(panel);
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Twice' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', { name: texts.confirmTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: texts.submit }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ open: OTHER.id });
    });
    // No question about leaving unsent changes: the form went first.
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('says the kept record is of another branch now, names it, and reads nothing more', async () => {
    const calls = open(detailOf(), {
      [`POST /api/people/students/${STUDENT.id}/merge`]: () =>
        json({
          student: detailOf({ mergedUids: [OTHER.uid] }),
          branch: { id: SOUTH.id, name: SOUTH.name },
        }),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await previewed(panel);
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Twice' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', { name: texts.confirmTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: texts.submit }));
    expect(
      await within(panel).findByText(
        texts.leftBranch.replace('{{name}}', 'Oʻtkir Rahimov').replace('{{branch}}', SOUTH.name),
      ),
    ).toBeDefined();
    // Nothing is read after the merge: not the record (404 in this branch now).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const posted = calls.findIndex((call) => call.route.startsWith('POST'));
    expect(
      calls.slice(posted).some((call) => call.route === `GET /api/people/students/${STUDENT.id}`),
    ).toBe(false);
  });

  it('keeps the refusal when the student changed after the preview, and reads both again', async () => {
    const calls = open(detailOf(), {
      [`POST /api/people/students/${STUDENT.id}/merge`]: () =>
        json(
          {
            error: {
              code: 'student_changed',
              message: 'The student changed.',
              requestId: 'r-1',
            },
          },
          409,
        ),
    });
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    const form = await previewed(panel);
    const previews = () =>
      calls.filter((call) => call.route === `GET /api/people/students/${STUDENT.id}/merge`).length;
    const details = () =>
      calls.filter((call) => call.route === `GET /api/people/students/${STUDENT.id}`).length;
    const before = { previews: previews(), details: details() };
    fireEvent.change(within(form).getByLabelText(texts.reason), { target: { value: 'Twice' } });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    const dialog = await screen.findByRole('alertdialog', { name: texts.confirmTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: texts.submit }));
    expect(await within(form).findByText(en.errors.student_changed)).toBeDefined();
    await waitFor(() => {
      expect(previews()).toBeGreaterThan(before.previews);
      expect(details()).toBeGreaterThan(before.details);
    });
  });

  it('draws the merge on the History tab, in Russian too', async () => {
    open(
      detailOf({ readsHistory: true, mergedUids: [OTHER.uid] }),
      {
        [`GET /api/people/students/${STUDENT.id}/history`]: () =>
          json({
            lines: [{ kind: 'merged', on: '2026-10-10', uid: OTHER.uid, reason: 'Created twice' }],
            today: '2026-10-10',
          }),
      },
      { language: 'ru' },
    );
    renderApp(`${PATH}?open=${STUDENT.id}`);
    const panel = await screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
    fireEvent.click(
      await within(panel).findByRole('radio', { name: ru.people.students.tabs.history }),
    );
    expect(
      await within(panel).findByText(
        ru.people.students.merge.historyLine
          .replace('{{uid}}', OTHER.uid)
          .replace('{{reason}}', 'Created twice'),
      ),
    ).toBeDefined();
    expect(within(panel).getByText(schoolDateText('2026-10-10', 'ru'))).toBeDefined();
  });
});
