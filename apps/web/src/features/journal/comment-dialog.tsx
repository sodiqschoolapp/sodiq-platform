import {
  COMMENT_MAX_LENGTH,
  type CommentHistoryQuery,
  type CommentTarget,
  type CommentVisibility,
  type JournalComment,
  type JournalGrid,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField, TextAreaField } from '@/components/field';
import { ErrorState, EmptyState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useView } from '@/features/access/use-view';
import { momentText } from '@/lib/dates';
import { commentHistoryQuery, invalidateJournal, saveComment } from './journal-api';

/**
 * Comments in the journal (task 8.2, pull request #218; `07`, Entering data,
 * Comments: "A comment can be attached to any attendance mark or score, and a
 * general note to a student for a lesson. Each comment is either 'staff only'
 * or 'visible to parents'"; Keyboard: "a key opens the comment"). The grid
 * opens the dialog of a cell with the key at `KeyC` (decision 11); a lesson's
 * cell also shows the student's note of the lesson. The server decides who
 * may write (decision 10: whoever may enter the target).
 */

/** A cell of the grid a comment is on; `rating` is the quarter's rating entry. */
export type CommentCell =
  | { readonly target: 'mark' | 'note'; readonly lessonId: string; readonly studentId: string }
  | {
      readonly target: 'work';
      readonly lessonId: string;
      readonly workId: string;
      readonly studentId: string;
    }
  | { readonly target: 'rating'; readonly studentId: string };

/** What the grid calls: the comment stored on a cell, and the dialog. */
export interface CommentsInput {
  commentOn: (cell: CommentCell) => JournalComment | undefined;
  open: (cell: CommentCell) => void;
}

const matches = (comment: JournalComment, cell: CommentCell): boolean =>
  comment.studentId === cell.studentId &&
  comment.target === cell.target &&
  (cell.target === 'rating'
    ? true
    : comment.lessonId === cell.lessonId &&
      (cell.target !== 'work' || comment.workId === cell.workId));

export function useComments(grid: JournalGrid): {
  comments: CommentsInput;
  dialogs: React.JSX.Element;
} {
  const [opened, setOpened] = useState<CommentCell | null>(null);
  const all = useMemo(() => grid.students.flatMap((one) => one.comments), [grid.students]);
  const comments = useMemo(
    (): CommentsInput => ({
      commentOn: (cell) => all.find((one) => matches(one, cell)),
      open: (cell) => {
        setOpened(cell);
      },
    }),
    [all],
  );
  const dialogs =
    opened === null ? (
      <></>
    ) : (
      <CommentsDialog
        grid={grid}
        cell={opened}
        stored={all}
        onClose={() => {
          setOpened(null);
        }}
      />
    );
  return { comments, dialogs };
}

/** The target as the API names it. */
function targetOf(grid: JournalGrid, cell: CommentCell): CommentTarget {
  if (cell.target === 'rating') {
    return {
      target: 'rating',
      journalId: grid.journal.id,
      quarterId: grid.quarter.id,
      studentId: cell.studentId,
    };
  }
  return cell.target === 'work'
    ? { target: 'work', lessonId: cell.lessonId, workId: cell.workId, studentId: cell.studentId }
    : { target: cell.target, lessonId: cell.lessonId, studentId: cell.studentId };
}

function historyQueryOf(grid: JournalGrid, cell: CommentCell): CommentHistoryQuery {
  if (cell.target === 'rating') {
    return {
      target: 'rating',
      studentId: cell.studentId,
      journalId: grid.journal.id,
      quarterId: grid.quarter.id,
    };
  }
  return cell.target === 'work'
    ? { target: 'work', studentId: cell.studentId, lessonId: cell.lessonId, workId: cell.workId }
    : { target: cell.target, studentId: cell.studentId, lessonId: cell.lessonId };
}

