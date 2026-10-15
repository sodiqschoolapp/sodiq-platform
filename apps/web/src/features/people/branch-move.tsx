import {
  branchMoveAcceptSchema,
  branchMoveDeclineSchema,
  branchMoveGroupsSchema,
  branchMoveReleaseSchema,
  branchMoveTargetsSchema,
  classDisplayName,
  incomingBranchMovesSchema,
  listName,
  nextDay,
  type BranchMoveAccept,
  type BranchMoveDecline,
  type BranchMoveLine,
  type BranchMoveRelease,
  type IncomingBranchMove,
  type StudentBranchMove,
  type StudentDetail,
} from '@sodiq/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
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
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useMayView, useView } from '@/features/access/use-view';
import { classesQuery } from '@/features/classes/classes-api';
import { nameOf } from '@/features/setup/setup-api';
import { subjectsQuery } from '@/features/setup/subjects-api';
import { schoolDateText } from '@/lib/dates';
import { asFormSchema } from './form-schema';
import { invalidateStudents, studentsKey } from './people-api';

/**
 * The move of a student to another branch (edge/students-classes-groups, "A
 * student moves to another branch"; task 3.3c, pull request #97): the release
 * and its cancel in the student's side panel of the sending branch, the
 * incoming list of the receiving branch on the Students page with its accept
 * (class and groups) and decline, the lines of the Academic block and of the
 * History tab. The server decides who may do what; the page draws what its
 * answers say (`canMoveBranch`, `canDecide`).
 */

/** The other branches a student may be released to. */
const targetsQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'branch-move-targets'],
    queryFn: async () =>
      branchMoveTargetsSchema.parse(
        await answerOf(
          api.GET('/api/people/branch-moves/targets', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The releases to the branch of the switcher (decision 2). */
export const incomingQuery = (branchId: string | null) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'incoming'],
    queryFn: async () =>
      incomingBranchMovesSchema.parse(
        await answerOf(
          api.GET('/api/people/branch-moves/incoming', { params: { header: branchHeader() } }),
        ),
      ),
    enabled: branchId !== null,
  });

/** The groups offered to the accept of a release for one class. */
const groupsQuery = (branchId: string | null, moveId: string, classId: string) =>
  queryOptions({
    queryKey: [...studentsKey(branchId), 'incoming', moveId, 'groups', classId],
    queryFn: async () =>
      branchMoveGroupsSchema.parse(
        await answerOf(
          api.GET('/api/people/branch-moves/{id}/groups', {
            params: { header: branchHeader(), path: { id: moveId }, query: { classId } },
          }),
        ),
      ),
    enabled: branchId !== null && classId !== '',
  });

/** Whether the panel's form key is the release form. */
export const isBranchMoveForm = (key: string | null): boolean => key === 'moveBranch';

/** The Academic block's lines: the open release (the badge) and the move into this branch. */
export function branchMoveRows(
  t: TFunction,
  language: string,
  student: StudentDetail,
): [string, string][] {
  const rows: [string, string][] = [];
  if (student.branchMove !== null) {
    rows.push([
      t('people.students.branchMoves.branch'),
      t('people.students.branchMoves.released', {
        branch: student.branchMove.toBranch.name,
        date: schoolDateText(student.branchMove.from, language),
      }),
    ]);
  }
  if (student.lastBranchMove !== null) {
    rows.push([
      t('people.students.branchMoves.branch'),
      t('people.students.branchMoves.arrived', {
        branch: student.lastBranchMove.fromBranch.name,
        date: schoolDateText(student.lastBranchMove.from, language),
      }),
    ]);
  }
  return rows;
}

/** The text of a History line of a release. */
export function branchMoveLineText(t: TFunction, line: BranchMoveLine): string {
  const { move } = line;
  const text =
    line.toClass === null
      ? t('people.students.branchMoves.line', {
          from: move.fromBranch.name,
          to: move.toBranch.name,
        })
      : t('people.students.branchMoves.lineClass', {
          from: move.fromBranch.name,
          to: move.toBranch.name,
          class: classDisplayName(line.toClass.grade, line.toClass.name),
        });
  const state = move.cancelledByLeaving
    ? t('people.students.branchMoves.states.cancelledByLeaving')
    : t(`people.students.branchMoves.states.${move.state}`);
  return `${text} · ${state}`;
}

const RELEASE_SCHEMA = asFormSchema<BranchMoveRelease>(branchMoveReleaseSchema, (path) => [
  ...path,
]);

