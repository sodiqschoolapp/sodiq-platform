import {
  type Role,
  type StudentDetail,
  type StudentListItem,
  type StudentRelatives,
} from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import {
  fakeApi,
  json,
  NORTH,
  renderApp,
  sessionOf,
  SOUTH,
  type Handler,
} from '@/testing/render-app';
import { panelActions, savedInPanel } from '@/testing/panel';

const uid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/students';

// All names and phones are invented. Task 2.5a, pull request #72: the
// relative step of a new student and the Relatives tab (`04`, Close
// relatives; edge/close-relatives).
const OTKIR: StudentListItem = {
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
  class: null,
  plannedClass: null,
  tutor: null,
  actingTutor: null,
  groups: [],
  version: 1,
  opens: true,
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
  mainRoom: null,
  financial: {
    contracts: [{ id: uid(31), number: 'SQ-2026/017', signedOn: '2026-08-20' }],
    scholarship: { type: 'none', coverage: null, amount: null },
    previousSchool: null,
    consentSignedOn: null,
  },
  diagnosticScore: null,
  readsDiagnostic: true,
  statuses: [{ status: 'active', from: '2026-09-02', until: null, cause: 'start', reason: null }],
  canEdit: true,
  canArchive: false,
  canRestoreGraduated: false,
  deletable: false,
  scheduledMoves: [],
  lastClassMove: null,
  canMoveClass: false,
  groupMoveSubjects: [],
  canMoveInPast: false,
  readsHistory: false,
  branchMove: null,
  lastBranchMove: null,
  canMoveBranch: false,
  canMerge: false,
  today: '2026-10-10',
};

