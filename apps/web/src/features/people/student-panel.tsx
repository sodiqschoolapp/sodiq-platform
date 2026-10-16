import {
  classDisplayName,
  listName,
  phoneText,
  studentDetailSchema,
  studentIdentitySchema,
  studentUidCorrectionSchema,
  type ClassNotRestored,
  type StudentDetail,
  type StudentMove,
  type StudentIdentity,
  type StudentMergeResult,
  type StudentRecord,
  type StudentUidCorrection,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { uidSetText } from './uid-set';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { useLeave } from '@/components/unsent/unsent-changes';
import { PanelActions } from '@/components/list/panel-actions';
import { usePanelEditing, type PanelEditing } from '@/components/list/use-panel-editing';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { HistoryLink } from '@/features/audit/history-link';
import { ReportLink } from './report-link';
import { useView } from '@/features/access/use-view';
import { asFormSchema } from './form-schema';
import { invalidateStudents, studentDetailQuery, studentRelativesQuery } from './people-api';
import { StudentForm, takenOf, takenText } from './student-form';
import { GroupsPlacedNotice } from '@/features/classes/class-members';
import { StudentPhotoSection } from './student-photo-section';
import { StudentRelativesTab } from './student-relatives';
import {
  DeleteForm,
  isStatusForm,
  LeavingForm,
  RestoreForm,
  ReturnForm,
  StatusSection,
  statusActions,
  UndoForm,
  useCancelLeaving,
  type StatusForm,
} from './student-status-section';
import {
  ClassMoveForm,
  GroupMoveForm,
  HistoryTab,
  isMoveForm,
  moveRows,
  movesIt,
  targetOf,
  UndoMoveForm,
  useCancelMove,
} from './student-moves';
import { branchMoveRows, isBranchMoveForm, ReleaseForm, useCancelRelease } from './branch-move';
import { studentStatusText } from './status-cause';
import { alsoUidRow, isMergeForm, MergeForm } from './student-merge';
import { schoolDateText } from '@/lib/dates';
import { SECTION_TITLE } from '@/components/ui/control';

type Tab = 'overview' | 'relatives' | 'contract' | 'history';

/** The forms of the whole record: they take the place of the tabs and their content. */
const RECORD_FORMS = ['record', 'uid'] as const;

const isRecordForm = (key: string | null): boolean =>
  isStatusForm(key) ||
  isMoveForm(key) ||
  isBranchMoveForm(key) ||
  isMergeForm(key) ||
  RECORD_FORMS.some((one) => one === key);

interface StudentPanelProps {
  id: string;
  name: string;
  /** The name and UID of a student of this branch, by id, for a refusal that names one. */
  holderText: (id: string) => string | null;
}

/**
 * A student in the side panel of the list (`04`, Student record, "Profile
 * tabs"; task 2.4a): the tabs that have data so far, Overview and Contract and
 * scholarship. Each group of fields is drawn only when the server answers it
 * (edge/people-roles-accounts, Personal data and the audit log); the Principal
 * sees the identity fields behind a logged show. The status and its history
 * (task 2.4b-1) follow the overview. The panel reads first (task 2.7c-2b-2b):
 * the record's actions are at the bottom under every tab, each form opens
 * behind its button, one at a time.
 */
export function StudentPanel({ id, name, holderText }: StudentPanelProps) {
  const { t } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const leave = useLeave();
  const panel = usePanelEditing();
  const navigate = useNavigate();
  // After the delete of a student created twice the panel says so and reads nothing more (task 2.4b-1).
  const [deleted, setDeleted] = useState(false);
  // After a merge whose kept record left this branch (task 3.3d, correction 1): nothing more is read.
  const [movedTo, setMovedTo] = useState<{ name: string; branch: string } | null>(null);
  const detail = useQuery({
    ...studentDetailQuery(branchId, id),
    enabled: branchId !== null && !deleted && movedTo === null,
  });
  // Unchosen, a student with no relative opens on the Relatives tab (task 2.5a, decision 11).
  const [tab, setTab] = useState<Tab | null>(null);
  // A status form closed because the student changed under it: its refusal stays in the bottom row.
  const [staleClosed, setStaleClosed] = useState(false);
  const [notRestored, setNotRestored] = useState<readonly ClassNotRestored[]>([]);
  // A return or a restore names the groups it placed automatically (task 3.3b).
  const [groupsPlaced, setGroupsPlaced] = useState(0);
  // The move a History line's "Undo the move" opened (task 3.3a).
  const [undoing, setUndoing] = useState<StudentMove | null>(null);
  const relatives = useQuery({
    ...studentRelativesQuery(branchId, id),
    enabled:
      branchId !== null && !deleted && detail.data !== undefined && detail.data.contact !== null,
  });
  const where = () => ({ header: branchHeader(), path: { id } });
  const refresh = async (answer: unknown) => {
    queryClient.setQueryData(
      studentDetailQuery(branchId, id).queryKey,
      studentDetailSchema.parse(answer),
    );
    await invalidateStudents(queryClient);
  };
  const reread = async () => {
    await queryClient.invalidateQueries({
      queryKey: studentDetailQuery(branchId, id).queryKey,
    });
    await invalidateStudents(queryClient);
  };
  // A holder saved after the list was read: the list is read again, so the
  // refusal can name them (spec review of the build).
  const rereadOnTaken = async (error: Error) => {
    if (error instanceof ApiFailure && error.code === 'student_value_taken') {
      await invalidateStudents(queryClient);
    }
  };
  const edit = useMutation({
    mutationFn: (record: StudentRecord) =>
      answerOf(api.PUT('/api/people/students/{id}', { params: where(), body: record })),
    onSuccess: refresh,
    onError: rereadOnTaken,
  });
  const correct = useMutation({
    mutationFn: async (input: StudentUidCorrection) => {
      try {
        return await answerOf(
          api.PUT('/api/people/students/{id}/uid', { params: where(), body: input }),
        );
      } catch (error) {
        if (!(error instanceof ApiFailure) || error.code !== 'uid_set_mismatch') {
          throw error;
        }
        const go = await confirm({
          title: t('people.students.setTitle'),
          text: uidSetText(t, error, student?.grade ?? 1),
          names: [input.uid],
          action: t('people.students.saveAnyway'),
          destructive: false,
        });
        if (!go) {
          throw new SaveCancelled();
        }
        return answerOf(
          api.PUT('/api/people/students/{id}/uid', {
            params: where(),
            body: { ...input, confirmUidSet: true },
          }),
        );
      }
    },
    onSuccess: refresh,
    onError: rereadOnTaken,
  });
  const student = detail.data;
  const allowed = student === undefined ? null : statusActions(student);
  // A change of the status takes its button away: the panel shows Overview,
  // where the status heading is, and the focus goes to that heading. An action
  // started on the History tab stays there, the list read again in place, and
  // the focus goes to the list (task 3.5b, H28 of issue #105).
  // Only a choice of the person shows History (it is never the default tab).
  const focusAfter = () => (tab === 'history' ? 'history' : 'status');
  const statusChanged = async (answer: unknown) => {
    setTab((before) => (before === 'history' ? 'history' : 'overview'));
    // A cancel or an undo names the classes it could not give back (task 3.1b, decision 1).
    const read = studentDetailSchema.safeParse(answer);
    setNotRestored(read.success ? (read.data.classesNotRestored ?? []) : []);
    setGroupsPlaced(
      read.success ? new Set((read.data.groupsPlaced ?? []).map((one) => one.studentId)).size : 0,
    );
    await refresh(answer);
  };
  const cancelLeaving = useCancelLeaving(
    student,
    name,
    async (answer) => {
      await statusChanged(answer);
      panel.point(focusAfter());
    },
    reread,
  );
  // Task 3.3a: the cancel of a scheduled move, as the cancel of a leaving.
  const cancelMove = useCancelMove(
    student,
    name,
    async (answer) => {
      await statusChanged(answer);
      panel.point(focusAfter());
    },
    reread,
  );
  // Task 3.3c: the cancel of the open release to another branch.
  const cancelRelease = useCancelRelease(
    student,
    name,
    async (answer) => {
      await statusChanged(answer);
      panel.point(focusAfter());
    },
    reread,
  );
  /**
   * After a merge (task 3.3d, correction 1): the form goes first, then the
   * panel shows the kept record; when that is another record, it moves to
   * it (`.claude/rules/web.md`, the 2.5b-1 rule); when the kept record is no
   * longer of this branch, the panel says so, names the branch and reads
   * nothing more.
   */
  const [keptId, setKeptId] = useState<string | null>(null);
  const merged = async (result: StudentMergeResult) => {
    panel.stop({ saved: true, key: 'merge' });
    if (result.branch.id !== branchId) {
      setMovedTo({ name, branch: result.branch.name });
      queryClient.removeQueries({ queryKey: studentDetailQuery(branchId, id).queryKey });
    } else if (result.student.id !== id) {
      queryClient.setQueryData(
        studentDetailQuery(branchId, result.student.id).queryKey,
        result.student,
      );
      setKeptId(result.student.id);
    } else {
      await statusChanged(result.student);
    }
    await invalidateStudents(queryClient);
  };
  useEffect(() => {
    if (keptId !== null) {
      void navigate({
        to: '/people/students',
        search: (previous) => ({ ...previous, open: keptId }),
        replace: true,
      });
    }
  }, [keptId, navigate]);
  // A status form whose action is no longer allowed (the student was read
  // again) is not drawn: the panel reads as with no form open.
  const gone = isStatusForm(panel.editing) && allowed !== null && !allowed[panel.editing];
  const editing = gone ? null : panel.editing;
  // The parts of the panel see the same: a form not drawn is no open form.
  const shown = useMemo<PanelEditing>(
    () => (gone ? { ...panel, editing: null } : panel),
    [gone, panel],
  );

  if (deleted) {
    return <Deleted />;
  }
  if (movedTo !== null) {
    return <MovedAway name={movedTo.name} branch={movedTo.branch} />;
  }
  if (keptId !== null) {
    return <LoadingOutline />;
  }
  if (detail.isError) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (student === undefined || allowed === null) {
    return <LoadingOutline />;
  }
  // The profile tabs that have data so far (`04`, "Profile tabs"), as the
  // segmented control of the design system; one tab draws no control.
  const tabs: { key: Tab; title: string }[] = [
    { key: 'overview', title: t('people.students.tabs.overview') },
    // The Relatives tab for the Contact readers (`02`; task 2.5a).
    ...(student.contact === null
      ? []
      : [{ key: 'relatives' as const, title: t('people.students.tabs.relatives') }]),
    ...(student.financial === null
      ? []
      : [{ key: 'contract' as const, title: t('people.students.tabs.contract') }]),
    // The History tab (task 3.3a) for its readers.
    ...(student.readsHistory
      ? [{ key: 'history' as const, title: t('people.students.tabs.history') }]
      : []),
  ];
  const chosen = tab ?? (relatives.data?.relatives.length === 0 ? 'relatives' : 'overview');
  const shownTab = tabs.some((one) => one.key === chosen) ? chosen : 'overview';

  /** Opens a form; an open one with typed text is asked about first. */
  const start = (key: string) => {
    panel.start(key, () => {
      setStaleClosed(false);
      cancelLeaving.reset();
      cancelMove.reset();
      cancelRelease.reset();
    });
  };
  const opens = (key: string, text: string, variant: 'default' | 'secondary' | 'destructive') => (
    <Button
      key={key}
      variant={variant}
      {...panel.opener(key)}
      onClick={() => {
        start(key);
      }}
    >
      {text}
    </Button>
  );
  /**
   * "Student changed, reload" (edge/students-classes-groups): after the
   * re-read a status form whose action is gone closes, its refusal stays in
   * the bottom row, and the focus goes to the status heading above it.
   */
  const staleFor = (key: StatusForm) => async () => {
    await reread();
    const now = queryClient.getQueryData<StudentDetail>(studentDetailQuery(branchId, id).queryKey);
    if (now !== undefined && !statusActions(now)[key]) {
      setStaleClosed(true);
      panel.stop({ key, focus: focusAfter() });
    }
  };
  /** The props every status form shares; a save closes it with "Saved.". */
  const change = (key: StatusForm) => ({
    student,
    label: name,
    onChanged: async (answer: unknown) => {
      // Closed first: the re-read takes the form's action away.
      panel.stop({ saved: true, key, focus: focusAfter() });
      await statusChanged(answer);
    },
    onStale: staleFor(key),
    onCancel: () => {
      panel.stop();
    },
  });
  const secondary = [
    student.canEdit && opens('uid', t('people.students.uidTitle'), 'secondary'),
    allowed.cancel && (
      <Button
        key="cancel"
        variant="secondary"
        disabled={cancelLeaving.isPending}
        onClick={() => {
          setStaleClosed(false);
          cancelLeaving.mutate(undefined, {
            onSuccess: (answer) => {
              // The leaving kept: nothing was saved, so nothing says so.
              if (answer === null) {
                cancelLeaving.reset();
              }
            },
          });
        }}
      >
        {t('people.students.cancelLeaving')}
      </Button>
    ),
    allowed.undo && opens('undo', t('people.students.undoTitle'), 'secondary'),
    allowed.return && opens('return', t('people.students.returnTitle'), 'secondary'),
    allowed.restore && opens('restore', t('people.students.restoreTitle'), 'secondary'),
  ].filter((one) => one !== false);
  // Task 3.3a: a move, and the change and cancel of each scheduled move this reader may make.
  const scheduledClass = student.scheduledMoves.some((move) => move.kind === 'class');
  const movable = student.groups.filter((one) => student.groupMoveSubjects.includes(one.subjectId));
  const moves = [
    student.canMoveClass &&
      student.class !== null &&
      !scheduledClass &&
      opens('moveClass', t('people.students.moves.moveClass'), 'secondary'),
    movable.length > 0 && opens('moveGroup', t('people.students.moves.moveGroup'), 'secondary'),
    ...student.scheduledMoves
      .filter((move) => movesIt(student, move))
      .flatMap((move) => [
        opens(
          `change:${move.id}`,
          t('people.students.moves.change', { target: targetOf(move) }),
          'secondary',
        ),
        <Button
          key={`cancel:${move.id}`}
          variant="secondary"
          disabled={cancelMove.isPending}
          onClick={() => {
            setStaleClosed(false);
            cancelMove.mutate(move, {
              onSuccess: (answer) => {
                if (answer === null) {
                  cancelMove.reset();
                }
              },
            });
          }}
        >
          {t('people.students.moves.cancel', { target: targetOf(move) })}
        </Button>,
      ]),
  ].filter((one) => one !== false);
  secondary.push(...moves);
  // Task 3.3c: the release of an active student with no move waiting, and its cancel.
  const release = student.branchMove;
  if (
    student.canMoveBranch &&
    release === null &&
    student.status === 'active' &&
    student.scheduledMoves.length === 0
  ) {
    secondary.push(opens('moveBranch', t('people.students.branchMoves.move'), 'secondary'));
  }
  if (student.canMoveBranch && release !== null) {
    secondary.push(
      <Button
        key="cancel-release"
        variant="secondary"
        disabled={cancelRelease.isPending}
        onClick={() => {
          setStaleClosed(false);
          cancelRelease.mutate(release, {
            onSuccess: (answer) => {
              if (answer === null) {
                cancelRelease.reset();
              }
            },
          });
        }}
      >
        {t('people.students.branchMoves.cancel')}
      </Button>,
    );
  }
  const changing = student.scheduledMoves.find((move) => editing === `change:${move.id}`);
  const moveProps = (key: string) => ({
    student,
    onChanged: async (answer: unknown) => {
      panel.stop({ saved: true, key, focus: focusAfter() });
      await statusChanged(answer);
    },
    onStale: async () => {
      await reread();
    },
    onCancel: () => {
      panel.stop();
    },
  });
  // Task 3.3d: the merge with another record, for the reader the server lets merge.
  if (student.canMerge) {
    secondary.push(opens('merge', t('people.students.merge.action'), 'secondary'));
  }
  const danger = [
    allowed.leave && opens('leave', t('people.students.leaveTitle'), 'destructive'),
    allowed.delete && opens('delete', t('people.students.deleteAction'), 'destructive'),
  ].filter((one) => one !== false);

  return (
    <div className="grid gap-6">
      {/* One form open at a time (task 2.7c-2b-2b): a form of the whole record
          takes the place of the tabs, so its Save and Cancel are last. */}
      {editing === 'record' ? (
        <section className="grid gap-3">
          <h3 className={SECTION_TITLE}>{t('people.students.recordTitle')}</h3>
          <StudentForm
            key={`${student.id}-record`}
            student={student}
            label={name}
            holderText={holderText}
            onEdit={async (record) => {
              await edit.mutateAsync(record);
              panel.stop({ saved: true, key: 'record' });
            }}
            onCancel={() => {
              panel.stop();
            }}
          />
        </section>
      ) : editing === 'uid' ? (
        <UidCorrection
          key={student.id}
          student={student}
          label={name}
          holderText={holderText}
          onSave={async (input) => {
            await correct.mutateAsync(input);
            panel.stop({ saved: true, key: 'uid' });
          }}
          onCancel={() => {
            panel.stop();
          }}
        />
      ) : isRecordForm(editing) ? (
        // A status form below the status and its history, each only while
        // its action is allowed, keyed by the status state read (task 2.4b-1).
        <div className="grid gap-4">
          <StatusSection student={student} panel={shown} />
          {editing === 'moveClass' && (
            <ClassMoveForm
              key={`move-class-${String(student.version)}`}
              {...moveProps('moveClass')}
              label={name}
              move={null}
            />
          )}
          {editing === 'moveBranch' && (
            <ReleaseForm
              key={`move-branch-${String(student.version)}`}
              {...moveProps('moveBranch')}
            />
          )}
          {editing === 'merge' && (
            <MergeForm
              key={`merge-${student.id}`}
              student={student}
              onMerged={merged}
              onStale={reread}
              onCancel={() => {
                panel.stop();
              }}
            />
          )}
          {editing === 'moveGroup' && (
            <GroupMoveForm key="move-group" {...moveProps('moveGroup')} move={null} />
          )}
          {changing?.kind === 'class' && editing === `change:${changing.id}` && (
            <ClassMoveForm
              key={`change-${changing.id}`}
              {...moveProps(`change:${changing.id}`)}
              label={name}
              move={changing}
            />
          )}
          {changing?.kind === 'group' && editing === `change:${changing.id}` && (
            <GroupMoveForm
              key={`change-${changing.id}`}
              {...moveProps(`change:${changing.id}`)}
              move={changing}
            />
          )}
          {undoing !== null && editing === `undo:${undoing.id}` && (
            <UndoMoveForm
              key={`undo-${undoing.id}`}
              {...moveProps(`undo:${undoing.id}`)}
              move={undoing}
            />
          )}
          {editing === 'leave' && allowed.leave && (
            <LeavingForm key={`leave-${String(student.version)}`} {...change('leave')} />
          )}
          {editing === 'undo' && allowed.undo && (
            <UndoForm key={`undo-${String(student.version)}`} {...change('undo')} />
          )}
          {editing === 'return' && allowed.return && (
            <ReturnForm
              key={`return-${String(student.version)}`}
              {...change('return')}
              holderText={holderText}
            />
          )}
          {editing === 'restore' && allowed.restore && (
            <RestoreForm key={`restore-${String(student.version)}`} {...change('restore')} />
          )}
          {editing === 'delete' && allowed.delete && (
            <DeleteForm
              key={`delete-${String(student.version)}`}
              student={student}
              label={name}
              onStale={staleFor('delete')}
              onCancel={() => {
                panel.stop();
              }}
              onDeleted={async () => {
                setDeleted(true);
                queryClient.removeQueries({ queryKey: studentDetailQuery(branchId, id).queryKey });
                await invalidateStudents(queryClient);
              }}
            />
          )}
        </div>
      ) : (
        <>
          <StudentPhotoSection student={student} name={name} quiet={editing !== null} />
          <HistoryLink kind="student" id={student.id} />
          <ReportLink kind="student" id={student.id} />
          {tabs.length > 1 && (
            <Segmented
              label={t('people.students.tabs.label')}
              options={tabs.map((one) => ({ value: one.key, label: one.title }))}
              value={shownTab}
              onChange={(next) => {
                // Another tab takes the forms of this one away: ask first when
                // something is unsaved, then close the open form.
                const go = () => {
                  if (panel.editing !== null) {
                    panel.stop();
                  }
                  setTab(next);
                };
                if (!leave.unsent()) {
                  go();
                  return;
                }
                void leave.leave().then((leaves) => {
                  if (leaves) {
                    go();
                  }
                });
              }}
            />
          )}
          {/* Each tab holds only its own content (issue #39, hand test of 13 October
              2026, finding 5): the status belongs to Overview. */}
          {shownTab === 'overview' ? (
            <>
              <Overview student={student} />
              <Academic student={student} />
              {notRestored.length > 0 && (
                <p role="status" className="text-sm">
                  {t('people.students.notRestored', {
                    classes: notRestored
                      .map((one) => classDisplayName(one.grade, one.name))
                      .join(', '),
                  })}
                </p>
              )}
              <GroupsPlacedNotice count={groupsPlaced} />
              <StatusSection student={student} panel={shown} />
            </>
          ) : shownTab === 'relatives' ? (
            <StudentRelativesTab studentId={student.id} name={name} panel={shown} />
          ) : shownTab === 'history' ? (
            <HistoryTab
              student={student}
              onUndo={(move) => {
                setUndoing(move);
                start(`undo:${move.id}`);
              }}
            />
          ) : (
            <ContractTab student={student} />
          )}
        </>
      )}
      {editing === null && (
        <PanelActions
          primary={student.canEdit && opens('record', t('form.edit'), 'default')}
          secondary={secondary.length === 0 ? undefined : secondary}
          danger={danger.length === 0 ? undefined : danger}
          error={
            cancelLeaving.error ??
            cancelMove.error ??
            cancelRelease.error ??
            (staleClosed ? new ApiFailure('student_changed') : null)
          }
          // After a save of a form, or "Cancel the leaving" until another action starts.
          saved={
            (panel.saved && cancelLeaving.isIdle && cancelMove.isIdle && cancelRelease.isIdle) ||
            cancelLeaving.isSuccess ||
            cancelMove.isSuccess ||
            cancelRelease.isSuccess
          }
        />
      )}
    </div>
  );
}

/** The line after a merge whose kept record left this branch (correction 1); it takes the focus. */
function MovedAway({ name, branch }: { name: string; branch: string }) {
  const { t } = useTranslation();
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    line.current?.focus();
  }, []);
  return (
    <p ref={line} role="status" tabIndex={-1}>
      {t('people.students.merge.leftBranch', { name, branch })}
    </p>
  );
}

