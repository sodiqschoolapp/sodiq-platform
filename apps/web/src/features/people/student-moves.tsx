import {
  classDisplayName,
  classTransferChangeSchema,
  classTransferSchema,
  classTransferUndoSchema,
  groupTransferChangeSchema,
  groupTransferSchema,
  groupTransferUndoSchema,
  nextDay,
  previousDay,
  type ClassTransfer,
  type ClassTransferChange,
  type GroupTransfer,
  type GroupTransferChange,
  type MoveClass,
  type MoveGroup,
  type StudentDetail,
  type StudentHistoryLine,
  type StudentMove,
} from '@sodiq/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { DateField, Field, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { useClassFullText } from '@/features/classes/class-members';
import { classesQuery } from '@/features/classes/classes-api';
import { groupsQuery } from '@/features/classes/groups-api';
import { schoolDateText } from '@/lib/dates';
import { asFormSchema } from './form-schema';
import { useJournalEntries } from './journal-entries';
import { branchMoveLineText } from './branch-move';
import { mergedLineText } from './student-merge';
import { studentHistoryQuery } from './people-api';
import { statusCauseText } from './status-cause';

/**
 * Class and group transfers in the student's side panel (docs/spec/04-people.md,
 * Movements; edge/students-classes-groups; task 3.3a, pull request #95): the
 * forms of a move, its change, cancel and undo, the scheduled moves in the
 * Academic block, and the History tab. The server decides who may do what;
 * the panel draws what the record says (`canMoveClass`, `groupMoveSubjects`).
 */

/** The keys of the move forms of the side panel; a change and an undo name their move. */
export const isMoveForm = (key: string | null): boolean =>
  key === 'moveClass' ||
  key === 'moveGroup' ||
  (key !== null && (key.startsWith('change:') || key.startsWith('undo:')));

/** The name of where a move goes: its class or group. */
export const targetOf = (move: StudentMove): string =>
  move.toClass === null
    ? (move.toGroup?.name ?? '')
    : classDisplayName(move.toClass.grade, move.toClass.name);

/** Whether this reader changes, cancels or undoes the move (the server's rule, as the record says it). */
export const movesIt = (student: StudentDetail, move: StudentMove): boolean =>
  move.kind === 'class'
    ? student.canMoveClass
    : move.subjectId !== null && student.groupMoveSubjects.includes(move.subjectId);

interface MoveFormProps {
  student: StudentDetail;
  onChanged: (answer: unknown) => Promise<void>;
  onStale: () => Promise<void>;
  onCancel: () => void;
}

/** Sends a move; on "student changed" the student is read again before the refusal shows. */
async function sending<T>(send: () => Promise<T>, onStale: () => Promise<void>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'student_changed') {
      await onStale();
    }
    throw error;
  }
}

/**
 * "Asks for confirmation" when the two classes differ in language (`05`,
 * Language of instruction): the server answers `class_language_differs`, the
 * person confirms, the move is sent again with the confirmation.
 */
function useLanguageConfirm(label: string) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return async <T,>(
    send: (confirmLanguage: boolean) => Promise<T>,
    /** The question naming both classes and their languages (issue #105, H5), when both are known. */
    named?: string,
  ): Promise<T> => {
    try {
      return await send(false);
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.code !== 'class_language_differs') {
        throw error;
      }
      const go = await confirm({
        title: t('people.students.moves.languageTitle'),
        text: named ?? t('people.students.moves.languageText'),
        names: [label],
        action: t('people.students.moves.languageAction'),
        destructive: false,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      return send(true);
    }
  };
}

type ClassMoveField = 'toClassId' | 'from';

const CLASS_MOVE_SCHEMA = asFormSchema<ClassTransfer>(classTransferSchema, (path) => [...path]);
const CLASS_CHANGE_SCHEMA = asFormSchema<ClassTransferChange>(classTransferChangeSchema, (path) => [
  ...path,
]);

/**
 * A class transfer, or the change of a scheduled one (`move`): the new class,
 * of the student's grade in an open year, and the first day there, tomorrow
 * by default (edge: "The effective date is the first day in the new class,
 * tomorrow by default").
 */
