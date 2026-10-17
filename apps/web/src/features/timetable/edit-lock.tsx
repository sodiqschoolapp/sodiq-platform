import type { TimetableVersion } from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { LockIcon } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatMoment } from '@/lib/dates';
import { invalidateTimetable, takeEditLock } from './timetable-api';

/** The holder's "still here" goes at most once a minute, after a key or a pointer. */
const STILL_HERE_EVERY = 60_000;
/** A reader of a draft another person edits reads it again at most every 30 seconds, after a key or a pointer. */
const READ_AGAIN_EVERY = 30_000;

/**
 * Calls `work` on the first key or pointer of the person in the page, then
 * not again for `every` milliseconds: activity, never a timer on its own
 * (`.claude/rules/web.md`: nothing calls the API on a timer without asking).
 */
function useOnActivity(active: boolean, every: number, work: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    let resting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onActivity = () => {
      if (resting) return;
      resting = true;
      work();
      timer = setTimeout(() => {
        resting = false;
      }, every);
    };
    window.addEventListener('keydown', onActivity);
    window.addEventListener('pointerdown', onActivity);
    return () => {
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, every, work]);
}

/**
 * The edit lock of a draft in the builder (task 5.4c-1; 06, Editing in the
 * grid: "Several people can view a draft; one edits at a time"):
 *
 * - `othersEditing`: another person was active on it in the last 5 minutes;
 *   the page is read only and shows `EditLockBanner`.
 * - The holder's key or pointer keeps the lock ("still here", decision 3);
 *   a reader's reads the draft again, so a lock let go shows as free.
 * - A write refused `draft_edit_locked` reads the versions again, so the page
 *   turns read only with the name of the new holder (decision 5).
 */
export function useEditLock(version: TimetableVersion | undefined, canEditRole: boolean) {
  const queryClient = useQueryClient();
  const lock = version?.editLock ?? null;
  const othersEditing = lock !== null && !lock.mine;
  const versionId = version?.id ?? null;

  const take = useMutation({
    mutationFn: () => takeEditLock(versionId ?? ''),
    onSuccess: () => invalidateTimetable(queryClient),
  });

  const stillHere = useCallback(() => {
    if (versionId === null) return;
    takeEditLock(versionId).catch(() => invalidateTimetable(queryClient));
  }, [versionId, queryClient]);
  const readAgain = useCallback(() => {
    void invalidateTimetable(queryClient);
  }, [queryClient]);
  // Review correction 1: only the holder's activity keeps the lock; a reader's never takes it.
  useOnActivity(
    canEditRole && versionId !== null && lock?.mine === true,
    STILL_HERE_EVERY,
    stillHere,
  );
  useOnActivity(othersEditing, READ_AGAIN_EVERY, readAgain);

  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.action.type === 'error' &&
          event.action.error instanceof ApiFailure &&
          event.action.error.code === 'draft_edit_locked'
        ) {
          void invalidateTimetable(queryClient);
        }
      }),
    [queryClient],
  );

  return { othersEditing, take };
}

/** Who edits the draft now, and "Take over" (task 5.4c-1). */
export function EditLockBanner({
  version,
  take,
}: {
  version: TimetableVersion;
  take: ReturnType<typeof useEditLock>['take'];
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const lock = version.editLock;
  if (lock === null || lock.mine) return null;
  return (
    <div className="grid gap-2" data-edit-lock="">
      <Alert>
        <LockIcon />
        <AlertDescription className="grid gap-2">
          <span>
            {t('timetable.editLock.held', {
              name: lock.holder.name === '' ? t('timetable.editLock.someone') : lock.holder.name,
              time: formatMoment(i18n.language, lock.seenAt),
            })}
          </span>
          <span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={take.isPending}
              onClick={() => {
                take.mutate();
              }}
            >
              {t('timetable.editLock.takeOver')}
            </Button>
          </span>
        </AlertDescription>
      </Alert>
      <FailureAlert error={take.error} />
    </div>
  );
}