/** Whether the reader may write on the cell, as the grid shows it. */
function writable(grid: JournalGrid, cell: CommentCell): boolean {
  if (cell.target === 'rating') {
    return grid.rating !== null && (grid.rating.canEnter || grid.rating.canExempt);
  }
  const lesson = grid.lessons.find((one) => one.id === cell.lessonId);
  if (lesson === undefined) return false;
  return cell.target === 'work' ? lesson.canEnterWorks : lesson.canEnter;
}

function CommentsDialog({
  grid,
  cell,
  stored,
  onClose,
}: {
  grid: JournalGrid;
  cell: CommentCell;
  stored: readonly JournalComment[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const student = grid.students.find((one) => one.id === cell.studentId);
  const name = student === undefined ? '' : `${student.lastName} ${student.firstName}`;
  const title = t('journal.comments.title', { student: name });
  // A lesson's cell shows the student's note of the lesson beside its own comment.
  const cells: CommentCell[] =
    cell.target === 'rating' || cell.target === 'note'
      ? [cell]
      : [cell, { target: 'note', lessonId: cell.lessonId, studentId: cell.studentId }];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-label={title}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          {cells.map((one) => (
            <CommentSection
              key={one.target}
              grid={grid}
              cell={one}
              comment={stored.find((comment) => matches(comment, one))}
            />
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('journal.entry.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommentSection({
  grid,
  cell,
  comment,
}: {
  grid: JournalGrid;
  cell: CommentCell;
  comment: JournalComment | undefined;
}) {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const [body, setBody] = useState(comment?.body ?? '');
  const [visibility, setVisibility] = useState<CommentVisibility>(comment?.visibility ?? 'staff');
  const history = useQuery(commentHistoryQuery(branchId, historyQueryOf(grid, cell)));
  const save = useMutation({
    mutationFn: (text: string | null) =>
      saveComment({
        on: targetOf(grid, cell),
        body: text,
        visibility,
        version: comment?.version ?? null,
      }),
    onSettled: async () => {
      await invalidateJournal(queryClient);
    },
  });
  const canWrite = writable(grid, cell);
  const trimmed = body.trim();
  const heading = t(`journal.comments.targets.${cell.target}`);
  return (
    <section className="grid gap-2 text-sm" aria-label={heading}>
      <h3 className="font-semibold">{heading}</h3>
      <TextAreaField
        label={t('journal.comments.body')}
        value={body}
        disabled={!canWrite}
        maxLength={COMMENT_MAX_LENGTH}
        onChange={(event) => {
          setBody(event.target.value);
        }}
      />
      <SelectField
        label={t('journal.comments.visibility')}
        value={visibility}
        disabled={!canWrite}
        options={[
          { value: 'staff', label: t('journal.comments.visibilities.staff') },
          { value: 'parents', label: t('journal.comments.visibilities.parents') },
        ]}
        onChange={(event) => {
          setVisibility(event.target.value === 'parents' ? 'parents' : 'staff');
        }}
      />
      {save.isError && <FailureAlert error={save.error} />}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              save.isPending ||
              trimmed === '' ||
              (trimmed === (comment?.body ?? '') && visibility === comment?.visibility)
            }
            onClick={() => {
              save.mutate(trimmed);
            }}
          >
            {t('journal.comments.save')}
          </Button>
          {comment?.body != null && (
            <Button
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                save.mutate(null);
                setBody('');
              }}
            >
              {t('journal.comments.clear')}
            </Button>
          )}
        </div>
      )}
      {history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data === undefined ? (
        <LoadingOutline />
      ) : history.data.lines.length === 0 ? (
        <EmptyState text={t('journal.comments.noHistory')} />
      ) : (
        <ul className="grid gap-1 text-muted-foreground" aria-label={t('journal.comments.history')}>
          {history.data.lines.map((line) => (
            <li key={`${String(line.version)}:${line.changedAt}`}>
              {t('journal.comments.line', {
                text: line.bodyAfter ?? t('journal.comments.cleared'),
                who: line.changedBy ?? '—',
                when: momentText(i18n.language, line.changedAt),
              })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
