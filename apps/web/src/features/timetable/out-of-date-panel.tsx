import type { OutOfDateCause, TimetableVersion } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { failureText } from '@/api/failure-text';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { branchQuery } from '@/features/setup/setup-api';
import { momentText, schoolDateText } from '@/lib/dates';
import {
  bringUpToDate,
  invalidateTimetable,
  outOfDateQuery,
  publishCheckQuery,
} from './timetable-api';

/**
 * What marked a draft out of date, and bringing it up to date (task
 * 5.5a-3b-1, pull request #146; `06`, How surprises are prevented: "the draft
 * must be brought up to date before publishing; the differences are shown").
 * Each cause is named with its record and moment, in branch time; the check of
 * the draft under the changed setup is counted, with a way to the step that
 * lists it (decision 4). A publish cause waits for 5.5a-3b-2 (decision 5).
 */
export function OutOfDatePanel({
  version,
  canEdit,
  onOpenCheck,
}: {
  version: TimetableVersion;
  canEdit: boolean;
  onOpenCheck: () => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const causes = useQuery(outOfDateQuery(branchId, version.id));
  const branch = useQuery(branchQuery(branchId));
  const check = useQuery(publishCheckQuery(branchId, version.id, version.startsOn));
  const bring = useMutation({
    mutationFn: (key: string) => bringUpToDate(version.id, key),
    onSettled: async () => {
      await invalidateTimetable(queryClient);
    },
  });

  if (causes.isError || branch.isError) {
    return (
      <ErrorState
        error={causes.isError ? causes.error : branch.error}
        onRetry={() => {
          void causes.refetch();
          void branch.refetch();
        }}
      />
    );
  }
  if (causes.data === undefined || branch.data === undefined) {
    return <LoadingOutline />;
  }
  const timeZone = branch.data.timeZone;
  const byPublish = causes.data.causes.some((one) => one.kind === 'publish');
  const recordText = (cause: OutOfDateCause): string => {
    const record = cause.record;
    if (record === null) {
      // A teacher's record is read through the branch's row filter: one whose
      // branch was removed is no longer seen here (review round 1, second opinion).
      return cause.kind === 'publish'
        ? t('timetable.outOfDate.earlierPublish')
        : cause.kind === 'availability'
          ? t('timetable.outOfDate.teacherGone')
          : t('timetable.outOfDate.recordGone');
    }
    if (record.versionNumber !== null) {
      return t('timetable.outOfDate.version', { number: record.versionNumber });
    }
    const name = record.name ?? t('timetable.outOfDate.recordGone');
    if (record.firstDate === null || record.lastDate === null) {
      return name;
    }
    const dates =
      record.firstDate === record.lastDate
        ? schoolDateText(record.firstDate, language)
        : t('timetable.outOfDate.dates', {
            first: schoolDateText(record.firstDate, language),
            last: schoolDateText(record.lastDate, language),
          });
    return `${name}, ${dates}`;
  };

  return (
    <section
      aria-labelledby="out-of-date-title"
      className="grid gap-3"
      data-out-of-date-panel="true"
    >
      <h3 id="out-of-date-title" className={SECTION_TITLE}>
        {t('timetable.outOfDate.title')}
      </h3>
      {causes.data.causes.length === 0 ? (
        <p className="text-sm">{t('timetable.outOfDate.none')}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {causes.data.causes.map((cause) => (
            <li key={cause.id} data-cause={cause.action}>
              <span className="font-semibold">{t(`audit.actions.${cause.action}`)}</span>
              {': '}
              {recordText(cause)}
              {' · '}
              {momentText(language, cause.causedAt, { timeZone })}
            </li>
          ))}
        </ul>
      )}
      {check.isError ? (
        <p className="text-sm" role="alert">
          {failureText(t, check.error)}
        </p>
      ) : check.data === undefined ? null : (
        <p className="text-sm" data-check="true">
          {t('timetable.outOfDate.check', {
            refusals: check.data.refusals.filter((one) => one.code !== 'draft_out_of_date').length,
            warnings: check.data.warnings.length,
          })}{' '}
          <button type="button" className="text-link" onClick={onOpenCheck}>
            {t('timetable.outOfDate.openCheck')}
          </button>
        </p>
      )}
      {byPublish && <p className="text-sm">{t('timetable.outOfDate.byPublish')}</p>}
      {bring.isError && <FailureAlert error={bring.error} />}
      {canEdit && (
        <div>
          <Button
            type="button"
            disabled={byPublish || bring.isPending || causes.data.causes.length === 0}
            onClick={() => {
              bring.mutate(causes.data.key);
            }}
          >
            {t('timetable.outOfDate.bring')}
          </Button>
        </div>
      )}
    </section>
  );
}
