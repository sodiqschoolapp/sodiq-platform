import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  classTransferCancelSchema,
  classTransferChangeSchema,
  classTransferSchema,
  classTransferUndoSchema,
  groupTransferCancelSchema,
  groupTransferChangeSchema,
  groupTransferSchema,
  groupTransferUndoSchema,
  moveParamsSchema,
  studentDetailSchema,
  studentHistorySchema,
  studentParamsSchema,
  type ClassTransfer,
  type ClassTransferCancel,
  type ClassTransferChange,
  type ClassTransferUndo,
  type GroupTransfer,
  type GroupTransferCancel,
  type GroupTransferChange,
  type GroupTransferUndo,
  type MoveParams,
  type StudentDetail,
  type StudentHistory,
  type StudentParams,
} from '@sodiq/shared';
import { RequestId } from '../../http/request-id.js';
import { Returns, ValidBody, ValidParams } from '../../http/schemas.js';
import { Requires } from '../access/access.decorators.js';
import { CurrentAccess, type Access } from '../access/permission.guard.js';
import { StudentHistories } from './student-history.service.js';
import { StudentMoves } from './student-moves.service.js';

/**
 * Class transfers (docs/spec/04-people.md, Movements: "class transfers are
 * done by the Academic Vice Principal"; task 3.3a, pull request #95):
 * `classes` `edit`, the Super Admin and the Academic Vice Principal
 * (decision 3), for the branch of the request. Each answers the student as
 * the record route does.
 */
@Controller('classes/transfers')
export class ClassTransfersController {
  constructor(private readonly moves: StudentMoves) {}

  @Post()
  @HttpCode(200)
  @Requires('classes', 'edit')
  @Returns(studentDetailSchema)
  transfer(
    @CurrentAccess() access: Access,
    @ValidBody(classTransferSchema) input: ClassTransfer,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.transferClass(access, input, requestId);
  }

  @Post(':id/change')
  @HttpCode(200)
  @Requires('classes', 'edit')
  @Returns(studentDetailSchema)
  change(
    @CurrentAccess() access: Access,
    @ValidParams(moveParamsSchema) params: MoveParams,
    @ValidBody(classTransferChangeSchema) input: ClassTransferChange,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.changeClass(access, params.id, input, requestId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Requires('classes', 'edit')
  @Returns(studentDetailSchema)
  cancel(
    @CurrentAccess() access: Access,
    @ValidParams(moveParamsSchema) params: MoveParams,
    @ValidBody(classTransferCancelSchema) input: ClassTransferCancel,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.cancelClass(access, params.id, input, requestId);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @Requires('classes', 'edit')
  @Returns(studentDetailSchema)
  undo(
    @CurrentAccess() access: Access,
    @ValidParams(moveParamsSchema) params: MoveParams,
    @ValidBody(classTransferUndoSchema) input: ClassTransferUndo,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.undoClass(access, params.id, input, requestId);
  }
}

/**
 * Group transfers (`02`, Head Teacher: "Moves students between groups of
 * those subjects"; task 3.3a): `group_transfers` `edit`, the Super Admin, the
 * Academic Vice Principal and the Head Teachers, whose scope (own subjects)
 * the service checks on both groups of every request (decision 2).
 */
@Controller('groups/transfers')
export class GroupTransfersController {
  constructor(private readonly moves: StudentMoves) {}

  @Post()
  @HttpCode(200)
  @Requires('group_transfers', 'edit')
  @Returns(studentDetailSchema)
  transfer(
    @CurrentAccess() access: Access,
    @ValidBody(groupTransferSchema) input: GroupTransfer,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.transferGroup(access, input, requestId);
  }

  @Post(':id/change')
  @HttpCode(200)
  @Requires('group_transfers', 'edit')
  @Returns(studentDetailSchema)
  change(
    @CurrentAccess() access: Access,
    @ValidParams(moveParamsSchema) params: MoveParams,
    @ValidBody(groupTransferChangeSchema) input: GroupTransferChange,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.changeGroup(access, params.id, input, requestId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Requires('group_transfers', 'edit')
  @Returns(studentDetailSchema)
  cancel(
    @CurrentAccess() access: Access,
    @ValidParams(moveParamsSchema) params: MoveParams,
    @ValidBody(groupTransferCancelSchema) _input: GroupTransferCancel,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.cancelGroup(access, params.id, requestId);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @Requires('group_transfers', 'edit')
  @Returns(studentDetailSchema)
  undo(
    @CurrentAccess() access: Access,
    @ValidParams(moveParamsSchema) params: MoveParams,
    @ValidBody(groupTransferUndoSchema) input: GroupTransferUndo,
    @RequestId() requestId: string,
  ): Promise<StudentDetail> {
    return this.moves.undoGroup(access, params.id, input, requestId);
  }
}

/**
 * The History tab of a student (`04`, Profile tabs; Movements: "The profile
 * History tab shows each move with dates"; task 3.3a): `student_history`
 * `view`, the Tutor for own classes (decision 9 as changed by correction 3).
 */
@Controller('people')
export class StudentHistoryController {
  constructor(private readonly histories: StudentHistories) {}

  @Get('students/:id/history')
  @Requires('student_history', 'view')
  @Returns(studentHistorySchema)
  history(
    @CurrentAccess() access: Access,
    @ValidParams(studentParamsSchema) params: StudentParams,
  ): Promise<StudentHistory> {
    return this.histories.history(access, params.id);
  }
}
