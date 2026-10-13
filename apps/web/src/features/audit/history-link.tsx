import { permits, PERMISSIONS, type AuditPersonKind } from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useView } from '@/features/access/use-view';

/**
 * "History" on the panel of a staff member, a student or a parent (task 2.6a):
 * the Audit log with every entry about the person, as the actor or as the
 * person or record of the entry (decision 5). Only for a role that reads the
 * log; the server decides what it shows.
 */
export function HistoryLink({ kind, id }: { kind: AuditPersonKind; id: string }) {
  const { t } = useTranslation();
  const { role } = useView();
  if (role === null || !permits(PERMISSIONS, role, 'audit_log', 'view')) {
    return null;
  }
  return (
    <Link
      to="/audit"
      search={{ person: `${kind}:${id}` }}
      className="justify-self-start font-semibold text-link underline-offset-4 hover:underline"
    >
      {t('audit.history')}
    </Link>
  );
}