export function ClassMoveForm({
  student,
  label,
  move,
  onChanged,
  onStale,
  onCancel,
}: MoveFormProps & { label: string; move: StudentMove | null }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const classes = useQuery({ ...classesQuery(branchId), enabled: branchId !== null });
  const withLanguage = useLanguageConfirm(label);
  // Task 8.6: the entries of the journals left on or after the date.
  const { withEntries, dialog } = useJournalEntries({ movesDate: true });
  const options = (classes.data?.classes ?? [])
    .filter(
      (one) =>
        !one.archived &&
        one.yearStatus !== 'closed' &&
        one.grade === student.grade &&
        one.id !== student.class?.id,
    )
    .map((one) => ({ value: one.id, label: classDisplayName(one.grade, one.name) }));
  const form = useRecordForm<ClassMoveField, ClassTransfer | ClassTransferChange>({
    schema: move === null ? CLASS_MOVE_SCHEMA : CLASS_CHANGE_SCHEMA,
    initial: {
      toClassId: move?.toClass?.id ?? '',
      from: move?.from ?? nextDay(student.today),
    },
    read: (typed) =>
      move === null
        ? {
            studentId: student.id,
            version: student.version,
            toClassId: typed.toClassId,
            from: typed.from,
          }
        : { version: student.version, toClassId: typed.toClassId, from: typed.from },
    save: async (input) => {
      const to = classes.data?.classes.find((one) => one.id === input.toClassId);
      const from = student.class;
      const named =
        to === undefined || from === null
          ? undefined
          : t('people.students.moves.languageTextNamed', {
              from: classDisplayName(from.grade, from.name),
              fromLanguage: t(`classes.inLanguage.${from.language}`),
              to: classDisplayName(to.grade, to.name),
              toLanguage: t(`classes.inLanguage.${to.language}`),
            });
      const answer = await sending(
        () =>
          withEntries((journalEntries) =>
            withLanguage(
              (confirmLanguage) =>
                move === null
                  ? answerOf(
                      api.POST('/api/classes/transfers', {
                        params: { header: branchHeader() },
                        body: {
                          ...(input as ClassTransfer),
                          ...(confirmLanguage ? { confirmLanguage } : {}),
                          ...(journalEntries === undefined ? {} : { journalEntries }),
                        },
                      }),
                    )
                  : answerOf(
                      api.POST('/api/classes/transfers/{id}/change', {
                        params: { header: branchHeader(), path: { id: move.id } },
                        body: {
                          ...input,
                          ...(confirmLanguage ? { confirmLanguage } : {}),
                          ...(journalEntries === undefined ? {} : { journalEntries }),
                        },
                      }),
                    ),
              named,
            ),
          ),
        onStale,
      );
      await onChanged(answer);
    },
  });
  const title =
    move === null ? t('people.students.moves.moveClass') : t('people.students.moves.changeTitle');
  // H24: a full class named with its first day without a seat.
  const classFullText = useClassFullText(form.failure);
  return (
    <section className="grid gap-3">
      {dialog}
      <h3 className={SECTION_TITLE}>{title}</h3>
      {classes.isError ? (
        <ErrorState
          error={classes.error}
          onRetry={() => {
            void classes.refetch();
          }}
        />
      ) : classes.data === undefined ? (
        <LoadingOutline />
      ) : (
        <RecordForm form={form} failureText={classFullText} label={title} onCancel={onCancel}>
          <SelectField
            label={t('people.students.moves.toClass')}
            options={[{ value: '', label: t('people.students.choose') }, ...options]}
            {...form.bind('toClassId')}
          />
          <DateField label={t('people.students.moves.from')} {...form.bind('from')} />
        </RecordForm>
      )}
    </section>
  );
}

type GroupMoveField = 'memberId' | 'toGroupId' | 'from';

const GROUP_MOVE_SCHEMA = asFormSchema<GroupTransfer>(groupTransferSchema, (path) => [...path]);
const GROUP_CHANGE_SCHEMA = asFormSchema<GroupTransferChange>(groupTransferChangeSchema, (path) => [
  ...path,
]);

/**
 * A group transfer (`02`, Head Teacher: "Moves students between groups of
 * those subjects"), or the change of a scheduled one: the group the student
 * leaves (of a subject this reader moves), the new group of the same subject
 * that draws from the student's class, and the first day there.
 */
