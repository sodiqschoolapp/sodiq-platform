import type { NestExpressApplication } from '@nestjs/platform-express';
import { BRANCH_HEADER, type AssistantRole, type PermissionTable } from '@sodiq/shared';
import request from 'supertest';
import type { AssistantRouteLists } from '../modules/access/assistant-routes.js';
import { insertBranch } from './branch-filter-sql.js';
import { ClassesKit } from './classes-kit.js';
import { createTestApp } from './create-test-app.js';
import { FakeModel } from './assistant-model.js';
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

/** Asks a question in a branch, as a session. */
export function ask(
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
