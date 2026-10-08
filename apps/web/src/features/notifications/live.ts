import {
  NOTIFICATION_MESSAGES,
  NOTIFICATION_SOCKET_PATH,
  notificationEndedMessageSchema,
  notificationNewMessageSchema,
  notificationReadAllMessageSchema,
  notificationReadMessageSchema,
  notificationStateMessageSchema,
  type Notification,
  type NotificationList,
} from '@sodiq/shared';
import type { QueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { SESSION_CHANGED_CODES, stepOf, type Session } from '@/features/auth/session';
import { NOTIFICATIONS_KEY, updateList, withAllRead, withNew, withRead } from './notifications-api';

/** What a live connection tells the tab. */
export interface LiveHandlers {
  /** At every connection: the state replaces whatever the tab holds. */
  onState(state: NotificationList): void;
  onNew(items: Notification[]): void;
  onRead(ids: string[], readAt: string): void;
  onReadAll(readAt: string): void;
  /**
   * The server refused the handshake, or closed the connection, because the
   * session is over, owes a step, or the request did not come from the site.
   * The connection is closed and does not try again by itself.
   */
  onEnded(code: string): void;
}

export interface LiveConnection {
  close(): void;
}

/** Opens a connection. The tests give a fake; the app gives Socket.IO. */
export type LiveConnector = (handlers: LiveHandlers) => LiveConnection;

/** A refusal with one of these is about the session or the site: no reconnection helps. */
const STOP_CODES = new Set<string>([...SESSION_CHANGED_CODES, 'cross_site_request']);

/** What the web app uses of a schema of `packages/shared` (it does not import zod itself). */
interface MessageSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** Reads a message with its schema; a message that does not fit is dropped. */
function reading<T>(schema: MessageSchema<T>, handle: (payload: T) => void) {
  return (payload: unknown): void => {
    const parsed = schema.safeParse(payload);
    if (parsed.success) {
      handle(parsed.data);
    }
  };
}

/**
 * Live arrival over Socket.IO (docs/spec/13-technology.md), on the same origin
 * as the API, WebSocket only. The session cookie goes with the handshake. A
 * network failure is tried again by the client with its own backoff; a
 * refusal about the session or the site stops it (`.claude/rules/web.md`:
 * nothing polls the API).
 */
export const connectWithSocketIo: LiveConnector = (handlers) => {
  const socket = io({ path: NOTIFICATION_SOCKET_PATH, transports: ['websocket'] });
  let ended = false;
  const end = (code: string): void => {
    if (ended) {
      return;
    }
    ended = true;
    socket.disconnect();
    handlers.onEnded(code);
  };
  socket.on(
    NOTIFICATION_MESSAGES.state,
    reading(notificationStateMessageSchema, (state) => {
      handlers.onState(state);
    }),
  );
  socket.on(
    NOTIFICATION_MESSAGES.new,
    reading(notificationNewMessageSchema, ({ items }) => {
      handlers.onNew(items);
    }),
  );
  socket.on(
    NOTIFICATION_MESSAGES.read,
    reading(notificationReadMessageSchema, ({ ids, readAt }) => {
      handlers.onRead(ids, readAt);
    }),
  );
  socket.on(
    NOTIFICATION_MESSAGES.readAll,
    reading(notificationReadAllMessageSchema, ({ readAt }) => {
      handlers.onReadAll(readAt);
    }),
  );
  socket.on(
    NOTIFICATION_MESSAGES.ended,
    reading(notificationEndedMessageSchema, ({ code }) => {
      end(code);
    }),
  );
  socket.on('connect_error', (error: Error) => {
    if (STOP_CODES.has(error.message)) {
      end(error.message);
    }
  });
  return {
    close: () => {
      ended = true;
      socket.disconnect();
    },
  };
};

export interface LiveFollower {
  /** Called with every answer about the session the tab receives. */
  follow(session: Session | undefined): void;
  close(): void;
}

/**
 * Keeps one live connection while the session is complete, and none
 * otherwise: it opens with the first complete answer, closes at sign-out and
 * when the session is read as ended or owing a step, and feeds what arrives
 * into the cached list. After the server ended a connection, `onDoubt` asks
 * the API what the session is now; no new connection is made until the
 * session answer changes, so a refusal never turns into a loop.
 */
export function liveFollower(
  queryClient: QueryClient,
  connect: LiveConnector,
  onDoubt: () => void,
): LiveFollower {
  let connection: LiveConnection | undefined;
  let connectedFor: Session | undefined;

  const close = (): void => {
    connection?.close();
    connection = undefined;
    connectedFor = undefined;
  };

  return {
    follow(session) {
      if (session === undefined) {
        return;
      }
      if (session === null || stepOf(session) !== 'none') {
        close();
        return;
      }
      if (connectedFor === session) {
        return;
      }
      connection?.close();
      connectedFor = session;
      const own = connect({
        onState: (state) => {
          queryClient.setQueryData<NotificationList>(NOTIFICATIONS_KEY, state);
        },
        onNew: (items) => {
          updateList(queryClient, (list) => withNew(list, items));
        },
        onRead: (ids, readAt) => {
          updateList(queryClient, (list) => withRead(list, ids, readAt));
        },
        onReadAll: (readAt) => {
          updateList(queryClient, (list) => withAllRead(list, readAt));
        },
        onEnded: () => {
          if (connection === own) {
            // `connectedFor` stays: the same session answer opens nothing again.
            connection = undefined;
          }
          onDoubt();
        },
      });
      connection = own;
    },
    close,
  };
}
