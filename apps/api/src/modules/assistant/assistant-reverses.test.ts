import { describe, expect, it } from 'vitest';
import { ROUTE_ACCESS } from '../../testing/route-access-list.js';
import { ROUTE_LINES } from '../access/assistant-routes.js';
import { ASSISTANT_REVERSES, pathValuesOf, reverseOf } from './reverses.js';
import { GENERATED_TOOLS } from './tools.generated.js';

// Task 11.21 (pull request #388), the table of Undo (`02`, Reading and proposing: "the assistant
// proposes the reverse of each change made, where an action exists that reverses it"; plan
// decision 10). Each line names two routes of the assistant's lists, of one area, open to the same
// roles; every archive with a restore beside it is in the table both ways; each pair the build
// plan names is there.

const routes = Object.keys(GENERATED_TOOLS);

/** The roles and branch a route of the permission harness is open to. */
function accessOf(route: string): { roles: string[]; branch: string } {
  const access = ROUTE_ACCESS[route];
  return typeof access === 'object'
    ? { roles: [...access.roles].sort(), branch: access.branch }
    : { roles: [], branch: String(access) };
}

describe('the reverses of Undo', () => {
  it('names two existing change routes of one area for each line, open to the same roles in the same branch', () => {
    for (const [route, reverse] of Object.entries(ASSISTANT_REVERSES)) {
      expect(routes, route).toContain(route);
      expect(routes, reverse.route).toContain(reverse.route);
      const own = ROUTE_LINES[route];
      const back = ROUTE_LINES[reverse.route];
      expect(own?.kind, route).toBe('change');
      expect(back?.kind, reverse.route).toBe('change');
      expect(back?.group, route).toBe(own?.group);
      expect(accessOf(reverse.route), route).toEqual(accessOf(route));
      expect(accessOf(route).roles.length, route).toBeGreaterThan(0);
      // Each path value of the reverse comes from the change's own path or from its record.
      const params = (reverse.route.match(/:[A-Za-z]+/g) ?? []).map((one) => one.slice(1));
      expect(Object.keys(reverse.path).sort(), route).toEqual(params.sort());
      for (const value of Object.values(reverse.path)) {
        if (value.from === 'path') expect(route, route).toContain(`:${value.name}`);
      }
    }
  });

  it('holds every archive that has a restore beside it, both ways (the walk)', () => {
    for (const route of routes.filter((one) => /^POST .*\/archive$/.test(one))) {
      const restore = route.replace(/\/archive$/, '/restore');
      if (!routes.includes(restore)) continue;
      expect(ASSISTANT_REVERSES[route]?.route, route).toBe(restore);
      expect(ASSISTANT_REVERSES[restore]?.route, restore).toBe(route);
    }
  });

  it('holds each pair the build plan names: archive and restore, add and withdraw, a cancel and its restore, a day added and removed', () => {
    expect(ASSISTANT_REVERSES['POST /api/setup/subjects/:id/archive']?.route).toBe(
      'POST /api/setup/subjects/:id/restore',
    );
    expect(ASSISTANT_REVERSES['POST /api/timetable/absences']?.route).toBe(
      'POST /api/timetable/absences/:id/withdraw',
    );
    expect(ASSISTANT_REVERSES['POST /api/timetable/lessons/:id/substitute']?.route).toBe(
      'POST /api/timetable/lessons/:id/substitution/withdraw',
    );
    expect(ASSISTANT_REVERSES['POST /api/setup/calendar-entries']?.route).toBe(
      'POST /api/setup/calendar-entries/:id/archive',
    );
    expect(ASSISTANT_REVERSES['POST /api/timetable/lessons/:id/cancel']?.route).toBe(
      'POST /api/timetable/lessons/:id/restore',
    );
    // A one-day move or room change has no action that removes it: named, never reversed
    // (plan decision 10; review of the code, must fix 4).
    expect(ASSISTANT_REVERSES['POST /api/timetable/lessons/:id/move']).toBeUndefined();
    expect(ASSISTANT_REVERSES['POST /api/timetable/lessons/:id/room']).toBeUndefined();
  });

  it('reads the values of a path, and builds a reverse from the same path', () => {
    const id = '0199a3c4-0000-7000-8000-0000000000aa';
    expect(
      pathValuesOf('POST /api/setup/subjects/:id/archive', `/api/setup/subjects/${id}/archive`),
    ).toEqual({
      id,
    });
    expect(
      pathValuesOf('POST /api/setup/subjects/:id/archive', '/api/setup/rooms/x/archive'),
    ).toBeUndefined();
    expect(
      reverseOf(
        {
          route: 'POST /api/setup/subjects/:id/archive',
          url: `/api/setup/subjects/${id}/archive`,
          body: null,
        },
        null,
      ),
    ).toEqual(expect.objectContaining({ pathArgs: { id }, body: undefined }));
  });
});
