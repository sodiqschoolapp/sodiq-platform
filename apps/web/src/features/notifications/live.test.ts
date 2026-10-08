import { NOTIFICATION_MESSAGES, NOTIFICATION_SOCKET_PATH, type Notification } from '@sodiq/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { sessionOf } from '@/testing/render-app';
import {
  connectWithSocketIo,
  liveFollower,
  RETRY_MAX_MS,
  RETRY_MS,
  type LiveConnector,
  type LiveHandlers,
} from './live';
import { NOTIFICATIONS_KEY } from './notifications-api';

/** What `io` of socket.io-client gives: the handlers it was given, and what was done to it. */
const fakeSocket = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const socket = {
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler);
      return socket;
    }),
    disconnect: vi.fn(),
    connect: vi.fn(),
    /** Whether socket.io-client will try again by itself: not after a refused handshake. */
    active: true,
  };
  return {
    socket,
    listeners,
    /** The server (or the client itself) raises an event. */
    raise: (event: string, payload: unknown) => {
      listeners.get(event)?.(payload);
    },
    reset: () => {
      listeners.clear();
      socket.on.mockClear();
      socket.disconnect.mockClear();
      socket.connect.mockClear();
      socket.active = true;
    },
  };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket.socket),
}));

const ITEM: Notification = {
  id: '0199c000-0000-7000-8000-000000000001',
  kind: 'sample.message',
  data: { text: 'Monday changed.' },
  branchId: null,
  branchName: null,
  createdAt: '2026-10-08T04:00:00.000Z',
  readAt: null,
};

function handlersSpy(): LiveHandlers & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    onState: [],
    onNew: [],
    onRead: [],
    onReadAll: [],
    onEnded: [],
  };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name]?.push(args);
    };
  return {
    calls,
    onState: record('onState'),
    onNew: record('onNew'),
    onRead: record('onRead'),
    onReadAll: record('onReadAll'),
    onEnded: record('onEnded'),
  };
}

