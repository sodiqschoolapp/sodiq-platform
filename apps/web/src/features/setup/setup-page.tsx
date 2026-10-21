import { PERMISSIONS, permits, type Action } from '@sodiq/shared';
import { Link, type LinkProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { SetupChecklist } from './setup-checklist';
import { PANEL } from '@/components/ui/control';

interface SetupLink {
  key: string;
  to: LinkProps['to'];
  title: string;
  /** The area of the permission table the page belongs to. */
  area: string;
  /** What the role must be allowed in the area to see the link; `view` when left out. */
  action?: Action;
}

/**
 * The entry of the menu item "School setup" (docs/spec/03-school-setup.md:
 * "Setup is done once per branch and then drives every other screen"). One
 * link per part that is built; a part is shown when the permission table lets
 * the active role view its area. Above the links, the setup checklist of the
 * branch for the roles that view the settings (task 1.6, answer 23).
 */
export function SetupPage() {
  const { t } = useTranslation();
  const { role } = useView();
  const all: SetupLink[] = [
    {
      // The Branches list is the Super Admin's (task 2.7c-3, decision 2).
      key: 'branches',
      to: '/setup/branches',
      title: t('setup.branchesLink'),
      area: 'branches',
      action: 'create',
    },
    {
      key: 'branch',
      to: '/setup/branch',
      title: t('setup.branchLink'),
      area: 'branches',
    },
    {
      key: 'buildings',
      to: '/setup/buildings',
      title: t('setup.buildingsLink'),
      area: 'rooms',
    },
    {
      key: 'rooms',
      to: '/setup/rooms',
      title: t('setup.roomsLink'),
      area: 'rooms',
    },
    {
      key: 'divisions',
      to: '/setup/divisions',
      title: t('setup.divisionsLink'),
      area: 'divisions',
    },
    {
      key: 'years',
      to: '/setup/years',
      title: t('setup.yearsLink'),
      area: 'academic_years',
    },
    {
      key: 'slotTypes',
      to: '/setup/slot-types',
      title: t('setup.slotTypesLink'),
      area: 'day_templates',
    },
    {
      key: 'dayTemplates',
      to: '/setup/day-templates',
      title: t('setup.dayTemplatesLink'),
      area: 'day_templates',
    },
    {
      key: 'templateSettings',
      to: '/setup/day-template-settings',
      title: t('setup.templateSettingsLink'),
      area: 'day_templates',
    },
    {
      key: 'calendar',
      to: '/setup/calendar',
      title: t('setup.calendarLink'),
      area: 'calendar',
    },
    {
      key: 'settings',
      to: '/setup/settings',
      title: t('setup.settingsLink'),
      area: 'settings',
    },
    {
      key: 'travelTimes',
      to: '/setup/travel-times',
      title: t('setup.travelTimesLink'),
      area: 'branches',
    },
    {
      key: 'subjects',
      to: '/setup/subjects',
      title: t('setup.subjectsLink'),
      area: 'subjects',
    },
    {
      // The records deleted for good, the Super Admin's (tasks 5.8b and 5.8c).
      key: 'forcedDeletes',
      to: '/forced-deletes',
      title: t('setup.forcedDeletesLink'),
      area: 'forced_deletes',
    },
  ];
  const showsChecklist = role !== null && permits(PERMISSIONS, role, 'settings', 'view');
  const links = all.filter(
    (link) => role !== null && permits(PERMISSIONS, role, link.area, link.action ?? 'view'),
  );

  return (
    <>
      <PageHeader title={t('setup.title')} breadcrumbs={[{ label: t('home.title'), to: '/' }]} />
      {showsChecklist && <SetupChecklist />}
      {links.length === 0 ? (
        <EmptyState title={t('setup.noneTitle')} text={t('setup.none')} />
      ) : (
        <ul aria-label={t('setup.title')} className="grid max-w-3xl gap-6">
          {links.map((link) => (
            <li key={link.key} className={PANEL}>
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
