import { type RelativeDetail, type RelativeListItem, type Role } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf, SOUTH } from '@/testing/render-app';

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
      ['Dilfuza Rahimova', '+998901112233', 'Rahimov Oʻtkir', '1'],
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
    expect(await within(panel).findByRole('link', { name: 'Oʻtkir Rahimov' })).toBeDefined();
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
    const form = await within(panel).findByRole('form', {
      name: en.people.relatives.formLabel.replace('{{name}}', 'Dilfuza Rahimova'),
    });
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
    const form = await within(panel).findByRole('form');
    fireEvent.change(within(form).getByLabelText(en.people.relatives.phone), {
      target: { value: '+79161234567' },
    });
    expect(await within(form).findByText(en.people.relatives.noSms)).toBeDefined();
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
      const form = await within(panel).findByRole('form');
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
        newOwner: { previousId: uid(3), previousPhone: null },
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
          en.people.relatives.noValidPhoneSince.replace(
            '{{date}}',
            new Date('2026-10-01T07:00:00.000Z').toLocaleDateString('en'),
          ),
        ),
      ).toBeDefined();
    });
  });
});