/** The line after a delete; it takes the focus, since the panel's buttons are gone. */
function Deleted() {
  const { t } = useTranslation();
  const line = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    line.current?.focus();
  }, []);
  return (
    <p ref={line} role="status" tabIndex={-1}>
      {t('people.students.deleted')}
    </p>
  );
}

/**
 * The Academic block of the record (task 3.1b): the class today, else the one
 * planned with its first day, its groups (task 3.2b), its Tutor and acting
 * Tutor in force, and its main classroom.
 */
function Academic({ student }: { student: StudentDetail }) {
  const { t, i18n } = useTranslation();
  const shown = student.class ?? student.plannedClass;
  const name = shown === null ? null : classDisplayName(shown.grade, shown.name);
  const rows: [string, string][] = [
    [
      t('people.students.class'),
      name === null
        ? t('people.students.noClass')
        : student.class === null && shown !== null
          ? t('people.students.classFrom', {
              class: name,
              date: schoolDateText(shown.from, i18n.language),
            })
          : name,
    ],
    [
      t('people.students.groups'),
      student.groups.length === 0
        ? '—'
        : student.groups
            .map((group) =>
              group.state === 'planned'
                ? t('people.students.groupFrom', {
                    group: group.name,
                    date: schoolDateText(group.from, i18n.language),
                  })
                : group.name,
            )
            .join(', '),
    ],
    [
      t('people.students.tutor'),
      student.tutor === null ? t('classes.noTutor') : listName(student.tutor),
    ],
  ];
  if (student.actingTutor !== null) {
    rows.push([t('people.students.actingTutor'), listName(student.actingTutor)]);
  }
  rows.push([t('people.students.mainRoom'), student.mainRoom ?? t('classes.noRoom')]);
  // Task 3.3a: the scheduled moves with their dates, and the latest class move.
  rows.push(...moveRows(t, i18n.language, student));
  rows.push(...branchMoveRows(t, i18n.language, student));
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.students.academic')}</h3>
      <Terms rows={rows} />
    </section>
  );
}