const relative = (n: number, fullName: string, mainContact: boolean) => ({
  relativeId: uid(n),
  fullName,
  phone: `+99890111220${String(n % 10)}`,
  extraPhones: [] as string[],
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

function openList(relatives: StudentRelatives, extra: Record<string, Handler> = {}) {
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
  fireEvent.click(await screen.findByText('Rahimov Oʻtkir', { selector: 'button' }));
  return screen.findByRole('complementary', { name: 'Oʻtkir Rahimov' });
};

const tabOf = (panel: HTMLElement, name: string) =>
  within(within(panel).getByRole('radiogroup')).getByRole<HTMLInputElement>('radio', { name });

describe('the relative step of a new student', () => {
  it('shows the person a typed phone belongs to and links them (04, Adding a relative)', async () => {
    const calls = openList(TWO, {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/relatives/phone-match': () =>
        json({
          staff: null,
          staffElsewhere: false,
          holder: { id: uid(50), fullName: 'Shoira Nazarova', students: 2 },
        }),
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
    expect(within(form).queryByLabelText(en.people.relatives.fullNameField)).toBeNull();
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

describe('the new owner of a typed phone (task 2.5b-1; edge/close-relatives, row 2)', () => {
  it('creates a different person with the number and gives the earlier one a new phone', async () => {
    const calls = openList(TWO, {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/relatives/phone-match': () =>
        json({
          staff: null,
          staffElsewhere: false,
          holder: { id: uid(50), fullName: 'Shoira Nazarova', students: 1 },
        }),
      'POST /api/people/students': () => json(DETAIL, 201),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.uid, '2607003');
    type(en.people.students.lastName, 'Nazarov');
    type(en.people.students.firstName, 'Jamshid');
    type(en.people.students.sex, 'male');
    type(en.people.students.birthDate, '2014-05-02');
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    type(en.people.students.contractNumber, 'SQ-2026/141');
    type(en.people.students.contractSignedOn, '2026-08-20');
    const phone = within(form).getByLabelText(en.people.relatives.phone);
    fireEvent.change(phone, { target: { value: '+998 90 777 88 99' } });
    fireEvent.blur(phone);
    const choice = await within(form).findByLabelText(
      en.people.relatives.ownerChoice.replace('{{name}}', 'Shoira Nazarova'),
    );
    fireEvent.change(choice, { target: { value: 'new_owner' } });
    // The fields of the new person are back, with the earlier relative's new phone.
    type(en.people.relatives.fullNameField, 'Nodira Rasulova');
    type(
      en.people.relatives.previousPhone.replace('{{name}}', 'Shoira Nazarova'),
      '+998 90 111 22 33',
    );
    type(en.people.relatives.relationship, 'mother');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/students')).toBe(true);
    });
    const sent = calls.find((call) => call.route === 'POST /api/people/students')?.body as {
      relatives: unknown[];
    };
    expect(sent.relatives).toEqual([
      {
        kind: 'new_owner',
        relative: {
          fullName: 'Nodira Rasulova',
          phone: '+998907778899',
          workplace: null,
          email: null,
          extraPhones: [],
        },
        previousId: uid(50),
        previousPhone: '+998901112233',
        relationship: 'mother',
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
    // The main contact's Unlink first asks for the new main contact, in the row (task 2.7c-2b-2b).
    fireEvent.click(within(main).getByRole('button', { name: en.people.relatives.unlink }));
    const choice = await within(main).findByRole('form', {
      name: en.people.relatives.unlinkLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(choice).getByLabelText(en.people.relatives.newMain),
      );
    });
    const unlink = within(choice).getByRole('button', { name: en.people.relatives.unlink });
    // Finding 6 of the hand test of 13 October 2026: pressed with no new main
    // contact chosen, it says what to do first and sends nothing.
    fireEvent.click(unlink);
    expect(await within(main).findByText(en.people.relatives.chooseMainFirst)).toBeDefined();
    expect(
      within(main).getByLabelText(en.people.relatives.newMain).getAttribute('aria-invalid'),
    ).toBe('true');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(calls.some((call) => call.route.endsWith('/unlink'))).toBe(false);
    fireEvent.change(within(main).getByLabelText(en.people.relatives.newMain), {
      target: { value: uid(41) },
    });
    expect(within(main).queryByText(en.people.relatives.chooseMainFirst)).toBeNull();
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
    // The row is gone: "Saved." at the bottom, the focus on "Add relative".
    await savedInPanel(panel);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.people.relatives.add }),
      );
    });
  });

  // Task 2.7c-2b-2b: each row reads first, its actions open their form one at a time.
  const rowOf = async (panel: HTMLElement, fullName: string) => {
    const items = await within(panel).findAllByRole('listitem');
    const item = items.find((one) => within(one).queryByText(fullName) !== null);
    if (item === undefined) {
      throw new Error(`${fullName} is listed.`);
    }
    return item;
  };

  it('changes a link behind its button, one form at a time, and closes it with "Saved."', async () => {
    const calls = openList(TWO, {
      [`PATCH /api/people/students/${OTKIR.id}/relatives/${uid(41)}`]: () =>
        json({
          relatives: [
            relative(40, 'Dilfuza Rahimova', true),
            { ...relative(41, 'Anvar Rahimov', false), portalAccess: false },
          ],
          canEdit: true,
        }),
    });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    const anvar = await rowOf(panel, 'Anvar Rahimov');
    expect(within(panel).queryByRole('form')).toBeNull();
    fireEvent.click(within(anvar).getByRole('button', { name: en.people.relatives.changeLink }));
    const form = await within(anvar).findByRole('form', {
      name: en.people.relatives.linkLabel.replace('{{name}}', 'Anvar Rahimov'),
    });
    // The other row's actions and the bottom row give way while it is open.
    const dilfuza = await rowOf(panel, 'Dilfuza Rahimova');
    expect(within(dilfuza).queryByRole('button')).toBeNull();
    expect(panelActions(panel)).toBeNull();
    fireEvent.click(within(form).getByRole('checkbox', { name: en.people.relatives.portalAccess }));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);
    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toEqual({
      relationship: 'father',
      mainContact: false,
      portalAccess: false,
      receivesNotices: true,
    });
    expect(within(panel).queryByRole('form')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(anvar).getByRole('button', { name: en.people.relatives.changeLink }),
      );
    });
  });

  it('unlinks a relative who is not the main contact behind its confirmation, and gives the focus to "Add relative"', async () => {
    const ONE = { relatives: [relative(40, 'Dilfuza Rahimova', true)], canEdit: true };
    let unlinked = false;
    const calls = openList(TWO, {
      [`POST /api/people/students/${OTKIR.id}/relatives/${uid(41)}/unlink`]: () => {
        unlinked = true;
        return json(ONE);
      },
      // Read again after the unlink: the list without the relative.
      [`GET /api/people/students/${OTKIR.id}/relatives`]: () => json(unlinked ? ONE : TWO),
    });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    const anvar = await rowOf(panel, 'Anvar Rahimov');
    fireEvent.click(within(anvar).getByRole('button', { name: en.people.relatives.unlink }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.relatives.unlinkTitle,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.relatives.unlink }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/unlink'))?.body).toEqual({
        newMainContactId: null,
      });
    });
    await waitFor(() => {
      expect(within(panel).queryByText('Anvar Rahimov')).toBeNull();
    });
    await savedInPanel(panel);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.people.relatives.add }),
      );
    });
  });

  it('offers no Unlink for the last relative (04: the last relative stays)', async () => {
    openList({ relatives: [relative(40, 'Dilfuza Rahimova', true)], canEdit: true });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    const dilfuza = await rowOf(panel, 'Dilfuza Rahimova');
    expect(
      within(dilfuza).getByRole('button', { name: en.people.relatives.changeLink }),
    ).toBeDefined();
    expect(within(dilfuza).queryByRole('button', { name: en.people.relatives.unlink })).toBeNull();
  });

  it('opens "Add relative" through the panel and closes it on Cancel without a call', async () => {
    const calls = openList(TWO);
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    fireEvent.click(await within(panel).findByRole('button', { name: en.people.relatives.add }));
    const form = await within(panel).findByRole('form', {
      name: en.people.relatives.formLabel.replace('{{name}}', 'Oʻtkir Rahimov'),
    });
    expect(within(panel).queryByRole('button', { name: en.people.relatives.add })).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: en.people.relatives.changeLink }),
    ).toBeNull();
    expect(panelActions(panel)).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: en.form.cancel }));
    await waitFor(() => {
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    expect(calls.some((call) => call.route.startsWith('POST'))).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.people.relatives.add }),
      );
    });
  });

  it('draws no action of a link for a reader who may not change them', async () => {
    openList({ ...TWO, canEdit: false });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    await rowOf(panel, 'Anvar Rahimov');
    for (const name of [
      en.people.relatives.changeLink,
      en.people.relatives.unlink,
      en.people.relatives.add,
    ]) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
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

// Task 2.5b-2 (edge/close-relatives, row 5): extra phones, beside the main phone.
describe('the extra phones of a relative', () => {
  it('shows them under the main phone on the Relatives tab', async () => {
    openList({
      relatives: [
        {
          ...relative(40, 'Dilfuza Rahimova', true),
          extraPhones: ['+998935556677', '+79161234567'],
        },
        relative(41, 'Anvar Rahimov', false),
      ],
      canEdit: false,
    });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    const items = await within(panel).findAllByRole('listitem');
    const valueIn = (name: string) => {
      const item = items.find((one) => within(one).queryByText(name) !== null);
      return item === undefined
        ? undefined
        : within(item).queryByText(en.people.relatives.extraPhones, { selector: 'dt' })
            ?.nextElementSibling?.textContent;
    };
    // Grouped when Uzbek, a foreign number as stored (finding 24, decision 4).
    expect(valueIn('Dilfuza Rahimova')).toBe('+998 93 555 66 77, +79161234567');
    // None for a relative with none.
    expect(valueIn('Anvar Rahimov')).toBeUndefined();
  });

  // Task 3.5b, H26 of issue #105: Save pressed before the lookup answered.
  it('waits for the phone lookup on Save and links the person it finds', async () => {
    let answer: (response: Response) => void = () => undefined;
    const late = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const calls = openList(TWO, {
      'POST /api/people/relatives/phone-match': () => late,
      [`POST /api/people/students/${OTKIR.id}/relatives`]: () => json(TWO),
    });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    fireEvent.click(await within(panel).findByRole('button', { name: en.people.relatives.add }));
    const form = await within(panel).findByRole('form', {
      name: en.people.relatives.formLabel.replace('{{name}}', 'Oʻtkir Rahimov'),
    });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.relatives.phone, '+998 +998907778899');
    type(en.people.relatives.fullNameField, 'Nodira Rasulova');
    type(en.people.relatives.relationship, 'grandmother');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/relatives/phone-match')).toBe(
        true,
      );
    });
    const added = () =>
      calls.filter((call) => call.route === `POST /api/people/students/${OTKIR.id}/relatives`);
    expect(added()).toHaveLength(0);
    answer(
      json({
        staff: null,
        staffElsewhere: false,
        holder: { id: uid(80), fullName: 'Rasulova Nodira', students: 2 },
      }),
    );
    await waitFor(() => {
      expect(added()).toHaveLength(1);
    });
    expect(added()[0]?.body).toEqual({
      kind: 'existing',
      relativeId: uid(80),
      phone: '+998907778899',
      relationship: 'grandmother',
      mainContact: false,
      portalAccess: true,
      receivesNotices: true,
    });
  });

  it('adds a relative with extra phones: added and removed, at most three, sent in the body', async () => {
    const calls = openList(TWO, {
      'POST /api/people/relatives/phone-match': () =>
        json({ staff: null, staffElsewhere: false, holder: null }),
      [`POST /api/people/students/${OTKIR.id}/relatives`]: () => json(TWO),
    });
    renderApp(PATH);
    const panel = await openPanel();
    fireEvent.click(tabOf(panel, en.people.students.tabs.relatives));
    fireEvent.click(await within(panel).findByRole('button', { name: en.people.relatives.add }));
    const form = await within(panel).findByRole('form', {
      name: en.people.relatives.formLabel.replace('{{name}}', 'Oʻtkir Rahimov'),
    });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    const extraLabel = (n: number) => en.people.relatives.extraPhone.replace('{{n}}', String(n));
    const add = () => {
      fireEvent.click(
        within(form).getByRole('button', { name: en.people.relatives.addExtraPhone }),
      );
    };
    type(en.people.relatives.phone, '+998 90 777 88 99');
    type(en.people.relatives.fullNameField, 'Nodira Rasulova');
    type(en.people.relatives.relationship, 'grandmother');
    add();
    add();
    add();
    expect(
      within(form).queryByRole('button', { name: en.people.relatives.addExtraPhone }),
    ).toBeNull();
    type(extraLabel(1), '+998 93 111 22 33');
    type(extraLabel(2), '+44 20 7946 0000');
    type(extraLabel(3), '+998 93 444 55 66');
    // A foreign number cannot receive SMS (answer 24), on an extra phone too.
    expect(await within(form).findByText(en.people.relatives.noSms)).toBeDefined();
    fireEvent.click(
      within(form).getByRole('button', {
        name: en.people.relatives.removeExtraPhone.replace('{{n}}', '2'),
      }),
    );
    expect(within(form).queryByLabelText(extraLabel(3))).toBeNull();
    expect(within(form).getByLabelText<HTMLInputElement>(extraLabel(2)).value).toBe(
      '+998 93 444 55 66',
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(
        calls.some((call) => call.route.endsWith('/relatives') && call.route.startsWith('POST')),
      ).toBe(true);
    });
    expect(
      calls.find((call) => call.route === `POST /api/people/students/${OTKIR.id}/relatives`)?.body,
    ).toEqual({
      kind: 'new',
      relative: {
        fullName: 'Nodira Rasulova',
        phone: '+998907778899',
        workplace: null,
        email: null,
        extraPhones: ['+998931112233', '+998934445566'],
      },
      relationship: 'grandmother',
      mainContact: false,
      portalAccess: true,
      receivesNotices: true,
    });
  });

  it('gives a new student’s relative extra phones in the relative step', async () => {
    const calls = openList(TWO, {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/relatives/phone-match': () =>
        json({ staff: null, staffElsewhere: false, holder: null }),
      'POST /api/people/students': () => json(DETAIL, 201),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const type = (label: string, value: string) => {
      fireEvent.change(within(form).getByLabelText(label), { target: { value } });
    };
    type(en.people.students.uid, '2607004');
    type(en.people.students.lastName, 'Nazarov');
    type(en.people.students.firstName, 'Jamshid');
    type(en.people.students.sex, 'male');
    type(en.people.students.birthDate, '2014-05-02');
    type(en.people.students.grade, '7');
    type(en.people.students.startsOn, '2026-09-02');
    type(en.people.students.contractNumber, 'SQ-2026/142');
    type(en.people.students.contractSignedOn, '2026-08-20');
    type(en.people.relatives.phone, '+998 90 777 88 99');
    type(en.people.relatives.fullNameField, 'Nodira Rasulova');
    type(en.people.relatives.relationship, 'mother');
    fireEvent.click(within(form).getByRole('button', { name: en.people.relatives.addExtraPhone }));
    type(en.people.relatives.extraPhone.replace('{{n}}', '1'), '+998 93 111 22 33');
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'POST /api/people/students')).toBe(true);
    });
    const sent = calls.find((call) => call.route === 'POST /api/people/students')?.body as {
      relatives: { relative: unknown }[];
    };
    expect(sent.relatives[0]?.relative).toEqual({
      fullName: 'Nodira Rasulova',
      phone: '+998907778899',
      workplace: null,
      email: null,
      extraPhones: ['+998931112233'],
    });
  });
});

