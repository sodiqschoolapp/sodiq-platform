import { PERMISSIONS, permits, type Action, type Role } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { indexedPages } from '@/app/page-index';

// Pull request #361: Ctrl+K finds the Feedback reports and System status pages for the Super
// Admin, the one role of the area `monitoring`, and for no other role that has Setup.
const SETUP = { titleKey: 'menu.setup', to: '/setup' } as const;

const pagesOf = (role: Role) =>
  indexedPages([SETUP], (area: string, action?: Action) =>
    permits(PERMISSIONS, role, area, action ?? 'view'),
  ).map((page) => page.to);

describe('the search of pages', () => {
  it('lists the two pages for the Super Admin', () => {
    expect(pagesOf('super_admin')).toEqual(
      expect.arrayContaining(['/feedback-reports', '/system-status']),
    );
  });

  it.each(['principal', 'academic_vice_principal'] as const)('lists neither for the %s', (role) => {
    const pages = pagesOf(role);
    expect(pages).toContain('/setup/subjects');
    expect(pages).not.toContain('/feedback-reports');
    expect(pages).not.toContain('/system-status');
  });
});
