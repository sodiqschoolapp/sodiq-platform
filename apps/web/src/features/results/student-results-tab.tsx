import type { QuarterOutcomeShown, ResultSubjectQuarter, StudentResults } from '@sodiq/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { schoolDateText } from '@/lib/dates';
import { ResultLessonsDialog, type TracedPart } from './result-lessons-dialog';
import { studentResultsQuery } from './results-api';

/** The year of the selector: the current one unless the person chose another. */
export function YearSelect({
  years,
  value,
  onChange,
}: {
  years: StudentResults['years'];
  value: string | undefined;
  onChange: (id: string) => void;
}): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (years.length < 2) return null;
  return (
    <label className="grid gap-1 text-sm">
      <span>{t('results.year')}</span>
      <Select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {years.map((year) => (
          <option key={year.id} value={year.id}>
            {t('results.yearOption', {
              from: schoolDateText(year.startDate, i18n.language),
              to: schoolDateText(year.endDate, i18n.language),
            })}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** The quarter chosen, falling back to the latest quarter that has a figure. */
export function useQuarterChoice(
  quarters: readonly { id: string; number: number }[],
  withFigures: ReadonlySet<string>,
): [string | undefined, (id: string) => void] {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const offered = quarters.some((one) => one.id === chosen) ? chosen : undefined;
  const latest = [...quarters].reverse().find((one) => withFigures.has(one.id))?.id;
  return [offered ?? latest ?? quarters[0]?.id, setChosen];
}

/** The labels of a quarter's outcome (`studentQuarterOutcome`, From 4.3). */
function labelsOf(row: ResultSubjectQuarter, t: TFunction, language: string): string[] {
  const { outcome } = row;
  const labels: string[] = [];
  if (outcome.kind === 'number') {
    if (outcome.provisional) labels.push(t('results.labels.provisional'));
    if (outcome.leftOut.length > 0) {
      labels.push(
        t('results.labels.leftOut', {
          parts: outcome.leftOut.map((part) => t(`results.parts.${part}`)).join(', '),
        }),
      );
    }
    for (const flag of outcome.flags) labels.push(t(`results.flags.${flag}`));
    if (outcome.flags.includes('few_lessons') || row.atLeaving !== null) {
      labels.push(
        t('journal.grid.basedOn', { expected: row.basedOn.expected, held: row.basedOn.held }),
      );
    }
  }
  if (row.countsFrom !== null) {
    labels.push(t('results.labels.countsFrom', { date: schoolDateText(row.countsFrom, language) }));
  }
  if (row.leftSubjectOn !== null) {
    labels.push(
      t('results.labels.leftSubjectOn', { date: schoolDateText(row.leftSubjectOn, language) }),
    );
  }
  if (row.atLeaving !== null) {
    labels.push(t('results.labels.atLeaving', { date: schoolDateText(row.atLeaving, language) }));
  }
  return labels;
}

function outcomeText(outcome: QuarterOutcomeShown, t: TFunction) {
  switch (outcome.kind) {
    case 'number':
      return String(outcome.shown);
    case 'exempt':
      return t('journal.grid.exemptResult');
    case 'not_assessed':
      return t('results.notAssessed');
    default:
      return t('journal.grid.noResult');
  }
}

/** A figure that opens the lessons behind it (`08`: "Clicking a figure opens the lessons behind it"). */
function Figure({
  value,
  label,
  onOpen,
}: {
  value: string;
  label: string;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className="text-link tabular-nums" aria-label={label} onClick={onOpen}>
      {value}
    </button>
  );
}

/**
 * The Results tab of a student's profile (task 9.1; `08`, Student results; `04`,
 * Profile tabs): for the quarter chosen, each graded subject the reader reads with
 * its attendance, classwork and homework averages, rating exam, quarter result and
 * grade, as the server gives them; the year result once it is shown.
 */
export function StudentResultsTab({ studentId }: { studentId: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const results = useQuery(studentResultsQuery(branchId, studentId, yearId));
  const withFigures = new Set(
    results.data?.subjects.flatMap((one) => one.quarters.map((row) => row.quarterId)) ?? [],
  );
  const [quarterId, setQuarterId] = useQuarterChoice(results.data?.quarters ?? [], withFigures);
  const [traced, setTraced] = useState<{
    subjectId: string;
    quarterId: string;
    part: TracedPart;
  } | null>(null);
  if (results.isError) {
    return <ErrorState error={results.error} onRetry={() => void results.refetch()} />;
  }
  if (results.data === undefined) return <LoadingOutline />;
  const answer = results.data;
  if (answer.year === null) {
    return <EmptyState text={t('results.noYear')} />;
  }
  const quarter = answer.quarters.find((one) => one.id === quarterId);
  const rows = answer.subjects.flatMap((one) => {
    const row = one.quarters.find((found) => found.quarterId === quarterId);
    return row === undefined ? [] : [{ subject: one.subject, row }];
  });
  const years = answer.subjects.filter((one) => one.year !== null);
  return (
    <div className="grid gap-4" data-student-results="true">
      <YearSelect years={answer.years} value={answer.year.id} onChange={setYearId} />
      {answer.quarters.length > 0 && (
        <Segmented
          label={t('results.quarter')}
          options={answer.quarters.map((one) => ({
            value: one.id,
            label: t('results.quarterNumber', { number: one.number }),
          }))}
          value={quarterId ?? ''}
          onChange={setQuarterId}
        />
      )}
      {quarter?.notInSystem === true ? (
        <p className="text-sm text-muted-foreground" data-not-in-system="true">
          {t('results.notInSystem')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('results.emptyQuarter')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('results.columns.subject')}</TableHead>
              <TableHead>{t('results.columns.attendance')}</TableHead>
              <TableHead>{t('results.columns.classwork')}</TableHead>
              <TableHead>{t('results.columns.homework')}</TableHead>
              <TableHead>{t('results.columns.ratingExam')}</TableHead>
              <TableHead>{t('results.columns.result')}</TableHead>
              <TableHead>{t('results.columns.grade')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ subject, row }) => {
              const name = nameOf(subject.names, language);
              const open = (part: TracedPart) => () =>
                setTraced({ subjectId: subject.id, quarterId: row.quarterId, part });
              const figure = (part: TracedPart, value: number | null) =>
                value === null ? (
                  t('results.none')
                ) : (
                  <Figure
                    value={String(value)}
                    label={t('results.openLessons', {
                      subject: name,
                      part: t(`results.parts.${part}`),
                    })}
                    onOpen={open(part)}
                  />
                );
              const labels = labelsOf(row, t, language);
              return (
                <TableRow key={subject.id} data-subject={subject.id}>
                  <TableCell>
                    <span className="font-semibold">{name}</span>
                    {labels.length > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {labels.join(' · ')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell data-part="attendance">
                    {figure('attendance', row.attendance)}
                  </TableCell>
                  <TableCell data-part="classwork">{figure('classwork', row.classwork)}</TableCell>
                  <TableCell data-part="homework">{figure('homework', row.homework)}</TableCell>
                  <TableCell data-part="ratingExam">
                    {row.ratingShown ? figure('ratingExam', row.ratingExam) : ''}
                  </TableCell>
                  <TableCell data-part="result">
                    <Figure
                      value={outcomeText(row.outcome, t)}
                      label={t('results.openLessons', {
                        subject: name,
                        part: t('results.parts.result'),
                      })}
                      onOpen={open('result')}
                    />
                  </TableCell>
                  <TableCell data-part="grade">
                    {row.outcome.kind === 'number' ? row.outcome.grade : ''}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {years.length > 0 && (
        <section className="grid gap-2" data-year-results="true">
          <h3 className={SECTION_TITLE}>{t('results.yearTitle')}</h3>
          <ul className="grid gap-1 text-sm">
            {years.map((one) => (
              <li key={one.subject.id} data-subject={one.subject.id}>
                <span className="font-semibold">{nameOf(one.subject.names, language)}</span>
                {' · '}
                {one.year?.kind === 'number'
                  ? t('results.yearResult', {
                      shown: one.year.shown,
                      grade: one.year.grade,
                      count: one.year.basedOn,
                    })
                  : t('journal.grid.noResult')}
              </li>
            ))}
          </ul>
        </section>
      )}
      {traced !== null && (
        <ResultLessonsDialog
          studentId={studentId}
          subjectId={traced.subjectId}
          quarterId={traced.quarterId}
          part={traced.part}
          onClose={() => setTraced(null)}
        />
      )}
    </div>
  );
}
