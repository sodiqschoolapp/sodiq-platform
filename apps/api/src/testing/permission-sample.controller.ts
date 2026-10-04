import { All, Controller, Get, Post } from '@nestjs/common';
import {
  ROLES,
  type Action,
  type PermissionRows,
  type PermissionTable,
  type Role,
} from '@sodiq/shared';
import { z } from 'zod';
import { Returns } from '../http/schemas.js';
import { AnySignedIn, requiresInTable } from '../modules/access/access.decorators.js';
import { CurrentAccess, type Access } from '../modules/access/permission.guard.js';
import { AllowedBeforeSecondStep, CurrentSession, Public } from '../modules/auth/session.guard.js';
import type { ActiveSession } from '../modules/auth/sessions.service.js';

/** A row for each of the 15 roles: nothing, unless named. */
export function permissionRows(named: Partial<Record<Role, readonly Action[]>>): PermissionRows {
  return Object.fromEntries(ROLES.map((role) => [role, named[role] ?? []])) as PermissionRows;
}

/**
 * A table for tests, with the two kinds of area: `sample` belongs to a branch,
 * `school` is school-wide work. It keeps the fixed rules of `checkTable`.
 */
export const SAMPLE_PERMISSIONS: PermissionTable = {
  sample: permissionRows({
    super_admin: ['view', 'create', 'edit', 'archive', 'export'],
    principal: ['view', 'export'],
    academic_vice_principal: ['view', 'create', 'edit', 'archive', 'export'],
    spiritual_vice_principal: ['view'],
    head_tutor: ['view'],
    tutor: ['view'],
    senior_head_teacher: ['view', 'create', 'edit'],
    head_teacher: ['view', 'create', 'edit'],
    teacher: ['view'],
  }),
  school: permissionRows({
    super_admin: ['view', 'create'],
    senior_head_teacher: ['view'],
    head_teacher: ['view'],
  }),
};

export const accessAnswerSchema = z.object({
  accountId: z.uuid(),
  assignmentId: z.uuid(),
  role: z.string(),
  branchId: z.uuid().nullable(),
  branchIds: z.array(z.uuid()),
});

export const ownAnswerSchema = z.object({ login: z.string() });

export const openAnswerSchema = z.object({ ok: z.boolean() });

type AccessAnswer = z.infer<typeof accessAnswerSchema>;

const answerOf = (access: Access): AccessAnswer => ({
  ...access,
  branchIds: [...access.branchIds],
});

/**
 * Exists only in tests (docs/build-plan.md, task 0.7b: "sample routes pass for
 * all 15 roles"). One route of each kind of access, for an application made
 * with `createTestApp({ controllers, permissionTable: SAMPLE_PERMISSIONS })`.
 */
@Controller('permission-sample')
export class PermissionSampleController {
  @Get('view')
  @requiresInTable('sample', 'view')
  @Returns(accessAnswerSchema)
  view(@CurrentAccess() access: Access): AccessAnswer {
    return answerOf(access);
  }

  @Post('edit')
  @requiresInTable('sample', 'edit')
  @Returns(accessAnswerSchema, 201)
  edit(@CurrentAccess() access: Access): AccessAnswer {
    return answerOf(access);
  }

  @Get('school')
  @requiresInTable('school', 'view', { branch: 'none' })
  @Returns(accessAnswerSchema)
  school(@CurrentAccess() access: Access): AccessAnswer {
    return answerOf(access);
  }

  @Post('school')
  @requiresInTable('school', 'create', { branch: 'none' })
  @Returns(accessAnswerSchema, 201)
  createInSchool(@CurrentAccess() access: Access): AccessAnswer {
    return answerOf(access);
  }

  @Get('own')
  @AnySignedIn()
  @Returns(ownAnswerSchema)
  own(@CurrentSession() session: ActiveSession): { login: string } {
    return { login: session.login };
  }

  @Get('open')
  @Public()
  @Returns(openAnswerSchema)
  open(): { ok: boolean } {
    return { ok: true };
  }
}

/** A route for every method: the harness names it, because it cannot call or list it as one route. */
@Controller('permission-every-method')
export class EveryMethodController {
  @All()
  @AnySignedIn()
  @Returns(openAnswerSchema)
  every(): { ok: boolean } {
    return { ok: true };
  }
}

/** What the harness and the guard must never let through: routes that do not say who may call them. */
@Controller('permission-faults')
export class FaultyAccessController {
  /** No declaration at all. */
  @Get('undeclared')
  @Returns(openAnswerSchema)
  undeclared(): { ok: boolean } {
    return { ok: true };
  }

  /** Two declarations that contradict each other. */
  @Get('twice')
  @Public()
  @AnySignedIn()
  @Returns(openAnswerSchema)
  twice(): { ok: boolean } {
    return { ok: true };
  }

  /** A permission, and open to a session that has not passed the second step. */
  @Get('early')
  @requiresInTable('sample', 'view')
  @AllowedBeforeSecondStep()
  @Returns(openAnswerSchema)
  early(): { ok: boolean } {
    return { ok: true };
  }

  /** Declared, but it does not say what it answers. */
  @Get('no-answer-schema')
  @AnySignedIn()
  noAnswerSchema(): { ok: boolean } {
    return { ok: true };
  }
}
