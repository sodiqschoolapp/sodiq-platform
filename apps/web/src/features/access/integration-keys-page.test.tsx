import type { IntegrationKey, IntegrationKeyPerson } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ru } from '@/i18n/locales/ru';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// Task 10.9 (pull request #368): the Super Admin's Integration keys page. `02`, Integration
// keys: "The secret is shown once ... The list of keys shows each key's last use." All names
// and secrets are invented.

const uid = (n: number): string => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SECRET = `sodiq_ik_${'Ab3_'.repeat(10)}xyz`;

const person = (n: number, fields: Partial<IntegrationKeyPerson> = {}): IntegrationKeyPerson => ({
  staffRecordId: uid(100 + n),
  staffId: `S-26000${String(n)}`,
  firstName: 'Malika',
  lastName: `Teacherova${String(n)}`,
  holdsKeyRole: true,
  ...fields,
});

const key = (n: number, fields: Partial<IntegrationKey> = {}): IntegrationKey => ({
  id: uid(200 + n),
  name: `Platform ${String(n)}`,
  people: [person(1)],
  endsOn: '2027-06-30',
  state: 'active',
  createdAt: '2026-11-20T05:00:00.000Z',
  revokedAt: null,
  lastUsedAt: null,
  ...fields,
});

const listOf = (keys: IntegrationKey[]) => ({
  keys,
  today: '2026-11-21',
  latestEndsOn: '2027-11-21',
});

const session = (language: 'en' | 'ru' = 'en') =>
  sessionOf({
    assignments: [{ role: 'super_admin', branchId: null }],
    branches: [NORTH],
    language,
  });

const cellsOf = (): string[][] =>
  [...document.querySelectorAll('tbody tr')].map((one) =>
    [...one.querySelectorAll('td')].map((cell) => cell.textContent),
  );

async function openRow(text: string) {
  await waitFor(() => {
    expect(cellsOf().some((row) => row.some((cell) => cell.includes(text)))).toBe(true);
  });
  const row = [...document.querySelectorAll('tbody tr')].find((one) =>
    one.textContent.includes(text),
  );
  const button = row?.querySelector('button');
  if (!(button instanceof HTMLElement)) throw new Error(`No row ${text}`);
  fireEvent.click(button);
  return screen.findByRole('complementary');
}