export function GroupMoveForm({
  student,
  move,
  onChanged,
  onStale,
  onCancel,
}: MoveFormProps & { move: StudentMove | null }) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const groups = useQuery({ ...groupsQuery(branchId), enabled: branchId !== null });
  const own = student.groups.filter((one) => student.groupMoveSubjects.includes(one.subjectId));
  const { withEntries, dialog } = useJournalEntries({ movesDate: true });
  const form = useRecordForm<GroupMoveField, GroupTransfer | GroupTransferChange>({
    schema: move === null ? GROUP_MOVE_SCHEMA : GROUP_CHANGE_SCHEMA,
    initial: {
      memberId: move === null ? (own[0]?.membershipId ?? '') : '',
      toGroupId: move?.toGroup?.id ?? '',
      from: move?.from ?? nextDay(student.today),
    },
    read: (typed) =>
      move === null
        ? {
            studentId: student.id,
            memberId: typed.memberId,
            toGroupId: typed.toGroupId,
            from: typed.from,
          }
        : { toGroupId: typed.toGroupId, from: typed.from },
    save: async (input) => {
      const answer = await sending(
        () =>
          withEntries((journalEntries) => {
            const extra = journalEntries === undefined ? {} : { journalEntries };
            return move === null
              ? answerOf(
                  api.POST('/api/groups/transfers', {
                    params: { header: branchHeader() },
                    body: { ...(input as GroupTransfer), ...extra },
                  }),
                )
              : answerOf(
                  api.POST('/api/groups/transfers/{id}/change', {
                    params: { header: branchHeader(), path: { id: move.id } },
                    body: { ...input, ...extra },
                  }),
                );
          }),
        onStale,
      );
      await onChanged(answer);
    },
  });
  const chosen = own.find((one) => one.membershipId === form.bind('memberId').value);
  const subjectId = move?.subjectId ?? chosen?.subjectId ?? null;
  const leaving = move?.fromGroup?.id ?? chosen?.id ?? null;
  const classId = student.class?.id ?? student.plannedClass?.id ?? null;
  const options = (groups.data?.groups ?? [])
    .filter(
      (one) =>
        !one.archived &&
        one.subject.id === subjectId &&
        one.id !== leaving &&
        one.classes.some((held) => held.id === classId),
    )
    .map((one) => ({ value: one.id, label: one.name }));
  const title =
    move === null ? t('people.students.moves.moveGroup') : t('people.students.moves.changeTitle');
  return (
    <section className="grid gap-3">
      {dialog}
      <h3 className={SECTION_TITLE}>{title}</h3>
      {groups.isError ? (
        <ErrorState
          error={groups.error}
          onRetry={() => {
            void groups.refetch();
          }}
        />
      ) : groups.data === undefined ? (
        <LoadingOutline />
      ) : (
        <RecordForm form={form} label={title} onCancel={onCancel}>
          {move === null && (
            <SelectField
              label={t('people.students.moves.groupRow')}
              options={own.map((one) => ({ value: one.membershipId, label: one.name }))}
              {...form.bind('memberId')}
            />
          )}
          <SelectField
            label={t('people.students.moves.toGroup')}
            options={[{ value: '', label: t('people.students.choose') }, ...options]}
            {...form.bind('toGroupId')}
            note={options.length === 0 ? t('people.students.moves.noGroups') : undefined}
          />
          <DateField label={t('people.students.moves.from')} {...form.bind('from')} />
        </RecordForm>
      )}
    </section>
  );
}

const CLASS_UNDO_SCHEMA = asFormSchema(classTransferUndoSchema, (path) => [...path]);
const GROUP_UNDO_SCHEMA = asFormSchema(groupTransferUndoSchema, (path) => [...path]);

/** The undo of a move that has begun, with a reason (edge: "A transfer was a mistake"). */
export function UndoMoveForm({
  student,
  move,
  onChanged,
  onStale,
  onCancel,
}: MoveFormProps & { move: StudentMove }) {
  const { t } = useTranslation();
  const form = useRecordForm<'reason', { reason: string; version?: number }>({
    schema: move.kind === 'class' ? CLASS_UNDO_SCHEMA : GROUP_UNDO_SCHEMA,
    initial: { reason: '' },
    read: (typed) =>
      move.kind === 'class' ? { reason: typed.reason, version: student.version } : typed,
    save: async (input) => {
      const answer = await sending(
        () =>
          move.kind === 'class'
            ? answerOf(
                api.POST('/api/classes/transfers/{id}/undo', {
                  params: { header: branchHeader(), path: { id: move.id } },
                  body: { reason: input.reason, version: student.version },
                }),
              )
            : answerOf(
                api.POST('/api/groups/transfers/{id}/undo', {
                  params: { header: branchHeader(), path: { id: move.id } },
                  body: { reason: input.reason },
                }),
              ),
        onStale,
      );
      await onChanged(answer);
    },
  });
  const title = t('people.students.moves.undoTitle', { target: targetOf(move) });
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      <RecordForm form={form} label={title} onCancel={onCancel}>
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}

