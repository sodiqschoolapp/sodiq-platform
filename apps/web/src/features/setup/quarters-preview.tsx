import {
  classDisplayName,
  quartersPreviewSchema,
  type DayChangeChoice,
  type QuarterItem,
  type QuartersPreview,
  type QuartersSave,
  type TemplateDaysBody,
} from '@sodiq/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { FailureAlert } from '@/components/failure-alert';
import { SaveCancelled } from '@/components/form/save-cancelled';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { dayDecisionsBodyOf, PublishDayChanges } from '@/features/timetable/publish-day-changes';
import { schoolDateText } from '@/lib/dates';
import { CalendarExamsPreview, examBlocksOf, examsRefuseSave } from './calendar-exams-preview';
import { CalendarLessonsPreview, hasLessons, refusesSave } from './calendar-lessons-preview';
import { CalendarShortened, dayKeepsOf } from './calendar-shortened';
import { nameOf } from './setup-api';
import { PlanImpactList } from '@/components/plan-impact-list';

/** What a save of the quarters would do, written nowhere (task 5.6b-5a). */
async function quartersPreviewOf(yearId: string, body: QuartersSave): Promise<QuartersPreview> {
  return quartersPreviewSchema.parse(
    await answerOf(
      api.POST('/api/setup/academic-years/{id}/quarters/preview', {
        params: { path: { id: yearId }, header: branchHeader() },
        body,
      }),
    ),
  );
}

/** A list of items with the count of the rest, as the preview and a refusal name them. */
export interface QuarterItems {
  items: readonly QuarterItem[];
  more: number;
}

/** The refusal codes whose details name `QuarterItem`s (tasks 5.6b-5a and 5.6b-5b). */
const ITEM_CODES = [
  'quarter_past_lessons',
  'quarter_leaves_exam',
  'quarter_splits_move',
  'quarter_rating_exams',
  // Task 8.2 (decision 13): hand-set rating exam dates left outside their quarter.
  'quarter_rating_dates',
  'year_leaves_exam',
  // Task 6.1b-1 (decision 7): the lessons with data on days cut off.
  'lessons_hold_data',
] as const;

/** The code and the items a refused save names in its details, or `null` for another failure. */
export function quarterItemsOf(
  failure: unknown,
): (QuarterItems & { code: (typeof ITEM_CODES)[number] }) | null {
  if (!(failure instanceof ApiFailure)) return null;
  const code = ITEM_CODES.find((one) => one === failure.code);
  if (code === undefined) return null;
  const details = failure.details ?? [];
  return {
    code,
    items: details.flatMap((one) => (one.quarterItem === undefined ? [] : [one.quarterItem])),
    more: details.find((one) => one.path === 'more')?.more ?? 0,
  };
}

/**
 * The lines of what stands in the way of new quarter or year dates (task
 * 5.6b-5b): a lesson "date · class · subject", an exam "date · title", a
 * one-day move "from date → to date · class · subject"; then "and N more".
 * The preview and a refused save draw the same lines (decision 4).
 */
