import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { NOTIFICATION_MESSAGES, NOTIFICATION_SOCKET_PATH } from '@sodiq/shared';
import { Server, type Socket } from 'socket.io';
import { fromOwnSite } from '../../../http/same-site.js';
import { readSessionToken } from '../../../http/session-cookie.js';
import { Sessions, type OwedStep } from '../../auth/sessions.service.js';
import { Notifications } from '../notifications.service.js';

/** What a connection remembers of its handshake. */
interface ConnectionData {
  sessionId: string;
  accountId: string;
}

/** Why a handshake is refused, or a connection closed: a code of the API's error shape. */
type RefusalCode = 'cross_site_request' | 'not_signed_in' | OwedStep;

/** The room of every connection of one account. */
const roomOf = (accountId: string): string => `account:${accountId.toLowerCase()}`;

/**
 * The protocol and host the request was made to, as `same-site.ts` reads them
 * for a request of Express: the request itself, without any proxy's say. The
 * two agree while the API sets no `trust proxy`; a task that sets it for a
 * load balancer that ends TLS changes both, or they drift apart here.
 */
function ownOriginOf(request: IncomingMessage): string {
  const encrypted = (request.socket as { encrypted?: boolean }).encrypted === true;
  return `${encrypted ? 'https' : 'http'}://${request.headers.host ?? ''}`;
}

/**
 * Live arrival over Socket.IO (docs/spec/13-technology.md). The server is
 * attached to the HTTP server of the API by hand (no NestJS gateway), under
 * the API prefix, WebSocket only (`13`, Hosting: two application servers
 * behind a load balancer, and long polling would need sticky sessions). It
 * only tells: no message a client sends is acted on.
 *
 * The handshake refuses, with a reason the client reads: a request from
 * another site (the rule of `same-site.ts`, applied here whatever the method,
 * since a WebSocket upgrade is a GET); no session cookie; a session that is
 * over, of a locked account, or that still owes a step of its sign-in (the
 * layout, where the connection lives, needs a complete session). The lookup
 * does not count as use of the session (`Sessions.peek`).
 */
@Injectable()
export class LiveSockets implements BeforeApplicationShutdown {
  private readonly logger = new Logger('Live');
  private io: Server | undefined;

  constructor(
    private readonly sessions: Sessions,
    private readonly notifications: Notifications,
  ) {}

  /** Once, on the HTTP server of the API, before it listens. */
  attach(httpServer: HttpServer): void {
    if (this.io !== undefined) {
      throw new Error('The live server is attached already.');
    }
    const io = new Server(httpServer, {
      path: NOTIFICATION_SOCKET_PATH,
      serveClient: false,
      transports: ['websocket'],
      // A client sends nothing the server reads; a message of any size is refused.
      maxHttpBufferSize: 1024,
    });
    io.use((socket, next) => {
      this.admit(socket).then(
        (refusal) => {
          next(refusal === undefined ? undefined : new Error(refusal));
        },
        (error: unknown) => {
          // A fault while the session is read (the database away for a moment):
          // this handshake is refused and the tab tries again later; the process
          // and the other connections go on. Found by the permission review.
          this.logger.error(`A handshake could not be checked: ${nameOf(error)}`);
          next(new Error('not_signed_in'));
        },
      );
    });
    io.on('connection', (socket) => {
      void this.welcome(socket);
    });
    this.io = io;
  }

  /** The number of open connections of an account on this process. For the tests. */
  async connectionsOf(accountId: string): Promise<number> {
    if (this.io === undefined) {
      return 0;
    }
    return (await this.io.in(roomOf(accountId)).fetchSockets()).length;
  }

  private async admit(socket: Socket): Promise<RefusalCode | undefined> {
    const request = socket.request;
    if (!fromOwnSite(request.headers, ownOriginOf(request))) {
      return 'cross_site_request';
    }
    const token = readSessionToken(request);
    if (token === undefined) {
      return 'not_signed_in';
    }
    const [session] = await this.sessions.peek({ token });
    if (session === undefined) {
      return 'not_signed_in';
    }
    if (session.owedStep !== null) {
      return session.owedStep;
    }
    const data: ConnectionData = { sessionId: session.sessionId, accountId: session.accountId };
    socket.data = data;
    await socket.join(roomOf(session.accountId));
    return undefined;
  }

  /**
   * At every connection the tab gets the state: the unread count and the
   * latest items, so a tab whose connection was down is up to date the moment
   * it is back, without a call to the API.
   */
  private async welcome(socket: Socket): Promise<void> {
    const { accountId } = socket.data as ConnectionData;
    try {
      const state = await this.notifications.list(accountId);
      socket.emit(NOTIFICATION_MESSAGES.state, state);
    } catch (error) {
      this.logger.error(`The state for a connection could not be read: ${nameOf(error)}`);
      socket.disconnect(true);
    }
  }

  /**
   * Tells every connection of the account, after a check that its session is
   * still in force: a connection whose session ended, or owes a step again,
   * is told so and closed instead, and gets nothing.
   */
  async tell(accountId: string, message: string, payload: object): Promise<void> {
    if (this.io === undefined) {
      return;
    }
    const sockets = await this.io.in(roomOf(accountId)).fetchSockets();
    if (sockets.length === 0) {
      return;
    }
    const sessionIds = sockets.map((socket) => (socket.data as ConnectionData).sessionId);
    const open = new Map(
      (await this.sessions.peek({ sessionIds })).map((session) => [session.sessionId, session]),
    );
    for (const socket of sockets) {
      const session = open.get((socket.data as ConnectionData).sessionId);
      if (session === undefined || session.owedStep !== null) {
        socket.emit(NOTIFICATION_MESSAGES.ended, { code: session?.owedStep ?? 'not_signed_in' });
        socket.disconnect(true);
      } else {
        socket.emit(message, payload);
      }
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    const io = this.io;
    this.io = undefined;
    if (io !== undefined) {
      await io.close();
    }
  }
}

/** The name and message of an error, never the values of a row. */
export function nameOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}
