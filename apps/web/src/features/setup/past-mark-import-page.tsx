import {
  isLanguage,
  PAST_MARK_HEADINGS,
  PERMISSIONS,
  permits,
  STUDENT_IMPORT_TYPES,
  type PastMarkPreview,
  type PastMarkPreviewRow,
  type PastMarkProblem,
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
  confirmPastMarks,
  downloadPastMarkTemplate,
  pastMarkUploadsKey,
  previewPastMarks,
  uploadPastMarks,
} from './past-marks-api';

/** One problem of a row in words: the column's heading, then what is wrong. */
export function pastMarkProblemText(
  t: TFunction,
  language: string,
  problem: PastMarkProblem,
): string {
  const text = t(`setup.pastMarks.problems.${problem.code}`, {
    rows: (problem.rows ?? []).join(', '),
  });
  if (problem.column === null) return text;
  return `${PAST_MARK_HEADINGS[isLanguage(language) ? language : 'uz'][problem.column]}: ${text}`;
}

/**
 * The import of past marks from before go-live (task 11.26; `10`, Past marks from before
 * go-live, The upload), for the Super Admin and the Academic Vice Principal: the template, the
 * upload, the preview of every row with its problems, a page at a time, and the confirm that
 * saves all rows or none. The server checks everything; the page shows its answer.
 */
export function PastMarkImportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/setup/past-marks/import' });
  const queryClient = useQueryClient();
  const { role, branchId } = useView();
  const mayImport = role !== null && permits(PERMISSIONS, role, 'past_marks', 'create');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PastMarkPreview | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const language = isLanguage(i18n.language) ? i18n.language : 'uz';

  const template = useMutation({ mutationFn: () => downloadPastMarkTemplate(language) });
  const upload = useMutation({
    mutationFn: uploadPastMarks,
    onSuccess: (answer) => {
      setPreview(answer);
      setSaved(null);
    },
  });
  const page = useMutation({
    mutationFn: (next: number) => {
      if (preview === null) throw new Error('A page belongs to a preview.');
      return previewPastMarks(preview.importId, next);
    },
    onSuccess: setPreview,
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error('A confirm belongs to a preview.');
      return confirmPastMarks(preview.importId);
    },
    onSuccess: async (answer) => {
      if (answer.outcome === 'saved') {
        setPreview(null);
        setSaved(answer.rows);
        await queryClient.invalidateQueries({ queryKey: pastMarkUploadsKey(branchId) });
      } else {
        setPreview(answer.preview);
      }
    },
  });

  const columns = useMemo(
    (): Column<PastMarkPreviewRow>[] => [
      {
        key: 'row',
        header: t('people.import.row'),
        cell: (row) => row.rowNumber,
        sortValue: (row) => row.rowNumber,
        numeric: true,
        fixed: true,
      },
      {
        key: 'student',
        header: t('setup.pastMarks.student'),
        cell: (row) => [row.uid, row.name].filter((one) => one !== null).join(' · ') || '—',
        searchText: (row) => [row.uid ?? '', row.name ?? ''].join(' '),
      },
      {
        key: 'date',
        header: t('setup.pastMarks.date'),
        cell: (row) => row.date ?? '—',
        sortValue: (row) => row.date ?? '',
      },
      {
        key: 'subject',
        header: t('setup.pastMarks.subject'),
        cell: (row) => row.subject ?? '—',
        sortValue: (row) => row.subject ?? '',
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
                  {pastMarkProblemText(t, i18n.language, problem)}
                </li>
              ))}
            </ul>
          ),
      },
    ],
    [t, i18n.language],
  );

  if (!mayImport) {
    return (
      <>
        <PageHeader title={t('setup.pastMarks.importTitle')} />
        <EmptyState title={t('setup.pastMarks.importTitle')} text={t('problems.noAccessPart')} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('setup.pastMarks.importTitle')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
          { label: t('setup.pastMarks.title'), to: '/setup/past-marks' },
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
              {t('setup.pastMarks.saved', { count: saved })}{' '}
              <Link to="/setup/past-marks" className="text-link">
                {t('setup.pastMarks.toList')}
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
                count: preview.counts.rows,
                problems: preview.counts.withProblems,
              })}
            </p>
            {preview.alreadyImportedOn !== null && (
              <p className="text-sm text-destructive">
                {t('people.import.alreadyImported', { date: preview.alreadyImportedOn })}
              </p>
            )}
            {(confirm.isError || page.isError) && (
              <FailureAlert error={confirm.isError ? confirm.error : page.error} />
            )}
            <ListPage
              listId="past-mark-import"
              caption={t('people.import.preview')}
              rows={preview.rows}
              rowId={(row) => String(row.rowNumber)}
              rowName={(row) => String(row.rowNumber)}
              columns={columns}
              search={search}
              onSearchChange={(next: ListSearch, how) => {
                void navigate({
                  to: '/setup/past-marks/import',
                  search: next,
                  replace: how === 'replace',
                });
              }}
              empty={{ title: t('people.import.preview'), text: t('people.import.emptyFile') }}
            />
            {preview.pageCount > 1 && (
              <nav
                aria-label={t('setup.pastMarks.pages')}
                className="flex flex-wrap items-center gap-3 text-sm"
              >
                <Button
                  variant="secondary"
                  disabled={preview.page <= 1 || page.isPending}
                  onClick={() => {
                    page.mutate(preview.page - 1);
                  }}
                >
                  {t('setup.pastMarks.previous')}
                </Button>
                <span>
                  {t('setup.pastMarks.page', { page: preview.page, count: preview.pageCount })}
                </span>
                <Button
                  variant="secondary"
                  disabled={preview.page >= preview.pageCount || page.isPending}
                  onClick={() => {
                    page.mutate(preview.page + 1);
                  }}
                >
                  {t('setup.pastMarks.next')}
                </Button>
              </nav>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!preview.clean || confirm.isPending}
                onClick={() => {
                  confirm.mutate();
                }}
              >
                {t('setup.pastMarks.confirm', { count: preview.counts.rows })}
              </Button>
              {!preview.clean && (
                <span className="text-sm text-muted-foreground">
                  {t('setup.pastMarks.notClean')}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
