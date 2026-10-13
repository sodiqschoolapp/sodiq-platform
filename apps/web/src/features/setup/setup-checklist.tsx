import { PERMISSIONS, permits, type ChecklistItem, type ChecklistItemKey } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, type LinkProps } from '@tanstack/react-router';
import { CheckCircleIcon, RadioButtonUncheckedIcon, InfoIcon } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { checklistQuery } from './settings-api';
import { SECTION_TITLE } from '@/components/ui/control';

/** The page of each item and the area of the permission table it belongs to. */
const PAGES: Record<ChecklistItemKey, { to: LinkProps['to']; area: string }> = {
  branch: { to: '/setup/branch', area: 'branches' },
  rooms: { to: '/setup/rooms', area: 'rooms' },
  departments: { to: '/setup/divisions', area: 'divisions' },
  year: { to: '/setup/years', area: 'academic_years' },
  quarters: { to: '/setup/years', area: 'quarters' },
  slotTypes: { to: '/setup/slot-types', area: 'day_templates' },
  defaultTemplate: { to: '/setup/day-template-settings', area: 'day_templates' },
  calendar: { to: '/setup/calendar', area: 'calendar' },
  subjects: { to: '/setup/subjects', area: 'subjects' },
};

/**
 * Done or missing, in words beside the icon: never by colour or shape alone
 * (`12`, Accessibility; issue #39, hand test of 13 October 2026, finding 17).
 */
function Mark({ done }: { done: boolean | null }) {
  const { t } = useTranslation();
  if (done === null) {
    return <InfoIcon aria-hidden className="size-4 text-muted-foreground" />;
  }
  return done ? (
    <span className="inline-flex items-center gap-1 text-success">
      <CheckCircleIcon aria-hidden className="size-4" />
      {t('setup.checklist.done')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <RadioButtonUncheckedIcon aria-hidden className="size-4" />
      {t('setup.checklist.missing')}
    </span>
  );
}

function ItemText({ item }: { item: ChecklistItem }) {
  const { t } = useTranslation();
  if (item.key === 'calendar') {
    return (
      <span className="text-sm text-muted-foreground">
        {t('setup.checklist.calendarCount', { count: item.count ?? 0 })}
      </span>
    );
  }
  if (item.key === 'quarters' && item.years.length > 0) {
    return (
      <span className="text-sm text-muted-foreground">
        {t('setup.checklist.undatedYears', { years: item.years.join(', ') })}
      </span>
    );
  }
  if (item.key === 'subjects' && (item.count ?? 0) > 0) {
    return (
      <span className="text-sm text-muted-foreground">
        {t('setup.checklist.subjectsMissing', { count: item.count ?? 0 })}
      </span>
    );
  }
  if (item.key === 'departments') {
    return (
      <span className="text-sm text-muted-foreground">{t('setup.checklist.wholeSchool')}</span>
    );
  }
  return null;
}

/**
 * The setup checklist of the branch in use (`edge/academic-year`: "Each
 * branch has a setup checklist in a fixed order"; answer 23; task 1.6): each
 * item done or missing as stored, the calendar as a count that never blocks.
 * An item links to its page when the role views that page's area.
 */
export function SetupChecklist() {
  const { t } = useTranslation();
  const { role, branchId } = useView();
  const checklist = useQuery(checklistQuery(branchId));
  const title = t('setup.checklist.title');

  let body;
  if (checklist.isError) {
    body = (
      <ErrorState
        error={checklist.error}
        onRetry={() => {
          void checklist.refetch();
        }}
      />
    );
  } else if (checklist.data === undefined) {
    body = <LoadingOutline lines={4} />;
  } else {
    body = (
      <ol className="grid gap-2">
        {checklist.data.items.map((item) => {
          const page = PAGES[item.key];
          const name = t(`setup.checklist.items.${item.key}`);
          const linked = role !== null && permits(PERMISSIONS, role, page.area, 'view');
          return (
            <li key={item.key} data-item={item.key} className="flex flex-wrap items-center gap-2">
              <Mark done={item.done} />
              {linked ? (
                <Link
                  to={page.to}
                  className="font-semibold text-link underline-offset-4 hover:underline"
                >
                  {name}
                </Link>
              ) : (
                <span>{name}</span>
              )}
              <ItemText item={item} />
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <section aria-label={title} className="mb-6 grid max-w-3xl gap-3 rounded-xl bg-card p-6">
      <h2 className={SECTION_TITLE}>{title}</h2>
      {body}
    </section>
  );
}