/**
 * The cancel of a scheduled move ("It can be changed or cancelled until the
 * date"), after a confirmation naming the student; `null` when the person
 * keeps the move.
 */
export function useCancelMove(
  student: StudentDetail | undefined,
  label: string,
  onChanged: (answer: unknown) => Promise<void>,
  onStale: () => Promise<void>,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return useMutation({
    mutationFn: async (move: StudentMove) => {
      if (student === undefined) {
        return null;
      }
      const go = await confirm({
        title: t('people.students.moves.cancelTitle'),
        text: t('people.students.moves.cancelText'),
        names: [label],
        action: t('people.students.moves.cancel', { target: targetOf(move) }),
        cancel: t('people.students.moves.keep'),
        destructive: false,
      });
      if (!go) {
        return null;
      }
      return move.kind === 'class'
        ? answerOf(
            api.POST('/api/classes/transfers/{id}/cancel', {
              params: { header: branchHeader(), path: { id: move.id } },
              body: { version: student.version },
            }),
          )
        : answerOf(
            api.POST('/api/groups/transfers/{id}/cancel', {
              params: { header: branchHeader(), path: { id: move.id } },
              body: {},
            }),
          );
    },
    onSuccess: async (answer) => {
      if (answer !== null) {
        await onChanged(answer);
      }
    },
    onError: async (error) => {
      if (error instanceof ApiFailure && error.code === 'student_changed') {
        await onStale();
      }
    },
  });
}

/**
 * The Academic block's lines of the moves (edge: "the student shows the
 * current class with a badge"; `04`, Student record, Academic: "transfer
 * history"): each scheduled move with its date, and the latest class move
 * begun, which the History tab lists in full.
 */
export function moveRows(
  t: TFunction,
  language: string,
  student: StudentDetail,
): [string, string][] {
  const rows: [string, string][] = student.scheduledMoves.map((move) => [
    move.kind === 'class' ? t('people.students.class') : t('people.students.groups'),
    t('people.students.moves.scheduled', {
      target: targetOf(move),
      date: schoolDateText(move.from, language),
    }),
  ]);
  const last = student.lastClassMove;
  if (last?.fromClass !== null && last?.fromClass !== undefined) {
    rows.push([
      t('people.students.moves.transfers'),
      t('people.students.moves.lastMove', {
        class: classDisplayName(last.fromClass.grade, last.fromClass.name),
        date: schoolDateText(last.from, language),
      }),
    ]);
  }
  return rows;
}

/**
 * The text of a move line (task 3.5c, H34): "moved" only of a move that
 * happened; a scheduled one "moves", a cancelled one "was planned".
 */
function moveText(t: TFunction, move: StudentMove): string {
  const shape =
    move.state === 'scheduled' ? 'Planned' : move.state === 'cancelled' ? 'Cancelled' : '';
  const names =
    move.kind === 'class'
      ? {
          from:
            move.fromClass === null
              ? ''
              : classDisplayName(move.fromClass.grade, move.fromClass.name),
          to: targetOf(move),
        }
      : { from: move.fromGroup?.name ?? '', to: targetOf(move) };
  const text =
    move.kind === 'class'
      ? t(`people.students.moves.classMove${shape}` as 'people.students.moves.classMove', names)
      : t(`people.students.moves.groupMove${shape}` as 'people.students.moves.groupMove', names);
  const state = move.cancelledByLeaving
    ? t('people.students.moves.states.cancelledByLeaving')
    : t(`people.students.moves.states.${move.state}`);
  return `${text} · ${state}`;
}

/** The target of a move or of an earlier version of it, as the History lines name it. */
function changeTarget(target: { toClass: MoveClass | null; toGroup: MoveGroup | null }): string {
  return target.toClass !== null
    ? classDisplayName(target.toClass.grade, target.toClass.name)
    : (target.toGroup?.name ?? '');
}

/**
 * The changes of a scheduled move under its line (task 3.5c, H34: "one move
 * with its changes"): each change of the date and of the target, from the
 * first version of the move to the one in force.
 */
