import { PERMISSIONS, permits } from '@sodiq/shared';
import { Link, type LinkProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { useView } from '@/features/access/use-view';

interface SetupLink {
  key: string;
  to: LinkProps['to'];
  title: string;
  text: string;
  /** The area of the permission table the page belongs to. */
  area: string;
}

/**
 * The entry of the menu item "School setup" (docs/spec/03-school-setup.md:
 * "Setup is done once per branch and then drives every other screen"). One
 * link per part that is built; a part is shown when the permission table lets
 * the active role view its area. Later tasks add the calendar here.
 */
export function SetupPage() {
  const { t } = useTranslation();
  const { role } = useView();
  const all: SetupLink[] = [
    {
      key: 'branch',
      to: '/setup/branch',
      title: t('setup.branchLink'),
      text: t('setup.branchLinkText'),
      area: 'branches',
    },
    {
      key: 'buildings',
      to: '/setup/buildings',
      title: t('setup.buildingsLink'),
      text: t('setup.buildingsLinkText'),
      area: 'rooms',
    },
    {
      key: 'rooms',
      to: '/setup/rooms',
      title: t('setup.roomsLink'),
      text: t('setup.roomsLinkText'),
      area: 'rooms',
    },
    {
      key: 'divisions',
      to: '/setup/divisions',
      title: t('setup.divisionsLink'),
      text: t('setup.divisionsLinkText'),
      area: 'divisions',
    },
    {
      key: 'years',
      to: '/setup/years',
      title: t('setup.yearsLink'),
      text: t('setup.yearsLinkText'),
      area: 'academic_years',
    },
    {
      key: 'slotTypes',
      to: '/setup/slot-types',
      title: t('setup.slotTypesLink'),
      text: t('setup.slotTypesLinkText'),
      area: 'day_templates',
    },
    {
      key: 'dayTemplates',
      to: '/setup/day-templates',
      title: t('setup.dayTemplatesLink'),
      text: t('setup.dayTemplatesLinkText'),
      area: 'day_templates',
    },
    {
      key: 'templateSettings',
      to: '/setup/day-template-settings',
      title: t('setup.templateSettingsLink'),
      text: t('setup.templateSettingsLinkText'),
      area: 'day_templates',
    },
  ];
  const links = all.filter(
    (link) => role !== null && permits(PERMISSIONS, role, link.area, 'view'),
  );

  return (
    <>
      <PageHeader title={t('setup.title')} breadcrumbs={[{ label: t('home.title'), to: '/' }]} />
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">{t('setup.intro')}</p>
      {links.length === 0 ? (
        <EmptyState text={t('setup.none')} />
      ) : (
        <ul className="grid max-w-3xl gap-3">
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
