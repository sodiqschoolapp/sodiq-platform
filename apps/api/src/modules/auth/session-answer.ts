import { ROLES, type SessionResponse } from '@sodiq/shared';
import type { BranchChoice } from '../access/current-assignments.js';
import type { ActiveSession } from './sessions.service.js';

/** Nothing is shown before the step that is owed (docs/decisions.md, task 0.8c). */
export const owesAStep = (session: ActiveSession): boolean =>
  session.secondStep === 'pending' ||
  session.secondStep === 'set_up_required' ||
  session.mustChangePassword;

/**
 * What the session answers: who is signed in and, once no step is owed, the
 * assignments and the branches to choose from. `branches` is read only where
 * an answer is made (`Sessions.answerOf`), not on every request.
 */
export function answerOf(session: ActiveSession, branches: BranchChoice[]): SessionResponse {
  const owed = owesAStep(session);
  return {
    login: session.login,
    secondStep: session.secondStep,
    mustChangePassword: session.mustChangePassword,
    passwordResetBy: session.passwordResetBy,
    trustedUntil: session.trustedUntil?.toISOString() ?? null,
    language: session.language,
    assignments: owed
      ? []
      : ROLES.flatMap((role) =>
          session.assignments
            .filter((assignment) => assignment.role === role)
            .sort((a, b) => (a.branchId ?? '').localeCompare(b.branchId ?? ''))
            .map(({ branchId }) => ({ role, branchId })),
        ),
    branches: owed ? [] : branches,
  };
}
