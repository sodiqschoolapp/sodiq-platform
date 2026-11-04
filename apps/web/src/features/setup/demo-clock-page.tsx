import { demoClockSchema, schoolDateOf, type DemoClockState } from '@sodiq/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { answerOf } from '@/api/failure';
import { useConfirm } from '@/components/confirm-dialog';
import { FailureAlert } from '@/components/failure-alert';
import { DateField, Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { momentAt, momentText, weekdayMomentText } from '@/lib/dates';
import { branchQuery } from './setup-api';

/** A jump takes effect this long after it is written (the server's `leadMs`). */
const LEAD_MS = 5_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** `GET /api/setup/demo-clock`: school-wide, so no branch in the header or the key. */
export const demoClockQuery = () =>
  queryOptions({
    queryKey: ['setup', 'demoClock'],
    queryFn: async () => demoClockSchema.parse(await answerOf(api.GET('/api/setup/demo-clock'))),
  });

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The weekday of a school date, 1 Monday to 7 Sunday. */
const weekdayOf = (date: string): number =>
  ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

const QUICK_KEYS = ['hour', 'tomorrow', 'monday'] as const;

/**
 * The quick moves (decision of the plan, "Web"): one hour on, tomorrow at 07:05, next Monday at
 * 09:05, in branch time, each from the demo time at the moment the jump takes effect.
 */
export function quickMoves(
  demoAtEffect: number,
  timeZone: string,
): { key: (typeof QUICK_KEYS)[number]; to: string }[] {
  const today = schoolDateOf(new Date(demoAtEffect), timeZone);
  const monday = addDays(today, 8 - weekdayOf(today));
  return [
    { key: 'hour', to: new Date(demoAtEffect + HOUR_MS).toISOString() },
    { key: 'tomorrow', to: momentAt(addDays(today, 1), '07:05', timeZone) },
    { key: 'monday', to: momentAt(monday, '09:05', timeZone) },
  ];
}

/**
 * School setup → Demo time (task 10.5, pull request #280): on the test environment the Super
 * Admin moves the platform's "now" forward for the role tutorials. Real time and demo time are
 * shown in the branch's time zone; a move asks first, because time only moves forward.
 */
export function DemoClockPage() {
  const { t, i18n } = useTranslation();
  const { branchId } = useView();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const state = useQuery(demoClockQuery());
  const branch = useQuery(branchQuery(branchId));
  const timeZone = branch.data?.timeZone ?? 'Asia/Tashkent';
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  const move = useMutation({
    mutationFn: async (to: string) => {
      const asked = await confirm({
        title: t('setup.demoClock.confirmTitle', {
          moment: weekdayMomentText(i18n.language, to, { timeZone }),
        }),
        text: t('setup.demoClock.confirmText'),
        action: t('setup.demoClock.confirmAction'),
      });
      if (!asked) return;
      const answer = demoClockSchema.parse(
        await answerOf(api.POST('/api/setup/demo-clock/jumps', { body: { to } })),
      );
      queryClient.setQueryData(demoClockQuery().queryKey, answer);
      // Every page reads its data again at the new time.
      await queryClient.invalidateQueries();
    },
  });

  const title = t('setup.demoClock.title');
  const header = (
    <PageHeader
      title={title}
      breadcrumbs={[
        { label: t('home.title'), to: '/' },
        { label: t('setup.title'), to: '/setup' },
      ]}
    />
  );
  if (state.isError) {
    return (
      <>
        {header}
        <ErrorState
          error={state.error}
          onRetry={() => {
            void state.refetch();
          }}
        />
      </>
    );
  }
  if (state.data === undefined) {
    return (
      <>
        {header}
        <LoadingOutline />
      </>
    );
  }
  if (!state.data.enabled) {
    return (
      <>
        {header}
        <EmptyState title={t('setup.demoClock.offTitle')} text={t('setup.demoClock.offText')} />
      </>
    );
  }
  const shown: DemoClockState = state.data;
  // The demo time when a move made now would take effect, at the click.
  const demoAtEffect = () =>
    Date.parse(shown.demoNow) + (Date.now() - state.dataUpdatedAt) + LEAD_MS;
  const chosen = date !== '' && time !== '' ? momentAt(date, time, timeZone) : null;

  return (
    <>
      {header}
      <div className="grid max-w-3xl gap-6">
        <section className={PANEL} aria-labelledby="demo-clock-now">
          <h2 id="demo-clock-now" className={SECTION_TITLE}>
            {t('setup.demoClock.nowTitle')}
          </h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt className="text-sm text-muted-foreground">{t('setup.demoClock.demo')}</dt>
            <dd className="font-semibold">
              {weekdayMomentText(i18n.language, shown.demoNow, { timeZone })}
            </dd>
            <dt className="text-sm text-muted-foreground">{t('setup.demoClock.real')}</dt>
            <dd>{momentText(i18n.language, shown.realNow, { timeZone })}</dd>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">{t('setup.demoClock.intro')}</p>
        </section>
        <section className={PANEL} aria-labelledby="demo-clock-move">
          <h2 id="demo-clock-move" className={SECTION_TITLE}>
            {t('setup.demoClock.moveTitle')}
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {QUICK_KEYS.map((key) => (
              <Button
                key={key}
                variant="secondary"
                disabled={move.isPending}
                onClick={() => {
                  const quick = quickMoves(demoAtEffect(), timeZone).find((one) => one.key === key);
                  if (quick !== undefined) move.mutate(quick.to);
                }}
              >
                {t(`setup.demoClock.quick.${key}`)}
              </Button>
            ))}
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <DateField
              label={t('setup.demoClock.date')}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
              }}
            />
            <Field
              type="time"
              label={t('setup.demoClock.time')}
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
              }}
            />
            <Button
              disabled={chosen === null || move.isPending}
              onClick={() => {
                if (chosen !== null) move.mutate(chosen);
              }}
            >
              {t('setup.demoClock.moveChosen')}
            </Button>
          </div>
          <div className="mt-4">
            <FailureAlert error={move.error} />
          </div>
        </section>
      </div>
    </>
  );
}
