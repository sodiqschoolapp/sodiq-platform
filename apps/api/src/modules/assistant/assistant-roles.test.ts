import { PERMISSIONS, type PermissionTable } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, assistantScene, type AssistantScene } from '../../testing/assistant-kit.js';
import { errorCode } from '../../testing/sign-in-kit.js';

// Task 11.12 (permission review of the code, should fix 2). `02`, Assistant: "in the role chosen
// in the role switcher"; the role counts only where the person holds it now, in the branch of the
// request. A test table gives the Teacher the panel, as 11.14 will, so that a role held in
// another branch can be asked for; the application's table gives it to the Super Admin alone.

const TABLE: PermissionTable = {
  ...PERMISSIONS,
  assistant: { ...PERMISSIONS.assistant, teacher: ['view'] },
};

describe('the role a question is asked in', () => {
  let scene: AssistantScene;

  beforeAll(async () => {
    scene = await assistantScene({ permissionTable: TABLE });
    // The Super Admin also teaches, in South only.
    await scene.kit.giveRole(scene.adminAccount, { role: 'teacher', branchId: scene.south });
  }, 120_000);

  afterAll(async () => {
    await scene.close();
  });

  it('refuses a role held only in another branch (403 assistant_role_not_held)', async () => {
    const response = await ask(scene, scene.admin, scene.north, {
      text: 'As the Teacher.',
      role: 'teacher',
    });
    expect([response.status, errorCode(response)]).toEqual([403, 'assistant_role_not_held']);
  });

  it('takes the role in the branch where it is held: the switch is what refuses it there', async () => {
    const response = await ask(scene, scene.admin, scene.south, {
      text: 'As the Teacher.',
      role: 'teacher',
    });
    expect([response.status, errorCode(response)]).toEqual([409, 'assistant_off']);
  });
});
