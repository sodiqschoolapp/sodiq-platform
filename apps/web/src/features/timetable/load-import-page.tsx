import {
  errorCodeSchema,
  isLanguage,
  LOAD_IMPORT_PROBLEMS,
  LOAD_IMPORT_WORDS,
  PERMISSIONS,
  permits,
  STUDENT_IMPORT_TYPES,
  type LoadImportPreview,
  type LoadImportPreviewRow,
  type LoadImportProblem,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import {
  confirmLoadImport,
  downloadLoadImportTemplate,
  invalidateTimetable,
  uploadLoadImport,
  versionsQuery,
} from './timetable-api';

/** One problem of a row in words: the column's heading, then what is wrong. */
function problemText(t: TFunction, language: string, problem: LoadImportProblem): string {
  const own = LOAD_IMPORT_PROBLEMS.find((code) => code === problem.code);
  const refusal = errorCodeSchema.safeParse(problem.code);
  const text =
    own !== undefined
      ? t(`timetable.loadImport.problems.${own}`, {
          rows: (problem.rows ?? []).join(', '),
          groups: (problem.groups ?? []).join(', '),
        })
      : refusal.success
        ? t(`errors.${refusal.data}`)
        : t('timetable.loadImport.problems.invalid');
  if (problem.column === null) {
    return text;
  }
  const words = LOAD_IMPORT_WORDS[isLanguage(language) ? language : 'uz'];
  return `${words.headings[problem.column]}: ${text}`;
}

/** The cells of a row as the file has them, so the person finds it. */
const rowText = (row: LoadImportPreviewRow): string =>
  [row.cells.unit, row.cells.subject, row.cells.teacher, row.cells.lessonsPerWeek]
    .filter((one) => one !== undefined)
    .join(' · ') || '—';

/**
 * The teaching load import into a draft (task 5.13; `06`, Importing the load and the timetable),
 * for the Super Admin and the Academic Vice Principal: the template of the draft, the upload, the
 * preview of every row with its problems and warnings, and the confirm that adds every row to
 * the draft's load or none. The server checks everything; the page shows its answer.
 */
export function LoadImportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const search = useSearch({ from: '/app/timetable/load/import' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role, branchId } = useView();
  const mayImport = role !== null && permits(PERMISSIONS, role, 'timetable', 'edit');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<LoadImportPreview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const language = isLanguage(i18n.language) ? i18n.language : 'uz';
  const versions = useQuery({ ...versionsQuery(branchId), enabled: mayImport });
  const version = versions.data?.versions.find((one) => one.id === search.version);
  const versionId = version?.id ?? '';

  const columns = useMemo(
    (): Column<LoadImportPreviewRow>[] => [
      {
        key: 'row',
        header: t('people.import.row'),
        cell: (row) => row.rowNumber,
        sortValue: (row) => row.rowNumber,
        numeric: true,
        fixed: true,
      },
      {
        key: 'cells',
        header: t('timetable.loadImport.rowColumn'),
        cell: rowText,
        sortValue: rowText,
        searchText: rowText,
      },
      {
        key: 'problems',
        header: t('people.import.problemsColumn'),
        cell: (row) => (
          <div className="grid gap-1 text-sm">
            {row.problems.length === 0 ? (
              <span className="text-muted-foreground">{t('people.import.rowClean')}</span>
            ) : (
              <ul className="grid gap-1 text-destructive">
                {row.problems.map((problem, index) => (
                  <li key={`${String(problem.column)}-${String(index)}`}>
                    {problemText(t, i18n.language, problem)}
                  </li>
                ))}
              </ul>
            )}
            {row.warnings.map((warning) => (
              <span key={warning.code} className="text-muted-foreground">
                {t('timetable.loadImport.unplaced', { count: warning.count })}
              </span>
            ))}
          </div>
        ),
      },
    ],
    [t, i18n.language],
  );

  const template = useMutation({
    mutationFn: () => downloadLoadImportTemplate(versionId, language),
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadLoadImport(versionId, file),
    onSuccess: (answer) => {
      setPreview(answer);
      setSaved(null);
    },
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error('A confirm belongs to a preview.');
      return confirmLoadImport(versionId, preview.importId);
    },
    onSuccess: async (answer) => {
      if (answer.outcome === 'saved') {
        setPreview(null);
        setSaved(answer.created);
        await invalidateTimetable(queryClient);
      } else {
        setPreview(answer.preview);
      }
    },
  });

  const header = (
    <PageHeader
      title={t('timetable.loadImport.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('timetable.title'), to: '/timetable' },
        { label: t('timetable.load.title'), to: '/timetable/load' },
      ]}
    />
  );

  if (!mayImport) {
    return (
      <>
        {header}
        <EmptyState title={t('timetable.loadImport.title')} text={t('problems.noAccessPart')} />
      </>
    );
  }
  if (versions.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={versions.error}
          onRetry={() => {
            void versions.refetch();
          }}
        />
      </>
    );
  }
  if (versions.data === undefined) {
    return (
      <>
        {header}
        <LoadingOutline />
      </>
    );
  }
  if (version?.status !== 'draft') {
    return (
      <>
        {header}
        <EmptyState
          title={t('timetable.loadImport.title')}
          text={t('timetable.loadImport.noDraft')}
        />
      </>
    );
  }

  const withProblems = preview?.rows.filter((row) => row.problems.length > 0).length ?? 0;

  return (
    <>
      {header}
      <div className="grid gap-4">
        <section className={`${PANEL} grid gap-4`}>
          <p className="text-sm">{t('timetable.loadImport.intro', { number: version.number })}</p>
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
              {t('timetable.loadImport.saved', { count: saved })}{' '}
              <Link to="/timetable/load" search={{ version: versionId }} className="text-link">
                {t('timetable.loadImport.toLoad')}
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
              {t('timetable.loadImport.inDraft', { count: preview.rowsInDraft })}
            </p>
            {preview.alreadyImportedOn !== null && (
              <p className="text-sm text-destructive">
                {t('timetable.loadImport.alreadyImported', { date: preview.alreadyImportedOn })}
              </p>
            )}
            {confirm.isError && <FailureAlert error={confirm.error} />}
            <ListPage
              listId="load-import"
              caption={t('people.import.preview')}
              rows={preview.rows}
              rowId={(row) => String(row.rowNumber)}
              rowName={(row) => String(row.rowNumber)}
              columns={columns}
              search={search}
              onSearchChange={(next: ListSearch, how) => {
                void navigate({
                  to: '/timetable/load/import',
                  search: { ...next, version: versionId },
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
                {t('timetable.loadImport.confirm', { count: preview.rows.length })}
              </Button>
              {!preview.clean && (
                <span className="text-sm text-muted-foreground">
                  {t('timetable.loadImport.notClean')}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