// docs/spec/13-technology.md: Socket.IO for live updates. Decided by the owner
// at the plan of 0.9: WebSocket only; a refusal about the session or the site
// stops the connection, a network failure does not (the client tries again).
describe('the Socket.IO connection', () => {
  async function connect() {
    fakeSocket.reset();
    const handlers = handlersSpy();
    const connection = connectWithSocketIo(handlers);
    const { io } = await import('socket.io-client');
    return { handlers, connection, io };
  }

  it('opens on the path of the API, with WebSocket only', async () => {
    const { io } = await connect();

    expect(io).toHaveBeenLastCalledWith({
      path: NOTIFICATION_SOCKET_PATH,
      transports: ['websocket'],
    });
  });

  it('hands over the state, new items, read marks and "read all" as they fit their schemas', async () => {
    const { handlers } = await connect();

    fakeSocket.raise(NOTIFICATION_MESSAGES.state, { unreadCount: 1, items: [ITEM] });
    fakeSocket.raise(NOTIFICATION_MESSAGES.new, { items: [ITEM] });
    fakeSocket.raise(NOTIFICATION_MESSAGES.read, { ids: [ITEM.id], readAt: ITEM.createdAt });
    fakeSocket.raise(NOTIFICATION_MESSAGES.readAll, { readAt: ITEM.createdAt });

    expect(handlers.calls.onState).toEqual([[{ unreadCount: 1, items: [ITEM] }]]);
    expect(handlers.calls.onNew).toEqual([[[ITEM]]]);
    expect(handlers.calls.onRead).toEqual([[[ITEM.id], ITEM.createdAt]]);
    expect(handlers.calls.onReadAll).toEqual([[ITEM.createdAt]]);
  });

  it('drops a message that does not fit its schema', async () => {
    const { handlers } = await connect();

    fakeSocket.raise(NOTIFICATION_MESSAGES.new, { items: [{ id: 'x' }] });
    fakeSocket.raise(NOTIFICATION_MESSAGES.state, 'nothing');
    fakeSocket.raise(NOTIFICATION_MESSAGES.read, { ids: 'all' });

    expect(handlers.calls.onNew).toEqual([]);
    expect(handlers.calls.onState).toEqual([]);
    expect(handlers.calls.onRead).toEqual([]);
  });

  it('ends when the server says the session is over, once', async () => {
    const { handlers } = await connect();

    fakeSocket.raise(NOTIFICATION_MESSAGES.ended, { code: 'not_signed_in' });
    fakeSocket.raise(NOTIFICATION_MESSAGES.ended, { code: 'not_signed_in' });

    expect(fakeSocket.socket.disconnect).toHaveBeenCalledTimes(1);
    expect(handlers.calls.onEnded).toEqual([['not_signed_in']]);
  });

  it.each([
    'not_signed_in',
    'second_step_required',
    'password_change_required',
    'cross_site_request',
  ])('ends when the handshake is refused with %s', async (code) => {
    const { handlers } = await connect();

    fakeSocket.raise('connect_error', new Error(code));

    expect(fakeSocket.socket.disconnect).toHaveBeenCalledTimes(1);
    expect(handlers.calls.onEnded).toEqual([[code]]);
  });

  it('leaves a network failure to the client, which tries again by itself', async () => {
    const { handlers } = await connect();

    fakeSocket.raise('connect_error', new Error('websocket error'));
    fakeSocket.raise('connect_error', new Error('timeout'));

    expect(fakeSocket.socket.disconnect).not.toHaveBeenCalled();
    expect(fakeSocket.socket.connect).not.toHaveBeenCalled();
    expect(handlers.calls.onEnded).toEqual([]);
  });

  it('opens the connection again after a wait that doubles when the server turned it away for another reason', async () => {
    vi.useFakeTimers();
    try {
      const { handlers } = await connect();
      fakeSocket.socket.active = false;

      fakeSocket.raise('connect_error', new Error('internal_error'));
      fakeSocket.raise('connect_error', new Error('internal_error'));
      expect(fakeSocket.socket.connect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(RETRY_MS - 1);
      expect(fakeSocket.socket.connect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fakeSocket.socket.connect).toHaveBeenCalledTimes(1);

      fakeSocket.raise('connect_error', new Error('internal_error'));
      vi.advanceTimersByTime(RETRY_MS);
      expect(fakeSocket.socket.connect).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(RETRY_MS);
      expect(fakeSocket.socket.connect).toHaveBeenCalledTimes(2);

      // A connection that came through starts the waits over.
      fakeSocket.raise('connect', undefined);
      fakeSocket.raise('disconnect', 'io server disconnect');
      vi.advanceTimersByTime(RETRY_MS);
      expect(fakeSocket.socket.connect).toHaveBeenCalledTimes(3);

      expect(fakeSocket.socket.disconnect).not.toHaveBeenCalled();
      expect(handlers.calls.onEnded).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open the connection again once closed or ended', async () => {
    vi.useFakeTimers();
    try {
      const { connection } = await connect();
      fakeSocket.socket.active = false;

      fakeSocket.raise('connect_error', new Error('internal_error'));
      connection.close();
      vi.advanceTimersByTime(RETRY_MAX_MS);
      expect(fakeSocket.socket.connect).not.toHaveBeenCalled();

      fakeSocket.reset();
      await connect();
      fakeSocket.socket.active = false;
      fakeSocket.raise('connect_error', new Error('internal_error'));
      fakeSocket.raise('connect_error', new Error('not_signed_in'));
      vi.advanceTimersByTime(RETRY_MAX_MS);
      expect(fakeSocket.socket.connect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes when told', async () => {
    const { connection, handlers } = await connect();

    connection.close();
    fakeSocket.raise(NOTIFICATION_MESSAGES.ended, { code: 'not_signed_in' });

    expect(fakeSocket.socket.disconnect).toHaveBeenCalledTimes(1);
    expect(handlers.calls.onEnded).toEqual([]);
  });
});

describe('the follower of the session', () => {
  function follower() {
    const queryClient = new QueryClient();
    const connections: { handlers: LiveHandlers; closed: boolean }[] = [];
    const connect: LiveConnector = (handlers) => {
      const connection = { handlers, closed: false };
      connections.push(connection);
      return {
        close: () => {
          connection.closed = true;
        },
      };
    };
    const doubts: number[] = [];
    const live = liveFollower(queryClient, connect, () => doubts.push(1));
    return { queryClient, connections, doubts, live };
  }

  it('opens a connection for a complete session, once per answer, and closes it when the session is over or owes a step', () => {
    const { connections, live } = follower();
    const session = sessionOf();

    live.follow(undefined);
    expect(connections).toHaveLength(0);
    live.follow(session);
    live.follow(session);
    expect(connections).toHaveLength(1);

    const another = sessionOf({ login: 'b.karimov' });
    live.follow(another);
    expect(connections).toHaveLength(2);
    expect(connections[0]?.closed).toBe(true);

    live.follow(sessionOf({ secondStep: 'pending' }));
    expect(connections[1]?.closed).toBe(true);
    live.follow(sessionOf());
    expect(connections).toHaveLength(3);
    live.follow(null);
    expect(connections[2]?.closed).toBe(true);
    expect(connections).toHaveLength(3);
  });

  it('feeds what arrives into the cached list', () => {
    const { queryClient, connections, live } = follower();
    live.follow(sessionOf());
    const handlers = connections[0]?.handlers;
    const list = () => queryClient.getQueryData(NOTIFICATIONS_KEY);

    // Nothing cached yet: a new item is waited for by the list, not invented.
    handlers?.onNew([ITEM]);
    expect(list()).toBeUndefined();

    handlers?.onState({ unreadCount: 0, items: [] });
    handlers?.onNew([ITEM]);
    expect(list()).toEqual({ unreadCount: 1, items: [ITEM] });
    handlers?.onRead([ITEM.id], '2026-10-08T05:00:00.000Z');
    expect(list()).toEqual({
      unreadCount: 0,
      items: [{ ...ITEM, readAt: '2026-10-08T05:00:00.000Z' }],
    });
    handlers?.onNew([{ ...ITEM, id: '0199c000-0000-7000-8000-000000000002' }]);
    handlers?.onReadAll('2026-10-08T06:00:00.000Z');
    expect(list()).toMatchObject({ unreadCount: 0 });
    expect((list() as { items: Notification[] }).items.every((item) => item.readAt !== null)).toBe(
      true,
    );
  });

  it('asks about the session when the server ended the connection, and opens nothing for the same answer', () => {
    const { connections, doubts, live } = follower();
    const session = sessionOf();
    live.follow(session);

    connections[0]?.handlers.onEnded('not_signed_in');
    live.follow(session);

    expect(doubts).toEqual([1]);
    expect(connections).toHaveLength(1);

    live.follow(sessionOf());
    expect(connections).toHaveLength(2);
  });
});
