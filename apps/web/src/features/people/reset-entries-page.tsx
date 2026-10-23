import { listName, type Reset } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { DateField } from '@/components/field';
import { listSearch, type ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { formatMoment, schoolDateText } from '@/lib/dates';
import {
  accountText,
  cellChangeText,
  cellKindText,
  cellLessonText,
  workLineText,
} from './cell-lines';
import { resetEntriesQuery } from './people-api';
import { PeopleTabs } from './people-tabs';

/** The dates of the page's address, as the server reads them. */
export type ResetEntriesSearch = ListSearch & { from?: string; to?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `validateSearch` of the page: school dates only. */
export function resetEntriesSearch(search: Record<string, unknown>): ResetEntriesSearch {
  const result: ResetEntriesSearch = listSearch(search);
  for (const key of ['from', 'to'] as const) {
    const value = search[key];
    if (typeof value === 'string' && DATE.test(value)) result[key] = value;
  }
  return result;
}

/** One reset: who, how, by whom and when, with the entries of its 48 hours. */
function ResetCard({ reset }: { reset: Reset }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const empty = t('people.report.empty');
  return (
    <section className={`${PANEL} grid gap-3`} aria-label={accountText(reset.person, empty)}>
      <div className="grid gap-1">
        <h2 className={SECTION_TITLE}>
          {accountText(reset.person, empty)}
          {reset.person.login !== null && reset.person.name !== null && (
            <span className="font-normal text-muted-foreground"> · {reset.person.login}</span>
          )}
        </h2>
        <p className="text-sm">
          {[
            t(`people.resetEntries.kinds.${reset.kind}`),
            formatMoment(language, reset.at),
            reset.by === null
              ? null
              : t('people.resetEntries.by', { name: accountText(reset.by, empty) }),
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
        {reset.emailChangedBy !== null && (
          <p className="text-sm font-semibold" data-email-changed="">
            {t('people.resetEntries.emailChanged', {
              name: accountText(reset.emailChangedBy, empty),
              moment: formatMoment(language, reset.emailChangedBy.at),
            })}
          </p>
        )}
      </div>
      {reset.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('people.resetEntries.noEntries')}</p>
      ) : (
        <Table>
          <TableCaption className="sr-only">{t('people.resetEntries.caption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('people.resetEntries.moment')}</TableHead>
              <TableHead>{t('people.resetEntries.lesson')}</TableHead>
              <TableHead>{t('people.resetEntries.student')}</TableHead>
              <TableHead>{t('people.resetEntries.cell')}</TableHead>
              <TableHead>{t('people.resetEntries.change')}</TableHead>
              <TableHead>{t('people.resetEntries.how')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reset.entries.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{formatMoment(language, line.changedAt)}</TableCell>
                <TableCell>
                  {cellLessonText(t, language, line.lesson, (date) =>
                    schoolDateText(date, language),
                  )}
                </TableCell>
                <TableCell>
                  {line.student === null
                    ? empty
                    : [listName(line.student), line.student.uid].join(' · ')}
                </TableCell>
                <TableCell>{cellKindText(t, line)}</TableCell>
                <TableCell>{cellChangeText(t, line)}</TableCell>
                <TableCell>{t(`journal.changes.${line.changedHow}`)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {/* Task 8.1: the totals and "not held" marks the account set in the 48 hours. */}
      {reset.workEntries.length > 0 && (
        <Table data-work-entries="true">
          <TableCaption className="sr-only">{t('people.resetEntries.workCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('people.resetEntries.moment')}</TableHead>
              <TableHead>{t('people.resetEntries.lesson')}</TableHead>
              <TableHead>{t('people.resetEntries.change')}</TableHead>
              <TableHead>{t('people.resetEntries.how')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reset.workEntries.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{formatMoment(language, line.changedAt)}</TableCell>
                <TableCell>
                  {cellLessonText(t, language, line.lesson, (date) =>
                    schoolDateText(date, language),
                  )}
                </TableCell>
                <TableCell>{workLineText(t, line)}</TableCell>
                <TableCell>{t(`journal.works.changes.${line.changedHow}`)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/**
 * Entries after a reset (task 6.1c, pull request #209; edge cases, Accounts
 * and sign-in: "A report lists entries made within 48 hours of a reset ... A
 * password reset by email that follows a change of the email by somebody else
 * is listed in the same report"): the password resets of the branch's
 * accounts in the dates chosen, newest first, each with the journal entries
 * the account made in the branch within 48 hours. For the readers of
 * `account_access` (decision 5); no export (decision 9).
 */
export function ResetEntriesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search: ResetEntriesSearch = useSearch({ from: '/app/people/reset-entries' });
  const { branchId } = useView();
  const report = useQuery(resetEntriesQuery(branchId, search));

  const setRange = (next: ResetEntriesSearch): void => {
    void navigate({
      to: '/people/reset-entries',
      search: { ...search, ...next },
      replace: true,
    });
  };

  return (
    <>
      <PageHeader
        title={t('people.resetEntries.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('people.title'), to: '/people' },
        ]}
      />
      <PeopleTabs current="reset-entries" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <DateField
          label={t('people.resetEntries.from')}
          value={search.from ?? report.data?.from ?? ''}
          onChange={(event) => {
            setRange({ from: event.target.value || undefined });
          }}
        />
        <DateField
          label={t('people.resetEntries.to')}
          value={search.to ?? report.data?.to ?? ''}
          onChange={(event) => {
            setRange({ to: event.target.value || undefined });
          }}
        />
      </div>
      {report.error !== null ? (
        <ErrorState
          error={report.error}
          onRetry={() => {
            void report.refetch();
          }}
        />
      ) : report.data === undefined ? (
        <LoadingOutline />
      ) : report.data.resets.length === 0 ? (
        <EmptyState
          title={t('people.resetEntries.emptyTitle')}
          text={t('people.resetEntries.empty')}
        />
      ) : (
        <div className="grid gap-4">
          {report.data.resets.map((reset) => (
            <ResetCard key={reset.id} reset={reset} />
          ))}
        </div>
      )}
    </>
  );
}
