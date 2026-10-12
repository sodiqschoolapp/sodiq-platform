import {
  JOURNAL_TYPES,
  PERMISSIONS,
  permits,
  SUBJECT_GRADES,
  type Subject,
  type SubjectRecord,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { ApiFailure, answerOf } from '@/api/failure';
import { ListPage, type BulkAction } from '@/components/list/list-page';
import { useExport } from '@/components/list/use-export';
import { type Column, type Filter, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { divisionsQuery, nameOf } from './setup-api';
import { SubjectChip } from './subject-colour';
import { SubjectForm, type DepartmentChoice } from './subject-form';
import { SubjectPanel } from './subject-panel';
import { invalidateSubjects, subjectsQuery } from './subjects-api';
import { weightsText } from './weights-form';

/** What a bulk archive or restore did: how many went through, and the names refused, by reason. */
interface Outcome {
  restore: boolean;
  done: number;
  taken: string[];
  departmentArchived: string[];
}

/**
 * The subject list of the school (`05`, Subject; `12`, Lists), with this
 * branch's daily distribution, each opened in the side panel. The Super Admin
 * and the Academic Vice Principal add, edit, archive and restore (owner's
 * answer 4); the Principal reads. A new subject needs an active department of
 * Academic: without one, "Add subject" is switched off and says so
 * (`edge/academic-year`, the first row).
 */
export function SubjectsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/setup/subjects' });
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const [adding, setAdding] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const canCreate = role !== null && permits(PERMISSIONS, role, 'subjects', 'create');
  const canEdit = role !== null && permits(PERMISSIONS, role, 'subjects', 'edit');
  const canArchive = role !== null && permits(PERMISSIONS, role, 'subjects', 'archive');
  const canExport = role !== null && permits(PERMISSIONS, role, 'subjects', 'export');
  const exporter = useExport<Subject>('/api/setup/subjects/export', (row) => row.id);
  const subjects = useQuery(subjectsQuery(branchId));
  const divisions = useQuery(divisionsQuery(branchId));
  const language = i18n.language;
  const number = useMemo(() => new Intl.NumberFormat(language), [language]);

  /** Every department of Academic by id, and the active ones a subject can be put in. */
  const { departmentNames, choices } = useMemo(() => {
    const academic = divisions.data?.divisions.find((division) => division.builtIn);
    const all = academic?.departments ?? [];
    return {
      departmentNames: new Map(all.map((one) => [one.id, nameOf(one.names, language)])),
      choices: all
        .filter((one) => one.archivedAt === null)
        .map((one): DepartmentChoice => ({ id: one.id, name: nameOf(one.names, language) })),
    };
  }, [divisions.data, language]);

  const refresh = () => invalidateSubjects(queryClient);

  const create = useMutation({
    mutationFn: (record: SubjectRecord) =>
      answerOf(
        api.POST('/api/setup/subjects', { params: { header: branchHeader() }, body: record }),
      ),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
  });

  /** One call per subject, in order; a refusal of one does not stop the others. */
  const archiveMany = useMutation({
    mutationFn: async ({ rows, restore }: { rows: Subject[]; restore: boolean }) => {
      const result: Outcome = { restore, done: 0, taken: [], departmentArchived: [] };
      for (const row of rows) {
        try {
          await answerOf(
            api.POST(
              restore ? '/api/setup/subjects/{id}/restore' : '/api/setup/subjects/{id}/archive',
              { params: { header: branchHeader(), path: { id: row.id } } },
            ),
          );
          result.done += 1;
        } catch (error) {
          const name = nameOf(row.names, language);
          if (restore && error instanceof ApiFailure && error.code === 'already_exists') {
            result.taken.push(name);
          } else if (
            restore &&
            error instanceof ApiFailure &&
            error.code === 'subject_department_archived'
          ) {
            result.departmentArchived.push(name);
          } else {
            throw error;
          }
        }
      }
      return result;
    },
    onSuccess: setOutcome,
    onSettled: refresh,
  });

  const columns = useMemo((): Column<Subject>[] => {
    const yes = (on: boolean) => (on ? t('setup.subjects.yes') : t('setup.subjects.no'));
    return [
      {
        key: 'name',
        header: t('setup.subjects.name'),
        cell: (row) => <SubjectChip colour={row.colour} name={nameOf(row.names, language)} />,
        sortValue: (row) => nameOf(row.names, language),
        searchText: (row) => `${row.names.uz} ${row.names.ru} ${row.names.en}`,
        opens: true,
      },
      {
        key: 'department',
        header: t('setup.subjects.department'),
        cell: (row) => departmentNames.get(row.departmentId) ?? '',
        sortValue: (row) => departmentNames.get(row.departmentId) ?? '',
      },
      {
        key: 'grades',
        header: t('setup.subjects.grades'),
        cell: (row) => row.grades.map((grade) => number.format(grade)).join(', '),
        sortValue: (row) => row.grades[0] ?? 0,
      },
      {
        key: 'journalType',
        header: t('setup.subjects.journalType'),
        cell: (row) => t(`setup.subjects.journalTypes.${row.journalType}`),
        sortValue: (row) => row.journalType,
      },
      {
        key: 'ratingExam',
        header: t('setup.subjects.ratingExam'),
        cell: (row) => yes(row.ratingExam),
        sortValue: (row) => (row.ratingExam ? 0 : 1),
      },
      {
        key: 'daily',
        header: t('setup.subjects.daily'),
        cell: (row) =>
          row.journalType !== 'graded'
            ? t('setup.subjects.none')
            : row.daily === null
              ? t('setup.subjects.notSet')
              : weightsText(row.daily, language),
        sortValue: (row) => (row.daily === null ? '' : weightsText(row.daily, 'en')),
      },
      {
        key: 'quarterly',
        header: t('setup.subjects.quarterlyMissing'),
        cell: (row) =>
          row.journalType !== 'graded'
            ? t('setup.subjects.none')
            : row.quarterWeightsMissing === null
              ? t('setup.subjects.none')
              : number.format(row.quarterWeightsMissing),
        sortValue: (row) => row.quarterWeightsMissing ?? -1,
        numeric: true,
      },
      {
        key: 'switches',
        header: t('setup.subjects.switches'),
        cell: (row) =>
          [
            row.groupSubject ? t('setup.subjects.groupSubject') : null,
            row.languageRule ? t('setup.subjects.languageRule') : null,
            row.demanding ? t('setup.subjects.demanding') : null,
          ]
            .filter((text): text is string => text !== null)
            .join(', '),
      },
      {
        key: 'status',
        header: t('setup.subjects.status'),
        cell: (row) =>
          row.archivedAt === null ? t('setup.subjects.active') : t('setup.subjects.archived'),
        sortValue: (row) => (row.archivedAt === null ? 0 : 1),
      },
    ];
  }, [t, language, number, departmentNames]);

  const filters = useMemo(
    (): Filter<Subject>[] => [
      {
        key: 'department',
        label: t('setup.subjects.department'),
        options: [...departmentNames].map(([id, name]) => ({ value: id, label: name })),
        matches: (row, value) => row.departmentId === value,
      },
      {
        key: 'grade',
        label: t('setup.subjects.gradeFilter'),
        options: SUBJECT_GRADES.map((grade) => ({
          value: String(grade),
          label: t('setup.subjects.grade', { grade }),
        })),
        matches: (row, value) => row.grades.includes(Number(value)),
      },
      {
        key: 'journalType',
        label: t('setup.subjects.journalType'),
        options: JOURNAL_TYPES.map((type) => ({
          value: type,
          label: t(`setup.subjects.journalTypes.${type}`),
        })),
        matches: (row, value) => row.journalType === value,
      },
      {
        key: 'status',
        label: t('setup.subjects.status'),
        options: [
          { value: 'active', label: t('setup.subjects.active') },
          { value: 'archived', label: t('setup.subjects.archived') },
        ],
        matches: (row, value) => (row.archivedAt === null ? 'active' : 'archived') === value,
      },
    ],
    [t, departmentNames],
  );

  const bulkActions = useMemo((): BulkAction<Subject>[] => {
    if (!canArchive) {
      return [];
    }
    const action = (restore: boolean): BulkAction<Subject> => ({
      key: restore ? 'restore' : 'archive',
      label: restore ? t('setup.subjects.restore') : t('setup.subjects.archive'),
      run: (rows) => {
        archiveMany.mutate({ rows, restore });
      },
      confirm: (rows) => ({
        title: t(restore ? 'setup.subjects.restoreTitle' : 'setup.subjects.archiveTitle', {
          count: rows.length,
          n: number.format(rows.length),
        }),
        text: restore ? t('setup.subjects.restoreText') : t('setup.subjects.archiveText'),
        action: restore ? t('setup.subjects.restore') : t('setup.subjects.archive'),
        destructive: !restore,
      }),
    });
    return [action(false), action(true)];
  }, [canArchive, t, number, archiveMany]);

  const open = (next: ListSearch, how: 'push' | 'replace'): void => {
    void navigate({ to: '/setup/subjects', search: next, replace: how === 'replace' });
  };

  const noDepartment = divisions.data !== undefined && choices.length === 0;
  const addButton = canCreate && !adding && (
    <span className="flex flex-wrap items-center gap-2">
      {noDepartment && (
        <span className="text-sm text-muted-foreground">{t('setup.subjects.needsDepartment')}</span>
      )}
      <Button
        disabled={divisions.data === undefined || noDepartment}
        onClick={() => {
          setAdding(true);
        }}
      >
        {t('setup.subjects.add')}
      </Button>
    </span>
  );

  return (
    <>
      <PageHeader
        title={t('setup.subjects.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={addButton === false ? undefined : addButton}
      />
      {divisions.isError && (
        <ErrorState
          error={divisions.error}
          onRetry={() => {
            void divisions.refetch();
          }}
        />
      )}
      {adding && (
        <section
          aria-label={t('setup.subjects.newTitle')}
          className="mb-6 grid max-w-2xl gap-3 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{t('setup.subjects.newTitle')}</h2>
          <SubjectForm
            subject={null}
            departments={choices}
            hasDaily={false}
            label={t('setup.subjects.newTitle')}
            onSave={async (record) => {
              await create.mutateAsync(record);
            }}
          />
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                void leave.leave().then((leaves) => {
                  if (leaves) {
                    setAdding(false);
                  }
                });
              }}
            >
              {t('setup.subjects.cancel')}
            </Button>
          </div>
        </section>
      )}
      {outcome !== null && (
        <p role="status" className="mb-3 text-sm">
          {t(outcome.restore ? 'setup.subjects.restored' : 'setup.subjects.archivedDone', {
            count: outcome.done,
            n: number.format(outcome.done),
          })}
          {outcome.taken.length > 0 && (
            <> {t('setup.subjects.takenNames', { names: outcome.taken.join(', ') })}</>
          )}
          {outcome.departmentArchived.length > 0 && (
            <>
              {' '}
              {t('setup.subjects.departmentArchivedNames', {
                names: outcome.departmentArchived.join(', '),
              })}
            </>
          )}
        </p>
      )}
      <ListPage
        listId="subjects"
        caption={t('setup.subjects.caption')}
        rows={divisions.data === undefined ? undefined : subjects.data?.subjects}
        error={subjects.error ?? archiveMany.error ?? undefined}
        onRetry={() => {
          void subjects.refetch();
        }}
        rowId={(row) => row.id}
        rowName={(row) => nameOf(row.names, language)}
        columns={columns}
        filters={filters}
        onExport={canExport ? exporter.onExport : undefined}
        exportState={exporter.state}
        search={search}
        onSearchChange={open}
        empty={{
          text: t('setup.subjects.empty'),
          action: addButton === false ? undefined : addButton,
        }}
        bulkActions={bulkActions}
        panel={(row) => (
          <SubjectPanel
            key={row.id}
            subject={row}
            departments={choices}
            departmentName={departmentNames.get(row.departmentId) ?? ''}
            canEdit={canEdit}
            canArchive={canArchive}
            mayMoveDepartment={subjects.data?.mayMoveDepartment ?? false}
          />
        )}
      />
    </>
  );
}
