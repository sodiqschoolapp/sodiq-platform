import { describe, expect, it } from 'vitest';
import { resolveView } from './view';

const NORTH = { id: '0198a000-0000-7000-8000-000000000001', name: 'North' };
const SOUTH = { id: '0198a000-0000-7000-8000-000000000002', name: 'South' };
const NOBODY = { role: null, branchId: null };

describe('the role and branch on display', () => {
  it('shows nothing for an account without a role', () => {
    expect(resolveView({ assignments: [], branches: [] }, NOBODY)).toEqual({
      roles: [],
      role: null,
      branches: [],
      branchId: null,
    });
    expect(resolveView(null, NOBODY).role).toBeNull();
  });

  it('starts with the first role of the table and the first branch that suits it', () => {
    const view = resolveView(
      {
        assignments: [
          { role: 'tutor', branchId: SOUTH.id },
          { role: 'teacher', branchId: NORTH.id },
          { role: 'teacher', branchId: SOUTH.id },
        ],
        branches: [NORTH, SOUTH],
      },
      NOBODY,
    );

    expect(view.roles).toEqual(['tutor', 'teacher']);
    expect(view.role).toBe('tutor');
    expect(view.branches).toEqual([SOUTH]);
    expect(view.branchId).toBe(SOUTH.id);
  });

  it('lists a role held in two branches once, with both branches', () => {
    const view = resolveView(
      {
        assignments: [
          { role: 'teacher', branchId: NORTH.id },
          { role: 'teacher', branchId: SOUTH.id },
        ],
        branches: [NORTH, SOUTH],
      },
      NOBODY,
    );

    expect(view.roles).toEqual(['teacher']);
    expect(view.branches).toEqual([NORTH, SOUTH]);
  });

  it('keeps a choice the account holds, and moves the branch when the new role does not suit it', () => {
    const session = {
      assignments: [
        { role: 'tutor' as const, branchId: SOUTH.id },
        { role: 'teacher' as const, branchId: NORTH.id },
      ],
      branches: [NORTH, SOUTH],
    };

    expect(resolveView(session, { role: 'teacher', branchId: NORTH.id })).toMatchObject({
      role: 'teacher',
      branchId: NORTH.id,
    });
    // The branch chosen with the Tutor role is not a branch of the Teacher role.
    expect(resolveView(session, { role: 'teacher', branchId: SOUTH.id })).toMatchObject({
      role: 'teacher',
      branchId: NORTH.id,
    });
  });

  it('falls back to the default for a role or branch the account does not hold', () => {
    const session = {
      assignments: [{ role: 'teacher' as const, branchId: NORTH.id }],
      branches: [NORTH],
    };

    expect(resolveView(session, { role: 'principal', branchId: SOUTH.id })).toMatchObject({
      role: 'teacher',
      branchId: NORTH.id,
    });
  });

  it('gives the two roles that work across branches every branch', () => {
    for (const role of ['super_admin', 'senior_head_teacher'] as const) {
      const view = resolveView(
        { assignments: [{ role, branchId: null }], branches: [NORTH, SOUTH] },
        { role: null, branchId: SOUTH.id },
      );

      expect(view.branches, role).toEqual([NORTH, SOUTH]);
      expect(view.branchId, role).toBe(SOUTH.id);
    }
  });
});
