import {
  type Role,
  type StudentDetail,
  type StudentListItem,
  type StudentRelatives,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

const uid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/students';

// All names and phones are invented. Task 2.5a, pull request #72: the
// relative step of a new student and the Relatives tab (`04`, Close
// relatives; edge/close-relatives).
const OTKIR: StudentListItem = {
  id: uid(1),
  uid: '2607001',
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
  version: 1,
};

const DETAIL: StudentDetail = {
  ...OTKIR,
  contact: { phone: null, email: null },
  identity: {
    birthDate: '2014-03-02',
    documentType: null,
    documentNumber: null,
    jshshir: null,
    address: null,
    region: null,
  },
  identityHidden: false,
  financial: {
    contracts: [{ id: uid(31), number: 'SQ-2026/017', signedOn: '2026-08-20' }],
    scholarship: { type: 'none', coverage: null, amount: null },
    previousSchool: null,
    diagnosticScore: null,
    consentSignedOn: null,
  },
  statuses: [{ status: 'active', from: '2026-09-02', until: null, cause: 'start', reason: null }],
  canEdit: true,
  canArchive: false,
  canRestoreGraduated: false,
  deletable: false,
  today: '2026-10-10',
};

const relative = (n: number, fullName: string, mainContact: boolean) => ({
  relativeId: uid(n),
  fullName,
  phone: `+99890111220${String(n % 10)}`,
  relationship: mainContact ? ('mother' as const) : ('father' as const),
  mainContact,
  portalAccess: true,
  receivesNotices: true,
  identity: { workplace: null, email: null },
});

const TWO: StudentRelatives = {
  relatives: [relative(40, 'Dilfuza Rahimova', true), relative(41, 'Anvar Rahimov', false)],
  canEdit: true,
};

const sessionAs = (role: Role) =>
  sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  });

function openList(
  relatives: StudentRelatives,
  extra: Record<string, (body: unknown) => Response> = {},
) {
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs('academic_vice_principal')),
    'GET /api/people/students': () =>
      json({
        students: [OTKIR],
        canArchive: true,
        exportGroups: [],
        readsFinancial: true,
        today: '2026-10-10',
      }),
    [`GET /api/people/students/${OTKIR.id}`]: () => json(DETAIL),
    [`GET /api/people/students/${OTKIR.id}/relatives`]: () => json(relatives),
    ...extra,
  });
}

const openPanel = async () => {
  fireEvent.click(await screen.findByText('Oʻtkir Rahimov', { selector: 'button' }));
  return screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
};

const tabOf = (panel: HTMLElement, name: string) =>
  within(within(panel).getByRole('radiogroup')).getByRole<HTMLInputElement>('radio', { name });

describe('the relative step of a new student', () => {
  it('shows the person a typed phone belongs to and links them (04, Adding a relative)', async () => {
    const calls = openList(TWO, {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/relatives/phone-match': () =>
        json({ holder: { id: uid(50), fullName: 'Shoira Nazarova', students: 2 } }),
      'POST /api/people/students': () => json(DETAIL, 201),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.uid, '2607002');
    type(en.people.students.lastName, 'Nazarov');
    type(en.people.students.firstName, 'Jamshid');
    type(en.people.students.sex, 'male');
    type(en.people.students.birthDate, '2014-05-02');
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    type(en.people.students.contractNumber, 'SQ-2026/140');
    type(en.people.students.contractSignedOn, '2026-08-20');
    const phone = within(form).getByLabelText(en.people.relatives.phone);
    fireEvent.change(phone, { target: { value: '+998 90 777 88 99' } });
    fireEvent.blur(phone);
    expect(
      await within(form).findByText(
        en.people.relatives.found_other
          .replace('{{name}}', 'Shoira Nazarova')
          .replace('{{count}}', '2'),
      ),
    ).toBeDefined();
    // The fields of a new relative are gone: this person is linked.
    expect(within(form).queryByLabelText(en.people.relatives.fullName)).toBeNull();
    type(en.people.relatives.relationship, 'aunt');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/students')).toBe(true);
    });
    const sent = calls.find((call) => call.route === 'POST /api/people/students')?.body as {
      relatives: unknown[];
    };
    expect(sent.relatives).toEqual([
      {
        kind: 'existing',
        relativeId: uid(50),
        phone: '+998907778899',
        relationship: 'aunt',
        mainContact: true,
        portalAccess: true,
        receivesNotices: true,
      },
    ]);
  });
});

describe("the student's Relatives tab", () => {
  it('opens first for a student with no relative, with the add form', async () => {
    openList({ relatives: [], canEdit: true });
    renderApp(PATH);
    const panel = await openPanel();
    await waitFor(() => {
      expect(tabOf(panel, en.people.students.tabs.relatives).checked).toBe(true);
    });
    expect(within(panel).getByText(en.people.relatives.needsRelative)).toBeDefined();
    expect(within(panel).getByRole('button', { name: en.people.relatives.add })).toBeDefined();
  });

  it('asks the next main contact before unlinking the main one, naming both people', async () => {
    const calls = openList(TWO, {
      [`POST /api/people/students/${OTKIR.id}/relatives/${uid(40)}/unlink`]: () =>
        json({ relatives: [{ ...relative(41, 'Anvar Rahimov', true) }], canEdit: true }),
    });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    const items = await within(panel).findAllByRole('listitem');
    const main = items.find((item) => within(item).queryByText('Dilfuza Rahimova') !== null);
    if (main === undefined) {
      throw new Error('The main contact is listed.');
    }
    const unlink = within(main).getByRole('button', { name: en.people.relatives.unlink });
    expect(unlink.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(main).getByLabelText(en.people.relatives.newMain), {
      target: { value: uid(41) },
    });
    fireEvent.click(unlink);
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.relatives.unlinkTitle,
    });
    expect(within(dialog).getByText('Dilfuza Rahimova')).toBeDefined();
    expect(within(dialog).getByText('Oʻtkir Rahimov')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.relatives.unlink }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/unlink'))?.body).toEqual({
        newMainContactId: uid(41),
      });
    });
  });

  // Decision 8: a relative with no phone of their own gets no notices.
  it('shows "receives notices" off and locked for a relative with no phone of their own', async () => {
    openList(TWO);
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    fireEvent.click(await within(panel).findByRole('button', { name: en.people.relatives.add }));
    const form = await within(panel).findByRole('form', {
      name: en.people.relatives.formLabel.replace('{{name}}', 'Oʻtkir Rahimov'),
    });
    const notices = within(form).getByRole<HTMLInputElement>('checkbox', {
      name: en.people.relatives.receivesNotices,
    });
    expect(notices.checked).toBe(true);
    fireEvent.click(within(form).getByRole('checkbox', { name: en.people.relatives.noPhone }));
    expect(notices.checked).toBe(false);
    expect(notices.disabled).toBe(true);
  });
});
