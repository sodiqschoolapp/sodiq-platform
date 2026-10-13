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
});
