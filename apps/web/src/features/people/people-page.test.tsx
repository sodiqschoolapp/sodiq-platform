import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// .claude/rules/web.md, Text on screens: "A menu page is a title and its
// links" (issue #39, item 4; pull request #80, decision 2).
describe('the People page', () => {
  it('is a title and its links, each named by its title with no line under it', async () => {
    fakeApi({
      'GET /api/auth/session': () =>
        json(
          sessionOf({
            assignments: [{ role: 'academic_vice_principal', branchId: NORTH.id }],
            branches: [NORTH],
          }),
        ),
    });
    renderApp('/people');
    const title = await screen.findByRole('heading', { name: en.people.title, level: 1 });
    expect(title.closest('header')?.nextElementSibling?.tagName).toBe('UL');
    const list = screen.getByRole('list', { name: en.people.title });
    const links = within(list).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toContain(en.people.staffLink);
    expect(links.map((link) => link.textContent)).toContain(en.people.studentsLink);
    for (const item of within(list).getAllByRole('listitem')) {
      expect(item.textContent).toBe(within(item).getByRole('link').textContent);
    }
  });
});
