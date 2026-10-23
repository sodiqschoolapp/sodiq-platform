import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WarningIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';

/** Where the tab keeps that the server refused a write as `app_outdated`; nothing is fetched. */
const OUTDATED_KEY = ['app', 'outdated'] as const;

/** Called by the shell for every refusal `app_outdated` (task 8.3a). */
export const markOutdated = (queryClient: QueryClient): void => {
  queryClient.setQueryData(OUTDATED_KEY, true);
};

/** Reloads the page; a part of the app that tests can replace. */
export const reloadPage = { run: (): void => window.location.reload() };

/**
 * `edge/system-behaviour`, the release at 19:00: "Entries from the previous
 * version are accepted for at least one release; otherwise the page asks to
 * reload and keeps the unsent entries" (task 8.3a, decision 9). The page keeps
 * reading and showing what is not saved; Reload asks first while anything is
 * (`useLeave`). Until 8.3c stores the journal's entries, a reload drops them.
 */
export function OutdatedAlert() {
  const { t } = useTranslation();
  const { leave } = useLeave();
  const outdated = useQuery({
    queryKey: OUTDATED_KEY,
    queryFn: () => false,
    enabled: false,
    staleTime: Infinity,
  });
  if (outdated.data !== true) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm"
      data-outdated="true"
    >
      <WarningIcon aria-hidden="true" className="text-warning" />
      <span className="min-w-0 flex-1">{t('unsent.outdated')}</span>
      <Button
        variant="secondary"
        onClick={() => {
          void leave().then((leaves) => {
            if (leaves) reloadPage.run();
          });
        }}
      >
        {t('unsent.reload')}
      </Button>
    </div>
  );
}
