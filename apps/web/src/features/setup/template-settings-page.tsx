import {
  assignmentEndSchema,
  assignmentRecordSchema,
  FIRST_GRADE,
  LAST_GRADE,
  levelHasGrades,
  levelHasWeekday,
  nextDay,
  PERMISSIONS,
  permits,
  TEMPLATE_LEVELS,
  WEEKDAYS,
  type Assignment,
  type AssignmentEnd,
  type AssignmentRecord,
  type DayTemplateSummary,
  type TemplateLevelName,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { DateField, NumberField, SelectField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { useView } from '@/features/access/use-view';
import { schoolDateText, weekdayName } from './setup-api';
import { TemplateTableView, usePreview } from './template-table';
import {
  assignmentsQuery,
  dayTemplatesQuery,
  invalidateTemplates,
  templateTableQuery,
} from './templates-api';

const gradesText = (assignment: Assignment): string =>
  assignment.gradeFrom === null || assignment.gradeTo === null
    ? ''
    : assignment.gradeFrom === assignment.gradeTo
      ? String(assignment.gradeFrom)
      : `${String(assignment.gradeFrom)}–${String(assignment.gradeTo)}`;

interface SetFormProps {
  templates: readonly DayTemplateSummary[];
  tomorrow: string;
  onSave: (record: AssignmentRecord) => Promise<void>;
}

/**
 * A template set at a level from a date (owner's answer 11): the weekday is
 * asked for the two weekday levels, the grades for the two grade levels.
 */
function SetForm({ templates, tomorrow, onSave }: SetFormProps) {
  const { t, i18n } = useTranslation();
  const active = templates.filter((template) => template.archivedAt === null);
  const form = useRecordForm({
    schema: assignmentRecordSchema,
    initial: {
      level: 'default',
      weekday: '1',
      gradeFrom: '',
      gradeTo: '',
      dayTemplateId: active[0]?.id ?? '',
      from: tomorrow,
    },
    read: (typed) => {
      const level = typed.level as TemplateLevelName;
      return {
        level,
        weekday: levelHasWeekday(level) ? wholeNumber(typed.weekday) : null,
        gradeFrom: levelHasGrades(level) ? (wholeNumber(typed.gradeFrom) ?? null) : null,
        gradeTo: levelHasGrades(level) ? (wholeNumber(typed.gradeTo) ?? null) : null,
        dayTemplateId: typed.dayTemplateId,
        from: typed.from,
      };
    },
    save: onSave,
  });
  const level = form.bind('level');
  const levelName = level.value as TemplateLevelName;
  const number = new Intl.NumberFormat(i18n.language);
  const gradesNote = t('setup.templateSettings.gradesNote', {
    min: number.format(FIRST_GRADE),
    max: number.format(LAST_GRADE),
  });
  return (
    <RecordForm form={form} label={t('setup.templateSettings.setTitle')}>
      <SelectField
        label={t('setup.templateSettings.level')}
        options={TEMPLATE_LEVELS.map((one) => ({
          value: one,
          label: t(`setup.templateSettings.levels.${one}`),
        }))}
        {...level}
      />
      {levelHasWeekday(levelName) && (
        <SelectField
          label={t('setup.templateSettings.weekday')}
          options={WEEKDAYS.map((day) => ({
            value: String(day),
            label: weekdayName(i18n.language, day),
          }))}
          {...form.bind('weekday')}
        />
      )}
      {levelHasGrades(levelName) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label={t('setup.templateSettings.gradeFrom')}
            note={gradesNote}
            {...form.bind('gradeFrom')}
          />
          <NumberField label={t('setup.templateSettings.gradeTo')} {...form.bind('gradeTo')} />
        </div>
      )}
      <SelectField
        label={t('setup.templateSettings.template')}
        options={active.map((template) => ({ value: template.id, label: template.name }))}
        {...form.bind('dayTemplateId')}
      />
      <DateField label={t('setup.templateSettings.from')} {...form.bind('from')} />
    </RecordForm>
  );
}

/** A setting in the side panel: what it is, and its end from a date (never the default's, decision 8). */
function AssignmentPanel({
  assignment,
  templateName,
  tomorrow,
  canEdit,
}: {
  assignment: Assignment;
  templateName: string;
  tomorrow: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const preview = usePreview();
  const end = useMutation({
    mutationFn: (change: AssignmentEnd) =>
      answerOf(
        api.POST('/api/setup/day-template-assignments/{id}/end', {
          params: { path: { id: assignment.id }, header: branchHeader() },
          body: change,
        }),
      ),
    onSuccess: () => invalidateTemplates(queryClient),
  });
  const form = useRecordForm({
    schema: assignmentEndSchema,
    initial: { from: tomorrow },
    save: async (change) => {
      await preview.confirm({ kind: 'assignment_end', assignmentId: assignment.id, change });
      await end.mutateAsync(change);
    },
  });
  const date = (value: string | null) =>
    value === null ? '' : schoolDateText(value, i18n.language);
  return (
    <div className="grid gap-6">
      <dl className="grid gap-2 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">{t('setup.templateSettings.template')}</dt>
          <dd>{templateName}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">{t('setup.templateSettings.from')}</dt>
          <dd>{date(assignment.validFrom)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">{t('setup.templateSettings.until')}</dt>
          <dd>
            {assignment.validUntil === null
              ? t('setup.templateSettings.open')
              : date(assignment.validUntil)}
          </dd>
        </div>
      </dl>
      {canEdit &&
        (assignment.level === 'default' ? (
          <p className="text-sm text-muted-foreground">
            {t('setup.templateSettings.defaultStays')}
          </p>
        ) : (
          <section className="grid gap-3">
            <h3 className="text-base font-semibold">{t('setup.templateSettings.endTitle')}</h3>
            <RecordForm form={form} label={t('setup.templateSettings.endTitle')}>
              <DateField label={t('setup.templateSettings.endFrom')} {...form.bind('from')} />
            </RecordForm>
          </section>
        ))}
      {preview.dialog}
    </div>
  );
}

/**
 * Where the day templates apply (`03`, Slot types and day templates; task
 * 1.5): the resulting template of every working weekday and grade on a date,
 * the settings by level, and "Set a template from a date". Every save that can
 * change the table first shows it with the changes marked.
 */
export function TemplateSettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/day-template-settings' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const preview = usePreview();
  const canEdit = role !== null && permits(PERMISSIONS, role, 'day_templates', 'edit');
  const assignments = useQuery(assignmentsQuery(branchId));
  const templates = useQuery(dayTemplatesQuery(branchId));
  const today = assignments.data?.today;
  const tomorrow = today === undefined ? null : nextDay(today);
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  // A cleared date field shows tomorrow again, never a table that waits for good.
  const date = chosenDate === null || chosenDate === '' ? tomorrow : chosenDate;
  const table = useQuery(templateTableQuery(branchId, date));
  // The table waits on the date, which comes from the settings (today in
  // branch time) until one is chosen: their failure is the table's too.
  const tableFailure = table.isError
    ? { error: table.error, retry: () => void table.refetch() }
    : date === null && assignments.isError
      ? { error: assignments.error, retry: () => void assignments.refetch() }
      : null;
  // The list names the template of each setting: it fails with either query.
  const listFailure = assignments.isError
    ? { error: assignments.error, retry: () => void assignments.refetch() }
    : templates.isError
      ? { error: templates.error, retry: () => void templates.refetch() }
      : null;
  const language = i18n.language;

  const nameOf = useMemo(() => {
    const names = new Map((templates.data?.dayTemplates ?? []).map((one) => [one.id, one.name]));
    return (id: string) => names.get(id) ?? '';
  }, [templates.data]);

  const set = useMutation({
    mutationFn: (record: AssignmentRecord) =>
      answerOf(
        api.POST('/api/setup/day-template-assignments', {
          params: { header: branchHeader() },
          body: record,
        }),
      ),
    onSuccess: () => invalidateTemplates(queryClient),
  });

  const columns = useMemo(
    (): Column<Assignment>[] => [
      {
        key: 'level',
        header: t('setup.templateSettings.level'),
        cell: (row) => t(`setup.templateSettings.levels.${row.level}`),
        sortValue: (row) => TEMPLATE_LEVELS.indexOf(row.level),
        opens: true,
      },
      {
        key: 'weekday',
        header: t('setup.templateSettings.weekday'),
        cell: (row) => (row.weekday === null ? '' : weekdayName(language, row.weekday)),
        sortValue: (row) => row.weekday,
      },
      {
        key: 'grades',
        header: t('setup.templateSettings.grades'),
        cell: gradesText,
        sortValue: (row) => row.gradeFrom,
      },
      {
        key: 'template',
        header: t('setup.templateSettings.template'),
        cell: (row) => nameOf(row.dayTemplateId),
        sortValue: (row) => nameOf(row.dayTemplateId),
        searchText: (row) => nameOf(row.dayTemplateId),
      },
      {
        key: 'from',
        header: t('setup.templateSettings.from'),
        cell: (row) => schoolDateText(row.validFrom, language),
        sortValue: (row) => row.validFrom,
      },
      {
        key: 'until',
        header: t('setup.templateSettings.until'),
        cell: (row) =>
          row.validUntil === null
            ? t('setup.templateSettings.open')
            : schoolDateText(row.validUntil, language),
        sortValue: (row) => row.validUntil,
      },
    ],
    [t, language, nameOf],
  );

  const filters = useMemo(
    (): Filter<Assignment>[] => [
      {
        key: 'level',
        label: t('setup.templateSettings.level'),
        options: TEMPLATE_LEVELS.map((one) => ({
          value: one,
          label: t(`setup.templateSettings.levels.${one}`),
        })),
        matches: (row, value) => row.level === value,
      },
    ],
    [t],
  );

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({
      to: '/setup/day-template-settings',
      search: next,
      replace: how === 'replace',
    });
  };

  const activeTemplates = templates.data?.dayTemplates.filter((one) => one.archivedAt === null);

  return (
    <>
      <PageHeader
        title={t('setup.templateSettings.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
      />
      <section aria-label={t('setup.templateTable.title')} className="mb-8 grid gap-3">
        <h2 className="text-lg font-semibold">{t('setup.templateTable.title')}</h2>
        <div className="max-w-xs">
          <DateField
            label={t('setup.templateTable.date')}
            name="date"
            value={chosenDate ?? tomorrow ?? ''}
            onChange={(event) => {
              setChosenDate(event.target.value);
            }}
          />
        </div>
        {tableFailure !== null ? (
          <ErrorState error={tableFailure.error} onRetry={tableFailure.retry} />
        ) : table.data === undefined ? (
          <LoadingOutline lines={6} />
        ) : (
          <TemplateTableView table={table.data} caption={t('setup.templateTable.title')} />
        )}
      </section>
      {canEdit && tomorrow !== null && templates.isError && (
        <section
          aria-label={t('setup.templateSettings.setTitle')}
          className="mb-8 grid max-w-xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.templateSettings.setTitle')}</h2>
          <ErrorState
            error={templates.error}
            onRetry={() => {
              void templates.refetch();
            }}
          />
        </section>
      )}
      {canEdit && tomorrow !== null && activeTemplates !== undefined && (
        <section
          aria-label={t('setup.templateSettings.setTitle')}
          className="mb-8 grid max-w-xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.templateSettings.setTitle')}</h2>
          {activeTemplates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('setup.templateSettings.needTemplate')}
            </p>
          ) : (
            <SetForm
              templates={activeTemplates}
              tomorrow={tomorrow}
              onSave={async (record) => {
                await preview.confirm({ kind: 'assignment_set', change: record });
                await set.mutateAsync(record);
              }}
            />
          )}
        </section>
      )}
      <h2 className="mb-3 text-lg font-semibold">{t('setup.templateSettings.listTitle')}</h2>
      <ListPage
        listId="day-template-settings"
        caption={t('setup.templateSettings.listTitle')}
        rows={templates.data === undefined ? undefined : assignments.data?.assignments}
        error={listFailure?.error}
        onRetry={() => {
          listFailure?.retry();
        }}
        rowId={(row) => row.id}
        rowName={(row) =>
          [t(`setup.templateSettings.levels.${row.level}`), nameOf(row.dayTemplateId)].join(': ')
        }
        columns={columns}
        filters={filters}
        search={search}
        onSearchChange={open}
        empty={{ text: t('setup.templateSettings.empty') }}
        panel={(row) =>
          tomorrow === null ? null : (
            <AssignmentPanel
              key={row.id}
              assignment={row}
              templateName={nameOf(row.dayTemplateId)}
              tomorrow={tomorrow}
              canEdit={canEdit}
            />
          )
        }
      />
      {preview.dialog}
    </>
  );
}
