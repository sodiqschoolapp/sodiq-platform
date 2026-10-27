import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSIONS } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import { repositoryRoot } from '../../database/config.js';
import {
  GENERATED_END,
  GENERATED_START,
  renderGenerated,
  withGenerated,
} from '../../testing/permission-checklist.js';
import { PUBLIC_ROUTES, ROUTE_ACCESS, STEP_ROUTES } from '../../testing/route-access-list.js';
import { ROUTE_IDS } from '../../testing/route-id-list.js';
import { ROUTE_SCOPE } from '../../testing/route-scope-list.js';

const CHECKLIST = path.join(repositoryRoot, 'docs/security/permission-checklist.md');

/**
 * docs/spec/14-quality-plan.md, Code review: "A change to permissions ... also
 * needs the owner's sign-off on a written checklist." The tables of the
 * checklist are read from the lists the server and the harnesses run, so the
 * signature covers what runs (task 10.3a). `pnpm security:checklist` writes
 * them again (`vitest run --mode checklist`); without it this test only compares.
 */
describe('the permission checklist', () => {
  const generated = renderGenerated({
    table: PERMISSIONS,
    publicRoutes: PUBLIC_ROUTES,
    stepRoutes: STEP_ROUTES,
    access: ROUTE_ACCESS,
    scopes: ROUTE_SCOPE,
    ids: ROUTE_IDS,
  });

  it('shows the permission table and the route lists as the code has them', () => {
    if (process.env.MODE === 'checklist') {
      writeFileSync(CHECKLIST, withGenerated(readFileSync(CHECKLIST, 'utf8'), generated));
    }
    const document = readFileSync(CHECKLIST, 'utf8');
    const updated = withGenerated(document, generated);

    expect(document).toBe(updated);
  });

  it('names every area of the table, every route with a limit and every route with an id', () => {
    for (const area of Object.keys(PERMISSIONS)) {
      expect(generated).toContain(`### \`${area}\``);
    }
    for (const route of [...Object.keys(ROUTE_SCOPE), ...Object.keys(ROUTE_IDS)]) {
      expect(generated).toContain(`| \`${route}\` |`);
    }
  });

  it('keeps the hand-written text around the generated part', () => {
    const document = `before\n${GENERATED_START}\nold\n${GENERATED_END}\nafter\n`;

    expect(withGenerated(document, `${GENERATED_START}\nnew\n${GENERATED_END}`)).toBe(
      `before\n${GENERATED_START}\nnew\n${GENERATED_END}\nafter\n`,
    );
    expect(() => withGenerated('no markers', 'x')).toThrow('lost its generated markers');
  });
});
