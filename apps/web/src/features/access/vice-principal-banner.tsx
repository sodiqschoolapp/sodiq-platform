import { branchesWithoutViceSchema } from '@sodiq/shared';
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FOCUS_RING } from '@/components/ui/control';
import { sessionQuery } from '@/features/auth/session';
import { useView } from './use-view';

export const BRANCHES_WITHOUT_VICE_KEY = ['access', 'branches-without-vice-principal'] as const;

/** The branches with no active Academic Vice Principal now; the Super Admin alone may read them (task 2.3b-2). */
export const branchesWithoutViceQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: BRANCHES_WITHOUT_VICE_KEY,
    queryFn: async () =>
      branchesWithoutViceSchema.parse(
        await answerOf(api.GET('/api/access/branches-without-vice-principal')),
      ),
    enabled,
  });

/** After a change that can give, end or block an Academic Vice Principal, or add or rename a branch. */
export const invalidateBranchesWithoutVice = (queryClient: QueryClient): Promise<unknown> =>
  queryClient.invalidateQueries({ queryKey: BRANCHES_WITHOUT_VICE_KEY });

/**
 * Edge cases, Who can act: "a branch with no active Academic Vice Principal
 * shows an alert to the Super Admin" (task 2.3b-2, decisions 8 and 9 of
 * #64). Each name chooses its branch and opens its staff list, where the
 * Super Admin gives the role on a person's account section.
 */
export function BranchesWithoutViceBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { chooseBranch } = useView();
  const { data: session } = useQuery(sessionQuery);
  const isSuperAdmin =
    session?.assignments.some((assignment) => assignment.role === 'super_admin') ?? false;
  const branches = useQuery(branchesWithoutViceQuery(isSuperAdmin));
  if (!isSuperAdmin) {
    return null;
  }
  if (branches.isError) {
    return <FailureAlert error={branches.error} />;
  }
  if (branches.data === undefined || branches.data.branches.length === 0) {
    return null;
  }
  return (
    <Alert variant="warning" className="mb-4" data-banner="vice-principals">
      <AlertDescription>
        {t('layout.viceBanner')}{' '}
        {branches.data.branches.map((branch, index) => (
          <Fragment key={branch.id}>
            {index > 0 && ', '}
            {/* The Alert's own foreground, underlined: no new colour pair on the tint. */}
            <button
              type="button"
              className={`font-semibold underline underline-offset-4 ${FOCUS_RING}`}
              onClick={() => {
                chooseBranch(branch.id);
                void navigate({ to: '/people/staff' });
              }}
            >
              {branch.name}
            </button>
          </Fragment>
        ))}
      </AlertDescription>
    </Alert>
  );
}
