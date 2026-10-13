import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { ROLE_STORAGE_KEY } from '@/features/access/view-store';
import { fakeApi, json, NORTH, renderApp, SOUTH, sessionOf } from '@/testing/render-app';

const heading = (name: string) => screen.findByRole('heading', { name });

const staffList = () => json({ staff: [], today: '2026-10-13' });

afterEach(() => {
  window.sessionStorage.clear();
});

// Issue #39, hand test of 13 October 2026, finding 4: a page the role may not
// open is the full-page "no access" screen, not the list with a refusal and
// "Try again". The server's own reading decides: any current assignment of the
// person in the branch of the tab (`.claude/rules/api.md`).
describe('a page the person may not open', () => {
  it('shows a Teacher the full-page "no access" at the staff list, and calls nothing of it', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'teacher', branchId: NORTH.id }] })),
      'GET /api/people/staff': staffList,
    });
    renderApp('/people/staff');

    expect(await heading(en.problems.noAccessTitle)).toBeDefined();
    expect(screen.getByText(en.problems.noAccessText)).toBeDefined();
    expect(screen.getByRole('link', { name: en.problems.toHome })).toBeDefined();
    expect(screen.queryByRole('button', { name: en.problems.retry })).toBeNull();
    expect(calls.map((call) => call.route)).not.toContain('GET /api/people/staff');
  });

  it('opens the staff list for the Super Admin', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(sessionOf({ assignments: [{ role: 'super_admin', branchId: null }] })),
      'GET /api/people/staff': staffList,
    });
    renderApp('/people/staff');

    expect(await heading(en.people.staff.title)).toBeDefined();
    await waitFor(() => {
      expect(calls.map((call) => call.route)).toContain('GET /api/people/staff');
    });
    expect(screen.queryByText(en.problems.noAccessTitle)).toBeNull();
  });

  it('opens the staff list for a Teacher who is also Academic Vice Principal, viewing as Teacher', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'teacher');
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [
              { role: 'teacher', branchId: NORTH.id },
              { role: 'academic_vice_principal', branchId: NORTH.id },
            ],
          }),
        ),
      'GET /api/people/staff': staffList,
    });
    renderApp('/people/staff');

    expect(await heading(en.people.staff.title)).toBeDefined();
    await waitFor(() => {
      expect(calls.map((call) => call.route)).toContain('GET /api/people/staff');
    });
  });

  it('refuses the list in a branch where the permitting role is not held', async () => {
    window.sessionStorage.setItem(ROLE_STORAGE_KEY, 'teacher');
    const calls = fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [
              { role: 'teacher', branchId: NORTH.id },
              { role: 'academic_vice_principal', branchId: SOUTH.id },
            ],
            branches: [NORTH, SOUTH],
          }),
        ),
      'GET /api/people/staff': staffList,
    });
    // Viewing as Teacher, the tab shows North, where no role of the person sees the staff.
    renderApp('/people/staff');

    expect(await heading(en.problems.noAccessTitle)).toBeDefined();
    expect(calls.map((call) => call.route)).not.toContain('GET /api/people/staff');
  });
});