/**
 * The release of the student to another branch from a date, tomorrow by
 * default (the class transfer's rule, decision 9). The receiving branch
 * accepts from that date on.
 */
export function ReleaseForm({
  student,
  onChanged,
  onStale,
  onCancel,
}: {
  student: StudentDetail;
  onChanged: (answer: unknown) => Promise<void>;
  onStale: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const targets = useQuery(targetsQuery(branchId));
  const form = useRecordForm<'toBranchId' | 'from', BranchMoveRelease>({
    schema: RELEASE_SCHEMA,
    initial: { toBranchId: '', from: nextDay(student.today) },
    read: (typed) => ({ ...typed, version: student.version }),
    save: async (input) => {
      try {
        const answer = await answerOf(
          api.POST('/api/people/students/{id}/branch-move', {
            params: { header: branchHeader(), path: { id: student.id } },
            body: input,
          }),
        );
        await onChanged(answer);
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'student_changed') {
          await onStale();
        }
        throw error;
      }
    },
  });
  const title = t('people.students.branchMoves.move');
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      {targets.isError ? (
        <ErrorState
          error={targets.error}
          onRetry={() => {
            void targets.refetch();
          }}
        />
      ) : targets.data === undefined ? (
        <LoadingOutline />
      ) : (
        <RecordForm form={form} label={title} onCancel={onCancel}>
          <SelectField
            label={t('people.students.branchMoves.toBranch')}
            options={[
              { value: '', label: t('people.students.choose') },
              ...targets.data.branches.map((one) => ({ value: one.id, label: one.name })),
            ]}
            {...form.bind('toBranchId')}
          />
          <DateField label={t('people.students.branchMoves.from')} {...form.bind('from')} />
        </RecordForm>
      )}
    </section>
  );
}

