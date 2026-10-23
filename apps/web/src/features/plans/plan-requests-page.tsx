import { PLAN_REQUEST_DAYS_MAX, type PlanRequest, type PlanRequests } from '@sodiq/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FailureAlert } from '@/components/failure-alert';
import { SelectField } from '@/components/field';
import { ListPage } from '@/components/list/list-page';
import type { Column, ListSearch } from '@/components/list/list-state';
import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { useView } from '@/features/access/use-view';
import { nameOf } from '@/features/setup/setup-api';
import { momentDateText } from '@/lib/dates';
import { DecideDialog, RequestLines } from './plan-requests';
import {
  decidePlanEvent,
  decidePlanRequest,
  invalidatePlans,
  planRequestsQuery,
} from './plans-api';

/**
 * The plan edit requests the reader decides or sees (task 7.2, pull request
 * #215; `02`: "The Senior Head Teacher of the subject and the Academic Vice
 * Principal of the branch see it too, and either can decide it"; `edge`: "one
 * unanswered for 2 school days is highlighted"; `09`, Approving together).
 * The routing and "nobody approves their own" are the server's.
 */
export function PlanRequestsPage(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search: ListSearch = useSearch({ from: '/app/plans/requests' });
  const { branchId } = useView();
  const requests = useQuery(planRequestsQuery(branchId, 'deciding'));
  const language = i18n.language;
  const columns = useMemo(
    (): Column<PlanRequest>[] => [
      {
        key: 'unit',
        header: t('plans.requests.unit'),
        cell: (row) => row.unit.name,
        sortValue: (row) => row.unit.name,
        opens: true,
        fixed: true,
      },
      {
        key: 'subject',
        header: t('plans.requests.subject'),
        cell: (row) => nameOf(row.subject.names, language),
        sortValue: (row) => nameOf(row.subject.names, language),
      },
      {
        key: 'owner',
        header: t('plans.requests.owner'),
        cell: (row) => row.owner ?? t('plans.plan.noOwner'),
        searchText: (row) => row.owner ?? '',
      },
      {
        key: 'kind',
        header: t('plans.requests.kindLabel'),
        cell: (row) => t(`plans.requests.kind.${row.kind}`),
      },
      {
        key: 'status',
        header: t('plans.requests.statusLabel'),
        cell: (row) =>
          row.late ? (
            <span className="font-semibold">
              {t(`plans.requests.status.${row.status}`)} · {t('plans.requests.late')}
            </span>
          ) : (
            t(`plans.requests.status.${row.status}`)
          ),
        sortValue: (row) => (row.late ? 0 : row.canDecide ? 1 : 2),
      },
    ],
    [t, language],
  );
  return (
    <>
      <PageHeader
        title={t('plans.requests.pageTitle')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('plans.page.title'), to: '/plans' },
        ]}
      />
      {requests.isError ? (
        <ErrorState
          error={requests.error}
          onRetry={() => {
            void requests.refetch();
          }}
        />
      ) : (
        <div className="grid gap-4">
          {requests.data !== undefined && requests.data.events.length > 0 && (
            <Events events={requests.data.events} />
          )}
          <ListPage
            listId="plan-requests"
            caption={t('plans.requests.caption')}
            rows={requests.data?.requests}
            rowId={(row) => row.id}
            rowName={(row) => `${row.unit.name} · ${nameOf(row.subject.names, language)}`}
            columns={columns}
            search={search}
            onSearchChange={(next: ListSearch, how) => {
              void navigate({ to: '/plans/requests', search: next, replace: how === 'replace' });
            }}
            panel={(row) => <RequestPanel key={row.id} request={row} />}
            empty={{ title: t('plans.requests.emptyTitle'), text: t('plans.requests.empty') }}
          />
        </div>
      )}
    </>
  );
}

function RequestPanel({ request }: { request: PlanRequest }) {
  const { t } = useTranslation();
  const [deciding, setDeciding] = useState(false);
  return (
    <div className="grid gap-3 text-sm">
      <p>
        <span className="font-semibold">{t(`plans.requests.kind.${request.kind}`)}</span>
        {' · '}
        {t(`plans.requests.status.${request.status}`)}
      </p>
      <RequestLines request={request} />
      <Link
        to="/plans/$journalId"
        params={{ journalId: request.journalId }}
        search={{ quarter: request.quarterId }}
        className="text-link"
      >
        {t('plans.requests.openPlan')}
      </Link>
      {request.canDecide && (
        <div>
          <Button
            onClick={() => {
              setDeciding(true);
            }}
          >
            {t('plans.requests.decide')}
          </Button>
        </div>
      )}
      {deciding && (
        <DecideDialog
          lessons={request.lessons}
          replan={request.fromDate !== null}
          decide={(decision) => decidePlanRequest(request.id, decision)}
          onClose={() => {
            setDeciding(false);
          }}
        />
      )}
    </div>
  );
}

/** `09`, Approving together: "approve all requests caused by one event ... and set the number of days once". */
function Events({ events }: { events: PlanRequests['events'] }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [days, setDays] = useState('1');
  const approve = useMutation({
    mutationFn: (event: { eventId: string; subjectId?: string }) =>
      decidePlanEvent({ ...event, days: Number(days) }),
    onSuccess: () => invalidatePlans(queryClient),
  });
  return (
    <section className={`${PANEL} grid gap-3 p-4`} aria-labelledby="plan-events">
      <h2 id="plan-events" className={SECTION_TITLE}>
        {t('plans.requests.eventsTitle')}
      </h2>
      <div className="max-w-40">
        <SelectField
          label={t('plans.requests.daysLabel')}
          name="days"
          value={days}
          onChange={(event) => {
            setDays(event.target.value);
          }}
          options={Array.from({ length: PLAN_REQUEST_DAYS_MAX }, (_, index) => ({
            value: String(index + 1),
            label: String(index + 1),
          }))}
        />
      </div>
      <ul className="grid gap-2 text-sm">
        {events.map((event) => (
          <li
            key={event.eventId}
            className="flex flex-wrap items-center gap-2"
            data-event={event.eventId}
          >
            <span>
              {t('plans.requests.event', {
                count: event.requests,
                date: momentDateText(i18n.language, event.at),
              })}
            </span>
            <Button
              variant="secondary"
              disabled={approve.isPending}
              onClick={() => {
                approve.mutate({ eventId: event.eventId });
              }}
            >
              {t('plans.requests.approveAll')}
            </Button>
            {event.subjects.length > 1 &&
              event.subjects.map((subject) => (
                <Button
                  key={subject.id}
                  variant="ghost"
                  disabled={approve.isPending}
                  onClick={() => {
                    approve.mutate({ eventId: event.eventId, subjectId: subject.id });
                  }}
                >
                  {t('plans.requests.approveSubject', {
                    subject: nameOf(subject.names, i18n.language),
                  })}
                </Button>
              ))}
          </li>
        ))}
      </ul>
      {approve.data !== undefined && (
        <p className="text-sm">
          {t('plans.requests.eventDone', {
            approved: approve.data.approved.length,
            skipped: approve.data.skipped.length,
          })}
        </p>
      )}
      <FailureAlert error={approve.error} />
    </section>
  );
}
