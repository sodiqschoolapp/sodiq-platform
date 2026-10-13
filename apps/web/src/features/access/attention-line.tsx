import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExpandMoreIcon } from '@/components/icons';
import { Alert } from '@/components/ui/alert';
import { FOCUS_RING } from '@/components/ui/control';
import { sessionQuery } from '@/features/auth/session';
import { SM, useMinWidth } from '@/lib/use-min-width';
import { cn } from 'cn';
import { SuperAdminBanner, superAdminsQuery } from './super-admin-banner';
import { BranchesWithoutViceBanner, branchesWithoutViceQuery } from './vice-principal-banner';

/**
 * How many of the Super Admin's alerts are shown now. A failed alert query
 * counts: its failure is shown in the alert's place, and it is something to see.
 */
function useAttentionCount(): number {
  const { data: session } = useQuery(sessionQuery);
  const isSuperAdmin =
    session?.assignments.some((assignment) => assignment.role === 'super_admin') ?? false;
  const superAdmins = useQuery(superAdminsQuery(isSuperAdmin));
  const branches = useQuery(branchesWithoutViceQuery(isSuperAdmin));
  if (!isSuperAdmin) {
    return 0;
  }
  const fewSuperAdmins =
    superAdmins.isError || (superAdmins.data !== undefined && superAdmins.data.active < 2);
  const withoutVice =
    branches.isError || (branches.data !== undefined && branches.data.branches.length > 0);
  return Number(fewSuperAdmins) + Number(withoutVice);
}

/**
 * The alerts of the Super Admin above every page (fewer than two Super Admins,
 * branches without an Academic Vice Principal). From 640 px they are shown as
 * they are. On a phone they took most of the first screen (issue #39, hand
 * test of 13 October 2026, finding 30), so there they are one line, "Needs
 * your attention: n", with a button that shows them in place. Whether they
 * are open is kept only while the tab lives (task 2.7b-2, decision 6): an
 * alert about too few Super Admins comes back on the next visit.
 */
export function AttentionAlerts() {
  const { t } = useTranslation();
  const wide = useMinWidth(SM);
  const count = useAttentionCount();
  const [open, setOpen] = useState(false);
  const alertsId = useId();

  const alerts = (
    <>
      <SuperAdminBanner />
      <BranchesWithoutViceBanner />
    </>
  );
  if (wide || count === 0) {
    return alerts;
  }
  return (
    <div className="mb-4 grid gap-2" data-banner="attention">
      <Alert variant="warning" className="flex items-center justify-between gap-3 py-1">
        <span className="font-semibold">{t('layout.attentionLine', { count, n: count })}</span>
        {/* The Alert's own foreground: no new colour pair on the tint. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={alertsId}
          className={cn(
            'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 font-semibold',
            FOCUS_RING,
          )}
          onClick={() => {
            setOpen((before) => !before);
          }}
        >
          <ExpandMoreIcon aria-hidden className={cn('size-5', open && 'rotate-180')} />
          {open ? t('layout.attentionHide') : t('layout.attentionShow')}
        </button>
      </Alert>
      <div id={alertsId} hidden={!open}>
        {open && alerts}
      </div>
    </div>
  );
}
