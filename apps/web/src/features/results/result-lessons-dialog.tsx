import { codedName } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { studentResultLessonsQuery } from './results-api';

/** The figure clicked: its part, or the result (every part). */
export type TracedPart = 'attendance' | 'classwork' | 'homework' | 'ratingExam' | 'result';

/** A work as the lessons answer gives it. */
interface Work {
  readonly title: string | null;
  /** Task 11.27: the code shown beside the title (`null` when none or off). */
  readonly code: string | null;
  readonly position: number;
  readonly score: number | null;
  readonly total: number;
  readonly percent: number | null;
}

function workText(work: Work, t: TFunction): string {
  const name =
    work.title === null
      ? t('results.workNumber', { number: work.position })
      : codedName(work.code, work.title);
  return work.score === null
    ? t('results.workEmpty', { name, total: work.total })
    : t('results.work', { name, score: work.score, total: work.total, percent: work.percent });
}

/**
 * The lessons behind a figure (task 9.1; `08`: "Clicking a figure opens the lessons
 * behind it"): the student's counted lessons of the subject in the quarter, across
 * the journals that follow the student, with the mark and its value, the works and
 * the rating exam entry, as the server gives them. The part clicked decides the
 * columns; the result shows every part.
 */
export function ResultLessonsDialog({
  studentId,
  subjectId,
  quarterId,
  part,
  onClose,
}: {
  studentId: string;
  subjectId: string;
  quarterId: string;
  part: TracedPart;
  onClose: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const lessons = useQuery(studentResultLessonsQuery(branchId, studentId, subjectId, quarterId));
  const answer = lessons.data;
  const shows = (one: TracedPart) => part === 'result' || part === one;
  const works = answer?.reading === 'whole';
  const title =
    answer === undefined
      ? t('results.lessonsTitle')
      : t('results.lessonsOf', {
          subject: nameOf(answer.subject.names, language),
          number: answer.quarter.number,
        });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* `sm:` so that it wins over the dialog's own 384 px from 640 px up, and the phone keeps
          its margin (design review of 17 November 2026, D3). */}
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {lessons.isError ? (
          <ErrorState error={lessons.error} onRetry={() => void lessons.refetch()} />
        ) : answer === undefined ? (
          <LoadingOutline />
        ) : (
          <div className="grid gap-3" data-result-lessons={part}>
            {answer.lessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('results.noLessons')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('results.columns.date')}</TableHead>
                    <TableHead>{t('results.columns.unit')}</TableHead>
                    {shows('attendance') && <TableHead>{t('results.columns.mark')}</TableHead>}
                    {works && shows('classwork') && (
                      <TableHead>{t('results.columns.classwork')}</TableHead>
                    )}
                    {works && shows('homework') && (
                      <TableHead>{t('results.columns.homework')}</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {answer.lessons.map((lesson) => (
                    <TableRow key={lesson.lessonId} data-lesson={lesson.lessonId}>
                      <TableCell>{schoolDateText(lesson.date, language)}</TableCell>
                      <TableCell>{lesson.unit.name}</TableCell>
                      {shows('attendance') && (
                        <TableCell data-part="attendance">
                          {lesson.mark === null
                            ? t('results.unmarked')
                            : lesson.attendanceValue === null
                              ? String(lesson.mark)
                              : t('results.mark', {
                                  mark: lesson.mark,
                                  value: lesson.attendanceValue,
                                })}
                        </TableCell>
                      )}
                      {works && shows('classwork') && (
                        <TableCell data-part="classwork">
                          {lesson.classworks.map((work) => workText(work, t)).join('; ')}
                        </TableCell>
                      )}
                      {works && shows('homework') && (
                        <TableCell data-part="homework">
                          {lesson.homeworks.map((work) => workText(work, t)).join('; ')}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {works && shows('ratingExam') && answer.ratingExam !== null && (
              <p className="text-sm" data-part="ratingExam">
                {answer.ratingExam.kind === 'score'
                  ? t('results.rating.score', { score: answer.ratingExam.score })
                  : t(`results.rating.${answer.ratingExam.kind}`)}
              </p>
            )}
          </div>
        )}
        {/* Every dialog has a visible way out (design review of 17 November 2026, D3). */}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('app.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
