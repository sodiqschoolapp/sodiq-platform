import { PERMISSIONS, permits } from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useView } from '@/features/access/use-view';

/**
 * The two sections of the teacher list (`04`, Vacancy: "The teacher list
 * shows vacancies in a section of their own"; task 2.2b): the staff and the
 * vacancies, each a list with its own address, so that each keeps its own
 * search, filters and open record. The vacancies show for a role that views
 * them.
 */
export function PeopleTabs({ current }: { current: 'staff' | 'vacancies' }) {
  const { t } = useTranslation();
  const { role } = useView();
  if (role === null || !permits(PERMISSIONS, role, 'vacancies', 'view')) {
    return null;
  }
  const tab = (
    key: 'staff' | 'vacancies',
    to: '/people/staff' | '/people/vacancies',
    text: string,
  ) => (
    <Link
      to={to}
      aria-current={current === key ? 'page' : undefined}
      className={
        current === key
          ? 'border-b-2 border-primary px-1 pb-2 font-medium'
          : 'border-b-2 border-transparent px-1 pb-2 text-muted-foreground hover:text-foreground'
      }
    >
      {text}
    </Link>
  );
  return (
    <nav aria-label={t('people.sections')} className="mb-4 flex gap-6 border-b">
      {tab('staff', '/people/staff', t('people.staff.title'))}
      {tab('vacancies', '/people/vacancies', t('people.vacancies.title'))}
    </nav>
  );
}
