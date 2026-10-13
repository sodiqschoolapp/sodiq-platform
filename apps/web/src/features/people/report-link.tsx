import { permits, PERMISSIONS, type PersonalDataKind } from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useView } from '@/features/access/use-view';

/**
 * "Personal data report" on the panel of a student, a staff member or a
 * parent (task 2.6b): only for a role the table lets produce it, the Super
 * Admin (decision 3); the server decides and logs each report.
 */
export function ReportLink({ kind, id }: { kind: PersonalDataKind; id: string }) {
  const { t } = useTranslation();
  const { role } = useView();
  if (role === null || !permits(PERMISSIONS, role, 'personal_data_report', 'export')) {
    return null;
  }
  return (
    <Link
      to="/people/report/$kind/$id"
      params={{ kind, id }}
      className="justify-self-start font-semibold text-link underline-offset-4 hover:underline"
    >
      {t('people.report.link')}
    </Link>
  );
}
