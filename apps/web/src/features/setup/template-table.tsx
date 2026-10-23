import {
  GRADES,
  type DayChangeChoice,
  type SlotInUse,
  type TemplateChange,
  type TemplateDaysBody,
  type TemplatePreview,
  type TemplateTable,
} from '@sodiq/shared';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EditIcon } from '@/components/icons';
import { FailureAlert } from '@/components/failure-alert';
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
import { SECTION_TITLE } from '@/components/ui/control';
import { dayDecisionsBodyOf, PublishDayChanges } from '@/features/timetable/publish-day-changes';
import { CalendarExamsPreview, examBlocksOf, examsRefuseSave } from './calendar-exams-preview';
import { CalendarLessonsPreview, refusesSave } from './calendar-lessons-preview';
import { datesText } from './calendar-preview';
import { CalendarShortened, dayKeepsOf } from './calendar-shortened';
import { previewOf, rangeText } from './templates-api';
import { schoolDateText, weekdayName } from '@/lib/dates';
import { PlanImpactList } from '@/components/plan-impact-list';

interface TemplateTableViewProps {
  table: TemplateTable;
  /** The cells a change touches, marked (`03`: "shows that table with the changes marked"). */
  changed?: readonly { weekday: number; grade: number }[];
  caption: string;
  /** The date under the table, where no Date field above names it (the preview). */
  showDate?: boolean;
  /** The grades shown, 1 to 11 unless said (the draft builder shows the grades of its classes). */
  grades?: readonly number[];
}

/**
 * The resulting template of every working weekday and grade on one date
 * (`03`: "School setup shows the template that results for every weekday and
 * grade in one table"; owner's answer 13): grades down, weekdays across, each
 * cell the template's name and the times of its day.
 */
