import {
  CALENDAR_ENTRY_KINDS,
  calendarEntryRecordSchema,
  EXAM_WEEKS,
  GRADES,
  type CalendarEntry,
  type CalendarEntryRecord,
} from '@sodiq/shared';
import { useTranslation } from 'react-i18next';
import { DateField, Field, SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { WEEKDAYS } from './calendar-preview';
import { weekdayName } from '@/lib/dates';

interface CalendarEntryFormProps {
  /** The entry edited; none for a new one. */
  entry?: CalendarEntry | undefined;
  /** The first date a new entry can have: tomorrow in branch time. */
  firstDate: string;
  /** The day templates a special day can name: the active ones. */
  templates: readonly { id: string; name: string }[];
  /**
   * A started entry (decision 3 of pull request #47): only its name and its
   * last date are offered; the server refuses any other change.
   */
  limited?: boolean;
  label: string;
  onSave: (record: CalendarEntryRecord) => Promise<void>;
}

const text = (value: number | null): string => (value === null ? '' : String(value));

/**
 * A day off or a special day (owner's answer 15): a kind, one typed name, a
 * first and a last date, the whole branch or a range of grades; a special day
 * names a template, the weekday it follows (empty: the date's own) and
 * whether it is an exam week.
 */
export function CalendarEntryForm({
  entry,
  firstDate,
  templates,
  limited = false,
  label,
  onSave,
}: CalendarEntryFormProps) {
  const { t, i18n } = useTranslation();
  const form = useRecordForm({
    schema: calendarEntryRecordSchema,
    initial: {
      kind: entry?.kind ?? 'day_off',
      name: entry?.name ?? '',
      firstDate: entry?.firstDate ?? firstDate,
      lastDate: entry?.lastDate ?? firstDate,
      scope: entry === undefined || entry.gradeFrom === null ? 'branch' : 'grades',
      gradeFrom: text(entry?.gradeFrom ?? 1),
      gradeTo: text(entry?.gradeTo ?? 11),
      dayTemplateId: entry?.dayTemplateId ?? templates[0]?.id ?? '',
      followsWeekday: text(entry?.followsWeekday ?? null),
      examWeek: entry?.examWeek ?? '',
    },
    read: (typed) => {
      const special = typed.kind === 'special_day';
      const grades = typed.scope === 'grades';
      return {
        kind: typed.kind,
        name: typed.name,
        firstDate: typed.firstDate,
        lastDate: typed.lastDate,
        gradeFrom: grades ? wholeNumber(typed.gradeFrom) : null,
        gradeTo: grades ? wholeNumber(typed.gradeTo) : null,
        dayTemplateId: special && typed.dayTemplateId !== '' ? typed.dayTemplateId : null,
        followsWeekday:
          special && typed.followsWeekday !== '' ? wholeNumber(typed.followsWeekday) : null,
        examWeek: special && typed.examWeek !== '' ? typed.examWeek : null,
      };
    },
    save: onSave,
  });

  const kind = form.bind('kind').value;
  const scope = form.bind('scope').value;
  const gradeOptions = GRADES.map((grade) => ({ value: String(grade), label: String(grade) }));
  // The template of the entry stays offered even if it was archived since:
  // what the field shows is what an unchanged save sends.
  const offered =
    entry?.dayTemplateId != null &&
    entry.dayTemplateName !== null &&
    !templates.some((template) => template.id === entry.dayTemplateId)
      ? [...templates, { id: entry.dayTemplateId, name: entry.dayTemplateName }]
      : templates;

  return (
    <RecordForm form={form} label={label}>
      {entry === undefined && (
        <SelectField
          label={t('setup.calendar.kind')}
          options={CALENDAR_ENTRY_KINDS.map((one) => ({
            value: one,
            label: t(`setup.calendar.kinds.${one}`),
          }))}
          {...form.bind('kind')}
        />
      )}
      <Field label={t('setup.calendar.name')} autoComplete="off" {...form.bind('name')} />
      {!limited && <DateField label={t('setup.calendar.firstDate')} {...form.bind('firstDate')} />}
      <DateField label={t('setup.calendar.lastDate')} {...form.bind('lastDate')} />
      {!limited && (
        <>
          <SelectField
            label={t('setup.calendar.scope')}
            options={[
              { value: 'branch', label: t('setup.calendar.wholeBranch') },
              { value: 'grades', label: t('setup.calendar.someGrades') },
            ]}
            {...form.bind('scope')}
          />
          {scope === 'grades' && (
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label={t('setup.calendar.gradeFrom')}
                options={gradeOptions}
                {...form.bind('gradeFrom')}
              />
              <SelectField
                label={t('setup.calendar.gradeTo')}
                options={gradeOptions}
                {...form.bind('gradeTo')}
              />
            </div>
          )}
          {kind === 'special_day' && (
            <>
              <SelectField
                label={t('setup.calendar.template')}
                options={offered.map((template) => ({ value: template.id, label: template.name }))}
                {...form.bind('dayTemplateId')}
              />
              <SelectField
                label={t('setup.calendar.follows')}
                note={t('setup.calendar.followsNote')}
                options={[
                  { value: '', label: t('setup.calendar.ownWeekday') },
                  ...WEEKDAYS.map((day) => ({
                    value: String(day),
                    label: weekdayName(i18n.language, day),
                  })),
                ]}
                {...form.bind('followsWeekday')}
              />
              <SelectField
                label={t('setup.calendar.examWeek')}
                options={[
                  { value: '', label: t('setup.calendar.notExamWeek') },
                  ...EXAM_WEEKS.map((one) => ({
                    value: one,
                    label: t(`setup.calendar.examWeeks.${one}`),
                  })),
                ]}
                {...form.bind('examWeek')}
              />
            </>
          )}
        </>
      )}
    </RecordForm>
  );
}
