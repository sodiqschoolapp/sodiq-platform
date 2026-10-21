import { PERMISSIONS, permits } from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { PANEL } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';

/**
 * The entry of the menu item "Timetable" (task 3.4a): a title and its links.
 * The teaching load, the draft builder (task 5.3a) and the day changes (task
 * 5.6a-1), the exams of a date (task 5.6c-2), the absences (task 5.7a-1), the version
 * history (task 5.8a); the grid and the
 * views come with phase 5.
 */
export function TimetablePage() {
  const { t } = useTranslation();
  const { role } = useView();
  const views = role !== null && permits(PERMISSIONS, role, 'timetable', 'view');
  return (
    <>
      <PageHeader
        title={t('timetable.title')}
        breadcrumbs={[{ label: t('home.title'), to: '/' }]}
      />
      {views && (
        <ul aria-label={t('timetable.title')} className="grid max-w-3xl gap-6">
          <li className={PANEL}>
            <Link
              to="/timetable/load"
              className="font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('timetable.loadLink')}
            </Link>
          </li>
          <li className={PANEL}>
            <Link
              to="/timetable/builder"
              className="font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('timetable.builderLink')}
            </Link>
          </li>
          <li className={PANEL}>
            <Link
              to="/timetable/day"
              className="font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('timetable.dayLink')}
            </Link>
          </li>
          <li className={PANEL}>
            <Link
              to="/timetable/exams"
              className="font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('timetable.examsLink')}
            </Link>
          </li>
          <li className={PANEL}>
            <Link
              to="/timetable/absences"
              className="font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('timetable.absencesLink')}
            </Link>
          </li>
          <li className={PANEL}>
            <Link
              to="/timetable/room-closures"
              className="font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('timetable.roomClosuresLink')}
            </Link>
          </li>
          <li className={PANEL}>
            <Link
              to="/timetable/versions"
              className="font-semibold text-link underline-offset-4 hover:underline"
            >
              {t('timetable.versionsLink')}
            </Link>
          </li>
        </ul>
      )}
    </>
  );
}