/** The cancel of the open release, after a confirmation naming the student; `null` when kept. */
export function useCancelRelease(
  student: StudentDetail | undefined,
  label: string,
  onChanged: (answer: unknown) => Promise<void>,
) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  return useMutation({
    mutationFn: async (move: StudentBranchMove) => {
      if (student === undefined) {
        return null;
      }
      const go = await confirm({
        title: t('people.students.branchMoves.cancelTitle'),
        text: t('people.students.branchMoves.cancelText'),
        names: [label],
        action: t('people.students.branchMoves.cancel'),
        cancel: t('people.students.branchMoves.keep'),
        destructive: false,
      });
      if (!go) {
        return null;
      }
      return answerOf(
        api.POST('/api/people/branch-moves/{id}/cancel', {
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
  });
}

const ACCEPT_SCHEMA = asFormSchema<BranchMoveAccept>(branchMoveAcceptSchema, (path) => [...path]);

const groupField = (subjectId: string) => `group:${subjectId}`;

/**
 * The accept of one release (edge: "the receiving one accepts, choosing class
 * and groups"): the class, of the student's grade in an open year; then for
 * each split or group subject of it a group, "Place automatically" first
 * (the smallest suitable group, tagged for review; decision 13). A class in
 * another language than the class left asks a confirmation (decision 15).
 */
function AcceptForm({
  move,
  onDone,
  onCancel,
}: {
  move: IncomingBranchMove;
  onDone: (className: string) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const classes = useQuery(classesQuery(branchId));
  const subjects = useQuery(subjectsQuery(branchId));
  const [chosen, setClassId] = useState('');
  const options = (classes.data?.classes ?? [])
    .filter((one) => !one.archived && one.yearStatus !== 'closed' && one.grade === move.grade)
    .map((one) => ({ value: one.id, label: classDisplayName(one.grade, one.name) }));
  // A class no longer offered (archived meanwhile) falls back to none.
  const classId = options.some((one) => one.value === chosen) ? chosen : '';
  const groups = useQuery(groupsQuery(branchId, move.id, classId));
  // A subject of the groups that the list does not hold (added meanwhile):
  // the list is read again, and its field says "Group of a subject" until then.
  const missing =
    subjects.data !== undefined &&
    (groups.data?.subjects ?? []).some(
      (one) => !subjects.data.subjects.some((subject) => subject.id === one.subjectId),
    );
  const { refetch } = subjects;
  useEffect(() => {
    if (missing) {
      void refetch();
    }
  }, [missing, refetch]);
  const failed = classes.isError ? classes : subjects.isError ? subjects : null;
  if (failed !== null) {
    return (
      <ErrorState
        error={failed.error}
        onRetry={() => {
          void failed.refetch();
        }}
      />
    );
  }
  if (classes.data === undefined || subjects.data === undefined) {
    return <LoadingOutline />;
  }
  // A subject the list does not hold (added meanwhile): a general label,
  // and the list read again; never a blank label.
  const subjectName = (id: string) => {
    const found = subjects.data.subjects.find((one) => one.id === id);
    if (found === undefined) {
      return t('people.students.branchMoves.subjectUnknown');
    }
    return nameOf(found.names, i18n.language);
  };
  return (
    <div className="grid gap-3">
      <SelectField
        label={t('people.students.branchMoves.class')}
        options={[{ value: '', label: t('people.students.choose') }, ...options]}
        value={classId}
        onChange={(event) => {
          setClassId(event.target.value);
        }}
        note={options.length === 0 ? t('people.students.branchMoves.noClass') : undefined}
      />
      {classId === '' ? null : groups.isError ? (
        <ErrorState
          error={groups.error}
          onRetry={() => {
            void groups.refetch();
          }}
        />
      ) : groups.data === undefined ? (
        <LoadingOutline />
      ) : (
        <AcceptGroupsForm
          key={classId}
          move={move}
          classId={classId}
          className={options.find((one) => one.value === classId)?.label ?? ''}
          freeSeats={groups.data.freeSeats}
          subjects={groups.data.subjects.map((one) => ({
            subjectId: one.subjectId,
            name: subjectName(one.subjectId),
            groups: one.groups,
          }))}
          onDone={onDone}
          onCancel={onCancel}
        />
      )}
    </div>
  );
}

function AcceptGroupsForm({
  move,
  classId,
  className,
  freeSeats,
  subjects,
  onDone,
  onCancel,
}: {
  move: IncomingBranchMove;
  classId: string;
  className: string;
  freeSeats: number;
  subjects: {
    subjectId: string;
    name: string;
    groups: { id: string; name: string; freeSeats: number }[];
  }[];
  onDone: (className: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const label = t('people.students.branchMoves.acceptTitle', { name: listName(move) });
  const form = useRecordForm<string, BranchMoveAccept>({
    schema: ACCEPT_SCHEMA,
    initial: Object.fromEntries([
      ['classId', classId],
      ...subjects.map((one) => [groupField(one.subjectId), '']),
    ]) as Record<string, string>,
    read: (typed) => ({
      classId: typed.classId,
      groups: subjects.flatMap((one) => {
        const groupId = typed[groupField(one.subjectId)] ?? '';
        return groupId === '' ? [] : [{ subjectId: one.subjectId, groupId }];
      }),
    }),
    save: async (input) => {
      // No undo of an accept (decision 14): asked first, naming the student,
      // the branch left and the class.
      const go = await confirm({
        title: t('people.students.branchMoves.acceptConfirmTitle'),
        text: t('people.students.branchMoves.acceptConfirmText', {
          branch: move.fromBranch.name,
          class: className,
        }),
        names: [listName(move)],
        action: t('people.students.branchMoves.accept'),
        destructive: false,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      const send = (confirmLanguage: boolean) =>
        answerOf(
          api.POST('/api/people/branch-moves/{id}/accept', {
            params: { header: branchHeader(), path: { id: move.id } },
            body: { ...input, ...(confirmLanguage ? { confirmLanguage } : {}) },
          }),
        );
      try {
        await send(false);
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.code !== 'branch_move_language_differs') {
          throw error;
        }
        const go = await confirm({
          title: t('people.students.branchMoves.languageTitle'),
          text: t('people.students.branchMoves.languageText'),
          names: [listName(move)],
          action: t('people.students.branchMoves.accept'),
          destructive: false,
        });
        if (!go) {
          throw new SaveCancelled();
        }
        await send(true);
      }
      await invalidateStudents(queryClient);
      onDone(className);
    },
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <p className="text-sm text-muted-foreground">
        {t('people.students.branchMoves.freeSeats', { count: freeSeats })}
      </p>
      {subjects.map((one) => (
        <SelectField
          key={one.subjectId}
          label={one.name}
          options={[
            { value: '', label: t('people.students.branchMoves.placeAutomatically') },
            ...one.groups.map((group) => ({
              value: group.id,
              label: t('people.students.branchMoves.groupOption', {
                name: group.name,
                count: group.freeSeats,
              }),
              disabled: group.freeSeats <= 0,
            })),
          ]}
          {...form.bind(groupField(one.subjectId))}
        />
      ))}
    </RecordForm>
  );
}

const DECLINE_SCHEMA = asFormSchema<BranchMoveDecline>(branchMoveDeclineSchema, (path) => [
  ...path,
]);

/** The decline of one release, with a reason (decision 14). */
function DeclineForm({
  move,
  onDone,
  onCancel,
}: {
  move: IncomingBranchMove;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const label = t('people.students.branchMoves.declineTitle', { name: listName(move) });
  const form = useRecordForm<'reason', BranchMoveDecline>({
    schema: DECLINE_SCHEMA,
    initial: { reason: '' },
    save: async (input) => {
      // A decline closes the release for good (decision 14): asked first.
      const go = await confirm({
        title: t('people.students.branchMoves.declineConfirmTitle'),
        text: t('people.students.branchMoves.declineConfirmText', {
          branch: move.fromBranch.name,
        }),
        names: [listName(move)],
        action: t('people.students.branchMoves.decline'),
        destructive: true,
      });
      if (!go) {
        throw new SaveCancelled();
      }
      const answer = await answerOf(
        api.POST('/api/people/branch-moves/{id}/decline', {
          params: { header: branchHeader(), path: { id: move.id } },
          body: input,
        }),
      );
      queryClient.setQueryData(incomingQuery(branchId).queryKey, answer);
      onDone();
    },
  });
  return (
    <RecordForm form={form} label={label} onCancel={onCancel}>
      <Field label={t('people.students.reason')} {...form.bind('reason')} />
    </RecordForm>
  );
}

/**
 * The students released to the branch of the switcher (decision 2), above
 * the student list, for a reader of `branch_moves`: the UID, the name, the
 * grade, the branch and the date of each, with Accept (from the date on) and
 * Decline for those who decide. Drawn only when it holds a release.
 */
export function IncomingMoves() {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const reads = useMayView('branch_moves');
  const incoming = useQuery({ ...incomingQuery(branchId), enabled: branchId !== null && reads });
  const [open, setOpen] = useState<{ id: string; kind: 'accept' | 'decline' } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!reads) {
    return null;
  }
  if (incoming.isError) {
    return (
      <section className={`${PANEL} mb-3`}>
        <ErrorState
          error={incoming.error}
          onRetry={() => {
            void incoming.refetch();
          }}
        />
      </section>
    );
  }
  const moves = incoming.data?.moves ?? [];
  if (moves.length === 0 && done === null) {
    return null;
  }
  const title = t('people.students.branchMoves.incomingTitle', { count: moves.length });
  return (
    <section className={`${PANEL} mb-3 grid gap-3`} aria-label={title}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      {done !== null && (
        <p role="status" className="text-sm">
          {done}
        </p>
      )}
      <ul className="grid gap-3">
        {moves.map((move) => (
          <li key={move.id} className="grid gap-2" aria-label={listName(move)}>
            <span className="text-sm">
              {t('people.students.branchMoves.incomingLine', {
                name: listName(move),
                uid: move.uid,
                grade: move.grade,
                branch: move.fromBranch.name,
                date: schoolDateText(move.from, i18n.language),
              })}
            </span>
            {incoming.data?.canDecide === true && open?.id !== move.id && (
              <span className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={!move.acceptable}
                  onClick={() => {
                    setDone(null);
                    setOpen({ id: move.id, kind: 'accept' });
                  }}
                >
                  {t('people.students.branchMoves.accept')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDone(null);
                    setOpen({ id: move.id, kind: 'decline' });
                  }}
                >
                  {t('people.students.branchMoves.decline')}
                </Button>
                {!move.acceptable && (
                  <span className="text-sm text-muted-foreground">
                    {t('people.students.branchMoves.notYet', {
                      date: schoolDateText(move.from, i18n.language),
                    })}
                  </span>
                )}
              </span>
            )}
            {open?.id === move.id && open.kind === 'accept' && (
              <AcceptForm
                move={move}
                onDone={(className) => {
                  setOpen(null);
                  setDone(
                    t('people.students.branchMoves.accepted', {
                      name: listName(move),
                      class: className,
                    }),
                  );
                }}
                onCancel={() => {
                  setOpen(null);
                }}
              />
            )}
            {open?.id === move.id && open.kind === 'decline' && (
              <DeclineForm
                move={move}
                onDone={() => {
                  setOpen(null);
                  setDone(t('people.students.branchMoves.declined', { name: listName(move) }));
                }}
                onCancel={() => {
                  setOpen(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
