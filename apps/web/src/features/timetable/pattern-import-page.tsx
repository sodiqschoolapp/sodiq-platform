import {
  errorCodeSchema,
  isLanguage,
  PATTERN_IMPORT_PROBLEMS,
  PATTERN_IMPORT_WORDS,
  PERMISSIONS,
  permits,
  STUDENT_IMPORT_TYPES,
  type PatternImportPreview,
  type PatternImportPreviewRow,
  type PatternImportProblem,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { schoolDateText } from '@/lib/dates';
import { ruleText } from './rule-text';
import {
  confirmPatternImport,
  downloadPatternImportTemplate,
  invalidateTimetable,
  uploadPatternImport,
  versionsQuery,
} from './timetable-api';

/** One problem of a row in words: the column's heading, then what is wrong. */
function problemText(t: TFunction, language: string, problem: PatternImportProblem): string {
  const own = PATTERN_IMPORT_PROBLEMS.find((code) => code === problem.code);
  const refusal = errorCodeSchema.safeParse(problem.code);
  const rows = (problem.rows ?? []).join(', ');
  const text =
    own !== undefined
      ? t(`timetable.patternImport.problems.${own}`, {
          rows,
          units: (problem.units ?? []).join(', '),
          teacher: problem.teacher ?? '',
        })
      : refusal.success
        ? t(`errors.${refusal.data}`)
        : rows === ''
          ? ruleText(t, problem.code)
          : t('timetable.patternImport.ruleWith', { rule: ruleText(t, problem.code), rows });
  if (problem.column === null) {
    return text;
  }
  const words = PATTERN_IMPORT_WORDS[isLanguage(language) ? language : 'uz'];
  return `${words.headings[problem.column]}: ${text}`;
}

/** The cells of a row as the file has them, so the person finds it. */
const rowText = (row: PatternImportPreviewRow): string =>
  [
    row.cells.weekday,
    row.cells.lessonNumber,
    row.cells.unit,
    row.cells.subject,
    row.cells.teacher,
    row.cells.room,
  ]
    .filter((one) => one !== undefined)
    .join(' · ') || '—';

/**
 * The timetable import into a draft (task 5.14; `06`, Importing the load and the timetable), for
 * the Super Admin and the Academic Vice Principal: the template of the draft, the upload, the
 * preview of every row with its problems and the rule engine's warnings, and the confirm that,
 * after the person agrees to remove the draft's lessons, replaces them with the file's, all or
 * none. The server checks everything; the page shows its answer.
 */
export function PatternImportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const search = useSearch({ from: '/app/timetable/pattern/import' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ask = useConfirm();
  const { role, branchId } = useView();
  const mayImport = role !== null && permits(PERMISSIONS, role, 'timetable', 'edit');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PatternImportPreview | null>(null);
  const [saved, setSaved] = useState<{ removed: number; placed: number } | null>(null);
  const language = isLanguage(i18n.language) ? i18n.language : 'uz';
  const versions = useQuery({ ...versionsQuery(branchId), enabled: mayImport });
  const version = versions.data?.versions.find((one) => one.id === search.version);
  const versionId = version?.id ?? '';

  const columns = useMemo(
    (): Column<PatternImportPreviewRow>[] => [
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
        header: t('timetable.patternImport.rowColumn'),
        cell: rowText,
        sortValue: rowText,
        searchText: rowText,
      },
      {
        key: 'problems',
        header: t('people.import.problemsColumn'),
        cell: (row) =>
          row.problems.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('people.import.rowClean')}</span>
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
    ],
    [t, i18n.language],
  );

  const template = useMutation({
    mutationFn: () => downloadPatternImportTemplate(versionId, language),
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadPatternImport(versionId, file),
    onSuccess: (answer) => {
      setPreview(answer);
      setSaved(null);
    },
  });
  const confirm = useMutation({
    mutationFn: (chosen: PatternImportPreview) =>
      confirmPatternImport(versionId, chosen.importId, chosen.removes),
    onSuccess: async (answer) => {
      if (answer.outcome === 'saved') {
        setPreview(null);
        setSaved({ removed: answer.removed, placed: answer.placed });
        await invalidateTimetable(queryClient);
      } else {
        setPreview(answer.preview);
      }
    },
  });

  const header = (
    <PageHeader
      title={t('timetable.patternImport.title')}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('timetable.title'), to: '/timetable' },
        { label: t('timetable.builderLink'), to: '/timetable/builder' },
      ]}
    />
  );

  if (!mayImport) {
    return (
      <>
        {header}
        <EmptyState title={t('timetable.patternImport.title')} text={t('problems.noAccessPart')} />
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
          title={t('timetable.patternImport.title')}
          text={t('timetable.patternImport.noDraft')}
        />
      </>
    );
  }

  const withProblems = preview?.rows.filter((row) => row.problems.length > 0).length ?? 0;

  const onConfirm = async (chosen: PatternImportPreview) => {
    const removes = chosen.removes.length;
    const goOn =
      removes === 0 ||
      (await ask({
        title: t('timetable.patternImport.replaceTitle', { count: removes }),
        text: t('timetable.patternImport.replaceText', { count: chosen.lessons }),
        action: t('timetable.patternImport.replaceAction'),
        destructive: true,
      }));
    if (goOn) confirm.mutate(chosen);
  };

  return (
    <>
      {header}
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
              {t('timetable.patternImport.saved', { count: saved.placed })}{' '}
              {saved.removed > 0 && t('timetable.patternImport.removed', { count: saved.removed })}{' '}
              <Link
                to="/timetable/builder"
                search={{ version: versionId, step: 'grid' }}
                className="text-link"
              >
                {t('timetable.patternImport.toGrid')}
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
              {t('timetable.patternImport.inDraft', { count: preview.removes.length })}
            </p>
            {preview.alreadyImportedOn !== null && (
              <p className="text-sm text-destructive">
                {t('timetable.patternImport.alreadyImported', {
                  date: schoolDateText(preview.alreadyImportedOn, language),
                })}
              </p>
            )}
            {confirm.isError && <FailureAlert error={confirm.error} />}
            <ListPage
              listId="pattern-import"
              caption={t('people.import.preview')}
              rows={preview.rows}
              rowId={(row) => String(row.rowNumber)}
              rowName={(row) => String(row.rowNumber)}
              columns={columns}
              search={search}
              onSearchChange={(next: ListSearch, how) => {
                void navigate({
                  to: '/timetable/pattern/import',
                  search: { ...next, version: versionId },
                  replace: how === 'replace',
                });
              }}
              empty={{ title: t('people.import.preview'), text: t('people.import.emptyFile') }}
            />
            {preview.warnings.length > 0 && (
              <div className="grid gap-2">
                <h4 className={SUBSECTION_TITLE}>{t('timetable.patternImport.warnings')}</h4>
                <ul className="grid gap-1 text-sm text-muted-foreground">
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.rule}-${String(index)}`}>
                      {warning.rows.length === 0
                        ? ruleText(t, warning.rule)
                        : t('timetable.patternImport.warningRows', {
                            rule: ruleText(t, warning.rule),
                            rows: warning.rows.join(', '),
                          })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!preview.clean || confirm.isPending}
                onClick={() => {
                  void onConfirm(preview);
                }}
              >
                {t('timetable.patternImport.confirm', { count: preview.lessons })}
              </Button>
              {!preview.clean && (
                <span className="text-sm text-muted-foreground">
                  {t('timetable.patternImport.notClean')}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
