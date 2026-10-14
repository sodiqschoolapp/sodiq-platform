import { type RelativeDetail, type RelativeListItem, type Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, refusal, renderApp, sessionOf, SOUTH } from '@/testing/render-app';
import {
  actionsAreLast,
  edit,
  panelActionNames,
  panelActions,
  savedInPanel,
} from '@/testing/panel';

const uid = (n: number): string => `0199f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PATH = '/people/parents';

// All names and phones are invented. Task 2.5a, pull request #72: the
// Parents list and page (`04`, Close relatives; edge/close-relatives).
const DILFUZA: RelativeListItem = {
  id: uid(1),
  fullName: 'Dilfuza Rahimova',
  phone: '+998901112233',
  students: [
    {
      id: uid(11),
      firstName: 'Oʻtkir',
      lastName: 'Rahimov',
      uid: '2607001',
      relationship: 'mother',
      mainContact: true,
    },
  ],
  elsewhere: 1,
  phoneInvalidSince: null,
};

const ANVAR: RelativeListItem = {
  id: uid(2),
  fullName: 'Anvar Saidov',
  phone: null,
  students: [
    {
      id: uid(12),
      firstName: 'Zarina',
      lastName: 'Saidova',
      uid: '2507014',
      relationship: 'father',
      mainContact: false,
    },
  ],
  elsewhere: 0,
  phoneInvalidSince: null,
};

const detailOf = (row: RelativeListItem, fields: Partial<RelativeDetail> = {}): RelativeDetail => ({
  ...row,
  extraPhones: [],
  samePerson: null,
  samePersonElsewhere: false,
  identity: { workplace: 'Toshkent shahar shifoxonasi', email: 'd.rahimova@example.uz' },
  identityHidden: false,
  canEdit: true,
  ...fields,
});

const sessionAs = (role: Role, language: 'en' | 'ru' = 'en') => ({
  ...sessionOf({
    assignments: [{ role, branchId: role === 'super_admin' ? null : NORTH.id }],
    branches: [NORTH, SOUTH],
  }),
  language,
});

function openList(
  role: Role,
  extra: Record<string, (body: unknown) => Response> = {},
  language: 'en' | 'ru' = 'en',
  detail: Partial<RelativeDetail> = {},
) {
  const editor = role === 'academic_vice_principal' || role === 'super_admin';
  return fakeApi({
    'GET /api/auth/session': () => json(sessionAs(role, language)),
    'GET /api/people/relatives': () =>
      json({ relatives: [ANVAR, DILFUZA], searchesPhone: editor, canEdit: editor }),
    [`GET /api/people/relatives/${DILFUZA.id}`]: () => json(detailOf(DILFUZA, detail)),
    ...extra,
  });
}

const rowsDrawn = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? ''),
  );

const search = (text: string) => {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: text } });
};

describe('the Parents list', () => {
  it('lists the relatives of the branch with the main phone and the count elsewhere', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    await screen.findByRole('heading', { name: en.people.relatives.title });
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    expect(rowsDrawn()).toEqual([
      ['Anvar Saidov', en.people.relatives.noPhone, 'Saidova Zarina', ''],
      // The phone grouped (finding 24).
      ['Dilfuza Rahimova', '+998 90 111 22 33', 'Rahimov Oʻtkir', '1'],
    ]);
  });

  it('finds a relative by a spelling of the name, and by the phone for the Academic Vice Principal', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    search('Дилфуза');
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[0])).toEqual(['Dilfuza Rahimova']);
    });
    search('1112233');
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[0])).toEqual(['Dilfuza Rahimova']);
    });
    // Typed as it is shown, with spaces (finding 24).
    search('90 111 22 33');
    await waitFor(() => {
      expect(rowsDrawn().map((row) => row[0])).toEqual(['Dilfuza Rahimova']);
    });
  });

  it('leaves the phone out of the search of the Principal (edge/people-roles-accounts)', async () => {
    openList('principal');
    renderApp(PATH);
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(2);
    });
    search('1112233');
    await waitFor(() => {
      expect(rowsDrawn()).toHaveLength(0);
    });
  });

  it('asks the server for the relatives with no valid phone (task 2.5b-1)', async () => {
    const lost = { ...ANVAR, phoneInvalidSince: '2026-10-01T07:00:00.000Z' };
    const calls = openList('academic_vice_principal', {
      'GET /api/people/relatives': () =>
        json({ relatives: [ANVAR, DILFUZA, lost].slice(2), searchesPhone: true, canEdit: true }),
    });
    renderApp(`${PATH}?f=%7B%22phone%22%3A%22no_valid_phone%22%7D`);
    await waitFor(() => {
      expect(rowsDrawn()).toEqual([
        ['Anvar Saidov', en.people.relatives.noValidPhone, 'Saidova Zarina', ''],
      ]);
    });
    expect(
      calls.some(
        (call) =>
          call.route === 'GET /api/people/relatives' && call.query === '?filter=no_valid_phone',
      ),
    ).toBe(true);
  });

  it('speaks Russian', async () => {
    openList('academic_vice_principal', {}, 'ru');
    renderApp(PATH, 'ru');
    expect(await screen.findByRole('heading', { name: ru.people.relatives.title })).toBeDefined();
    await waitFor(() => {
      expect(rowsDrawn()[0]?.[1]).toBe(ru.people.relatives.noPhone);
    });
  });
});

describe('the page of a relative', () => {
  const openPanel = async () => {
    fireEvent.click(await screen.findByText('Dilfuza Rahimova', { selector: 'button' }));
    return screen.findByRole('complementary', { name: 'Dilfuza Rahimova' });
  };

  it('shows the students of the branch and the count of the others', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    const panel = await openPanel();
    expect(await within(panel).findByRole('link', { name: 'Rahimov Oʻtkir' })).toBeDefined();
    expect(
      within(panel).getByText(en.people.relatives.elsewhereCount_one.replace('{{count}}', '1')),
    ).toBeDefined();
  });

  it('saves the record and names the holder of a phone it refuses', async () => {
    const calls = openList('academic_vice_principal', {
      [`PATCH /api/people/relatives/${DILFUZA.id}`]: () =>
        Response.json(
          {
            error: {
              code: 'relative_phone_taken',
              message: 'x',
              requestId: 'r',
              details: [
                {
                  path: 'phone',
                  code: 'already_exists',
                  message: 'x',
                  holder: { fullName: 'Shoira Nazarova', students: 2 },
                },
              ],
            },
          },
          { status: 409 },
        ),
    });
    renderApp(PATH);
    const panel = await openPanel();
    const form = await edit(
      panel,
      en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    );
    fireEvent.change(within(form).getByLabelText(en.people.relatives.phone), {
      target: { value: '+998 90 444 55 66' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.startsWith('PATCH'))).toBe(true);
    });
    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toEqual({
      fullName: 'Dilfuza Rahimova',
      phone: '+998904445566',
      workplace: 'Toshkent shahar shifoxonasi',
      email: 'd.rahimova@example.uz',
      extraPhones: [],
    });
    expect(
      await within(form).findByText(
        en.people.relatives.takenBy_other
          .replace('{{name}}', 'Shoira Nazarova')
          .replace('{{count}}', '2'),
      ),
    ).toBeDefined();
  });

  it('warns that a foreign number cannot receive SMS (answer 24)', async () => {
    openList('academic_vice_principal');
    renderApp(PATH);
    const panel = await openPanel();
    const form = await edit(
      panel,
      en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    );
    fireEvent.change(within(form).getByLabelText(en.people.relatives.phone), {
      target: { value: '+79161234567' },
    });
    expect(await within(form).findByText(en.people.relatives.noSms)).toBeDefined();
  });

  // Task 2.7c-2b-2b: the panel reads first; Edit at the bottom opens the record's form.
  it('reads first, with Edit last in the panel, and closes the form on Cancel without a call', async () => {
    const calls = openList('academic_vice_principal');
    renderApp(PATH);
    const panel = await openPanel();
    await within(panel).findByText(en.people.relatives.phone, { selector: 'dt' });
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(panelActionNames(panel)).toEqual([en.form.edit]);
    expect(actionsAreLast(panel)).toBe(true);
    const form = await edit(
      panel,
      en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    );
    expect(panelActions(panel)).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: en.form.cancel }));
    await waitFor(() => {
      expect(within(panel).queryByRole('form')).toBeNull();
    });
    expect(calls.some((call) => call.route.startsWith('PATCH'))).toBe(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.form.edit }),
      );
    });
  });

  it('closes the form after a save with "Saved." and the focus on Edit', async () => {
    const calls = openList('academic_vice_principal', {
      [`PATCH /api/people/relatives/${DILFUZA.id}`]: () =>
        json(detailOf(DILFUZA, { fullName: 'Dilfuza Rahimova-Karimova' })),
    });
    renderApp(PATH);
    const panel = await openPanel();
    const form = await edit(
      panel,
      en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    );
    fireEvent.change(within(form).getByLabelText(en.people.relatives.fullName), {
      target: { value: 'Dilfuza Rahimova-Karimova' },
    });
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await savedInPanel(panel);
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toMatchObject({
      fullName: 'Dilfuza Rahimova-Karimova',
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(panel).getByRole('button', { name: en.form.edit }),
      );
    });
  });

  it('hides workplace and email from the Principal behind a show', async () => {
    const calls = openList(
      'principal',
      {
        [`POST /api/people/relatives/${DILFUZA.id}/show`]: () =>
          json({ workplace: 'Toshkent shahar shifoxonasi', email: 'd.rahimova@example.uz' }),
      },
      'en',
      { identity: null, identityHidden: true, canEdit: false },
    );
    renderApp(PATH);
    const panel = await openPanel();
    expect(await within(panel).findAllByText(en.people.relatives.hidden)).toHaveLength(2);
    expect(within(panel).queryByRole('form')).toBeNull();
    // No Edit and no opener for a reader who may not edit (task 2.7c-2b-2b).
    expect(panelActions(panel)).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: en.people.relatives.show }));
    expect(await within(panel).findByText('d.rahimova@example.uz')).toBeDefined();
    expect(calls.some((call) => call.route.endsWith('/show'))).toBe(true);
  });

  describe('a phone refused as taken (task 2.5b-1)', () => {
    const takenAnswer = (mergeable: boolean) => () =>
      Response.json(
        {
          error: {
            code: 'relative_phone_taken',
            message: 'x',
            requestId: 'r',
            details: [
              {
                path: 'phone',
                code: 'already_exists',
                message: 'x',
                holder: { fullName: 'Shoira Nazarova', students: 2 },
                mergeable,
              },
            ],
          },
        },
        { status: 409 },
      );

    const refuse = async () => {
      const panel = await openPanel();
      const form = await edit(
        panel,
        en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
      );
      fireEvent.change(within(form).getByLabelText(en.people.relatives.phone), {
        target: { value: '+998 90 444 55 66' },
      });
      fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
      return within(panel).findByRole('region', { name: en.people.relatives.takenTitle });
    };

    it('merges the two records with the name and phone chosen, after a confirmation', async () => {
      const calls = openList('academic_vice_principal', {
        [`PATCH /api/people/relatives/${DILFUZA.id}`]: takenAnswer(true),
        'POST /api/people/relatives/phone-match': () =>
          json({ holder: { id: uid(3), fullName: 'Shoira Nazarova', students: 2 } }),
        [`POST /api/people/relatives/${DILFUZA.id}/merge`]: () => json(detailOf(DILFUZA)),
      });
      renderApp(PATH);
      const choices = await refuse();
      fireEvent.click(
        within(choices).getByRole('button', {
          name: en.people.relatives.mergeWith.replace('{{name}}', 'Shoira Nazarova'),
        }),
      );
      fireEvent.change(within(choices).getByLabelText(en.people.relatives.mergeName), {
        target: { value: 'other' },
      });
      fireEvent.click(within(choices).getByRole('button', { name: en.people.relatives.merge }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Shoira Nazarova')).toBeDefined();
      fireEvent.click(within(dialog).getByRole('button', { name: en.people.relatives.merge }));
      await waitFor(() => {
        expect(calls.some((call) => call.route.endsWith('/merge'))).toBe(true);
      });
      expect(calls.find((call) => call.route.endsWith('/merge'))?.body).toEqual({
        otherId: uid(3),
        thisPhone: '+998901112233',
        otherPhone: '+998904445566',
        phoneOf: 'this',
        nameOf: 'other',
      });
      // This record stays: the merge saved the phone, so its form closes (task 2.7c-2b-2b).
      const panel = screen.getByRole('complementary', { name: 'Dilfuza Rahimova' });
      await savedInPanel(panel);
      expect(within(panel).queryByRole('form')).toBeNull();
    });

    it('keeps the record form\'s Save as the one primary, and closes the form with "Saved." after "Give the number"', async () => {
      let patches = 0;
      const calls = openList('academic_vice_principal', {
        [`PATCH /api/people/relatives/${DILFUZA.id}`]: () => {
          patches += 1;
          return patches === 1 ? takenAnswer(true)() : json(detailOf(DILFUZA));
        },
        'POST /api/people/relatives/phone-match': () =>
          json({ holder: { id: uid(3), fullName: 'Shoira Nazarova', students: 2 } }),
      });
      renderApp(PATH);
      const choices = await refuse();
      const panel = screen.getByRole('complementary', { name: 'Dilfuza Rahimova' });
      const primaries = () =>
        [...panel.querySelectorAll('[data-slot="button"][data-variant="default"]')].map(
          (button) => button.textContent,
        );
      fireEvent.click(
        within(choices).getByRole('button', {
          name: en.people.relatives.mergeWith.replace('{{name}}', 'Shoira Nazarova'),
        }),
      );
      expect(
        within(choices)
          .getByRole('button', { name: en.people.relatives.merge })
          .getAttribute('data-variant'),
      ).toBe('destructive');
      expect(primaries()).toEqual([en.form.save]);
      fireEvent.click(within(choices).getByRole('button', { name: en.people.relatives.newOwner }));
      fireEvent.click(
        within(choices).getByLabelText(
          en.people.relatives.previousUnknown.replace('{{name}}', 'Shoira Nazarova'),
        ),
      );
      const give = within(choices).getByRole('button', { name: en.people.relatives.giveNumber });
      expect(give.getAttribute('data-variant')).toBe('secondary');
      expect(primaries()).toEqual([en.form.save]);
      // One "Cancel" only: the choices close with words of their own.
      expect(within(panel).getAllByRole('button', { name: en.form.cancel })).toHaveLength(1);
      fireEvent.click(give);
      await savedInPanel(panel);
      expect(within(panel).queryByRole('form')).toBeNull();
      expect(calls.filter((call) => call.route.startsWith('PATCH'))).toHaveLength(2);
    });

    it('opens the record that stays when it is the other one', async () => {
      const shoira = {
        ...DILFUZA,
        id: uid(3),
        fullName: 'Shoira Nazarova',
        phone: '+998904445566',
      };
      let mergedNow = false;
      openList('academic_vice_principal', {
        [`PATCH /api/people/relatives/${DILFUZA.id}`]: takenAnswer(true),
        'POST /api/people/relatives/phone-match': () =>
          json({ holder: { id: uid(3), fullName: 'Shoira Nazarova', students: 2 } }),
        [`POST /api/people/relatives/${DILFUZA.id}/merge`]: () => {
          mergedNow = true;
          return json(detailOf(shoira));
        },
        [`GET /api/people/relatives/${uid(3)}`]: () => json(detailOf(shoira)),
        // After the merge the list holds the record that stays.
        'GET /api/people/relatives': () =>
          json({
            relatives: mergedNow ? [ANVAR, shoira] : [ANVAR, DILFUZA],
            searchesPhone: true,
            canEdit: true,
          }),
      });
      const shell = renderApp(PATH);
      const choices = await refuse();
      fireEvent.click(
        within(choices).getByRole('button', {
          name: en.people.relatives.mergeWith.replace('{{name}}', 'Shoira Nazarova'),
        }),
      );
      fireEvent.change(within(choices).getByLabelText(en.people.relatives.mergePhone), {
        target: { value: 'other' },
      });
      fireEvent.click(within(choices).getByRole('button', { name: en.people.relatives.merge }));
      const dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: en.people.relatives.merge }));
      await waitFor(() => {
        expect(shell.router.state.location.search).toMatchObject({ open: uid(3) });
      });
      expect(await screen.findByRole('complementary', { name: 'Shoira Nazarova' })).toBeDefined();
    });

    it('offers no merge when the holder may not be merged, and gives the number a new owner', async () => {
      const calls = openList('academic_vice_principal', {
        [`PATCH /api/people/relatives/${DILFUZA.id}`]: takenAnswer(false),
        'POST /api/people/relatives/phone-match': () =>
          json({ holder: { id: uid(3), fullName: 'Shoira Nazarova', students: 2 } }),
      });
      renderApp(PATH);
      const choices = await refuse();
      expect(
        within(choices).queryByRole('button', {
          name: en.people.relatives.mergeWith.replace('{{name}}', 'Shoira Nazarova'),
        }),
      ).toBeNull();
      fireEvent.click(within(choices).getByRole('button', { name: en.people.relatives.newOwner }));
      fireEvent.click(
        within(choices).getByLabelText(
          en.people.relatives.previousUnknown.replace('{{name}}', 'Shoira Nazarova'),
        ),
      );
      fireEvent.click(
        within(choices).getByRole('button', { name: en.people.relatives.giveNumber }),
      );
      await waitFor(() => {
        expect(calls.filter((call) => call.route.startsWith('PATCH'))).toHaveLength(2);
      });
      expect(calls.filter((call) => call.route.startsWith('PATCH'))[1]?.body).toEqual({
        fullName: 'Dilfuza Rahimova',
        phone: '+998904445566',
        workplace: 'Toshkent shahar shifoxonasi',
        email: 'd.rahimova@example.uz',
        extraPhones: [],
        newOwner: { previousId: uid(3), previousPhone: null },
      });
    });

    // Issue #39, hand test of 13 October 2026, finding 28 (task 2.7b-2, decision
    // 9): Cancel leaves the choice, not the edit.
    describe('Cancel in the choices', () => {
      const routes = () => ({
        [`PATCH /api/people/relatives/${DILFUZA.id}`]: takenAnswer(true),
        'POST /api/people/relatives/phone-match': () =>
          json({ holder: { id: uid(3), fullName: 'Shoira Nazarova', students: 2 } }),
      });
      const cancel = (choices: HTMLElement) => {
        fireEvent.click(
          within(choices).getByRole('button', { name: en.people.relatives.closeChoices }),
        );
      };
      const closed = async () => {
        await waitFor(() => {
          expect(screen.queryByRole('region', { name: en.people.relatives.takenTitle })).toBeNull();
        });
        // The phone typed into the edit stays as it is.
        const panel = screen.getByRole('complementary', { name: 'Dilfuza Rahimova' });
        const form = within(panel).getAllByRole('form')[0] as HTMLElement;
        expect(within(form).getByLabelText<HTMLInputElement>(en.people.relatives.phone).value).toBe(
          '+998 90 444 55 66',
        );
      };

      it('closes the choices before one is chosen, and sends nothing', async () => {
        const calls = openList('academic_vice_principal', routes());
        renderApp(PATH);
        cancel(await refuse());
        await closed();
        expect(calls.filter((call) => call.route.startsWith('PATCH'))).toHaveLength(1);
        expect(calls.some((call) => call.route.endsWith('/merge'))).toBe(false);
      });

      it('closes the merge view and sends nothing', async () => {
        const calls = openList('academic_vice_principal', routes());
        renderApp(PATH);
        const choices = await refuse();
        fireEvent.click(
          within(choices).getByRole('button', {
            name: en.people.relatives.mergeWith.replace('{{name}}', 'Shoira Nazarova'),
          }),
        );
        cancel(choices);
        await closed();
        expect(calls.some((call) => call.route.endsWith('/merge'))).toBe(false);
      });

      it('closes the new owner view at once with nothing typed', async () => {
        openList('academic_vice_principal', routes());
        renderApp(PATH);
        const choices = await refuse();
        fireEvent.click(
          within(choices).getByRole('button', { name: en.people.relatives.newOwner }),
        );
        cancel(choices);
        expect(screen.queryByRole('alertdialog')).toBeNull();
        await closed();
      });

      it('asks before dropping a typed previous phone, and keeps it when the person stays', async () => {
        const calls = openList('academic_vice_principal', routes());
        renderApp(PATH);
        const choices = await refuse();
        fireEvent.click(
          within(choices).getByRole('button', { name: en.people.relatives.newOwner }),
        );
        const previous = within(choices).getByLabelText<HTMLInputElement>(
          en.people.relatives.previousPhone.replace('{{name}}', 'Shoira Nazarova'),
        );
        fireEvent.change(previous, { target: { value: '+998 90 777 88 99' } });

        cancel(choices);
        let dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
        fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.stay }));
        await waitFor(() => {
          expect(screen.queryByRole('alertdialog')).toBeNull();
        });
        expect(previous.value).toBe('+998 90 777 88 99');

        cancel(choices);
        dialog = await screen.findByRole('alertdialog', { name: en.unsent.leaveTitle });
        fireEvent.click(within(dialog).getByRole('button', { name: en.unsent.leave }));
        await closed();
        expect(calls.filter((call) => call.route.startsWith('PATCH'))).toHaveLength(1);
      });
    });

    it('shows "no valid phone" with its date on the page', async () => {
      openList('academic_vice_principal', {}, 'en', {
        phone: null,
        phoneInvalidSince: '2026-10-01T07:00:00.000Z',
      });
      renderApp(PATH);
      const panel = await openPanel();
      expect(
        await within(panel).findByText(
          en.people.relatives.noValidPhoneSince.replace('{{date}}', '1 Oct 2026'),
        ),
      ).toBeDefined();
    });
  });
});

// Task 2.5b-2 (edge/close-relatives, rows 5 and 8): the extra phones and the
// mark "same person". All names and phones are invented.
describe('the extra phones and the same person of a relative', () => {
  const BAHODIR = {
    id: uid(60),
    staffId: 'S-260012',
    firstName: 'Bahodir',
    lastName: 'Karimov',
    fatherName: null,
    categories: ['teacher' as const],
    branches: [{ branchId: NORTH.id, name: 'North', main: true }],
    divisions: [],
    subjects: [],
    languages: [],
    phone: '+998907770011',
    status: 'active' as const,
    planned: null,
    photoId: null,
  };
  const MALIKA = {
    ...BAHODIR,
    id: uid(61),
    staffId: 'S-260013',
    firstName: 'Malika',
    lastName: 'Yusupova',
    phone: '+998907770012',
  };
  const SAME = { staffId: BAHODIR.id, name: 'Karimov Bahodir', staffNumber: 'S-260012' };

  const openPanel = async () => {
    fireEvent.click(await screen.findByText('Dilfuza Rahimova', { selector: 'button' }));
    return screen.findByRole('complementary', { name: 'Dilfuza Rahimova' });
  };

  /** The value under a term of the panel. */
  const valueOf = async (panel: HTMLElement, term: string) =>
    (await within(panel).findByText(term, { selector: 'dt' })).nextElementSibling?.textContent;

  it('shows the extra phones under the main phone', async () => {
    openList('principal', {}, 'en', {
      extraPhones: ['+998935556677', '+79161234567'],
      canEdit: false,
    });
    renderApp(PATH);
    const panel = await openPanel();
    // Grouped when Uzbek, a foreign number as stored (finding 24, decision 4).
    expect(await valueOf(panel, en.people.relatives.phone)).toBe('+998 90 111 22 33');
    expect(await valueOf(panel, en.people.relatives.extraPhones)).toBe(
      '+998 93 555 66 77, +79161234567',
    );
  });

  it('adds and removes extra phones, at most three, warns of SMS, and sends the whole list', async () => {
    const calls = openList('academic_vice_principal', {
      [`PATCH /api/people/relatives/${DILFUZA.id}`]: () =>
        json(detailOf(DILFUZA, { extraPhones: ['+998935556677'] })),
    });
    renderApp(PATH);
    const panel = await openPanel();
    const form = await edit(
      panel,
      en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    );
    const add = () => {
      fireEvent.click(
        within(form).getByRole('button', { name: en.people.relatives.addExtraPhone }),
      );
    };
    const extra = (n: number) =>
      within(form).getByLabelText<HTMLInputElement>(
        en.people.relatives.extraPhone.replace('{{n}}', String(n)),
      );
    add();
    add();
    add();
    // Three at most: the button is gone.
    expect(
      within(form).queryByRole('button', { name: en.people.relatives.addExtraPhone }),
    ).toBeNull();
    // The country code is offered, as on the main phone.
    expect(extra(1).value).toBe('+998 ');
    fireEvent.change(extra(1), { target: { value: '+79161234567' } });
    fireEvent.change(extra(2), { target: { value: '+998 93 555 66 77' } });
    fireEvent.change(extra(3), { target: { value: '+998 93 555 66 77' } });
    expect(await within(form).findByText(en.people.relatives.noSms)).toBeDefined();
    expect(within(form).getByText(en.people.relatives.extraPhoneTwice)).toBeDefined();
    // Nothing is sent while a phone is given twice.
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    fireEvent.click(
      within(form).getByRole('button', {
        name: en.people.relatives.removeExtraPhone.replace('{{n}}', '3'),
      }),
    );
    fireEvent.click(
      within(form).getByRole('button', {
        name: en.people.relatives.removeExtraPhone.replace('{{n}}', '1'),
      }),
    );
    // The second moved up.
    expect(extra(1).value).toBe('+998 93 555 66 77');
    expect(
      within(form).queryByLabelText(en.people.relatives.extraPhone.replace('{{n}}', '2')),
    ).toBeNull();
    expect(calls.some((call) => call.route.startsWith('PATCH'))).toBe(false);
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.startsWith('PATCH'))).toBe(true);
    });
    expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toEqual({
      fullName: 'Dilfuza Rahimova',
      phone: '+998901112233',
      workplace: 'Toshkent shahar shifoxonasi',
      email: 'd.rahimova@example.uz',
      extraPhones: ['+998935556677'],
    });
  });

  it('sends the extra phones it opened with, and none once all are removed', async () => {
    const calls = openList(
      'academic_vice_principal',
      { [`PATCH /api/people/relatives/${DILFUZA.id}`]: () => json(detailOf(DILFUZA)) },
      'en',
      { extraPhones: ['+998935556677'] },
    );
    renderApp(PATH);
    const panel = await openPanel();
    const form = await edit(
      panel,
      en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    );
    expect(
      within(form).getByLabelText<HTMLInputElement>(
        en.people.relatives.extraPhone.replace('{{n}}', '1'),
      ).value,
    ).toBe('+998 93 555 66 77');
    fireEvent.click(
      within(form).getByRole('button', {
        name: en.people.relatives.removeExtraPhone.replace('{{n}}', '1'),
      }),
    );
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.startsWith('PATCH'))?.body).toMatchObject({
        extraPhones: [],
      });
    });
  });

  it('names the staff member marked as the same person, with a link to the staff panel', async () => {
    openList('academic_vice_principal', {}, 'en', { samePerson: SAME });
    const shell = renderApp(PATH);
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: en.people.relatives.sameTitle,
    });
    expect(
      within(section).getByText(en.people.relatives.staffIdOf.replace('{{staffId}}', 'S-260012')),
    ).toBeDefined();
    fireEvent.click(within(section).getByRole('link', { name: 'Karimov Bahodir' }));
    await waitFor(() => {
      expect(shell.router.state.location.pathname).toBe('/people/staff');
    });
    expect(shell.router.state.location.search).toMatchObject({ open: BAHODIR.id });
  });

  it('marks the relative as a staff member found by name', async () => {
    const calls = openList('academic_vice_principal', {
      'GET /api/people/staff': () => json({ staff: [MALIKA, BAHODIR], today: '2026-10-10' }),
      [`PUT /api/people/relatives/${DILFUZA.id}/same-person`]: () =>
        json(detailOf(DILFUZA, { samePerson: SAME })),
    });
    renderApp(PATH);
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: en.people.relatives.sameTitle,
    });
    expect(within(section).getByText(en.people.relatives.sameNone)).toBeDefined();
    fireEvent.click(within(section).getByRole('button', { name: en.people.relatives.markStaff }));
    const picker = await within(section).findByRole('form', {
      name: en.people.relatives.markStaff,
    });
    fireEvent.change(within(picker).getByLabelText(en.people.relatives.staffSearch), {
      target: { value: 'карим' },
    });
    const choice = await within(picker).findByLabelText(en.people.relatives.staffChoice);
    expect([...choice.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      en.people.relatives.choose,
      'Karimov Bahodir (S-260012)',
    ]);
    fireEvent.change(choice, { target: { value: BAHODIR.id } });
    fireEvent.click(within(picker).getByRole('button', { name: en.people.relatives.markSave }));
    await waitFor(() => {
      expect(calls.find((call) => call.route.endsWith('/same-person'))?.body).toEqual({
        staffId: BAHODIR.id,
      });
    });
    expect(calls.find((call) => call.route.endsWith('/same-person'))?.route).toBe(
      `PUT /api/people/relatives/${DILFUZA.id}/same-person`,
    );
    expect(await within(section).findByRole('link', { name: 'Karimov Bahodir' })).toBeDefined();
    // The picker closes with "Saved." in the bottom row (task 2.7c-2b-2b).
    await savedInPanel(panel);
    expect(within(section).queryByRole('form')).toBeNull();
  });

  it('opens the picker through the panel with the search field focused; Remove gives way and Cancel closes it', async () => {
    openList(
      'academic_vice_principal',
      { 'GET /api/people/staff': () => json({ staff: [MALIKA, BAHODIR], today: '2026-10-10' }) },
      'en',
      { samePerson: SAME },
    );
    renderApp(PATH);
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: en.people.relatives.sameTitle,
    });
    const change = within(section).getByRole('button', { name: en.people.relatives.changeStaff });
    fireEvent.click(change);
    const picker = await within(section).findByRole('form', {
      name: en.people.relatives.markStaff,
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(picker).getByLabelText(en.people.relatives.staffSearch),
      );
    });
    expect(
      within(section).queryByRole('button', { name: en.people.relatives.removeMark }),
    ).toBeNull();
    expect(panelActions(panel)).toBeNull();
    const cancel = within(picker).getByRole('button', { name: en.people.relatives.markCancel });
    expect(cancel.getAttribute('data-variant')).toBe('ghost');
    fireEvent.click(cancel);
    await waitFor(() => {
      expect(within(section).queryByRole('form')).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(section).getByRole('button', { name: en.people.relatives.changeStaff }),
      );
    });
    expect(
      within(section).getByRole('button', { name: en.people.relatives.removeMark }),
    ).toBeDefined();
  });

  it('says why a mark is refused', async () => {
    openList('academic_vice_principal', {
      'GET /api/people/staff': () => json({ staff: [BAHODIR], today: '2026-10-10' }),
      [`PUT /api/people/relatives/${DILFUZA.id}/same-person`]: () =>
        refusal('same_person_taken', 409),
    });
    renderApp(PATH);
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: en.people.relatives.sameTitle,
    });
    fireEvent.click(within(section).getByRole('button', { name: en.people.relatives.markStaff }));
    const choice = await within(section).findByLabelText(en.people.relatives.staffChoice);
    fireEvent.change(choice, { target: { value: BAHODIR.id } });
    fireEvent.click(within(section).getByRole('button', { name: en.people.relatives.markSave }));
    expect(await within(section).findByText(en.errors.same_person_taken)).toBeDefined();
  });

  it('removes the mark after a question naming both people', async () => {
    let marked = true;
    const calls = openList('academic_vice_principal', {
      [`GET /api/people/relatives/${DILFUZA.id}`]: () =>
        json(detailOf(DILFUZA, { samePerson: marked ? SAME : null })),
      [`DELETE /api/people/relatives/${DILFUZA.id}/same-person`]: () => {
        marked = false;
        return new Response(null, { status: 204 });
      },
    });
    renderApp(PATH);
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: en.people.relatives.sameTitle,
    });
    fireEvent.click(
      await within(section).findByRole('button', { name: en.people.relatives.removeMark }),
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.relatives.removeMarkTitle,
    });
    expect(within(dialog).getByText('Dilfuza Rahimova')).toBeDefined();
    expect(within(dialog).getByText('Karimov Bahodir')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.relatives.removeMark }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.startsWith('DELETE'))).toBe(true);
    });
    expect(await within(section).findByText(en.people.relatives.sameNone)).toBeDefined();
    expect(within(section).queryByRole('link')).toBeNull();
  });

  it('lets the Super Admin remove a mark to a staff member of another branch, unnamed', async () => {
    let marked = true;
    const calls = openList('super_admin', {
      [`GET /api/people/relatives/${DILFUZA.id}`]: () =>
        json(detailOf(DILFUZA, { samePerson: null, samePersonElsewhere: marked })),
      [`DELETE /api/people/relatives/${DILFUZA.id}/same-person`]: () => {
        marked = false;
        return new Response(null, { status: 204 });
      },
    });
    renderApp(PATH);
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: en.people.relatives.sameTitle,
    });
    expect(await within(section).findByText(en.people.relatives.sameElsewhere)).toBeDefined();
    expect(within(section).queryByRole('link')).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: en.people.relatives.removeMark }));
    const dialog = await screen.findByRole('alertdialog', {
      name: en.people.relatives.removeMarkTitle,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.people.relatives.removeMark }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.startsWith('DELETE'))).toBe(true);
    });
    expect(await within(section).findByText(en.people.relatives.sameNone)).toBeDefined();
  });

  it('shows the mark without actions to a reader who may not edit', async () => {
    openList('principal', {}, 'en', { samePerson: SAME, canEdit: false });
    renderApp(PATH);
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: en.people.relatives.sameTitle,
    });
    expect(within(section).getByRole('link', { name: 'Karimov Bahodir' })).toBeDefined();
    for (const name of [
      en.people.relatives.markStaff,
      en.people.relatives.changeStaff,
      en.people.relatives.removeMark,
    ]) {
      expect(within(section).queryByRole('button', { name })).toBeNull();
    }
  });

  it('leaves the section out for a reader who may not edit a relative marked as nobody', async () => {
    openList('principal', {}, 'en', { canEdit: false });
    renderApp(PATH);
    const panel = await openPanel();
    await within(panel).findByText(en.people.relatives.phone, { selector: 'dt' });
    expect(within(panel).queryByRole('region', { name: en.people.relatives.sameTitle })).toBeNull();
  });

  it('speaks Russian', async () => {
    openList('academic_vice_principal', {}, 'ru', {
      samePerson: SAME,
      extraPhones: ['+998935556677'],
    });
    renderApp(PATH, 'ru');
    const panel = await openPanel();
    const section = await within(panel).findByRole('region', {
      name: ru.people.relatives.sameTitle,
    });
    expect(
      within(section).getByText(ru.people.relatives.staffIdOf.replace('{{staffId}}', 'S-260012')),
    ).toBeDefined();
    expect(
      within(section).getByRole('button', { name: ru.people.relatives.changeStaff }),
    ).toBeDefined();
    expect(await valueOf(panel, ru.people.relatives.extraPhones)).toBe('+998 93 555 66 77');
    const form = await edit(
      panel,
      ru.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
      ru.form.edit,
    );
    expect(
      within(form).getByLabelText(ru.people.relatives.extraPhone.replace('{{n}}', '1')),
    ).toBeDefined();
  });
});

// Task 2.6a, pull request #75: "History" on the panel of a parent.
describe('the History link of a parent', () => {
  it('opens the log about the parent for the Principal', async () => {
    openList('principal');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Dilfuza Rahimova', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Dilfuza Rahimova' });
    const link = await within(panel).findByRole('link', { name: en.audit.history });
    expect(link.getAttribute('href')).toBe(`/audit?person=relative%3A${DILFUZA.id}`);
  });
});

// Task 2.6b, pull request #76: "Personal data report" on the panel, for the
// Super Admin only (decision 3).
describe('the personal data report link of a parent', () => {
  it('opens the report of the parent for the Super Admin', async () => {
    openList('super_admin');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Dilfuza Rahimova', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Dilfuza Rahimova' });
    const link = await within(panel).findByRole('link', { name: en.people.report.link });
    expect(link.getAttribute('href')).toBe(`/people/report/relative/${DILFUZA.id}`);
  });

  it('is not shown to the Principal', async () => {
    openList('principal');
    renderApp(PATH);
    fireEvent.click(await screen.findByText('Dilfuza Rahimova', { selector: 'button' }));
    const panel = await screen.findByRole('complementary', { name: 'Dilfuza Rahimova' });
    await within(panel).findByRole('link', { name: en.audit.history });
    expect(within(panel).queryByRole('link', { name: en.people.report.link })).toBeNull();
  });
});
