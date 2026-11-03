import {
  errorCodeSchema,
  isLanguage,
  PERMISSIONS,
  permits,
  STAFF_IMPORT_PROBLEMS,
  staffImportHeading,
  STUDENT_IMPORT_TYPES,
  type FirstPasswordSlip,
  type StaffImportDecisions,
  type StaffImportPreview,
  type StaffImportPreviewRow,
  type StaffImportProblem,
} from '@sodiq/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET, PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { FirstPasswordSlipCard } from './first-password-slip';
import {
  confirmStaffImport,
  downloadStaffImportTemplate,
  invalidateStaff,
  previewStaffImport,
  uploadStaffImport,
} from './people-api';

const NO_DECISIONS: StaffImportDecisions = { confirmedWarnings: [] };

/** The body attribute that prints the slips alone (index.css). */
const PRINTING = 'slip';

/** One problem of a row in words: the column's heading, then what is wrong. */
function problemText(t: TFunction, language: string, problem: StaffImportProblem): string {
  const own = STAFF_IMPORT_PROBLEMS.find((code) => code === problem.code);
  const refusal = errorCodeSchema.safeParse(problem.code);
  const holder =
    problem.left === true
      ? t('people.staffImport.holderLeft', { name: problem.staffName ?? '' })
      : problem.staffName !== undefined
        ? t('people.staffImport.holderHere', { name: problem.staffName })
        : problem.elsewhere === true
          ? t('people.staffImport.holderElsewhere')
          : null;
  const what =
    own !== undefined
      ? t(`people.staffImport.problems.${own}`, { rows: (problem.rows ?? []).join(', ') })
      : refusal.success
        ? t(`errors.${refusal.data}`)
        : t('people.staffImport.problems.invalid');
  const text = holder === null ? what : `${what} ${holder}`;
  if (problem.column === null) {
    return text;
  }
  const heading = staffImportHeading(problem.column, isLanguage(language) ? language : 'uz');
  return `${heading}: ${text}`;
}

/**
 * The slips of the accounts an import made, four to an A4 page (task 9.4h;
 * `edge/people-roles-accounts`: "printed once on per-person slips and not
 * stored"). The passwords live only in the state of the page; leaving it
 * drops them.
 */
function SlipsSheet({ slips, issued }: { slips: FirstPasswordSlip[]; issued: string }) {
  const { t } = useTranslation();
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) {
      return undefined;
    }
    document.body.dataset.printing = PRINTING;
    const done = () => {
      setPrinting(false);
    };
    window.addEventListener('afterprint', done);
    window.print();
    return () => {
      window.removeEventListener('afterprint', done);
      delete document.body.dataset.printing;
    };
  }, [printing]);

  return (
    <section className={`${PANEL} grid gap-4`} aria-labelledby="import-slips">
      <h2 id="import-slips" className={SECTION_TITLE}>
        {t('people.staffImport.slipsTitle', { count: slips.length })}
      </h2>
      <p className="text-sm">{t('people.staffImport.slipsOnce')}</p>
      <div>
        <Button
          onClick={() => {
            setPrinting(true);
          }}
        >
          {t('people.staffImport.print')}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {slips.map((slip) => (
          <FirstPasswordSlipCard key={slip.login} slip={slip} issued={issued} compact />
        ))}
      </div>
      {createPortal(
        <div data-slip-sheet="" data-four="" className="hidden">
          {slips.map((slip) => (
            <FirstPasswordSlipCard key={slip.login} slip={slip} issued={issued} compact />
          ))}
        </div>,
        document.body,
      )}
    </section>
  );
}

/**
 * The staff import (task 9.4h; `04`, Teacher and staff record: the import),
 * for the Super Admin: the template, the upload, the preview of every row
 * with its problems and warnings, the confirm that saves all rows or none,
 * and the first-password slips of the accounts made. The server checks
 * everything; the page shows its answer.
 */
