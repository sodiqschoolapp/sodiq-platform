import { NOTIFICATION_KINDS, type Notification } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { NotificationsIcon } from '@/components/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { NOTIFICATIONS_KEY, notificationsQuery } from './notifications-api';
import { nameOf } from '@/features/setup/setup-api';
import { formatMoment, schoolDateText } from '@/lib/dates';
import { ExamNotice } from './exam-notice';
import { WeekChange } from './week-change';

/**
 * The text of a notification, from the kind and its data, in the language of
 * the tab (decided by the owner, task 0.9). A kind this version of the app
 * does not know (a newer server) gets a text that says so instead of nothing
 * (`edge/system-behaviour`: a tab from before a release keeps working).
 */
/** The kinds of task 9.2c whose data holds school dates, written as the screen writes them. */
const DATED_KINDS: ReadonlySet<string> = new Set([
  'results.check_difference',
  'results.check_missed',
  'results.closing_overdue',
  'plans.window_ending',
  'plans.window_missing',
]);

export function useNotificationText(): (item: Notification) => string {
  const { t, i18n } = useTranslation();
  return (item) => {
    const key = `notifications.kinds.${item.kind}`;
    if (!i18n.exists(key)) {
      return t('notifications.kinds.unknown');
    }
    // Task 9.1: a weights change names the subject in the language shown, its quarters and the
    // date as the screen writes them (a stored value is never shown as stored).
    if (item.kind === 'setup.quarter_weights_changed') {
      const change = NOTIFICATION_KINDS[item.kind].safeParse(item.data);
      if (!change.success) return t('notifications.kinds.unknown');
      return t('notifications.kinds.setup.quarter_weights_changed', {
        replace: {
          subject: nameOf(change.data.subject, i18n.language),
          quarters: change.data.quarters
            .map((number) => t('results.quarterNumber', { number }))
            .join(', '),
          date: schoolDateText(change.data.date, i18n.language),
          reason: change.data.reason,
        },
      });
    }
    // Task 9.2a: the reminder of the closing checklist lists the teacher's own items, each
    // named in the language shown (`07`: "sends the list to the teachers concerned").
    if (item.kind === 'results.closing_reminder') {
      const reminder = NOTIFICATION_KINDS[item.kind].safeParse(item.data);
      if (!reminder.success) return t('notifications.kinds.unknown');
      return t('notifications.kinds.results.closing_reminder', {
        replace: {
          quarter: reminder.data.quarter,
          items: reminder.data.items
            .map((one) =>
              t('results.closing.reminderLine', {
                replace: {
                  kind: t(`results.closing.kinds.${one.kind}`),
                  unit: one.unit,
                  subject: nameOf(one.subject, i18n.language),
                  count: one.count,
                },
              }),
            )
            .join('; '),
        },
      });
    }
    // Task 9.2c: "about to lock" names the subject in the language shown and the moment of
    // the lock; the dates of the daily notices as the screen writes them.
    if (item.kind === 'journal.lesson_about_to_lock') {
      const notice = NOTIFICATION_KINDS[item.kind].safeParse(item.data);
      if (!notice.success) return t('notifications.kinds.unknown');
      return t('notifications.kinds.journal.lesson_about_to_lock', {
        replace: {
          unit: notice.data.unit,
          subject: nameOf(notice.data.subject, i18n.language),
          date: schoolDateText(notice.data.date, i18n.language),
          locksAt: formatMoment(i18n.language, notice.data.locksAt),
        },
      });
    }
    if (DATED_KINDS.has(item.kind)) {
      const data = Object.fromEntries(
        Object.entries(item.data).map(([name, value]) => [
          name,
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? schoolDateText(value, i18n.language)
            : value,
        ]),
      );
      return t(key as 'notifications.kinds.unknown', { replace: data });
    }
    // The key exists; the type of `t` cannot know a key built from data. The
    // data fills the {{names}} only (`replace`): a field called `count` or
    // `context` must not change the lookup.
    return t(key as 'notifications.kinds.unknown', { replace: item.data });
  };
}

/**
 * The bell of the top bar (docs/spec/10-portal-notifications-release-2.md,
 * last paragraph: staff notifications in the app). The badge says how many
 * are unread, in words for a screen reader; the dialog lists the latest ones,
 * newest first, each marked read by a click, and "Mark all as read". The list
 * is kept current by the live connection (`live.ts`); a click asks the list
 * again once, never on a timer.
 */
export function NotificationsButton() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery(notificationsQuery);
  const textOf = useNotificationText();
  const [open, setOpen] = useState(false);
  const unread = list.data?.unreadCount ?? 0;
  const formatted = new Intl.NumberFormat(i18n.language).format(unread);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  const markRead = useMutation({
    mutationFn: (id: string) =>
      answerOf(api.POST('/api/notifications/{id}/read', { params: { path: { id } } })),
    onSuccess: refresh,
  });
  const markAllRead = useMutation({
    mutationFn: () => answerOf(api.POST('/api/notifications/read-all')),
    onSuccess: refresh,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            aria-label={
              unread > 0
                ? t('notifications.buttonUnread', { count: unread, n: formatted })
                : t('notifications.button')
            }
          />
        }
      >
        <NotificationsIcon />
        {/* The count is a plain number beside the icon, never a badge or a dot
            (docs/design-system.md, What we never do 4 and 12). */}
        {unread > 0 && (
          <span aria-hidden data-unread-count="" className="tabular-nums">
            {formatted}
          </span>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('notifications.title')}</DialogTitle>
          <DialogDescription>{t('notifications.text')}</DialogDescription>
        </DialogHeader>
        {list.isPending ? (
          <LoadingOutline />
        ) : list.isError ? (
          <ErrorState
            error={list.error}
            onRetry={() => {
              void list.refetch();
            }}
          />
        ) : list.data.items.length === 0 ? (
          <EmptyState text={t('notifications.empty')} />
        ) : (
          <ul aria-label={t('notifications.title')} className="grid max-h-96 gap-1 overflow-y-auto">
            {list.data.items.map((item) => {
              const unreadItem = item.readAt === null;
              const where = [item.branchName, formatMoment(i18n.language, item.createdAt)]
                .filter((part): part is string => part !== null)
                .join(' · ');
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!unreadItem}
                    onClick={() => {
                      markRead.mutate(item.id);
                    }}
                    className={cn(
                      'grid w-full gap-0.5 rounded-lg px-2 py-1.5 text-left text-sm',
                      unreadItem ? 'hover:bg-muted' : 'text-muted-foreground',
                    )}
                  >
                    {/* Unread: the text in bold and the word "Unread", never a dot
                        (docs/design-system.md, What we never do 12). */}
                    <span className={cn(unreadItem && 'font-semibold')}>{textOf(item)}</span>
                    <span className="text-xs text-muted-foreground">
                      {where}
                      {unreadItem && (
                        <>
                          {' · '}
                          {t('notifications.unread')}
                        </>
                      )}
                    </span>
                  </button>
                  <ExamNotice item={item} />
                  <WeekChange item={item} />
                </li>
              );
            })}
          </ul>
        )}
        <FailureAlert error={markRead.error ?? markAllRead.error} />
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            {t('notifications.close')}
          </DialogClose>
          <Button
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => {
              markAllRead.mutate();
            }}
          >
            {t('notifications.markAllRead')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