describe('the integration keys', () => {
  it('lists each key with its people, end date, last use and state', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/integration-keys': () =>
        json(
          listOf([
            key(1),
            key(2, {
              state: 'revoked',
              revokedAt: '2026-11-21T04:00:00.000Z',
              lastUsedAt: '2026-11-20T06:00:00.000Z',
            }),
          ]),
        ),
    });
    renderApp('/integration-keys');
    await screen.findByRole('heading', { name: en.integrationKeys.title });
    await waitFor(() => {
      expect(cellsOf()).toHaveLength(2);
    });
    const [first, second] = cellsOf();
    expect(first).toEqual(
      expect.arrayContaining([
        'Platform 1',
        'Teacherova1 Malika',
        en.integrationKeys.neverUsed,
        en.integrationKeys.state_active,
      ]),
    );
    expect(second).toEqual(expect.arrayContaining([en.integrationKeys.state_revoked]));
  });

  it('says what the page is for when there is no key', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/integration-keys': () => json(listOf([])),
    });
    renderApp('/integration-keys');
    expect(await screen.findByText(en.integrationKeys.empty)).toBeDefined();
  });

  it('creates a key and shows its secret once, with a copy button; closing leaves it nowhere', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    let created = false;
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/integration-keys': () => json(listOf(created ? [key(1)] : [])),
      'GET /api/integration-keys/choices': () =>
        json({ people: [person(1), person(2, { lastName: 'Headova' })] }),
      'POST /api/integration-keys': () => {
        created = true;
        return json({ key: key(1, { name: 'English platform' }), secret: SECRET }, 201);
      },
    });
    const shell = renderApp('/integration-keys');
    fireEvent.click(await screen.findByRole('button', { name: en.integrationKeys.create }));
    const form = await screen.findByRole('form', { name: en.integrationKeys.create });
    fireEvent.change(within(form).getByLabelText(en.integrationKeys.name), {
      target: { value: 'English platform' },
    });
    fireEvent.click(await within(form).findByLabelText(/Headova Malika/));
    fireEvent.click(within(form).getByRole('button', { name: en.form.save }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(SECRET)).toBeDefined();
    expect(within(dialog).getByText(en.integrationKeys.secretOnce)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: en.integrationKeys.copy }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SECRET);
    });
    expect(calls.find((call) => call.route === 'POST /api/integration-keys')?.body).toEqual({
      name: 'English platform',
      staffRecordIds: [uid(102)],
      endsOn: '2027-11-21',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: en.integrationKeys.done }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.textContent).not.toContain(SECRET);
    // No cache keeps it (`.claude/rules/web.md`, a secret an answer holds once).
    const caches = JSON.stringify([
      shell.queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      shell.queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.data),
    ]);
    expect(caches).not.toContain(SECRET);
    vi.unstubAllGlobals();
  });

  it('asks before a revoke, naming the key, and sends it on yes', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/integration-keys': () => json(listOf([key(1)])),
      'GET /api/integration-keys/choices': () => json({ people: [person(1)] }),
      'POST /api/integration-keys/0199a000-0000-7000-8000-000000000201/revoke': () =>
        json(key(1, { state: 'revoked', revokedAt: '2026-11-21T04:00:00.000Z' })),
    });
    renderApp('/integration-keys');
    const panel = await openRow('Platform 1');
    fireEvent.click(within(panel).getByRole('button', { name: en.integrationKeys.revoke }));
    const question = await screen.findByRole('alertdialog');
    expect(
      within(question).getByText(en.integrationKeys.revokeTitle.replace('{{name}}', 'Platform 1')),
    ).toBeDefined();
    fireEvent.click(within(question).getByRole('button', { name: en.integrationKeys.revoke }));
    await waitFor(() => {
      expect(calls.some((call) => call.route.endsWith('/revoke'))).toBe(true);
    });
  });

  it('shows a revoked key read only, with no form and no Revoke', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/integration-keys': () =>
        json(listOf([key(1, { state: 'revoked', revokedAt: '2026-11-21T04:00:00.000Z' })])),
    });
    renderApp('/integration-keys');
    const panel = await openRow('Platform 1');
    expect(within(panel).queryByRole('button', { name: en.integrationKeys.revoke })).toBeNull();
    expect(within(panel).queryByRole('form')).toBeNull();
    expect(within(panel).getByText(/Teacherova1 Malika/)).toBeDefined();
  });

  it('marks a person who no longer holds a key role', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/integration-keys': () =>
        json(listOf([key(1, { people: [person(1, { holdsKeyRole: false })] })])),
      'GET /api/integration-keys/choices': () => json({ people: [] }),
    });
    renderApp('/integration-keys');
    const panel = await openRow('Platform 1');
    expect(await within(panel).findByText(en.integrationKeys.noKeyRole)).toBeDefined();
  });

  it('shows a refused person in the words of the error, in Russian', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session('ru')),
      'GET /api/integration-keys': () => json(listOf([key(1)])),
      'GET /api/integration-keys/choices': () =>
        json({ people: [person(1), person(2, { lastName: 'Headova' })] }),
      'PUT /api/integration-keys/0199a000-0000-7000-8000-000000000201/people': () =>
        json(
          {
            error: {
              code: 'integration_key_person_refused',
              message: 'refused',
              requestId: 'r',
              details: [
                {
                  path: 'staffRecordIds',
                  code: 'integration_key_person_refused',
                  message: 'refused',
                  recordId: uid(102),
                },
              ],
            },
          },
          422,
        ),
    });
    renderApp('/integration-keys', 'ru');
    const panel = await openRow('Platform 1');
    const form = await within(panel).findByRole('form', { name: ru.integrationKeys.people });
    fireEvent.click(await within(form).findByLabelText(/Headova Malika/));
    fireEvent.click(within(form).getByRole('button', { name: ru.form.save }));
    expect(await within(panel).findByText(ru.errors.integration_key_person_refused)).toBeDefined();
  });
});