export function StaffImportPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/people/staff/import' });
  const queryClient = useQueryClient();
  const { role } = useView();
  const mayImport = role !== null && permits(PERMISSIONS, role, 'staff', 'create');
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<StaffImportPreview | null>(null);
  const [decisions, setDecisions] = useState<StaffImportDecisions>(NO_DECISIONS);
  const [saved, setSaved] = useState<{
    created: number;
    slips: FirstPasswordSlip[];
    issued: string;
  } | null>(null);
  const language = isLanguage(i18n.language) ? i18n.language : 'uz';

  const template = useMutation({ mutationFn: () => downloadStaffImportTemplate(language) });
  const upload = useMutation({
    mutationFn: uploadStaffImport,
    onSuccess: (answer) => {
      setPreview(answer);
      setDecisions(NO_DECISIONS);
      setSaved(null);
    },
  });
  const decide = useMutation({
    mutationFn: (next: StaffImportDecisions) => {
      if (preview === null) throw new Error('A decision belongs to a preview.');
      return previewStaffImport(preview.importId, next);
    },
    onSuccess: (answer, next) => {
      setPreview(answer);
      setDecisions(next);
    },
  });
  // The answer holds the first passwords: no cache keeps it (`.claude/rules/web.md`, task 2.3a).
  const confirm = useMutation({
    gcTime: 0,
    mutationFn: () => {
      if (preview === null) throw new Error('A confirm belongs to a preview.');
      return confirmStaffImport(preview.importId, decisions);
    },
    onSuccess: async (answer) => {
      if (answer.outcome === 'saved') {
        setPreview(null);
        setSaved({ created: answer.created, slips: answer.slips, issued: answer.issuedOn });
        confirm.reset();
        await invalidateStaff(queryClient);
      } else {
        setPreview(answer.preview);
      }
    },
  });

  const columns = useMemo((): Column<StaffImportPreviewRow>[] => {
    const decisionsOf = (row: StaffImportPreviewRow) => {
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
                  decide.mutate({
                    confirmedWarnings: event.target.checked
                      ? [...decisions.confirmedWarnings, row.rowNumber]
                      : decisions.confirmedWarnings.filter((number) => number !== row.rowNumber),
                  });
                }}
              />
              <span className="text-sm">
                {warning.records.length > 0
                  ? t('people.staffImport.warningHere', {
                      names: warning.records
                        .map((one) =>
                          one.staffId === null ? one.name : `${one.name} (${one.staffId})`,
                        )
                        .join(', '),
                    })
                  : warning.elsewhere
                    ? t('people.staffImport.warningElsewhere')
                    : t('people.staffImport.warningRows', { rows: warning.rows.join(', ') })}
              </span>
            </label>
          )}
          {row.samePerson !== null && (
            <span className="text-sm text-muted-foreground">
              {row.samePerson.fullName === null
                ? t('people.staffImport.samePersonElsewhere')
                : t('people.staffImport.samePerson', { name: row.samePerson.fullName })}
            </span>
          )}
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
        key: 'name',
        header: t('people.import.name'),
        cell: (row) =>
          [row.lastName, row.firstName].filter((part) => part !== null).join(' ') || '—',
        sortValue: (row) => `${row.lastName ?? ''} ${row.firstName ?? ''}`,
        searchText: (row) => `${row.lastName ?? ''} ${row.firstName ?? ''}`,
      },
      {
        key: 'role',
        header: t('people.staffImport.role'),
        cell: (row) =>
          row.role === null ? t('people.staffImport.noRole') : t(`roles.${row.role}`),
        sortValue: (row) => row.role ?? '',
      },
      {
        key: 'login',
        header: t('people.account.login'),
        cell: (row) => row.login ?? '—',
        sortValue: (row) => row.login ?? '',
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
    // `decide` reads the decisions and the pending state given here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, i18n.language, decisions, decide.isPending]);

  if (!mayImport) {
    return (
      <>
        <PageHeader title={t('people.staffImport.title')} />
        <EmptyState title={t('people.staffImport.title')} text={t('problems.noAccessPart')} />
      </>
    );
  }

  const withProblems = preview?.rows.filter((row) => row.problems.length > 0).length ?? 0;

  return (
    <>
      <PageHeader
        title={t('people.staffImport.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
          { label: t('people.staff.title'), to: '/people/staff' },
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
              {t('people.staffImport.saved', { count: saved.created })}{' '}
              <Link to="/people/staff" className="text-link">
                {t('people.staffImport.toList')}
              </Link>
            </p>
          )}
        </section>
        {saved !== null && saved.slips.length > 0 && (
          <SlipsSheet slips={saved.slips} issued={saved.issued} />
        )}
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
              listId="staff-import"
              caption={t('people.import.preview')}
              rows={preview.rows}
              rowId={(row) => String(row.rowNumber)}
              rowName={(row) => String(row.rowNumber)}
              columns={columns}
              search={search}
              onSearchChange={(next: ListSearch, how) => {
                void navigate({
                  to: '/people/staff/import',
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
                {t('people.staffImport.confirm', { count: preview.rows.length })}
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
