import {
  errorCodeSchema,
  importHeading,
  isLanguage,
  PERMISSIONS,
  permits,
  STUDENT_IMPORT_PROBLEMS,
  STUDENT_IMPORT_TYPES,
  type StudentImportDecisions,
  type StudentImportPreview,
  type StudentImportPreviewRow,
  type StudentImportProblem,
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
import { CHECKBOX, CHECKBOX_TARGET, PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import {
  confirmImport,
  downloadImportTemplate,
  invalidateStudents,
  previewImport,
  uploadImport,
} from './people-api';

const NO_DECISIONS: StudentImportDecisions = { confirmedWarnings: [], relativeLinks: [] };

/** One problem of a row in words: the column's heading, then what is wrong. */
function problemText(t: TFunction, language: string, problem: StudentImportProblem): string {
  const own = STUDENT_IMPORT_PROBLEMS.find((code) => code === problem.code);
  const refusal = errorCodeSchema.safeParse(problem.code);
  const found =
    own !== undefined
      ? t(`people.import.problems.${own}`, { rows: (problem.rows ?? []).join(', ') })
      : problem.elsewhere === true
        ? t('people.import.heldElsewhere')
        : refusal.success
          ? t(`errors.${refusal.data}`)
          : t('people.import.problems.invalid');
  // A group problem names its subject (the required group has no column of its own).
  const subject = problem.subject?.[isLanguage(language) ? language : 'uz'];
  const what =
    subject === undefined
      ? found
      : t('people.import.problems.groupSubject', { text: found, subject });
  if (problem.column === null) {
    return what;
  }
  const heading = importHeading(problem.column, isLanguage(language) ? language : 'uz');
  return `${heading}: ${what}`;
}

/**
 * The student import (task 9.4g; `04`, Student record: Excel import): the
 * template, the upload, the preview of every row with its problems and the
 * decisions it asks for, and the confirm that saves all rows or none. The
 * server checks everything; the page shows its answer.
 */
export function StudentImportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/people/students/import' });
  const queryClient = useQueryClient();
  const { role } = useView();
  const mayImport = role !== null && permits(PERMISSIONS, role, 'students', 'create');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<StudentImportPreview | null>(null);
  const [decisions, setDecisions] = useState<StudentImportDecisions>(NO_DECISIONS);
  const [saved, setSaved] = useState<number | null>(null);
  const language = isLanguage(i18n.language) ? i18n.language : 'uz';

  const template = useMutation({ mutationFn: () => downloadImportTemplate(language) });
  const upload = useMutation({
    mutationFn: uploadImport,
    onSuccess: (answer) => {
      setPreview(answer);
      setDecisions(NO_DECISIONS);
      setSaved(null);
    },
  });
  const decide = useMutation({
    mutationFn: (next: StudentImportDecisions) => {
      if (preview === null) throw new Error('A decision belongs to a preview.');
      return previewImport(preview.importId, next);
    },
    onSuccess: (answer, next) => {
      setPreview(answer);
      setDecisions(next);
    },
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (preview === null) throw new Error('A confirm belongs to a preview.');
      return confirmImport(preview.importId, decisions);
    },
    onSuccess: async (answer) => {
      if (answer.outcome === 'saved') {
        setPreview(null);
        setSaved(answer.created);
        await invalidateStudents(queryClient);
      } else {
        setPreview(answer.preview);
      }
    },
  });

  const change = (next: StudentImportDecisions) => {
    decide.mutate(next);
  };

  const columns = useMemo((): Column<StudentImportPreviewRow>[] => {
    const decisionsOf = (row: StudentImportPreviewRow) => {
      const warning = row.warning;
      return (
        <div className="grid gap-2">
          {warning !== null && (
            <label className={CHECKBOX_TARGET}>
              <input
                type="checkbox"
                className={CHECKBOX}
                checked={decisions.confirmedWarnings.includes(row.rowNumber)}
                disabled={decide.isPending}
                onChange={(event) => {
                  change({
                    ...decisions,
                    confirmedWarnings: event.target.checked
                      ? [...decisions.confirmedWarnings, row.rowNumber]
                      : decisions.confirmedWarnings.filter((number) => number !== row.rowNumber),
                  });
                }}
              />
              <span className="text-sm">
                {warning.students.length > 0
                  ? t('people.import.warningHere', {
                      uids: warning.students.map((one) => one.uid).join(', '),
                    })
                  : warning.elsewhere
                    ? t('people.import.warningElsewhere')
                    : t('people.import.warningRows', { rows: warning.rows.join(', ') })}
              </span>
            </label>
          )}
          {row.held.map((one) => {
            const relativeId = one.holder.id;
            return (
              <label key={one.position} className={CHECKBOX_TARGET}>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={one.linked}
                  disabled={decide.isPending || relativeId === null}
                  onChange={(event) => {
                    const others = decisions.relativeLinks.filter(
                      (link) => link.rowNumber !== row.rowNumber || link.position !== one.position,
                    );
                    change({
                      ...decisions,
                      relativeLinks:
                        event.target.checked && relativeId !== null
                          ? [
                              ...others,
                              { rowNumber: row.rowNumber, position: one.position, relativeId },
                            ]
                          : others,
                    });
                  }}
                />
                <span className="text-sm">
                  {t('people.import.linkTo', {
                    position: one.position,
                    name: one.holder.fullName,
                  })}
                </span>
              </label>
            );
          })}
        </div>
      );
    };
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
        key: 'uid',
        header: t('people.students.uid'),
        cell: (row) => row.uid ?? '—',
        sortValue: (row) => row.uid ?? '',
        searchText: (row) => row.uid ?? '',
      },
      {
        key: 'name',
        header: t('people.import.name'),
        cell: (row) =>
          [row.lastName, row.firstName].filter((part) => part !== null).join(' ') || '—',
        sortValue: (row) => `${row.lastName ?? ''} ${row.firstName ?? ''}`,
        searchText: (row) => `${row.lastName ?? ''} ${row.firstName ?? ''}`,
      },
      {
        key: 'class',
        header: t('people.students.class'),
        cell: (row) => row.className ?? '—',
        sortValue: (row) => row.className ?? '',
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
      {
        key: 'decisions',
        header: t('people.import.decisions'),
        cell: decisionsOf,
      },
    ];
    // `change` reads the decisions and the pending state given here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n.language, decisions, decide.isPending]);

  if (!mayImport) {
    return (
      <>
        <PageHeader title={t('people.import.title')} />
        <EmptyState title={t('people.import.title')} text={t('problems.noAccessPart')} />
      </>
    );
  }

  const withProblems = preview?.rows.filter((row) => row.problems.length > 0).length ?? 0;

  return (
    <>
      <PageHeader
        title={t('people.import.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
          { label: t('people.students.title'), to: '/people/students' },
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
              {t('people.import.saved', { count: saved })}{' '}
              <Link to="/people/students" className="text-link">
                {t('people.import.toList')}
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
              })}
            </p>
            {preview.alreadyImportedOn !== null && (
              <p className="text-sm text-destructive">
                {t('people.import.alreadyImported', { date: preview.alreadyImportedOn })}
              </p>
            )}
            {decide.isError && <FailureAlert error={decide.error} />}
            {confirm.isError && <FailureAlert error={confirm.error} />}
            <ListPage
              listId="student-import"
              caption={t('people.import.preview')}
              rows={preview.rows}
              rowId={(row) => String(row.rowNumber)}
              rowName={(row) => String(row.rowNumber)}
              columns={columns}
              search={search}
              onSearchChange={(next: ListSearch, how) => {
                void navigate({
                  to: '/people/students/import',
                  search: next,
                  replace: how === 'replace',
                });
              }}
              empty={{ title: t('people.import.preview'), text: t('people.import.emptyFile') }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!preview.clean || confirm.isPending || decide.isPending}
                onClick={() => {
                  confirm.mutate();
                }}
              >
                {t('people.import.confirm', { count: preview.rows.length })}
              </Button>
              {!preview.clean && (
                <span className="text-sm text-muted-foreground">{t('people.import.notClean')}</span>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
