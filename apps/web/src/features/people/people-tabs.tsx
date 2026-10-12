import { PERMISSIONS, permits } from '@sodiq/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useView } from '@/features/access/use-view';

type Section = 'staff' | 'vacancies' | 'head-teachers' | 'never-used';

const SECTIONS: readonly {
  key: Section;
  to: '/people/staff' | '/people/vacancies' | '/people/head-teachers' | '/people/never-used';
  area: string;
  title:
    | 'people.staff.title'
    | 'people.vacancies.title'
    | 'people.headTeachers.title'
    | 'people.neverUsed.title';
}[] = [
  { key: 'staff', to: '/people/staff', area: 'staff', title: 'people.staff.title' },
  { key: 'vacancies', to: '/people/vacancies', area: 'vacancies', title: 'people.vacancies.title' },
  {
    key: 'head-teachers',
    to: '/people/head-teachers',
    area: 'head_teachers',
    title: 'people.headTeachers.title',
  },
  // Task 2.3c-1: the accounts never used, for the readers of `account_access`.
  {
    key: 'never-used',
    to: '/people/never-used',
    area: 'account_access',
    title: 'people.neverUsed.title',
  },
];

/**
 * The sections of People, each a list with its own address, so that each
 * keeps its own search, filters and open record: the staff and the vacancies
 * (`04`, Vacancy: "The teacher list shows vacancies in a section of their
 * own"; task 2.2b) and the Head Teachers (task 2.3b-2). A tab shows for each
 * section the role views; the row shows when there are two or more
 * (decision 6 of #64).
 */
export function PeopleTabs({ current }: { current: Section }) {
  const { t } = useTranslation();
  const { role } = useView();
  const shown = SECTIONS.filter(
    (section) => role !== null && permits(PERMISSIONS, role, section.area, 'view'),
  );
  if (shown.length < 2) {
    return null;
  }
  return (
    <nav aria-label={t('people.sections')} className="mb-4 flex gap-6 border-b">
      {shown.map((section) => (
        <Link
          key={section.key}
          to={section.to}
          aria-current={current === section.key ? 'page' : undefined}
          className={
            current === section.key
              ? 'border-b-2 border-foreground px-1 pb-2 font-semibold'
              : 'border-b-2 border-transparent px-1 pb-2 text-muted-foreground hover:text-foreground'
          }
        >
          {t(section.title)}
        </Link>
      ))}
    </nav>
  );
}
