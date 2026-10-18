import {
  weekdaySchema,
  type ErrorDetail,
  type OutOfDateCause,
  type TimetableVersion,
  type UpToDateItem,
  type UpToDateSide,
  type UpToDateValues,
  type Weekday,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiFailure } from '@/api/failure';
import { failureText } from '@/api/failure-text';
import { FailureAlert } from '@/components/failure-alert';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { SECTION_TITLE, SUBSECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { useView } from '@/features/access/use-view';
import { branchQuery, nameOf } from '@/features/setup/setup-api';
import { momentText, schoolDateText, weekdayName } from '@/lib/dates';
import { ruleText } from './rule-text';
import {
  bringUpToDate,
  invalidateTimetable,
  outOfDateQuery,
  publishCheckQuery,
} from './timetable-api';

type Pick = UpToDateSide | '';

/**
 * What marked a draft out of date, and bringing it up to date (task
 * 5.5a-3b-1, pull request #146; `06`, How surprises are prevented: "the draft
 * must be brought up to date before publishing; the differences are shown").
 * Each cause is named with its record and moment, in branch time; the check of
 * the draft under the changed setup is counted, with a way to the step that
 * lists it (decision 4). Task 5.5a-3b-2: after a publish, every difference
 * from the published version compared is shown beside the version the draft
 * started from, with a pick per difference (`edge/timetable`, Versions and
 * drafts: "Bringing one up to date lists what changed on both sides, and the
 * Academic Vice Principal picks").
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
  // The person's picks by item key; an item not picked here takes its default.
  const [picked, setPicked] = useState<Record<string, UpToDateSide>>({});
  const bring = useMutation({
    mutationFn: (input: { key: string; picks: { item: string; side: UpToDateSide }[] }) =>
      bringUpToDate(version.id, input.key, input.picks),
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
  const answer = causes.data;
  const timeZone = branch.data.timeZone;
  const pickOf = (item: UpToDateItem): Pick => picked[item.key] ?? item.defaultPick ?? '';
  const allPicked = answer.items.every((item) => pickOf(item) !== '');
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

  const setAll = (side: UpToDateSide) => {
    setPicked(Object.fromEntries(answer.items.map((item) => [item.key, side])));
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
      {answer.causes.length === 0 ? (
        <p className="text-sm">{t('timetable.outOfDate.none')}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {answer.causes.map((cause) => (
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
      {answer.causes.some((one) => one.kind === 'publish') && (
        <p className="text-sm">{t('timetable.outOfDate.byPublish')}</p>
      )}
      {answer.other !== null && (
        <div className="grid gap-3" data-comparison="true">
          <p className="text-sm">
            {t('timetable.outOfDate.compared', {
              number: answer.other.number,
              date: schoolDateText(answer.other.startsOn, language),
            })}{' '}
            {answer.base === null
              ? t('timetable.outOfDate.noBase')
              : t('timetable.outOfDate.startedFrom', { number: answer.base.number })}
          </p>
          {answer.items.length === 0 ? (
            <p className="text-sm">{t('timetable.outOfDate.noDifferences')}</p>
          ) : (
            <>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setAll('draft');
                    }}
                  >
                    {t('timetable.outOfDate.allDraft')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setAll('published');
                    }}
                  >
                    {t('timetable.outOfDate.allPublished')}
                  </Button>
                </div>
              )}
              <ul className="grid gap-4">
                {answer.items.map((item) => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    pick={pickOf(item)}
                    canEdit={canEdit}
                    onPick={(side) => {
                      setPicked((now) => ({ ...now, [item.key]: side }));
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {bring.isError && <FailureAlert error={bring.error} />}
      {bring.isError && <RefusedDetails error={bring.error} />}
      {canEdit && (
        <div className="grid gap-1">
          {!allPicked && <p className="text-sm">{t('timetable.outOfDate.pickNeeded')}</p>}
          <div>
            <Button
              type="button"
              disabled={bring.isPending || answer.causes.length === 0 || !allPicked}
              onClick={() => {
                bring.mutate({
                  key: answer.key,
                  picks: answer.items.flatMap((item) => {
                    const side = pickOf(item);
                    return side === '' ? [] : [{ item: item.key, side }];
                  }),
                });
              }}
            >
              {t('timetable.outOfDate.bring')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** One difference: each row's three sides side by side, who changed it, and the pick. */
function ItemCard({
  item,
  pick,
  canEdit,
  onPick,
}: {
  item: UpToDateItem;
  pick: Pick;
  canEdit: boolean;
  onPick: (side: UpToDateSide) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const title = item.rows
    .map((row) => `${row.unitName}, ${nameOf(row.subjectNames, language)}`)
    .join(' · ');
  return (
    <li className="grid gap-2 rounded-lg border p-3" data-item={item.key}>
      <h4 className={SUBSECTION_TITLE}>{title}</h4>
      <p className="text-sm text-muted-foreground">
        {t(`timetable.outOfDate.changedBy.${item.changedBy}`)}
      </p>
      {item.rows.map((row) => (
        <div key={row.key} className="overflow-x-auto">
          {item.rows.length > 1 && (
            <p className="text-sm font-semibold">
              {row.unitName}, {nameOf(row.subjectNames, language)}
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th scope="col" className="py-1 pr-3">
                  <span className="sr-only">{t('timetable.outOfDate.field')}</span>
                </th>
                <th scope="col" className="py-1 pr-3">
                  {t('timetable.outOfDate.side.base')}
                </th>
                <th scope="col" className="py-1 pr-3">
                  {t('timetable.outOfDate.side.draft')}
                </th>
                <th scope="col" className="py-1 pr-3">
                  {t('timetable.outOfDate.side.published')}
                </th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((field) => (
                <tr key={field} className="border-t align-top">
                  <th scope="row" className="py-1 pr-3 text-left font-medium">
                    {t(`timetable.outOfDate.fields.${field}`)}
                  </th>
                  {[row.base, row.draft, row.published].map((values, index) => (
                    <td key={index} className="py-1 pr-3">
                      <FieldText field={field} values={values} tutorRow={row.tutorRow} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {canEdit && (
        <Segmented<Pick>
          label={t('timetable.outOfDate.pick', { item: title })}
          options={[
            { value: 'draft', label: t('timetable.outOfDate.keepDraft') },
            { value: 'published', label: t('timetable.outOfDate.takePublished') },
          ]}
          value={pick}
          onChange={(side) => {
            if (side !== '') onPick(side);
          }}
        />
      )}
    </li>
  );
}

const FIELDS = ['teacher', 'room', 'lessons', 'placements', 'pins'] as const;

/** One field of one side of a row. */
function FieldText({
  field,
  values,
  tutorRow,
}: {
  field: (typeof FIELDS)[number];
  values: UpToDateValues | null;
  tutorRow: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  if (values === null) {
    return <span className="text-muted-foreground">{t('timetable.outOfDate.notThere')}</span>;
  }
  const slot = (one: { weekday: Weekday; slotPosition: number }) =>
    t('timetable.outOfDate.slot', {
      weekday: weekdayName(language, one.weekday),
      position: one.slotPosition,
    });
  switch (field) {
    case 'teacher':
      return (
        <span>
          {tutorRow
            ? t('timetable.outOfDate.tutor')
            : (values.teacherName ?? t('timetable.outOfDate.recordGone'))}
        </span>
      );
    case 'room':
      return <span>{values.roomName ?? t('timetable.outOfDate.noRoom')}</span>;
    case 'lessons':
      return (
        <span>
          {values.doubleLessons
            ? t('timetable.outOfDate.lessonsDouble', { count: values.lessonsPerWeek })
            : t('timetable.outOfDate.lessons', { count: values.lessonsPerWeek })}
        </span>
      );
    case 'placements':
      return values.placements.length === 0 ? (
        <span className="text-muted-foreground">{t('timetable.outOfDate.notPlaced')}</span>
      ) : (
        <ul>
          {values.placements.map((one) => (
            <li key={`${String(one.weekday)}-${String(one.slotPosition)}`}>
              {[
                slot(one),
                one.roomName,
                one.pairedWith === null ? null : t('timetable.outOfDate.double'),
              ]
                .filter(Boolean)
                .join(', ')}
            </li>
          ))}
        </ul>
      );
    case 'pins':
      return values.pins.length === 0 ? (
        <span className="text-muted-foreground">{t('timetable.outOfDate.noPins')}</span>
      ) : (
        <span>{values.pins.map(slot).join('; ')}</span>
      );
  }
}

/** The rules and load problems a refused bring-up-to-date names (decision 8). */
function RefusedDetails({ error }: { error: Error }): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  if (!(error instanceof ApiFailure) || error.code !== 'up_to_date_blocked') return null;
  const textOf = (detail: ErrorDetail): string => {
    if (detail.path.startsWith('pattern.')) {
      const weekday = weekdaySchema.safeParse(detail.rule?.weekday);
      return weekday.success
        ? `${ruleText(t, detail.code)} (${weekdayName(i18n.language, weekday.data)})`
        : ruleText(t, detail.code);
    }
    if (detail.path.startsWith('loadRows.')) {
      return t(`timetable.load.problems.${detail.code}`, {
        defaultValue: t('timetable.outOfDate.loadProblem'),
      });
    }
    const [, day, position] = detail.path.split('.');
    const weekday = weekdaySchema.safeParse(Number(day));
    return weekday.success
      ? t('timetable.outOfDate.noSlot', {
          weekday: weekdayName(i18n.language, weekday.data),
          position,
        })
      : t('timetable.outOfDate.loadProblem');
  };
  return (
    <ul className="grid gap-1 text-sm" data-refused="true">
      {(error.details ?? []).map((detail, index) => (
        <li key={index}>{textOf(detail)}</li>
      ))}
    </ul>
  );
}
