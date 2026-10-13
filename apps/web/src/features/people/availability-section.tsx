import {
  availabilitySchema,
  availabilitySetSchema,
  PERMISSIONS,
  permits,
  WEEKDAYS,
  type AvailabilityEntry,
  type AvailabilitySet,
  type Weekday,
} from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SavedSign } from '@/components/form/saved-sign';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf, ApiFailure } from '@/api/failure';
import { DateField, Field } from '@/components/field';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useLeave } from '@/components/unsent/unsent-changes';
import { useView } from '@/features/access/use-view';
import { branchQuery } from '@/features/setup/setup-api';
import { asFormSchema } from './form-schema';
import { availabilityQuery } from './people-api';
import { schoolDateText, weekdayName } from '@/lib/dates';

type DayField = `day${Weekday}`;
type Fields = 'from' | DayField;

const dayField = (day: Weekday): DayField => `day${String(day)}` as DayField;

/** The ranges of a weekday as typed: `08:00–13:00, 14:00–17:00`. */
const rangesText = (entry: AvailabilityEntry | undefined, day: Weekday): string =>
  (entry?.ranges ?? [])
    .filter((range) => range.weekday === day)
    .map((range) => `${range.start}–${range.end}`)
    .join(', ');

const isWithdrawn = (entry: AvailabilityEntry) => entry.until === entry.from;

const inForceOn = (entry: AvailabilityEntry, date: string) =>
  !isWithdrawn(entry) && entry.from <= date && (entry.until === null || date < entry.until);

/**
 * The availability of a staff record, a person or a vacancy (`04`,
 * Availability; `06`, Teachers who work in several branches: "Each branch's
 * Academic Vice Principal edits the hours of own branch and sees the others
 * read only"; task 2.2b). The entries of the branch of the switcher, each from
 * a date, with a change from a date for a role that may edit; the other
 * branches below, read only.
 */
export function AvailabilitySection({ id, label }: { id: string; label: string }) {
  const { t } = useTranslation();
  const { role, branchId } = useView();
  const queryClient = useQueryClient();
  const leave = useLeave();
  const hours = useQuery(availabilityQuery(branchId, id));
  const branch = useQuery(branchQuery(branchId));
  const [changing, setChanging] = useState(false);
  // The record whose change was saved last: "Saved." beside "Change
  // availability" until the next change starts or the panel shows another
  // record (finding 18).
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const canEdit = role !== null && permits(PERMISSIONS, role, 'staff_teaching', 'edit');
  const set = useMutation({
    mutationFn: (input: AvailabilitySet) =>
      answerOf(
        api.PUT('/api/people/staff/{id}/availability', {
          params: { header: branchHeader(), path: { id } },
          body: input,
        }),
      ),
    onSuccess: (answer) => {
      queryClient.setQueryData(
        availabilityQuery(branchId, id).queryKey,
        availabilitySchema.parse(answer),
      );
      setChanging(false);
      setSavedFor(id);
    },
  });

  const failed = hours.isError ? hours : branch.isError ? branch : null;
  let body;
  if (failed !== null) {
    body = (
      <ErrorState
        error={failed.error}
        onRetry={() => {
          void failed.refetch();
        }}
      />
    );
  } else if (hours.data === undefined || branch.data === undefined) {
    body = <LoadingOutline lines={2} />;
  } else {
    const data = hours.data;
    const current = data.entries.find((entry) => inForceOn(entry, data.today));
    // The working weekdays of the branch, and any other weekday that has hours (decision 4).
    const days = WEEKDAYS.filter(
      (day) =>
        branch.data.workingWeekdays.includes(day) ||
        data.entries.some((entry) => entry.ranges.some((range) => range.weekday === day)),
    );
    body = (
      <>
        <Entries entries={data.entries} today={data.today} days={days} />
        {/* The sign is always in the page, so it is read out when it arrives. */}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            {!changing && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setChanging(true);
                  setSavedFor(null);
                }}
              >
                {t('people.availability.change')}
              </Button>
            )}
            <SavedSign saved={savedFor === id && !changing} />
          </div>
        )}
        {canEdit && changing && (
          <ChangeForm
            key={`${id}-${String(data.entries.length)}`}
            current={current ?? data.entries.at(-1)}
            earliest={data.earliestFrom}
            days={days}
            label={t('people.availability.changeOf', { name: label })}
            onSave={async (input) => {
              await set.mutateAsync(input);
            }}
            onCancel={() => {
              void leave.leave().then((leaves) => {
                if (leaves) {
                  setChanging(false);
                }
              });
            }}
          />
        )}
        <OverlapDays error={set.error} />
        {data.elsewhere.map((other) => (
          <section key={other.branchId} className="grid gap-2">
            <h4 className="text-sm font-semibold">
              {t('people.availability.elsewhere', { name: other.name })}
            </h4>
            <Entries entries={other.entries} today={data.today} days={WEEKDAYS} />
          </section>
        ))}
      </>
    );
  }
  return (
    <section className="grid gap-3">
      <h3 className="text-base font-semibold">{t('people.availability.title')}</h3>
      {body}
    </section>
  );
}