export function QuarterItemsList({
  title,
  list,
}: {
  title: string;
  list: QuarterItems;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (list.items.length === 0 && list.more === 0) return null;
  const unitText = (unit: { name: string; grade: number | null }): string =>
    unit.grade === null ? unit.name : classDisplayName(unit.grade, unit.name);
  const lineOf = (item: QuarterItem): string => {
    switch (item.kind) {
      case 'past_lesson':
      case 'data_lesson':
      // Task 8.2: a hand-set rating exam date, drawn as a lesson line.
      case 'rating_date':
        return t('setup.years.preview.lessonLine', {
          date: schoolDateText(item.date, language),
          unit: unitText(item.unit),
          subject: nameOf(item.subject.names, language),
        });
      case 'exam':
        return t(
          item.cancelled ? 'setup.years.preview.cancelledExamLine' : 'setup.years.preview.examLine',
          {
            date: schoolDateText(item.date, language),
            title: item.title,
          },
        );
      case 'split_move':
        return t('setup.years.preview.moveLine', {
          from: schoolDateText(item.fromDate, language),
          to: schoolDateText(item.toDate, language),
          unit: unitText(item.unit),
          subject: nameOf(item.subject.names, language),
        });
      case 'rating_exams':
        // Task 5.6c-3b: a journal given two rating exams in one quarter.
        return t('setup.years.preview.ratingLine', {
          unit: unitText(item.unit),
          subject: nameOf(item.subject.names, language),
          exams: item.exams
            .map((one) => `${schoolDateText(one.date, language)} ${one.title}`)
            .join(', '),
        });
    }
  };
  return (
    <section className="space-y-1">
      <h4 className={SUBSECTION_TITLE}>{title}</h4>
      <ul className="list-disc space-y-0.5 ps-5 text-sm" aria-label={title}>
        {list.items.map((item, index) => (
          <li key={`${item.kind}-${String(index)}`}>{lineOf(item)}</li>
        ))}
        {list.more > 0 && <li>{t('setup.years.preview.more', { count: list.more })}</li>}
      </ul>
    </section>
  );
}

/** The title of the list a refusal code names. */
const LIST_TITLES = {
  quarter_past_lessons: 'setup.years.preview.pastLessons',
  quarter_leaves_exam: 'setup.years.preview.exams',
  quarter_splits_move: 'setup.years.preview.splitMoves',
  quarter_rating_exams: 'setup.years.preview.ratingExams',
  quarter_rating_dates: 'setup.years.preview.ratingDates',
  year_leaves_exam: 'setup.years.preview.yearExams',
  lessons_hold_data: 'setup.years.preview.dataLessons',
} as const;

/** The lines of a refused save of the quarters or of the year's dates, under its form. */
export function QuarterRefusalLines({ failure }: { failure: unknown }): React.JSX.Element | null {
  const { t } = useTranslation();
  const list = quarterItemsOf(failure);
  if (list === null) return null;
  return <QuarterItemsList title={t(LIST_TITLES[list.code])} list={list} />;
}

/** Whether the preview refuses the save with a list (`pastLessons`, `exams`, `splitMoves`, `ratingExams`). */
const listsRefuse = (preview: QuartersPreview): boolean =>
  [
    preview.pastLessons,
    preview.exams,
    preview.splitMoves,
    preview.ratingExams,
    preview.ratingDates,
    preview.dataLessons,
  ].some((list) => list.items.length > 0 || list.more > 0);

/**
 * Whether the preview has anything to show or to decide (decision 3): with
 * nothing, the save goes on without a dialog.
 */
export function hasQuartersEffect(preview: QuartersPreview): boolean {
  const { lessons } = preview;
  const { dayChanges } = lessons;
  return (
    listsRefuse(preview) ||
    preview.movedBlocks.length > 0 ||
    hasLessons(lessons) ||
    lessons.shortenedDays.length > 0 ||
    lessons.keepRefusals.length > 0 ||
    dayChanges.kept.length > 0 ||
    dayChanges.decide.length > 0 ||
    dayChanges.dropped.length > 0 ||
    dayChanges.bulk.length > 0
  );
}

/** The dates whose lessons go to another quarter, one line each with the count of lesson times (decision 5). */
function QuarterMovedBlocks({
  moved,
}: {
  moved: QuartersPreview['movedBlocks'];
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (moved.length === 0) return null;
  return (
    <section className="space-y-1" data-testid="quarter-moved-blocks">
      <h3 className={SECTION_TITLE}>{t('setup.years.preview.movedTitle')}</h3>
      <ul className="list-disc space-y-0.5 ps-5 text-sm">
        {moved.map((one) => (
          <li key={one.date}>
            {t('setup.years.preview.movedLine', {
              date: schoolDateText(one.date, i18n.language),
              count: one.blocks,
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Question {
  yearId: string;
  /** The quarters previewed, sent again with the ticks. */
  body: QuartersSave;
  preview: QuartersPreview;
  /** The choices the save sends, or `null` when the person does not save. */
  answer: (days: TemplateDaysBody | null) => void;
}

/**
 * The preview before a save of the quarters (task 5.6b-5b;
 * `edge/time-dates-calendar`, "Quarter dates are edited after lessons
 * exist"; `06`, How surprises are prevented, Impact preview): what stands in
 * the way (held lessons on dates that would change quarter, exams on dates
 * that would leave every quarter, one-day moves split across quarters), the
 * dates whose lessons go to another quarter, and, with the calendar dialog's
 * parts, the lessons of the dates that leave or join the quarters, the exams,
 * the shortened days with their ticks and the stored one-day changes sorted.
 * Save is off while the server would refuse. `confirm` resolves with the key
 * of the sorting shown and the choices, which the save sends as `days`; with
 * nothing to show it resolves at once with the key (decision 3).
 */
export function useQuartersPreview(): {
  /** Resolves with the choices when the person saves; throws `SaveCancelled` when they do not, or the refusal of the preview. */
  confirm: (yearId: string, body: QuartersSave) => Promise<TemplateDaysBody>;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [question, setQuestion] = useState<Question | null>(null);
  const [choices, setChoices] = useState<Record<string, DayChangeChoice>>({});
  // Task 5.7b-3: the reason typed for a substitution's cancel, by its key.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [ticks, setTicks] = useState<Record<string, number[]>>({});
  const [examChoices, setExamChoices] = useState<Record<string, 'cancel' | 'keep'>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  const confirm = async (yearId: string, body: QuartersSave): Promise<TemplateDaysBody> => {
    const preview = await quartersPreviewOf(yearId, body);
    if (!hasQuartersEffect(preview)) {
      return { dayChangesKey: preview.lessons.dayChanges.key };
    }
    const days = await new Promise<TemplateDaysBody | null>((resolve) => {
      setChoices({});
      setReasons({});
      setTicks({});
      setExamChoices({});
      setRefreshError(null);
      setQuestion({ yearId, body, preview, answer: resolve });
    });
    if (days === null) {
      throw new SaveCancelled();
    }
    return days;
  };

  const answer = (days: TemplateDaysBody | null) => {
    question?.answer(days);
    setQuestion(null);
  };
  const decided =
    question === null
      ? null
      : dayDecisionsBodyOf(question.preview.lessons.dayChanges, choices, reasons);
  const dayKeeps = dayKeepsOf(ticks);
  const examBlocks = examBlocksOf(examChoices);
  const days: TemplateDaysBody | null =
    decided === null
      ? null
      : {
          ...decided,
          ...(dayKeeps.length === 0 ? {} : { dayKeeps }),
          ...(examBlocks.length === 0 ? {} : { examBlocks }),
        };

  /** The ticks of a date and class changed: the preview again with every tick. */
  const tick = async (key: string, positions: number[]) => {
    if (question === null) return;
    const next = { ...ticks, [key]: positions };
    setTicks(next);
    setRefreshing(true);
    setRefreshError(null);
    try {
      const keeps = dayKeepsOf(next);
      const preview = await quartersPreviewOf(question.yearId, {
        ...question.body,
        days: { ...question.body.days, ...(keeps.length === 0 ? {} : { dayKeeps: keeps }) },
      });
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
            <DialogTitle>{t('setup.years.preview.title')}</DialogTitle>
            {/* Code review should-fix 1: no sentence under the title
                (`.claude/rules/web.md`); the description is for screen readers. */}
            <DialogDescription className="sr-only">
              {t('setup.years.preview.description')}
            </DialogDescription>
          </DialogHeader>
          {listsRefuse(question.preview) && (
            <div className="space-y-3" data-testid="quarter-refusals">
              <QuarterItemsList
                title={t('setup.years.preview.pastLessons')}
                list={question.preview.pastLessons}
              />
              <QuarterItemsList
                title={t('setup.years.preview.exams')}
                list={question.preview.exams}
              />
              <QuarterItemsList
                title={t('setup.years.preview.splitMoves')}
                list={question.preview.splitMoves}
              />
              <QuarterItemsList
                title={t('setup.years.preview.ratingExams')}
                list={question.preview.ratingExams}
              />
              <QuarterItemsList
                title={t('setup.years.preview.ratingDates')}
                list={question.preview.ratingDates}
              />
              <QuarterItemsList
                title={t('setup.years.preview.dataLessons')}
                list={question.preview.dataLessons}
              />
              <p className="text-sm font-medium text-destructive" role="alert">
                {t('setup.years.preview.refused')}
              </p>
            </div>
          )}
          <QuarterMovedBlocks moved={question.preview.movedBlocks} />
          <CalendarLessonsPreview lessons={question.preview.lessons} />
          <PlanImpactList plans={question.preview.plans} />
          <CalendarExamsPreview
            lessons={question.preview.lessons}
            choices={examChoices}
            onChoose={(key, choice) => {
              setExamChoices({ ...examChoices, [key]: choice });
            }}
          />
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
            reasons={reasons}
            onReason={(key, reason) => {
              setReasons({ ...reasons, [key]: reason });
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                answer(null);
              }}
            >
              {t('setup.years.cancel')}
            </Button>
            <Button
              disabled={
                listsRefuse(question.preview) ||
                refusesSave(question.preview.lessons) ||
                examsRefuseSave(question.preview.lessons, examChoices) ||
                days === null ||
                refreshing ||
                refreshError !== null ||
                question.preview.lessons.keepRefusals.length > 0
              }
              onClick={() => {
                if (days !== null) answer(days);
              }}
            >
              {t('setup.years.preview.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return { confirm, dialog };
}