export function TemplateTableView({
  table,
  changed = [],
  caption,
  showDate = false,
  grades = GRADES,
}: TemplateTableViewProps) {
  const { t, i18n } = useTranslation();
  const isChanged = (weekday: number, grade: number) =>
    changed.some((one) => one.weekday === weekday && one.grade === grade);
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('setup.templateTable.grade')}</TableHead>
            {table.weekdays.map((weekday) => (
              <TableHead key={weekday}>{weekdayName(i18n.language, weekday)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {grades.map((grade) => (
            <TableRow key={grade}>
              <TableHead scope="row">{t('setup.templateTable.gradeNumber', { grade })}</TableHead>
              {table.weekdays.map((weekday) => {
                const template = table.cells.find(
                  (one) => one.weekday === weekday && one.grade === grade,
                )?.template;
                const marked = isChanged(weekday, grade);
                return (
                  <TableCell
                    key={weekday}
                    data-changed={marked ? 'true' : undefined}
                    // The info tint with the edit icon and a hidden word: orange is
                    // never a marker and no information is shown by colour alone
                    // (docs/design-system.md, What we never do 9, Accessibility;
                    // pull request #80, decision 5).
                    className={marked ? 'bg-info-bg font-semibold text-info' : undefined}
                  >
                    {template == null ? (
                      <span
                        className={marked ? 'flex items-center gap-1' : 'text-muted-foreground'}
                      >
                        {marked && <EditIcon className="size-4" />}
                        {t('setup.templateTable.none')}
                      </span>
                    ) : (
                      <span className="grid">
                        <span className="flex items-center gap-1">
                          {marked && <EditIcon className="size-4" />}
                          {template.name}
                        </span>
                        <span className="text-xs">
                          {rangeText(t, template.start, template.end)}
                        </span>
                      </span>
                    )}
                    {marked && <span className="sr-only">{t('setup.templateTable.changed')}</span>}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {changed.length > 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <EditIcon className="size-4" />
          {t('setup.templateTable.changedLegend')}
        </p>
      )}
      {showDate && table.weekdays.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('setup.templateTable.on', { date: schoolDateText(table.date, i18n.language) })}
        </p>
      )}
    </div>
  );
}

/** The used lesson slots a change removes or reorders, one line per run of dates (task 5.6b-4b). */
function TemplateSlotsInUse({ slots }: { slots: readonly SlotInUse[] }): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (slots.length === 0) return null;
  return (
    <section className="space-y-1" data-testid="template-slots-in-use">
      <h3 className={SECTION_TITLE}>{t('setup.templateTable.slotsInUse.title')}</h3>
      <ul className="list-disc space-y-0.5 ps-5 text-sm">
        {slots.map((one) => (
          <li
            key={`${one.firstDate}-${String(one.grade)}-${String(one.lessonNumber)}-${one.problem}`}
          >
            {t('setup.templateTable.slotsInUse.line', {
              dates: datesText(one.firstDate, one.lastDate, i18n.language),
              grade: one.grade,
              weekday: weekdayName(i18n.language, one.weekday),
              number: one.lessonNumber,
              problem: t(`setup.templateTable.slotsInUse.problems.${one.problem}`),
            })}
          </li>
        ))}
      </ul>
      <p className="text-sm font-medium text-destructive" role="alert">
        {t('setup.templateTable.slotsInUse.refused')}
      </p>
    </section>
  );
}

/** The change with the shortened days' choices, as the preview takes them again. */
function withKeeps(change: TemplateChange, dayKeeps: TemplateDaysBody['dayKeeps']): TemplateChange {
  const days = { dayKeeps };
  switch (change.kind) {
    case 'slot_length':
      return { ...change, change: { ...change.change, days } };
    case 'template_version':
      return { ...change, change: { ...change.change, days } };
    case 'assignment_set':
      return { ...change, change: { ...change.change, days } };
    case 'assignment_end':
      return { ...change, change: { ...change.change, days } };
  }
}

interface Question {
  /** The change previewed, sent again with the ticks. */
  change: TemplateChange;
  preview: TemplatePreview;
  /** The choices the save sends, or `null` when the person does not save. */
  answer: (days: TemplateDaysBody | null) => void;
}

/**
 * The preview before a save that can change the table (decision 19 of pull
 * request #46): the change is sent to the preview route, which runs it and
 * writes nothing; the dialog shows the table on the change's date with the
 * changed cells marked, and the save goes on only when the person says so.
 *
 * Task 5.6b-4b: under the table, what the change does to the published
 * timetable (`06`, How surprises are prevented, Impact preview;
 * `edge/time-dates-calendar`, "A slot type's length or a day template is
 * changed mid-year"), with the calendar dialog's parts: the lessons removed,
 * created, cancelled, needing a teacher and the teachers told, and the
 * blocked conflicts by date; the used lesson slots it removes or reorders;
 * the exams; the shortened special dates with their ticks, which ask the
 * preview again; and the stored one-day changes and bulk cancels sorted,
 * each "needs a decision" with its choice. Save is off while the server
 * would refuse. `confirm` resolves with the key of the sorting shown and the
 * choices, which the save sends as `days`.
 *
 *     const preview = usePreview();
 *     save: async (values) => { const days = await preview.confirm(change); await save({ ...values, days }); }
 *     …
 *     {preview.dialog}
 */
export function usePreview(): {
  /** Resolves with the choices when the person saves; throws `SaveCancelled` when they do not, or the refusal of the preview. */
  confirm: (change: TemplateChange) => Promise<TemplateDaysBody>;
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

  const confirm = async (change: TemplateChange): Promise<TemplateDaysBody> => {
    const preview = await previewOf(change);
    const days = await new Promise<TemplateDaysBody | null>((resolve) => {
      setChoices({});
      setReasons({});
      setTicks({});
      setExamChoices({});
      setRefreshError(null);
      setQuestion({ change, preview, answer: resolve });
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
      const preview = await previewOf(withKeeps(question.change, dayKeepsOf(next)));
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
            <DialogTitle>{t('setup.templateTable.previewTitle')}</DialogTitle>
            <DialogDescription>
              {question.preview.changed.length === 0
                ? t('setup.templateTable.noChange')
                : t('setup.templateTable.changedCount', {
                    count: question.preview.changed.length,
                  })}
            </DialogDescription>
          </DialogHeader>
          <TemplateTableView
            table={question.preview.after}
            changed={question.preview.changed}
            caption={t('setup.templateTable.previewTitle')}
            showDate
          />
          <TemplateSlotsInUse slots={question.preview.slotsInUse} />
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
              {t('setup.templateTable.cancel')}
            </Button>
            <Button
              disabled={
                question.preview.slotsInUse.length > 0 ||
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
              {t('setup.templateTable.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );

  return { confirm, dialog };
}