function changeTexts(
  t: TFunction,
  line: Extract<StudentHistoryLine, { kind: 'move' }>,
  language: string,
): string[] {
  const versions = [
    ...line.changes,
    { from: line.move.from, toClass: line.move.toClass, toGroup: line.move.toGroup },
  ];
  const texts: string[] = [];
  versions.slice(1).forEach((version, index) => {
    const before = versions[index];
    if (before === undefined) {
      return;
    }
    if (before.from !== version.from) {
      texts.push(
        t('people.students.moves.dateChanged', {
          from: schoolDateText(before.from, language),
          to: schoolDateText(version.from, language),
        }),
      );
    }
    if (changeTarget(before) !== changeTarget(version)) {
      texts.push(
        t(
          line.move.kind === 'class'
            ? 'people.students.moves.classChanged'
            : 'people.students.moves.groupChanged',
          { from: changeTarget(before), to: changeTarget(version) },
        ),
      );
    }
  });
  return texts;
}

/**
 * The text of a stay in a class or a group (task 3.5c, H35: "one line per
 * stay in a class, from its first to its last day (or 'hozirgacha')"): its
 * last day, "until now" while it is in force, "from <date>" while it is ahead.
 */
function stayText(
  t: TFunction,
  line: Extract<StudentHistoryLine, { kind: 'class' } | { kind: 'group' }>,
  today: string,
  language: string,
): string {
  const named =
    line.kind === 'class'
      ? { class: classDisplayName(line.class.grade, line.class.name) }
      : { group: line.group.name };
  const kind = line.kind === 'class' ? 'class' : 'group';
  if (line.from > today) {
    return t(`people.students.moves.${kind}StayFrom`, {
      ...named,
      from: schoolDateText(line.from, language),
    });
  }
  if (line.until === null) {
    return t(`people.students.moves.${kind}StayNow`, named);
  }
  return t(`people.students.moves.${kind}Stay`, {
    ...named,
    until: schoolDateText(previousDay(line.until), language),
  });
}

/** The text of one line of the History tab. */
function lineText(t: TFunction, line: StudentHistoryLine, today: string, language: string): string {
  switch (line.kind) {
    case 'move':
      return moveText(t, line.move);
    case 'class':
    case 'group':
      return stayText(t, line, today, language);
    case 'branch_move':
      return branchMoveLineText(t, line);
    case 'merged':
      return mergedLineText(t, line);
    case 'status':
      return `${t(`people.students.statuses.${line.status}`)} · ${statusCauseText(t, line, today, language)}`;
  }
}

/**
 * The History tab (`04`, Profile tabs; Movements: "The profile History tab
 * shows each move with dates"), newest first, each line with its date; a move
 * this reader may undo has its button.
 */
export function HistoryTab({
  student,
  onUndo,
}: {
  student: StudentDetail;
  onUndo: (move: StudentMove) => void;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const history = useQuery(studentHistoryQuery(branchId, student.id));
  if (history.isError) {
    return (
      <ErrorState
        error={history.error}
        onRetry={() => {
          void history.refetch();
        }}
      />
    );
  }
  if (history.data === undefined) {
    return <LoadingOutline />;
  }
  return (
    <section
      className="grid gap-3"
      aria-label={t('people.students.moves.historyLabel')}
      // H28: an action started here comes back to the tab with the focus here.
      tabIndex={-1}
      data-opens="history"
    >
      <ol className="grid gap-3 text-sm">
        {history.data.lines.map((line, index) => {
          const from =
            line.kind === 'move' || line.kind === 'branch_move'
              ? line.move.from
              : line.kind === 'merged'
                ? line.on
                : line.from;
          const move = line.kind === 'move' ? line.move : null;
          return (
            <li key={`${line.kind}-${from}-${String(index)}`} className="grid gap-1">
              <span className="text-muted-foreground">{schoolDateText(from, i18n.language)}</span>
              <span>{lineText(t, line, history.data.today, i18n.language)}</span>
              {line.kind === 'move' &&
                changeTexts(t, line, i18n.language).map((text) => (
                  <span key={text} className="text-muted-foreground">
                    {text}
                  </span>
                ))}
              {move !== null && move.undoable && movesIt(student, move) && (
                <span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onUndo(move);
                    }}
                  >
                    {t('people.students.moves.undo')}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Every move of the student this reader may still undo, by id: the History tab's buttons open their forms. */
export function useMovesForUndo(
  student: StudentDetail | undefined,
): ReadonlyMap<string, StudentMove> {
  const { branchId } = useView();
  const history = useQuery({
    ...studentHistoryQuery(branchId, student?.id ?? ''),
    enabled: branchId !== null && student !== undefined && student.readsHistory,
  });
  return new Map(
    (history.data?.lines ?? [])
      .flatMap((line) => (line.kind === 'move' ? [line.move] : []))
      .map((move) => [move.id, move]),
  );
}
