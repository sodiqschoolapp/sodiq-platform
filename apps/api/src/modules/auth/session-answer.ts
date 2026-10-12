import { ROLES, type PersonName, type SessionResponse } from '@sodiq/shared';
import type { BranchChoice } from '../access/current-assignments.js';
import type { ActiveSession } from './sessions.service.js';

/** Nothing is shown before the step that is owed (docs/decisions.md, task 0.8c). */
export const owesAStep = (session: ActiveSession): boolean =>
  session.secondStep === 'pending' ||
  session.secondStep === 'set_up_required' ||
  session.mustChangePassword;

/** The names an answer shows, read where it is made (task 2.3a, decision 9). */
export interface AnswerNames {
  /** The first and last name of the person's own staff record. */
  name: PersonName | null;
  /** The name of the administrator who reset the password; `null` when they have no record. */
  resetBy: PersonName | null;
}

/**
 * What the session answers: who is signed in and, once no step is owed, the
 * assignments and the branches to choose from. `branches` and the names are
 * read only where an answer is made (`Sessions.answerOf`), not on every
 * request. The administrator who reset the password is named by their name,
 * by their login when they have no staff record.
 */
export function answerOf(
  session: ActiveSession,
  branches: BranchChoice[],
  names: AnswerNames,
): SessionResponse {
  const owed = owesAStep(session);
  const resetBy =
    session.passwordResetBy === null
      ? null
      : names.resetBy === null
        ? session.passwordResetBy
        : `${names.resetBy.firstName} ${names.resetBy.lastName}`;
  return {
    login: session.login,
    name: names.name,
    secondStep: session.secondStep,
    mustChangePassword: session.mustChangePassword,
    passwordResetBy: resetBy,
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
