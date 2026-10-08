import type { Notification } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { BellIcon } from 'lucide-react';
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
import { formatMoment } from '@/features/auth/moments';
import { NOTIFICATIONS_KEY, notificationsQuery } from './notifications-api';

/**
 * The text of a notification, from the kind and its data, in the language of
 * the tab (decided by the owner, task 0.9). A kind this version of the app
 * does not know (a newer server) gets a text that says so instead of nothing
 * (`edge/system-behaviour`: a tab from before a release keeps working).
 */
export function useNotificationText(): (item: Notification) => string {
  const { t, i18n } = useTranslation();
  return (item) => {
    const key = `notifications.kinds.${item.kind}`;
    if (!i18n.exists(key)) {
      return t('notifications.kinds.unknown');
    }
    // The key exists; the type of `t` cannot know a key built from data.
    return t(key as 'notifications.kinds.unknown', { ...item.data });
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
            className="relative"
            aria-label={
              unread > 0
                ? t('notifications.buttonUnread', { count: unread, n: formatted })
                : t('notifications.button')
            }
          />
        }
      >
        <BellIcon aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-medium text-primary-foreground"
          >
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
                    <span className="flex items-start gap-2">
                      {/* The unread mark: a dot and a word, not a colour alone (`12`, Look and feel). */}
                      <span
                        aria-hidden
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          unreadItem ? 'bg-primary' : 'bg-transparent',
                        )}
                      />
                      <span className={cn(unreadItem && 'font-medium')}>{textOf(item)}</span>
                    </span>
                    <span className="pl-4 text-xs text-muted-foreground">
                      {where}
                      {unreadItem && (
                        <>
                          {' · '}
                          {t('notifications.unread')}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <FailureAlert error={markRead.error ?? markAllRead.error} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
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
