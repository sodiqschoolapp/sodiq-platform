import {
  FIRST_GRADE,
  LAST_GRADE,
  type CalendarChange,
  type CalendarDay,
  type CalendarDaysBody,
  type CalendarPreview,
  type DayChangeChoice,
  type Weekday,
} from '@sodiq/shared';
import { weekdayOf } from '@sodiq/timetable-rules';
import type { TFunction } from 'i18next';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { FailureAlert } from '@/components/failure-alert';
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
import { dayDecisionsBodyOf, PublishDayChanges } from '@/features/timetable/publish-day-changes';
import { calendarPreviewOf } from './calendar-api';
import { CalendarLessonsPreview, refusesSave } from './calendar-lessons-preview';
import { CalendarShortened, dayKeepsOf } from './calendar-shortened';
import { schoolDateText, weekdayName } from '@/lib/dates';

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
  /** The change previewed, sent again with the ticks (task 5.6b-2b). */
  change: CalendarChange;
  preview: CalendarPreview;
  /** The key of the sorting shown and the choices made, or `null` when the person does not save. */
  answer: (days: CalendarDaysBody | null) => void;
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
 * grades the save changes, before and after, and what it does to the
 * published timetable (task 5.6b-1), with Save off while the server would
 * refuse it. Task 5.6b-2a: the stored one-day changes and bulk cancels of the
 * changed dates, sorted (kept, needs a decision, dropped), with Save off
 * until each "needs a decision" item has a choice. Task 5.6b-2b: the
 * shortened days of the changed dates, with the lessons kept; a change of the
 * ticks asks the preview again with them. `confirm` resolves with the key of
 * the sorting shown, the choices and the ticks, which the save sends, when
 * the person saves, and throws `SaveCancelled` when they do not.
 */
export function useCalendarPreview(): {
  confirm: (change: CalendarChange) => Promise<CalendarDaysBody>;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [question, setQuestion] = useState<Question | null>(null);
  const [choices, setChoices] = useState<Record<string, DayChangeChoice>>({});
  const [ticks, setTicks] = useState<Record<string, number[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  const confirm = async (change: CalendarChange): Promise<CalendarDaysBody> => {
    const preview = await calendarPreviewOf(change);
    const days = await new Promise<CalendarDaysBody | null>((resolve) => {
      setChoices({});
      setTicks({});
      setRefreshError(null);
      setQuestion({ change, preview, answer: resolve });
    });
    if (days === null) {
      throw new SaveCancelled();
    }
    return days;
  };

  const answer = (days: CalendarDaysBody | null) => {
    question?.answer(days);
    setQuestion(null);
  };
  const decided =
    question === null ? null : dayDecisionsBodyOf(question.preview.lessons.dayChanges, choices);
  const dayKeeps = dayKeepsOf(ticks);
  const days: CalendarDaysBody | null =
    decided === null ? null : { ...decided, ...(dayKeeps.length === 0 ? {} : { dayKeeps }) };

  /** The ticks of a date and class changed: the preview again with every tick. */
  const tick = async (key: string, positions: number[]) => {
    if (question === null) return;
    const next = { ...ticks, [key]: positions };
    setTicks(next);
    setRefreshing(true);
    setRefreshError(null);
    try {
      const preview = await calendarPreviewOf({ ...question.change, dayKeeps: dayKeepsOf(next) });
      setQuestion((current) => (current === null ? null : { ...current, preview }));
    } catch (error) {
      setRefreshError(error);
    } finally {
      setRefreshing(false);
    }
  };

  const dialog =
    question === null ? null : (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            answer(null);
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
          <CalendarLessonsPreview lessons={question.preview.lessons} />
          <CalendarShortened
            lessons={question.preview.lessons}
            ticks={ticks}
            disabled={refreshing}
            onTicks={(key, positions) => {
              void tick(key, positions);
            }}
          />
          {refreshing && <p className="text-sm">{t('setup.calendar.lessons.refreshing')}</p>}
          {refreshError !== null && <FailureAlert error={refreshError} />}
          <PublishDayChanges
            impact={question.preview.lessons}
            choices={choices}
            canEdit
            onChoose={(key, choice) => {
              setChoices({ ...choices, [key]: choice });
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                answer(null);
              }}
            >
              {t('setup.calendar.cancel')}
            </Button>
            <Button
              disabled={
                refusesSave(question.preview.lessons) ||
                days === null ||
                refreshing ||
                refreshError !== null ||
                question.preview.lessons.keepRefusals.length > 0
              }
              onClick={() => {
                if (days !== null) answer(days);
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
