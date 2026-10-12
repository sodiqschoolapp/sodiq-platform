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
  text: string;
  /** The area of the permission table the page belongs to. */
  area: string;
}

/**
 * The entry of the menu item "People" (docs/spec/04-people.md): one link per
 * list that is built, shown when the permission table lets the active role
 * view its area. Staff came with task 2.2a, vacancies with 2.2b; students and relatives come with
 * tasks 2.4 and 2.5.
 */
export function PeoplePage() {
  const { t } = useTranslation();
  const { role } = useView();
  const all: PeopleLink[] = [
    {
      key: 'staff',
      to: '/people/staff',
      title: t('people.staffLink'),
      text: t('people.staffLinkText'),
      area: 'staff',
    },
    {
      key: 'vacancies',
      to: '/people/vacancies',
      title: t('people.vacanciesLink'),
      text: t('people.vacanciesLinkText'),
      area: 'vacancies',
    },
  ];
  const links = all.filter(
    (link) => role !== null && permits(PERMISSIONS, role, link.area, 'view'),
  );
  return (
    <>
      <PageHeader title={t('people.title')} breadcrumbs={[{ label: t('home.title'), to: '/' }]} />
      {links.length === 0 ? (
        <EmptyState text={t('people.none')} />
      ) : (
        <ul aria-label={t('people.title')} className="grid max-w-3xl gap-3">
          {links.map((link) => (
            <li key={link.key} className="rounded-lg border p-4">
              <Link to={link.to} className="font-medium underline-offset-4 hover:underline">
                {link.title}
              </Link>
              <p className="mt-1 text-sm text-muted-foreground">{link.text}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
