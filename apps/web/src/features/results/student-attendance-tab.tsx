import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Segmented } from '@/components/ui/segmented';
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
import { ResultLessonsDialog } from './result-lessons-dialog';
import { studentAttendanceQuery } from './results-api';
import { useQuarterChoice, YearSelect } from './student-results-tab';

/**
 * The Attendance tab of a student's profile (task 9.1, decision 10; `04`, Profile
 * tabs; `07`, rule 5): for the quarter chosen, each subject the reader reads, the
 * attendance-only ones included, with the attendance average and the counts of the
 * marks, as the server gives them. The average opens the lessons behind it.
 */
export function StudentAttendanceTab({ studentId }: { studentId: string }): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const [yearId, setYearId] = useState<string | undefined>(undefined);
  const attendance = useQuery(studentAttendanceQuery(branchId, studentId, yearId));
  const withFigures = new Set(
    attendance.data?.subjects.flatMap((one) => one.quarters.map((row) => row.quarterId)) ?? [],
  );
  const [quarterId, setQuarterId] = useQuarterChoice(attendance.data?.quarters ?? [], withFigures);
  const [traced, setTraced] = useState<{ subjectId: string; quarterId: string } | null>(null);
  if (attendance.isError) {
    return <ErrorState error={attendance.error} onRetry={() => void attendance.refetch()} />;
  }
  if (attendance.data === undefined) return <LoadingOutline />;
  const answer = attendance.data;
  if (answer.year === null) return <EmptyState text={t('results.noYear')} />;
  const quarter = answer.quarters.find((one) => one.id === quarterId);
  const rows = answer.subjects.flatMap((one) => {
    const row = one.quarters.find((found) => found.quarterId === quarterId);
    return row === undefined ? [] : [{ subject: one.subject, row }];
  });
  return (
    <div className="grid gap-4" data-student-attendance="true">
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
              <TableHead>{t('results.counts.present')}</TableHead>
              <TableHead>{t('results.counts.absent')}</TableHead>
              <TableHead>{t('results.counts.late')}</TableHead>
              <TableHead>{t('results.counts.skipped')}</TableHead>
              <TableHead>{t('results.counts.exempt')}</TableHead>
              <TableHead>{t('results.counts.unmarked')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ subject, row }) => {
              const name = nameOf(subject.names, language);
              return (
                <TableRow key={subject.id} data-subject={subject.id}>
                  <TableCell>
                    <span className="font-semibold">{name}</span>
                    {row.attendanceOnly && (
                      <span className="block text-xs text-muted-foreground">
                        {t('results.attendanceOnly')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell data-part="attendance">
                    {row.average === null ? (
                      t('results.none')
                    ) : (
                      <button
                        type="button"
                        className="text-link tabular-nums"
                        aria-label={t('results.openLessons', {
                          subject: name,
                          part: t('results.parts.attendance'),
                        })}
                        onClick={() =>
                          setTraced({ subjectId: subject.id, quarterId: row.quarterId })
                        }
                      >
                        {String(row.average)}
                      </button>
                    )}
                  </TableCell>
                  <TableCell data-count="present">{row.counts.present}</TableCell>
                  <TableCell data-count="absent">{row.counts.absent}</TableCell>
                  <TableCell data-count="late">{row.counts.late}</TableCell>
                  <TableCell data-count="skipped">{row.counts.skipped}</TableCell>
                  <TableCell data-count="exempt">{row.counts.exempt}</TableCell>
                  <TableCell data-count="unmarked">{row.counts.unmarked}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {traced !== null && (
        <ResultLessonsDialog
          studentId={studentId}
          subjectId={traced.subjectId}
          quarterId={traced.quarterId}
          part="attendance"
          onClose={() => setTraced(null)}
        />
      )}
    </div>
  );
}
