import type { NestExpressApplication } from '@nestjs/platform-express';
import { BRANCH_HEADER, type AssistantRole, type PermissionTable } from '@sodiq/shared';
import request from 'supertest';
import type { AssistantRouteLists } from '../modules/access/assistant-routes.js';
import { insertBranch } from './branch-filter-sql.js';
import { ClassesKit } from './classes-kit.js';
import { createTestApp } from './create-test-app.js';
import { FakeModel } from './assistant-model.js';
import { AssistantWork } from '../modules/assistant/assistant-work.js';
import { FixedClock } from './fixed-clock.js';
import { signInKit, type SignInKit } from './sign-in-kit.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

/** A moment of a school day in Tashkent, inside the year of `ClassesKit.year`. */
export const ASSISTANT_NOW = '2026-11-20T10:00:00+05:00';

export interface AssistantScene {
  database: TestDatabase;
  app: NestExpressApplication;
  kit: SignInKit;
  people: ClassesKit;
  model: FakeModel;
  clock: FixedClock;
  /** Task 11.15: each wait between two calls of the model; a wait moves the clock, never sleeps. */
  waits: number[];
  north: string;
  south: string;
  northYear: string;
  southYear: string;
  /** The Super Admin's session cookie and account. */
  admin: string;
  adminAccount: string;
  close(): Promise<void>;
}

/**
 * The scene of the assistant's tests (task 11.12): two branches with a current year each, a
 * Super Admin with a complete session, the fake model, and the server listening on 127.0.0.1 so
 * that the reads reach it. Names are invented.
 */
export async function assistantScene(
  options: {
    routeLists?: AssistantRouteLists;
    on?: boolean;
    permissionTable?: PermissionTable;
  } = {},
): Promise<AssistantScene> {
  const database = await createTestDatabase();
  const north = await insertBranch(database.migrator, 'North');
  const south = await insertBranch(database.migrator, 'South');
  const clock = new FixedClock(ASSISTANT_NOW);
  const model = new FakeModel();
  const waits: number[] = [];
  const app = await createTestApp({
    database: database.app,
    clock,
    assistantModel: model,
    assistantWait: (milliseconds) => {
      waits.push(milliseconds);
      clock.advance(milliseconds);
      return Promise.resolve();
    },
    listen: true,
    ...(options.routeLists === undefined ? {} : { assistantRouteLists: options.routeLists }),
    ...(options.permissionTable === undefined ? {} : { permissionTable: options.permissionTable }),
  });
  const kit = signInKit(app);
  const people = new ClassesKit(database.migrator);
  const northYear = await people.year(north);
  const southYear = await people.year(south);
  const browser = await kit.completeSession('Dilnoza', 'Karimova');
  await kit.giveRole(browser.account.id, { role: 'super_admin' });
  if (options.on !== false) {
    await database.migrator
      .updateTable('assistant_settings')
      .set({ school_on: true, roles_on: ['super_admin'] })
      .execute();
  }
  return {
    database,
    app,
    kit,
    people,
    model,
    clock,
    waits,
    north,
    south,
    northYear,
    southYear,
    admin: browser.cookie,
    adminAccount: browser.account.id,
    close: async () => {
      await app.close();
      await database.destroy();
    },
  };
}

/** Sends a question in a branch, as a session, and answers as soon as the route answered. */
export function send(
  scene: Pick<AssistantScene, 'app'>,
  cookie: string,
  branch: string,
  body: { text: string; role?: AssistantRole; conversationId?: string },
) {
  return request(scene.app.getHttpServer() as Parameters<typeof request>[0])
    .post('/api/assistant/questions')
    .set('Cookie', cookie)
    .set(BRANCH_HEADER, branch)
    .send({ role: 'super_admin', ...body });
}

/**
 * Asks a question in a branch, as a session, and waits for its answer (task 11.16): the route
 * answers 202 with the question; once the work of every question is done, the body's
 * conversation is read again, so a test reads the answer, the proposal or the notice there.
 */
export async function ask(
  scene: Pick<AssistantScene, 'app'>,
  cookie: string,
  branch: string,
  body: { text: string; role?: AssistantRole; conversationId?: string },
): Promise<Awaited<ReturnType<typeof send>>> {
  return settle(scene.app, await send(scene, cookie, branch, body), cookie, branch);
}

/**
 * Task 11.16: waits until no question is being answered in the app, then, for a question the
 * route took (202), puts the conversation read again into the body of its response.
 */
export async function settle<T extends { status: number; body: unknown }>(
  app: Pick<NestExpressApplication, 'get' | 'getHttpServer'>,
  response: T,
  cookie: string,
  branch: string,
): Promise<T> {
  await app.get(AssistantWork).whenIdle();
  if (response.status === 202) {
    const accepted = response.body as { conversation: { id: string } };
    const again = await request(app.getHttpServer())
      .get(`/api/assistant/conversations/${accepted.conversation.id}`)
      .set('Cookie', cookie)
      .set(BRANCH_HEADER, branch);
    if (again.status === 200) {
      response.body = { conversation: again.body as unknown };
    }
  }
  return response;
}

/** A GET of a branch, as a session. */
export function read(
  scene: Pick<AssistantScene, 'app'>,
  cookie: string,
  path: string,
  branch?: string,
) {
  const call = request(scene.app.getHttpServer()).get(path).set('Cookie', cookie);
  return branch === undefined ? call : call.set(BRANCH_HEADER, branch);
}

/**
 * Task 11.16: the code of the notice a settled question ended in (the last message of its
 * conversation), or `undefined`. A model's refusal is no longer the answer of the request.
 */
export function noticeOf(response: { body: unknown }): string | undefined {
  const messages = (
    response.body as { conversation?: { messages?: { kind: string; code?: string }[] } }
  ).conversation?.messages;
  const last = messages?.at(-1);
  return last?.kind === 'notice' ? last.code : undefined;
}
