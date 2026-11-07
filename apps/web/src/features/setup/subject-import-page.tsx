import {
  errorCodeSchema,
  isLanguage,
  PERMISSIONS,
  permits,
  STUDENT_IMPORT_TYPES,
  SUBJECT_IMPORT_PROBLEMS,
  subjectImportHeading,
  type SubjectImportPreview,
  type SubjectImportPreviewRow,
  type SubjectImportProblem,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import {
  confirmSubjectImport,
  downloadSubjectImportTemplate,
  invalidateSubjects,
  uploadSubjectImport,
} from './subjects-api';

/** One problem of a row in words: the column's heading, then what is wrong. */
function problemText(t: TFunction, language: string, problem: SubjectImportProblem): string {
  const own = SUBJECT_IMPORT_PROBLEMS.find((code) => code === problem.code);
  const refusal = errorCodeSchema.safeParse(problem.code);
  const text =
    own !== undefined
      ? t(`setup.subjectImport.problems.${own}`, { rows: (problem.rows ?? []).join(', ') })
      : refusal.success
        ? t(`errors.${refusal.data}`)
        : t('setup.subjectImport.problems.invalid');
  if (problem.column === null) {
    return text;
  }
  const heading = subjectImportHeading(problem.column, isLanguage(language) ? language : 'uz');
  return `${heading}: ${text}`;
}

/**
 * The subject import (the owner's change of 7 November 2026, #316; `05`,
 * "Excel import of subjects"), for the Super Admin and the Academic Vice
 * Principal: the template, the upload, the preview of every row with its
 * problems, and the confirm that saves all rows or none. The server checks
 * everything; the page shows its answer.
 */
export function SubjectImportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/setup/subjects/import' });
  const queryClient = useQueryClient();
  const { role } = useView();
  const mayImport =
    role !== null &&
    permits(PERMISSIONS, role, 'subjects', 'create') &&
    permits(PERMISSIONS, role, 'subjects', 'edit');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<SubjectImportPreview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const language = isLanguage(i18n.language) ? i18n.language : 'uz';

  const template = useMutation({ mutationFn: () => downloadSubjectImportTemplate(language) });
  const upload = useMutation({
    mutationFn: uploadSubjectImport,
    onSuccess: (answer) => {
      setPreview(answer);
      setSaved(null);
    },
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error('A confirm belongs to a preview.');
      return confirmSubjectImport(preview.importId);
    },
    onSuccess: async (answer) => {
      if (answer.outcome === 'saved') {
        setPreview(null);
        setSaved(answer.created);
        await invalidateSubjects(queryClient);
      } else {
        setPreview(answer.preview);
      }
    },
  });

  const columns = useMemo((): Column<SubjectImportPreviewRow>[] => {
    const nameIn = (row: SubjectImportPreviewRow) =>
      row.names[language] ?? row.names.en ?? row.names.uz ?? row.names.ru ?? '—';
    return [
      {
        key: 'row',
        header: t('people.import.row'),
        cell: (row) => row.rowNumber,
        sortValue: (row) => row.rowNumber,
        numeric: true,
        fixed: true,
      },
      {
        key: 'name',
        header: t('setup.subjectImport.name'),
        cell: nameIn,
        sortValue: nameIn,
        searchText: (row) => [row.names.uz, row.names.ru, row.names.en].join(' '),
      },
      {
        key: 'problems',
        header: t('people.import.problemsColumn'),
        cell: (row) =>
          row.problems.length === 0 ? (
            <span className="text-muted-foreground">{t('people.import.rowClean')}</span>
          ) : (
            <ul className="grid gap-1 text-sm text-destructive">
              {row.problems.map((problem, index) => (
                <li key={`${String(problem.column)}-${String(index)}`}>
                  {problemText(t, i18n.language, problem)}
                </li>
              ))}
            </ul>
          ),
      },
    ];
  }, [t, i18n.language, language]);

  if (!mayImport) {
    return (
      <>
        <PageHeader title={t('setup.subjectImport.title')} />
        <EmptyState title={t('setup.subjectImport.title')} text={t('problems.noAccessPart')} />
      </>
    );
  }

  const withProblems = preview?.rows.filter((row) => row.problems.length > 0).length ?? 0;

  return (
    <>
      <PageHeader
        title={t('setup.subjectImport.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
          { label: t('setup.subjects.title'), to: '/setup/subjects' },
        ]}
      />
      <div className="grid gap-4">
        <section className={`${PANEL} grid gap-4`}>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={template.isPending}
              onClick={() => {
                template.mutate();
              }}
            >
              {t('people.import.template')}
            </Button>
            <input
              ref={input}
              type="file"
              className="hidden"
              accept={['.xlsx', ...STUDENT_IMPORT_TYPES].join(',')}
              aria-label={t('people.import.upload')}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen !== undefined) upload.mutate(chosen);
                event.target.value = '';
              }}
            />
            <Button
              disabled={upload.isPending}
              onClick={() => {
                input.current?.click();
              }}
            >
              {upload.isPending ? t('people.import.reading') : t('people.import.upload')}
            </Button>
          </div>
          {template.isError && <FailureAlert error={template.error} />}
          {upload.isError && <FailureAlert error={upload.error} />}
          {saved !== null && (
            <p role="status" className="text-sm">
              {t('setup.subjectImport.saved', { count: saved })}{' '}
              <Link to="/setup/subjects" className="text-link">
                {t('setup.subjectImport.toList')}
              </Link>
            </p>
          )}
        </section>
        {preview !== null && (
          <section className={`${PANEL} grid gap-4`} aria-labelledby="import-preview">
            <h2 id="import-preview" className={SECTION_TITLE}>
              {t('people.import.preview')}
            </h2>
            <p role="status" className="text-sm">
              {t('people.import.counts', {
                count: preview.rows.length,
                problems: withProblems,
              })}{' '}
              {preview.quarterCount === 0
                ? t('setup.subjectImport.noQuarters')
                : t('setup.subjectImport.quarters', { count: preview.quarterCount })}
            </p>
            {preview.alreadyImportedOn !== null && (
              <p className="text-sm text-destructive">
                {t('people.import.alreadyImported', { date: preview.alreadyImportedOn })}
              </p>
            )}
            {confirm.isError && <FailureAlert error={confirm.error} />}
            <ListPage
              listId="subject-import"
              caption={t('people.import.preview')}
              rows={preview.rows}
              rowId={(row) => String(row.rowNumber)}
              rowName={(row) => String(row.rowNumber)}
              columns={columns}
              search={search}
              onSearchChange={(next: ListSearch, how) => {
                void navigate({
                  to: '/setup/subjects/import',
                  search: next,
                  replace: how === 'replace',
                });
              }}
              empty={{ title: t('people.import.preview'), text: t('people.import.emptyFile') }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!preview.clean || confirm.isPending}
                onClick={() => {
                  confirm.mutate();
                }}
              >
                {t('setup.subjectImport.confirm', { count: preview.rows.length })}
              </Button>
              {!preview.clean && (
                <span className="text-sm text-muted-foreground">
                  {t('setup.subjectImport.notClean')}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
