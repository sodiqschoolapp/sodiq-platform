import { PERMISSIONS, permits } from '@sodiq/shared';
import { Link, type LinkProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { useView } from '@/features/access/use-view';

interface PeopleLink {
  key: string;
  to: LinkProps['to'];
  title: string;
  /** The area of the permission table the page belongs to. */
  area: string;
}

/**
 * The entry of the menu item "People" (docs/spec/04-people.md): one link per
 * list that is built, shown when the permission table lets the active role
 * view its area. Staff came with task 2.2a, vacancies with 2.2b, Head Teachers with 2.3b-2, the accounts never used with 2.3c-1, students with 2.4a, the parents with 2.5a;
 * relatives come with task 2.5.
 */
export function PeoplePage() {
  const { t } = useTranslation();
  const { role } = useView();
  const all: PeopleLink[] = [
    {
      key: 'staff',
      to: '/people/staff',
      title: t('people.staffLink'),
      area: 'staff',
    },
    {
      key: 'students',
      to: '/people/students',
      title: t('people.studentsLink'),
      area: 'students',
    },
    // Task 2.5a: the relatives of the students of the branch.
    {
      key: 'parents',
      to: '/people/parents',
      title: t('people.parentsLink'),
      area: 'relatives',
    },
    {
      key: 'vacancies',
      to: '/people/vacancies',
      title: t('people.vacanciesLink'),
      area: 'vacancies',
    },
    {
      key: 'head-teachers',
      to: '/people/head-teachers',
      title: t('people.headTeachersLink'),
      area: 'head_teachers',
    },
    {
      key: 'never-used',
      to: '/people/never-used',
      title: t('people.neverUsedLink'),
      area: 'account_access',
    },
  ];
  const links = all.filter(
    (link) => role !== null && permits(PERMISSIONS, role, link.area, 'view'),
  );
  return (
    <>
      <PageHeader title={t('people.title')} breadcrumbs={[{ label: t('home.title'), to: '/' }]} />
      {links.length === 0 ? (
        <EmptyState title={t('people.noneTitle')} text={t('people.none')} />
      ) : (
        <ul aria-label={t('people.title')} className="grid max-w-3xl gap-6">
          {links.map((link) => (
            <li key={link.key} className="rounded-xl bg-card p-6">
              <Link
                to={link.to}
                className="font-semibold text-link underline-offset-4 hover:underline"
              >
                {link.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
