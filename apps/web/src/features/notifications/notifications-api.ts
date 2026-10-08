import {
  NOTIFICATION_LIST_LIMIT,
  notificationListSchema,
  type Notification,
  type NotificationList,
} from '@sodiq/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';

export const NOTIFICATIONS_KEY = ['notifications'] as const;

/**
 * The latest notifications of the person and the unread count. Loaded once,
 * when the bell of the layout mounts; afterwards the live connection keeps it
 * current (every connection brings the state again), so it is never asked
 * for on a timer (`.claude/rules/web.md`).
 */
export const notificationsQuery = queryOptions({
  queryKey: NOTIFICATIONS_KEY,
  queryFn: async () => notificationListSchema.parse(await answerOf(api.GET('/api/notifications'))),
  staleTime: Number.POSITIVE_INFINITY,
});

/** Applies a change to the cached list, when there is one. */
export function updateList(
  queryClient: QueryClient,
  change: (list: NotificationList) => NotificationList,
): void {
  queryClient.setQueryData<NotificationList>(NOTIFICATIONS_KEY, (list) =>
    list === undefined ? undefined : change(list),
  );
}

/** New notifications in front of the list, each once, at most the latest ones. */
export function withNew(list: NotificationList, items: Notification[]): NotificationList {
  const known = new Set(list.items.map((item) => item.id));
  const added = items.filter((item, index) => {
    const first = items.findIndex((other) => other.id === item.id) === index;
    return first && !known.has(item.id);
  });
  return {
    unreadCount: list.unreadCount + added.filter((item) => item.readAt === null).length,
    items: [...added, ...list.items].slice(0, NOTIFICATION_LIST_LIMIT),
  };
}

/** These notifications marked read; the count goes down by those that were unread. */
export function withRead(
  list: NotificationList,
  ids: readonly string[],
  readAt: string,
): NotificationList {
  const marked = new Set(ids);
  let newlyRead = 0;
  const items = list.items.map((item) => {
    if (!marked.has(item.id) || item.readAt !== null) {
      return item;
    }
    newlyRead += 1;
    return { ...item, readAt };
  });
  return { unreadCount: Math.max(0, list.unreadCount - newlyRead), items };
}

/** Everything read. */
export function withAllRead(list: NotificationList, readAt: string): NotificationList {
  return {
    unreadCount: 0,
    items: list.items.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
  };
}
