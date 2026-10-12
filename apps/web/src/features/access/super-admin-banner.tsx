import { superAdminSummarySchema } from '@sodiq/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { sessionQuery } from '@/features/auth/session';

export const SUPER_ADMINS_KEY = ['access', 'super-admins'] as const;

/** The number of active Super Admins; the Super Admin alone may read it (task 2.3a). */
export const superAdminsQuery = (enabled: boolean) =>
  queryOptions({
    queryKey: SUPER_ADMINS_KEY,
    queryFn: async () =>
      superAdminSummarySchema.parse(await answerOf(api.GET('/api/access/super-admins'))),
    enabled,
  });

/**
 * Edge cases, Accounts and sign-in: "A banner shows while fewer than two
 * [Super Admins] exist" (task 2.3a). Shown to a Super Admin, who is the one
 * who can give the role.
 */
export function SuperAdminBanner() {
  const { t } = useTranslation();
  const { data: session } = useQuery(sessionQuery);
  const isSuperAdmin =
    session?.assignments.some((assignment) => assignment.role === 'super_admin') ?? false;
  const count = useQuery(superAdminsQuery(isSuperAdmin));
  if (!isSuperAdmin) {
    return null;
  }
  if (count.isError) {
    return <FailureAlert error={count.error} />;
  }
  if (count.data === undefined || count.data.active >= 2) {
    return null;
  }
  return (
    <Alert variant="warning" className="mb-4" data-banner="super-admins">
      <AlertDescription>{t('layout.superAdminBanner')}</AlertDescription>
    </Alert>
  );
}
