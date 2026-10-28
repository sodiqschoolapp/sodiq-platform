import { Link } from '@tanstack/react-router';
import type { LinkProps } from '@tanstack/react-router';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { PANEL } from '@/components/ui/control';
import { useMayView } from '@/features/access/use-view';

/** The reports of `08`, Analytics in Release 1, each shown when the role views its area. */
const REPORTS: readonly { area: string; titleKey: ParseKeys; to: LinkProps['to'] }[] = [
  {
    area: 'attendance_report',
    titleKey: 'results.reports.links.attendance',
    to: '/results/attendance',
  },
  { area: 'results_reports', titleKey: 'results.reports.links.table', to: '/results/table' },
  { area: 'results_reports', titleKey: 'results.reports.links.mastery', to: '/results/mastery' },
  {
    area: 'journal_discipline',
    titleKey: 'results.reports.links.discipline',
    to: '/journal/discipline',
  },
  { area: 'timetable_load', titleKey: 'results.reports.links.load', to: '/results/load' },
];

/** The areas of the reports: a role that views one of them has the Reports page. */
export const REPORT_AREAS: readonly string[] = [...new Set(REPORTS.map((one) => one.area))];

/** Whether the role in use views any report. */
export function useMayReport(): boolean {
  const attendance = useMayView('attendance_report');
  const results = useMayView('results_reports');
  const discipline = useMayView('journal_discipline');
  const load = useMayView('timetable_load');
  return attendance || results || discipline || load;
}

function ReportLink({ report }: { report: (typeof REPORTS)[number] }): React.JSX.Element | null {
  const { t } = useTranslation();
  const may = useMayView(report.area);
  if (!may) return null;
  return (
    <li>
      <Link to={report.to} className="text-link">
        {t(report.titleKey)}
      </Link>
    </li>
  );
}

/** A menu page (`.claude/rules/web.md`: a title and its links). */
export function ReportsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const may = useMayReport();
  return (
    <>
      <PageHeader
        title={t('results.reports.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
      />
      {may ? (
        <ul className={`${PANEL} grid gap-3`}>
          {REPORTS.map((report) => (
            <ReportLink key={report.titleKey} report={report} />
          ))}
        </ul>
      ) : (
        <EmptyState title={t('results.reports.title')} text={t('problems.noAccessPart')} />
      )}
    </>
  );
}
