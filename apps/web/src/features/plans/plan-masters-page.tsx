import {
  INSTRUCTION_LANGUAGES,
  planMasterCreateSchema,
  type PlanMasterCreate,
  type PlanMasters,
  type PlanMasterSummary,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, SelectField } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ListPage } from '@/components/list/list-page';
import type { Column, Filter, ListSearch } from '@/components/list/list-state';
import { useNewRecord } from '@/components/list/use-new-record';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useView } from '@/features/access/use-view';
import { yearText } from '@/features/journal/journals-page';
import { nameOf } from '@/features/setup/setup-api';
import { SubjectChip } from '@/features/setup/subject-colour';
import { createPlanMaster, invalidatePlans, planMastersQuery } from './plans-api';
import type { PlansSearch } from './plans-search';

type Row = PlanMasterSummary;

const QUARTER_NUMBERS = [1, 2, 3, 4] as const;

/**
 * Master plans (task 7.3, pull request #216; `09`, Master plans: "A Head
 * Teacher can keep a master plan for one of their subjects, a grade, a
 * language of instruction and a quarter"; "A Senior Head Teacher can keep one
 * master for all branches"). Every reader of plans reads them; the server
 * answers which subjects the reader keeps (`keeps`), and a row opens its master.
 */
export function PlanMastersPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: PlansSearch = useSearch({ from: '/app/plans/masters' });
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const list = useQuery(
    planMastersQuery(branchId, search.year === undefined ? {} : { yearId: search.year }),
  );
  const newRecord = useNewRecord();
  const language = i18n.language;
  const create = useMutation({
    mutationFn: async (body: PlanMasterCreate) => {
      const made = await createPlanMaster(body);
      await invalidatePlans(queryClient);
      return made;
    },
  });

  const subjectName = useMemo(
    () => (row: { subject: Row['subject'] }) => nameOf(row.subject.names, language),
    [language],
  );

  const columns = useMemo(
    (): Column<Row>[] => [
      {
        key: 'name',
        header: t('plans.masters.name'),
        cell: (row) => row.name,
        sortValue: (row) => row.name,
        searchText: (row) => `${row.name} ${subjectName(row)}`,
        opens: true,
        fixed: true,
      },
      {
        key: 'subject',
        header: t('plans.page.subject'),
        cell: (row) => <SubjectChip colour={row.subject.colour} name={subjectName(row)} />,
        sortValue: subjectName,
      },
      {
        key: 'grade',
        header: t('plans.masters.grade'),
        cell: (row) => String(row.grade),
        sortValue: (row) => row.grade,
      },
      {
        key: 'language',
        header: t('plans.masters.language'),
        cell: (row) => t(`people.staff.languages.${row.language}`),
      },
      {
        key: 'quarter',
        header: t('plans.masters.quarter'),
        cell: (row) => t('plans.page.quarter', { number: row.quarter }),
        sortValue: (row) => row.quarter,
      },
      {
        key: 'scope',
        header: t('plans.masters.scope'),
        cell: (row) => t(`plans.masters.scopes.${row.scope}`),
      },
      {
        key: 'items',
        header: t('plans.masters.items'),
        cell: (row) => String(row.items),
        sortValue: (row) => row.items,
      },
      {
        key: 'state',
        header: t('plans.masters.state'),
        cell: (row) => (row.archived ? t('plans.masters.archived') : t('plans.masters.active')),
      },
    ],
    [t, subjectName],
  );

  const filters = useMemo(
    (): Filter<Row>[] => [
      {
        key: 'subject',
        label: t('plans.page.subject'),
        options: [
          ...new Map(
            (list.data?.masters ?? []).map((row) => [row.subject.id, subjectName(row)]),
          ).entries(),
        ]
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label, language)),
        matches: (row, value) => row.subject.id === value,
      },
      {
        key: 'quarter',
        label: t('plans.masters.quarter'),
        options: QUARTER_NUMBERS.map((number) => ({
          value: String(number),
          label: t('plans.page.quarter', { number }),
        })),
        matches: (row, value) => String(row.quarter) === value,
      },
      {
        key: 'state',
        label: t('plans.masters.state'),
        options: [
          { value: 'active', label: t('plans.masters.active') },
          { value: 'archived', label: t('plans.masters.archived') },
        ],
        matches: (row, value) => (value === 'archived') === row.archived,
      },
    ],
    [t, list.data, subjectName, language],
  );

  const go = (next: PlansSearch, how: 'push' | 'replace' = 'push'): void => {
    void navigate({ to: '/plans/masters', search: next, replace: how === 'replace' });
  };
  const keep = search.year === undefined ? {} : { year: search.year };
  const keeps = list.data?.keeps ?? [];
  const yearId = list.data?.yearId ?? null;

  const addButton = keeps.length > 0 && yearId !== null && newRecord.value === null && (
    <Button
      id={newRecord.buttonId}
      onClick={() => {
        newRecord.start(true);
      }}
    >
      {t('plans.masters.add')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('plans.masters.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('plans.page.title'), to: '/plans' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      <div className="grid gap-4">
        {list.data !== undefined && list.data.years.length > 1 && (
          <div className="w-48">
            <SelectField
              label={t('plans.page.year')}
              value={list.data.yearId ?? ''}
              options={list.data.years.map((year) => ({ value: year.id, label: yearText(year) }))}
              onChange={(event) => {
                go({ year: event.target.value });
              }}
            />
          </div>
        )}
        <ListPage
          listId="plan-masters"
          caption={t('plans.masters.title')}
          rows={list.data?.masters}
          error={list.error ?? undefined}
          onRetry={() => {
            void list.refetch();
          }}
          rowId={(row) => row.id}
          rowName={(row) => `${row.name} · ${subjectName(row)}`}
          columns={columns}
          filters={filters}
          search={search}
          onSearchChange={(next: ListSearch, how) => {
            go({ ...keep, ...next }, how);
          }}
          onOpenRow={(row) => {
            void navigate({ to: '/plans/masters/$masterId', params: { masterId: row.id } });
          }}
          empty={{
            title: t('plans.masters.emptyTitle'),
            text: t('plans.masters.empty'),
            action: addButton === false ? undefined : addButton,
          }}
          creating={
            newRecord.value === null || yearId === null
              ? undefined
              : {
                  key: 'master',
                  title: t('plans.masters.newTitle'),
                  content: ({ close }) => (
                    <div className="grid gap-4">
                      <NewMasterForm
                        keeps={keeps}
                        label={t('plans.masters.newTitle')}
                        onSave={async (typed) => {
                          const made = await create.mutateAsync({ ...typed, yearId });
                          newRecord.handlers.onSaved(made.id);
                          void navigate({
                            to: '/plans/masters/$masterId',
                            params: { masterId: made.id },
                          });
                        }}
                      />
                      <div>
                        <Button variant="ghost" onClick={close}>
                          {t('plans.masters.cancel')}
                        </Button>
                      </div>
                    </div>
                  ),
                  ...newRecord.handlers,
                }
          }
        />
      </div>
    </>
  );
}

type MasterField = 'subjectId' | 'grade' | 'language' | 'quarter' | 'name' | 'scope';

/** The form of a new master: the subjects the reader keeps, their grades and scopes. */
function NewMasterForm({
  keeps,
  label,
  onSave,
}: {
  keeps: PlanMasters['keeps'];
  label: string;
  /** The page puts the list's year in place of the stand-in. */
  onSave: (body: PlanMasterCreate) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const first = keeps[0];
  const form = useRecordForm<MasterField, PlanMasterCreate>({
    // The year is the list's; the schema checks the rest with a stand-in that is never sent.
    schema: planMasterCreateSchema,
    initial: {
      subjectId: first?.subject.id ?? '',
      grade: String(first?.grades[0] ?? ''),
      language: 'uz',
      quarter: '1',
      name: '',
      scope: 'branch',
    },
    read: (typed) => ({
      yearId: '00000000-0000-4000-8000-000000000000',
      subjectId: typed.subjectId,
      grade: Number(typed.grade),
      language: typed.language as PlanMasterCreate['language'],
      quarter: Number(typed.quarter),
      name: typed.name,
      scope: typed.scope as PlanMasterCreate['scope'],
    }),
    save: onSave,
  });
  const subject = form.bind('subjectId');
  const grade = form.bind('grade');
  const scope = form.bind('scope');
  const chosen = keeps.find((one) => one.subject.id === subject.value) ?? first;
  const scopes = chosen?.scopes ?? [];
  return (
    <RecordForm form={form} label={label}>
      <SelectField
        label={t('plans.page.subject')}
        options={keeps.map((one) => ({
          value: one.subject.id,
          label: nameOf(one.subject.names, i18n.language),
        }))}
        {...subject}
        onChange={(event) => {
          subject.onChange(event);
          // The grade and the scope follow the subject's options (`.claude/rules/web.md`).
          const next = keeps.find((one) => one.subject.id === event.target.value);
          grade.onChange({ target: { value: String(next?.grades[0] ?? '') } });
          scope.onChange({ target: { value: next?.scopes[0] ?? 'branch' } });
        }}
      />
      <SelectField
        label={t('plans.masters.grade')}
        options={(chosen?.grades ?? []).map((one) => ({ value: String(one), label: String(one) }))}
        {...grade}
      />
      <SelectField
        label={t('plans.masters.language')}
        options={INSTRUCTION_LANGUAGES.map((one) => ({
          value: one,
          label: t(`people.staff.languages.${one}`),
        }))}
        {...form.bind('language')}
      />
      <SelectField
        label={t('plans.masters.quarter')}
        options={QUARTER_NUMBERS.map((number) => ({
          value: String(number),
          label: t('plans.page.quarter', { number }),
        }))}
        {...form.bind('quarter')}
      />
      <Field label={t('plans.masters.name')} autoComplete="off" {...form.bind('name')} />
      {scopes.length > 1 && (
        <SelectField
          label={t('plans.masters.scope')}
          options={scopes.map((one) => ({ value: one, label: t(`plans.masters.scopes.${one}`) }))}
          {...scope}
        />
      )}
    </RecordForm>
  );
}

/** The links of the plans page to the masters and the parallel classes (task 7.3). */
export function MasterLinks({ parallel }: { parallel: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <Link to="/plans/masters" className="text-link">
        {t('plans.masters.title')}
      </Link>
      {parallel && (
        <Link to="/plans/parallel" className="text-link">
          {t('plans.parallel.title')}
        </Link>
      )}
    </>
  );
}
