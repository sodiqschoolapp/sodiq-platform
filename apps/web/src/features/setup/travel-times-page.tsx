import { PERMISSIONS, permits, TRAVEL_MINUTES_MAX, travelTimeRecordSchema } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, branchHeader } from '@/api/client';
import { answerOf } from '@/api/failure';
import { NumberField } from '@/components/field';
import { wholeNumber } from '@/components/form/form-messages';
import { RecordForm } from '@/components/form/record-form';
import { useRecordForm } from '@/components/form/use-record-form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingOutline } from '@/components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useView } from '@/features/access/use-view';
import { travelTimesQuery } from './settings-api';

interface Pair {
  branchId: string;
  branchName: string;
  minutes: number | null;
}

/** The minutes to one other branch, as the Super Admin types them. */
function PairForm({ pair }: { pair: Pair }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const queryClient = useQueryClient();
  const { branchId } = useView();
  const save = useMutation({
    mutationFn: (minutes: number) =>
      answerOf(
        api.PUT('/api/setup/travel-times', {
          params: { header: branchHeader() },
          body: { otherBranchId: pair.branchId, minutes },
        }),
      ),
    onSuccess: async (answer) => {
      queryClient.setQueryData(travelTimesQuery(branchId).queryKey, answer);
      // The other branch's list shows the same pair.
      await queryClient.invalidateQueries({ queryKey: ['setup', 'travelTimes'] });
    },
  });
  const form = useRecordForm({
    schema: travelTimeRecordSchema,
    initial: { minutes: pair.minutes === null ? '' : String(pair.minutes) },
    read: (typed) => ({ otherBranchId: pair.branchId, minutes: wholeNumber(typed.minutes) }),
    save: async (record) => {
      await save.mutateAsync(record.minutes);
    },
  });
  return (
    <RecordForm form={form} label={pair.branchName}>
      <NumberField
        label={t('setup.travelTimes.minutes')}
        note={t('setup.travelTimes.minutesNote', {
          min: number.format(0),
          max: number.format(TRAVEL_MINUTES_MAX),
        })}
        {...form.bind('minutes')}
      />
    </RecordForm>
  );
}

/**
 * Travel time between the branch in use and every other branch (`06`,
 * Teachers who work in several branches; answer 21): set by the Super Admin,
 * read by the Principal and the Academic Vice Principal (answer 24). A pair
 * not set yet says so; it never reads as 0 minutes (decision 4).
 */
export function TravelTimesPage() {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const { role, branchId } = useView();
  const canEdit = role !== null && permits(PERMISSIONS, role, 'branches', 'edit');
  const list = useQuery(travelTimesQuery(branchId));
  const shown = (minutes: number | null) =>
    minutes === null
      ? t('setup.travelTimes.notSet')
      : t('setup.travelTimes.minutesValue', { count: minutes, value: number.format(minutes) });

  let body;
  if (branchId === null) {
    body = <EmptyState text={t('setup.travelTimes.none')} />;
  } else if (list.isError) {
    body = (
      <ErrorState
        error={list.error}
        onRetry={() => {
          void list.refetch();
        }}
      />
    );
  } else if (list.data === undefined) {
    body = <LoadingOutline lines={3} />;
  } else if (list.data.pairs.length === 0) {
    body = <EmptyState text={t('setup.travelTimes.oneBranch')} />;
  } else if (canEdit) {
    body = list.data.pairs.map((pair) => (
      <section
        key={pair.branchId}
        aria-label={pair.branchName}
        className="grid gap-2 rounded-xl bg-card p-6 max-sm:p-4"
      >
        <h2 className="text-base font-semibold">{pair.branchName}</h2>
        <p className="text-sm text-muted-foreground">{shown(pair.minutes)}</p>
        <PairForm key={`${pair.branchId}-${String(pair.minutes)}`} pair={pair} />
      </section>
    ));
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('setup.travelTimes.branch')}</TableHead>
            <TableHead>{t('setup.travelTimes.minutes')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data.pairs.map((pair) => (
            <TableRow key={pair.branchId}>
              <TableCell>{pair.branchName}</TableCell>
              <TableCell>{shown(pair.minutes)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <>
      <PageHeader
        title={t('setup.travelTimes.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
      />
      <div className="grid max-w-3xl gap-4">{body}</div>
    </>
  );
}