// Task 3.6b-1 (pull request #119): a typed phone that is a staff member's.
describe('a typed phone of a staff member (edge/close-relatives, "A teacher is also a parent")', () => {
  const startStudent = async (match: Record<string, unknown>) => {
    const calls = openList(TWO, {
      'POST /api/people/students/check': () => json({ sameNameAndBirth: [], elsewhere: false }),
      'POST /api/people/relatives/phone-match': () => json(match),
      'POST /api/people/students': () => json(DETAIL, 201),
    });
    renderApp(PATH);
    fireEvent.click(await screen.findByRole('button', { name: en.people.students.add }));
    const form = await screen.findByRole('form', { name: en.people.students.newTitle });
    const phone = within(form).getByLabelText(en.people.relatives.phone);
    fireEvent.change(phone, { target: { value: '+998 90 777 88 99' } });
    fireEvent.blur(phone);
    return { calls, form };
  };

  it('says the parent will be the staff member, with the name and email of the staff record locked', async () => {
    const { form } = await startStudent({
      holder: null,
      staff: { fullName: 'Karimov Bahodir Akmalovich', email: 'b.karimov@example.uz' },
      staffElsewhere: false,
    });
    expect(
      await within(form).findByText(
        en.people.relatives.phoneIsStaff.replace('{{name}}', 'Karimov Bahodir Akmalovich'),
      ),
    ).toBeDefined();
    const name = within(form).getByLabelText<HTMLInputElement>(en.people.relatives.fullNameField);
    expect([name.value, name.disabled]).toEqual(['Karimov Bahodir Akmalovich', true]);
    const step = within(form).getByRole('group', { name: en.people.relatives.stepTitle });
    const email = within(step).getByLabelText<HTMLInputElement>(en.people.relatives.email);
    expect([email.value, email.disabled]).toEqual(['b.karimov@example.uz', true]);
  });

  it('says so for a staff member of another branch, with the name typed', async () => {
    const { form } = await startStudent({ holder: null, staff: null, staffElsewhere: true });
    expect(await within(form).findByText(en.people.relatives.phoneIsStaffElsewhere)).toBeDefined();
    const name = within(form).getByLabelText<HTMLInputElement>(en.people.relatives.fullNameField);
    expect(name.disabled).toBe(false);
  });

  it('does not offer "a different person" for a parent whose phone is a staff phone', async () => {
    const { form } = await startStudent({
      holder: { id: uid(50), fullName: 'Shoira Nazarova', students: 1 },
      staff: null,
      staffElsewhere: true,
    });
    expect(await within(form).findByText(en.people.relatives.newOwnerStaff)).toBeDefined();
    expect(
      within(form).queryByLabelText(
        en.people.relatives.ownerChoice.replace('{{name}}', 'Shoira Nazarova'),
      ),
    ).toBeNull();
    expect(within(form).queryByLabelText(en.people.relatives.fullNameField)).toBeNull();
  });
});