/** The entries of one branch: those in force and planned, then the history. */
function Entries({
  entries,
  today,
  days,
}: {
  entries: readonly AvailabilityEntry[];
  today: string;
  days: readonly Weekday[];
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const live = entries.filter((entry) => !isWithdrawn(entry));
  if (live.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('people.availability.none')}</p>;
  }
  const state = (entry: AvailabilityEntry) =>
    inForceOn(entry, today)
      ? t('people.availability.inForce')
      : entry.from > today
        ? t('people.availability.planned')
        : t('people.availability.ended');
  const period = (entry: AvailabilityEntry) =>
    entry.until === null
      ? t('people.availability.fromDate', { date: schoolDateText(entry.from, language) })
      : t('people.availability.period', {
          from: schoolDateText(entry.from, language),
          until: schoolDateText(entry.until, language),
        });
  const shown = [...live].sort((a, b) => b.from.localeCompare(a.from));
  return (
    <ul className="grid gap-3">
      {shown.map((entry) => (
        <li key={entry.id} className="grid gap-1 text-sm">
          <p>
            <span className="font-medium">{period(entry)}</span>{' '}
            <span className="text-muted-foreground">{state(entry)}</span>
          </p>
          {entry.ranges.length === 0 ? (
            <p className="text-muted-foreground">{t('people.availability.noHours')}</p>
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
              {days
                .filter((day) => entry.ranges.some((range) => range.weekday === day))
                .map((day) => (
                  <div key={day} className="contents">
                    <dt className="text-muted-foreground">{weekdayName(language, day)}</dt>
                    <dd>{rangesText(entry, day)}</dd>
                  </div>
                ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Reads `08:00–13:00, 14:00-17:00` as ranges; a piece that is not two times stays as typed for the schema to refuse. */
function readRanges(
  text: string,
  day: Weekday,
): { weekday: Weekday; start: string; end: string }[] {
  return text
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '')
    .map((piece) => {
      const [start = piece, end = ''] = piece.split(/\s*[–—-]\s*/);
      return { weekday: day, start, end };
    });
}

/** A new entry from a date: a field per weekday (decision 2: the whole week of the branch). */
function ChangeForm({
  current,
  earliest,
  days,
  label,
  onSave,
  onCancel,
}: {
  current: AvailabilityEntry | undefined;
  earliest: string;
  days: readonly Weekday[];
  label: string;
  onSave: (input: AvailabilitySet) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const initial = { from: earliest } as Record<Fields, string>;
  for (const day of WEEKDAYS) {
    initial[dayField(day)] = rangesText(current, day);
  }
  // The weekday of each range read last, so that an issue of a range marks its field.
  const order: Weekday[] = [];
  const form = useRecordForm<Fields, AvailabilitySet>({
    schema: asFormSchema<AvailabilitySet>(availabilitySetSchema, (path) => {
      const [first, index] = path;
      if (first === 'ranges' && typeof index === 'number') {
        const day = order[index];
        return day === undefined ? ['from'] : [dayField(day)];
      }
      return [...path];
    }),
    initial,
    read: (typed) => {
      order.length = 0;
      const ranges = WEEKDAYS.flatMap((day) => readRanges(typed[dayField(day)], day));
      order.push(...ranges.map((range) => range.weekday));
      return { from: typed.from, ranges };
    },
    save: onSave,
  });
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <RecordForm form={form} label={label}>
        <DateField label={t('people.availability.from')} min={earliest} {...form.bind('from')} />
        {days.map((day) => (
          <Field
            key={day}
            label={weekdayName(i18n.language, day)}
            placeholder={t('people.availability.placeholder')}
            autoComplete="off"
            {...form.bind(dayField(day))}
          />
        ))}
      </RecordForm>
      <div>
        <Button variant="ghost" onClick={onCancel}>
          {t('people.availability.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** The weekdays an overlap refusal names (decision 6). */
function OverlapDays({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  if (!(error instanceof ApiFailure) || error.code !== 'availability_overlap') {
    return null;
  }
  const days = (error.details ?? [])
    .map((detail) => Number(detail.path.replace('weekday.', '')))
    .filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday));
  if (days.length === 0) {
    return null;
  }
  return (
    <p className="text-sm" role="status">
      {t('people.availability.overlapDays', {
        days: days.map((day) => weekdayName(i18n.language, day)).join(', '),
      })}
    </p>
  );
}
