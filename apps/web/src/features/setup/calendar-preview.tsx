import {
  FIRST_GRADE,
  LAST_GRADE,
  type CalendarChange,
  type CalendarDay,
  type CalendarPreview,
  type Weekday,
} from '@sodiq/shared';
import { weekdayOf } from '@sodiq/timetable-rules';
import type { TFunction } from 'i18next';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { calendarPreviewOf } from './calendar-api';
import { schoolDateText, weekdayName } from './setup-api';

/** "14 October" or "14 – 16 October 2026". */
export function datesText(first: string, last: string, language: string): string {
  return first === last
    ? schoolDateText(first, language)
    : `${schoolDateText(first, language, first.slice(0, 4) !== last.slice(0, 4))} – ${schoolDateText(last, language)}`;
}

/** "Whole branch" (no grades, or all of 1 to 11) or "Grades 9–11". */
export function gradesText(t: TFunction, gradeFrom: number | null, gradeTo: number | null): string {
  if (
    gradeFrom === null ||
    gradeTo === null ||
    (gradeFrom === FIRST_GRADE && gradeTo === LAST_GRADE)
  ) {
    return t('setup.calendar.wholeBranch');
  }
  return gradeFrom === gradeTo
    ? t('setup.calendar.grade', { grade: gradeFrom })
    : t('setup.calendar.grades', { from: gradeFrom, to: gradeTo });
}

/**
 * What a grade has on a date, in words: "No lessons: day off (Navruz)", or the
 * template, with the weekday its lessons follow when it is not the date's own
 * and the exam week.
 */
export function dayText(t: TFunction, language: string, date: string, day: CalendarDay): string {
  if (!day.lessons) {
    const reason = t(`setup.calendar.reasons.${day.reason}`);
    return day.entryName === null ? reason : `${reason} (${day.entryName})`;
  }
  const parts = [day.dayTemplateName];
  if (day.followsWeekday !== weekdayOf(date)) {
    parts.push(
      t('setup.calendar.followsText', { weekday: weekdayName(language, day.followsWeekday) }),
    );
  }
  if (day.examWeek !== null) {
    parts.push(t(`setup.calendar.examWeeks.${day.examWeek}`));
  }
  if (day.entryName !== null) {
    parts.push(day.entryName);
  }
  return parts.join(' · ');
}

interface Question {
  preview: CalendarPreview;
  answer: (save: boolean) => void;
}

/** The changes of a save, before and after, by dates and grades. */
function PreviewTable({ preview }: { preview: CalendarPreview }) {
  const { t, i18n } = useTranslation();
  return (
    <Table>
      <caption className="sr-only">{t('setup.calendar.previewTitle')}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('setup.calendar.dates')}</TableHead>
          <TableHead>{t('setup.calendar.scope')}</TableHead>
          <TableHead>{t('setup.calendar.before')}</TableHead>
          <TableHead>{t('setup.calendar.after')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {preview.changes.map((change) => (
          <TableRow key={`${change.firstDate}-${String(change.gradeFrom)}`}>
            <TableCell>{datesText(change.firstDate, change.lastDate, i18n.language)}</TableCell>
            <TableCell>{gradesText(t, change.gradeFrom, change.gradeTo)}</TableCell>
            <TableCell>{dayText(t, i18n.language, change.firstDate, change.before)}</TableCell>
            <TableCell className="font-medium">
              {dayText(t, i18n.language, change.firstDate, change.after)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The preview before a calendar save (`edge/time-dates-calendar`: "the impact
 * preview is shown first"; decision 11 of pull request #47): the dates and
 * grades the save changes, before and after. `confirm` resolves when the
 * person saves and throws `SaveCancelled` when they do not.
 */
export function useCalendarPreview(): {
  confirm: (change: CalendarChange) => Promise<void>;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [question, setQuestion] = useState<Question | null>(null);

  const confirm = async (change: CalendarChange): Promise<void> => {
    const preview = await calendarPreviewOf(change);
    const save = await new Promise<boolean>((resolve) => {
      setQuestion({ preview, answer: resolve });
    });
    if (!save) {
      throw new SaveCancelled();
    }
  };

  const answer = (save: boolean) => {
    question?.answer(save);
    setQuestion(null);
  };

  const dialog =
    question === null ? null : (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            answer(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('setup.calendar.previewTitle')}</DialogTitle>
            <DialogDescription>
              {question.preview.changes.length === 0
                ? t('setup.calendar.noChange')
                : t('setup.calendar.changedCount', { count: question.preview.changes.length })}
            </DialogDescription>
          </DialogHeader>
          {question.preview.changes.length > 0 && <PreviewTable preview={question.preview} />}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                answer(false);
              }}
            >
              {t('setup.calendar.cancel')}
            </Button>
            <Button
              onClick={() => {
                answer(true);
              }}
            >
              {t('setup.calendar.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return { confirm, dialog };
}

/** The weekdays as options, Monday first. */
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