/** A list of terms and values. */
function Terms({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([term, value], index) => (
        <div key={`${term}-${String(index)}`} className="grid gap-0.5">
          <dt className="text-muted-foreground">{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Basic, Contact and Identity, as far as the reader may see them; Identity behind a show for the Principal. */
function Overview({ student }: { student: StudentDetail }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [shown, setShown] = useState<StudentIdentity | null>(null);
  const show = useMutation({
    mutationFn: async () =>
      studentIdentitySchema.parse(
        await answerOf(
          api.POST('/api/people/students/{id}/identity', {
            params: { header: branchHeader(), path: { id: student.id } },
          }),
        ),
      ),
    onSuccess: setShown,
  });
  const notSet = t('people.students.notSet');
  const identity = student.identity ?? shown;
  const rows: [string, string][] = [
    [t('people.students.uid'), student.uid],
    // Task 3.3d: the UIDs of the records merged into this one.
    ...alsoUidRow(t, student),
    // The one field of the record's form the overview lacked (task 2.7c-2b-2b, decision 4).
    [t('people.students.paternalName'), student.paternalName ?? notSet],
    [t('people.students.grade'), t('setup.subjects.grade', { grade: student.grade })],
    [t('people.students.sex'), t(`people.staff.sexes.${student.sex}`)],
    [t('people.students.startsOn'), schoolDateText(student.startsOn, language)],
    [t('people.students.status'), studentStatusText(t, student, student.today, language)],
  ];
  // Task 3.6a (L50): the score has readers of its own, shown in the Overview.
  if (student.readsDiagnostic) {
    rows.push([
      t('people.students.diagnosticScore'),
      student.diagnosticScore === null ? notSet : String(student.diagnosticScore),
    ]);
  }
  if (student.contact !== null) {
    rows.push(
      [
        t('people.students.phone'),
        student.contact.phone === null ? notSet : phoneText(student.contact.phone),
      ],
      [t('people.students.email'), student.contact.email ?? notSet],
    );
  }
  if (identity !== null) {
    rows.push(
      [t('people.students.birthDate'), schoolDateText(identity.birthDate, language)],
      [
        t('people.students.document'),
        identity.documentType === null
          ? notSet
          : `${t(`people.students.documentTypes.${identity.documentType}`)} ${identity.documentNumber ?? ''}`,
      ],
      [t('people.students.jshshir'), identity.jshshir ?? notSet],
      [t('people.students.address'), identity.address ?? notSet],
      [
        t('people.students.region'),
        identity.region === null ? notSet : t(`people.students.regions.${identity.region}`),
      ],
    );
  } else if (student.identityHidden) {
    rows.push(
      [t('people.students.birthDate'), t('people.students.hidden')],
      [t('people.students.document'), t('people.students.hidden')],
    );
  }
  return (
    <section className="grid gap-3">
      <Terms rows={rows} />
      {student.identityHidden && shown === null && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={show.isPending}
            onClick={() => {
              show.mutate();
            }}
          >
            {t('people.students.showIdentity')}
          </Button>
          <FailureAlert error={show.error} />
        </div>
      )}
    </section>
  );
}

/** The Financial group: contracts, scholarship, and the enrolment fields of decision 4. */
function ContractTab({ student }: { student: StudentDetail }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const financial = student.financial;
  if (financial === null) {
    return null;
  }
  const notSet = t('people.students.notSet');
  const { scholarship } = financial;
  const scholarshipText =
    scholarship.type === 'none'
      ? t('people.students.scholarshipTypes.none')
      : [
          t(`people.students.scholarshipTypes.${scholarship.type}`),
          scholarship.coverage === null
            ? ''
            : t(`people.students.scholarshipCoverages.${scholarship.coverage}`),
          scholarship.amount === null
            ? ''
            : t('people.students.amount', { amount: scholarship.amount }),
        ]
          .filter((part) => part !== '')
          .join(', ');
  return (
    <section className="grid gap-3">
      <Terms
        rows={[
          ...financial.contracts.map(
            (contract) =>
              [
                t('people.students.contract'),
                t('people.students.contractText', {
                  number: contract.number,
                  date: schoolDateText(contract.signedOn, language),
                }),
              ] as const,
          ),
          [t('people.students.scholarship'), scholarshipText],
          [t('people.students.previousSchool'), financial.previousSchool ?? notSet],
          [
            t('people.students.consentSignedOn'),
            financial.consentSignedOn === null
              ? t('people.students.noConsent')
              : schoolDateText(financial.consentSignedOn, language),
          ],
        ]}
      />
    </section>
  );
}

type UidField = 'uid' | 'reason';

const UID_SCHEMA = asFormSchema<StudentUidCorrection>(studentUidCorrectionSchema, (path) => [
  ...path,
]);

/** The correction of a mistyped UID with a reason (edge/students-classes-groups). */
function UidCorrection({
  student,
  label,
  holderText,
  onSave,
  onCancel,
}: {
  student: StudentDetail;
  label: string;
  holderText: (id: string) => string | null;
  onSave: (input: StudentUidCorrection) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const form = useRecordForm<UidField, StudentUidCorrection>({
    schema: UID_SCHEMA,
    initial: { uid: student.uid, reason: '' },
    read: (typed) => ({ uid: typed.uid, reason: typed.reason, confirmUidSet: false }),
    // Keyed by the student alone: its own save keeps "Saved." and empties the
    // reason for the next correction (finding 18).
    followInitial: true,
    save: onSave,
  });
  const taken = takenOf(form.failure);
  const uid = form.bind('uid');
  return (
    <section className="grid gap-3">
      <h3 className={SECTION_TITLE}>{t('people.students.uidTitle')}</h3>
      <RecordForm
        form={form}
        label={t('people.students.uidLabel', { name: label })}
        onCancel={onCancel}
      >
        <Field
          label={t('people.students.uid')}
          inputMode="numeric"
          {...uid}
          error={uid.error ?? (taken === null ? undefined : t(...takenText(taken, holderText)))}
        />
        <Field label={t('people.students.reason')} {...form.bind('reason')} />
      </RecordForm>
    </section>
  );
}
