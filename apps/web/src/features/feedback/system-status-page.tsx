import {
  STATUS_PERIODS,
  type CheckStatus,
  type GrafanaFiring,
  type StatusPeriod,
  type StatusProviders,
  type SystemStatus,
  type UptimeDownPeriod,
} from '@sodiq/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, InfoIcon, WarningIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { Segmented } from '@/components/ui/segmented';
import { formatMoment } from '@/lib/dates';
import { SYSTEM_STATUS_KEY, statusProvidersQuery, systemStatusQuery } from './feedback-reports-api';
import { attentionOf, historyOf, type HistoryReading } from './status-history';

type Provider = StatusProviders['uptimeRobot' | 'grafana' | 'sentry'];

const LINK = 'font-semibold text-link underline-offset-4 hover:underline';

/**
 * The System status page of the Super Admin (pull request #361; owner, 19 November 2026: "a
 * status page by which we are able to fully see the health of current app … uptimerobot,
 * grafana etc."). The app's own checks come at once; UptimeRobot, Grafana and Sentry fill their
 * panels when the server has read them. Nothing reads on a timer: Refresh reads both again.
 * Pull request #363: the outside services' history of 24 hours, 7 or 14 days, chosen in the
 * address (`?period=7d`); the summary stays "now".
 */
export function SystemStatusPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const own = useQuery(systemStatusQuery());
  const navigate = useNavigate();
  const search = useSearch({ from: '/app/system-status' });
  const period: StatusPeriod = search.period ?? '24h';
  const providers = useQuery(statusProvidersQuery(period));
  const history = providers.data === undefined ? undefined : historyOf(providers.data);
  // A Grafana line names its branch by id: the own checks know the names.
  const branchNames = new Map((own.data?.branches ?? []).map((branch) => [branch.id, branch.name]));
  const refreshing = own.isFetching || providers.isFetching;

  return (
    <>
      <PageHeader
        title={t('systemStatus.title')}
        breadcrumbs={[
          { label: t('home.title'), to: '/' },
          { label: t('setup.title'), to: '/setup' },
        ]}
        actions={
          <Button
            variant="secondary"
            pending={refreshing}
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: SYSTEM_STATUS_KEY });
            }}
          >
            {t('systemStatus.refresh')}
          </Button>
        }
      />
      <div className="grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6">
        {own.isError ? (
          <section className={PANEL}>
            <ErrorState
              error={own.error}
              onRetry={() => {
                void own.refetch();
              }}
            />
          </section>
        ) : own.data === undefined ? (
          <section className={PANEL}>
            <LoadingOutline />
          </section>
        ) : (
          <>
            <Summary
              own={own.data}
              providers={providers.data}
              providersFailed={providers.isError}
            />
            <OwnChecks status={own.data} />
            <Branches status={own.data} />
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={SECTION_TITLE}>{t('systemStatus.outside')}</h2>
          <Segmented
            label={t('systemStatus.period')}
            options={STATUS_PERIODS.map((value) => ({
              value,
              label: t(`systemStatus.period_${value}`),
            }))}
            value={period}
            onChange={(value) => {
              void navigate({
                to: '/system-status',
                search: value === '24h' ? {} : { period: value },
                replace: true,
              });
            }}
          />
        </div>
        <ProviderPanel
          title={t('systemStatus.uptimeRobot.title')}
          name={t('systemStatus.uptimeRobot.name')}
          query={providers}
          pick={(all) => all.uptimeRobot}
          rows={(provider) =>
            provider.state === 'connected' && (
              <ul aria-label={t('systemStatus.uptimeRobot.title')} className="grid gap-2">
                {provider.monitors.map((monitor) => (
                  <li key={`${monitor.name} ${monitor.url}`} className="grid gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-3">
                      <span className="font-semibold">{monitor.name}</span>
                      <StatusWord
                        status={
                          monitor.state === 'up'
                            ? 'ok'
                            : monitor.state === 'down' || monitor.state === 'seems_down'
                              ? 'attention'
                              : 'unknown'
                        }
                        text={t(`systemStatus.uptimeRobot.state_${monitor.state}`)}
                      />
                    </span>
                    <span className="text-sm break-all text-muted-foreground">
                      {monitor.uptime === null
                        ? monitor.url
                        : t('systemStatus.uptimeRobot.uptime', {
                            url: monitor.url,
                            ratio: monitor.uptime,
                          })}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
          history={
            history !== undefined && (
              <HistoryBlock
                title={t('systemStatus.uptimeRobot.downs')}
                reading={history.downs}
                empty={t('systemStatus.uptimeRobot.noDowns')}
                line={(down) => <DownLine down={down} />}
                keyOf={(down) => `${down.monitor} ${down.startedAt}`}
              />
            )
          }
        />
        <ProviderPanel
          title={t('systemStatus.grafana.title')}
          name={t('systemStatus.grafana.name')}
          query={providers}
          pick={(all) => all.grafana}
          rows={(provider) =>
            provider.state === 'connected' && <GrafanaRules rules={provider.rules} />
          }
          history={
            history !== undefined && (
              <HistoryBlock
                title={t('systemStatus.grafana.fired')}
                reading={history.firings}
                empty={t('systemStatus.grafana.noneFired')}
                line={(firing) => <FiringLine firing={firing} branchNames={branchNames} />}
                keyOf={(firing) =>
                  `${firing.rule} ${firing.branch ?? ''} ${firing.detail ?? ''} ${firing.firedAt ?? firing.resolvedAt ?? ''}`
                }
              />
            )
          }
        />
        <ProviderPanel
          title={t('systemStatus.sentry.title')}
          name={t('systemStatus.sentry.name')}
          query={providers}
          pick={(all) => all.sentry}
          rows={(provider) =>
            provider.state === 'connected' &&
            (provider.issues.length === 0 ? (
              <StatusWord status="ok" text={t('systemStatus.sentry.none')} />
            ) : (
              <>
                <SentryIssues issues={provider.issues} />
                {provider.cut && (
                  <p className="text-sm text-muted-foreground">{t('systemStatus.sentry.cut')}</p>
                )}
              </>
            ))
          }
        />
      </div>
    </>
  );
}

/** A status in words beside its icon, never by colour alone (`12`, Accessibility). */
export function StatusWord({ status, text }: { status: CheckStatus; text: string }) {
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <CheckCircleIcon aria-hidden className="size-4" />
        {text}
      </span>
    );
  }
  if (status === 'attention') {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-warning">
        <WarningIcon aria-hidden className="size-4" />
        {text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <InfoIcon aria-hidden className="size-4" />
      {text}
    </span>
  );
}

/** How many checks need attention: the own ones, and each outside service once it answered. */
function Summary({
  own,
  providers,
  providersFailed,
}: {
  own: SystemStatus;
  providers: StatusProviders | undefined;
  /** The read of the outside services failed: it counts as one that needs attention. */
  providersFailed: boolean;
}) {
  const { t, i18n } = useTranslation();
  const summary = attentionOf(own, providers, providersFailed);
  return (
    <section className={PANEL} aria-label={t('systemStatus.summary')}>
      <p className="text-lg" role="status">
        <StatusWord
          status={
            summary.kind === 'waiting' ? 'unknown' : summary.kind === 'fine' ? 'ok' : 'attention'
          }
          text={
            summary.kind === 'waiting'
              ? t('systemStatus.readingOutside')
              : summary.kind === 'fine'
                ? t('systemStatus.allFine')
                : t('systemStatus.needAttention', { count: summary.count })
          }
        />
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('systemStatus.checkedAt', { moment: formatMoment(i18n.language, own.checkedAt) })}
      </p>
    </section>
  );
}

/** The worker, the failed jobs and the new feedback. */
function OwnChecks({ status }: { status: SystemStatus }) {
  const { t, i18n } = useTranslation();
  const statusText = (one: CheckStatus) => t(`systemStatus.status_${one}`);
  return (
    <section className={PANEL} aria-labelledby="system-status-own">
      <h2 id="system-status-own" className={`mb-3 ${SECTION_TITLE}`}>
        {t('systemStatus.own')}
      </h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">{t('systemStatus.worker')}</dt>
        <dd className="grid gap-0.5">
          <StatusWord status={status.worker.status} text={statusText(status.worker.status)} />
          <span className="text-sm text-muted-foreground">
            {status.worker.lastRunAt === null
              ? t('systemStatus.workerNever')
              : t('systemStatus.workerLast', {
                  moment: formatMoment(i18n.language, status.worker.lastRunAt),
                })}
          </span>
        </dd>
        <dt className="font-semibold">{t('systemStatus.failedJobs')}</dt>
        <dd className="grid gap-0.5">
          <StatusWord
            status={status.failedJobs.status}
            text={statusText(status.failedJobs.status)}
          />
          {status.failedJobs.jobs.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('systemStatus.noFailedJobs')}</span>
          ) : (
            <ul className="text-sm">
              {status.failedJobs.jobs.map((job) => (
                <li key={job.name}>
                  {t('systemStatus.failedJob', { name: job.name, count: job.failed })}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt className="font-semibold">{t('systemStatus.feedback')}</dt>
        <dd>
          <Link to="/feedback-reports" className={LINK}>
            {t('systemStatus.newFeedback', { count: status.newFeedback })}
          </Link>
        </dd>
      </dl>
    </section>
  );
}

/** One row per branch: the nightly check, the daily work, failed exports and refused saves. */
function Branches({ status }: { status: SystemStatus }) {
  const { t, i18n } = useTranslation();
  const at = (moment: string | null, none: string) =>
    moment === null ? none : formatMoment(i18n.language, moment);
  return (
    <section className={PANEL} aria-labelledby="system-status-branches">
      <h2 id="system-status-branches" className={`mb-3 ${SECTION_TITLE}`}>
        {t('systemStatus.branches')}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-4">{t('systemStatus.branch')}</th>
              <th className="py-2 pr-4">{t('systemStatus.nightlyCheck')}</th>
              <th className="py-2 pr-4">{t('systemStatus.dailyWork')}</th>
              <th className="py-2 pr-4">{t('systemStatus.failedExports')}</th>
              <th className="py-2">{t('systemStatus.refusedSaves')}</th>
            </tr>
          </thead>
          <tbody>
            {status.branches.map((branch) => (
              <tr key={branch.id} className="border-t border-border align-top">
                <th scope="row" className="py-2 pr-4 font-semibold">
                  {branch.name}
                </th>
                <td className="py-2 pr-4">
                  <StatusWord
                    status={branch.nightlyCheck.status}
                    text={
                      branch.nightlyCheck.differences > 0
                        ? t('systemStatus.differences', { count: branch.nightlyCheck.differences })
                        : t(`systemStatus.status_${branch.nightlyCheck.status}`)
                    }
                  />
                  <div className="text-muted-foreground">
                    {at(branch.nightlyCheck.finishedAt, t('systemStatus.notYet'))}
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <StatusWord
                    status={branch.dailyWork.status}
                    text={t(`systemStatus.status_${branch.dailyWork.status}`)}
                  />
                  <div className="text-muted-foreground">
                    {at(branch.dailyWork.enqueuedAt, t('systemStatus.notYet'))}
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <StatusWord
                    status={branch.failedExports.status}
                    text={
                      branch.failedExports.count === 0
                        ? t('systemStatus.status_ok')
                        : t('systemStatus.failedExportsCount', {
                            count: branch.failedExports.count,
                          })
                    }
                  />
                </td>
                <td className="py-2 tabular-nums">{branch.refusedSaves}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A panel of one outside service: loading, not connected, out of reach, or its rows. */
function ProviderPanel<P extends Provider>({
  title,
  name,
  query,
  pick,
  rows,
  history,
}: {
  title: string;
  name: string;
  query: UseQueryResult<StatusProviders>;
  pick: (all: StatusProviders) => P;
  rows: (provider: P) => ReactNode;
  /** The history of the period, under the current rows (pull request #363). */
  history?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const id = `system-status-${name.toLowerCase().replace(/[^a-z]/g, '')}`;
  const provider = query.data === undefined ? undefined : pick(query.data);
  return (
    <section
      className={PANEL}
      aria-labelledby={id}
      aria-busy={provider === undefined && !query.isError}
    >
      <h2 id={id} className={`mb-3 ${SECTION_TITLE}`}>
        {title}
      </h2>
      {query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : provider === undefined ? (
        <LoadingOutline lines={2} />
      ) : (
        <div className="grid gap-3">
          {provider.state === 'not_connected' && (
            <StatusWord status="unknown" text={t('systemStatus.notConnected', { name })} />
          )}
          {provider.state === 'unreachable' && (
            <StatusWord
              status="attention"
              text={t('systemStatus.unreachable', {
                name,
                moment: formatMoment(i18n.language, provider.checkedAt),
              })}
            />
          )}
          {provider.state === 'connected' && (
            <>
              {rows(provider)}
              {history}
              <p className="text-sm text-muted-foreground">
                {t('systemStatus.readAt', {
                  moment: formatMoment(i18n.language, provider.checkedAt),
                })}
              </p>
            </>
          )}
          {provider.dashboardUrl !== null && (
            <a href={provider.dashboardUrl} target="_blank" rel="noreferrer" className={LINK}>
              {t('systemStatus.open', { name })}
            </a>
          )}
        </div>
      )}
    </section>
  );
}

type GrafanaRule = Extract<StatusProviders['grafana'], { state: 'connected' }>['rules'][number];

/** The rules that fire or wait first, then a count of the normal ones. */
function GrafanaRules({ rules }: { rules: readonly GrafanaRule[] }) {
  const { t } = useTranslation();
  const shown = rules.filter((rule) => rule.state !== 'normal' || rule.health !== 'ok');
  const normal = rules.length - shown.length;
  return (
    <div className="grid gap-2">
      {shown.length > 0 && (
        <ul aria-label={t('systemStatus.grafana.title')} className="grid gap-1">
          {shown.map((rule) => (
            <li key={rule.name} className="flex flex-wrap items-center gap-x-3">
              <span className="font-semibold">{rule.name}</span>
              <StatusWord
                status={
                  rule.state === 'firing' || rule.health === 'error'
                    ? 'attention'
                    : rule.state === 'normal' && rule.health === 'ok'
                      ? 'ok'
                      : 'unknown'
                }
                text={
                  rule.health === 'ok'
                    ? t(`systemStatus.grafana.state_${rule.state}`)
                    : t(`systemStatus.grafana.health_${rule.health}`)
                }
              />
            </li>
          ))}
        </ul>
      )}
      <StatusWord status="ok" text={t('systemStatus.grafana.normal', { count: normal })} />
    </div>
  );
}

type SentryIssue = Extract<StatusProviders['sentry'], { state: 'connected' }>['issues'][number];

function SentryIssues({ issues }: { issues: readonly SentryIssue[] }) {
  const { t, i18n } = useTranslation();
  return (
    <ul aria-label={t('systemStatus.sentry.title')} className="grid gap-2">
      {issues.map((issue) => (
        <li key={issue.shortId} className="grid gap-0.5">
          {issue.link === null ? (
            <span className="font-semibold">{issue.title}</span>
          ) : (
            <a href={issue.link} target="_blank" rel="noreferrer" className={LINK}>
              {issue.title}
            </a>
          )}
          <span className="text-sm text-muted-foreground">
            {issue.lastSeen === null
              ? t('systemStatus.sentry.issueLineNoTime', {
                  id: issue.shortId,
                  events: issue.events,
                })
              : t('systemStatus.sentry.issueLine', {
                  id: issue.shortId,
                  events: issue.events,
                  moment: formatMoment(i18n.language, issue.lastSeen),
                })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A service's history of the period (pull request #363): its lines newest first, a line when
 * there is none, "History could not be read" when the service answered it in another shape, and
 * a note when the service's own limit cut the list.
 */
function HistoryBlock<T>({
  title,
  reading,
  empty,
  line,
  keyOf,
}: {
  title: string;
  reading: HistoryReading<T>;
  empty: string;
  line: (item: T) => ReactNode;
  keyOf: (item: T) => string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 border-t border-border pt-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      {reading.kind === 'not_read' ? (
        <StatusWord status="unknown" text={t('systemStatus.historyUnreadable')} />
      ) : reading.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          <ul aria-label={title} className="grid gap-2 text-sm">
            {reading.items.map((item) => (
              <li key={keyOf(item)} className="grid gap-0.5">
                {line(item)}
              </li>
            ))}
          </ul>
          {reading.cut && (
            <p className="text-sm text-muted-foreground">{t('systemStatus.historyCut')}</p>
          )}
        </>
      )}
    </div>
  );
}

/** A down period of a monitor: when, how long or still down, and UptimeRobot's reason. */
function DownLine({ down }: { down: UptimeDownPeriod }) {
  const { t, i18n } = useTranslation();
  const from = formatMoment(i18n.language, down.startedAt);
  return (
    <>
      <span>
        {down.endedAt === null
          ? t('systemStatus.uptimeRobot.downRunning', { monitor: down.monitor, from })
          : t('systemStatus.uptimeRobot.down', {
              monitor: down.monitor,
              from,
              to: formatMoment(i18n.language, down.endedAt),
            })}
      </span>
      {down.reason !== null && (
        <span className="text-muted-foreground">
          {t('systemStatus.uptimeRobot.reason', { reason: down.reason })}
        </span>
      )}
    </>
  );
}

/** An alert that fired: the rule, its branch by name, the job or route, and when. */
function FiringLine({
  firing,
  branchNames,
}: {
  firing: GrafanaFiring;
  branchNames: ReadonlyMap<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const where = [
    firing.branch === null ? null : (branchNames.get(firing.branch) ?? firing.branch),
    firing.detail,
  ].filter((one): one is string => one !== null);
  const at = (moment: string) => formatMoment(i18n.language, moment);
  return (
    <>
      <span>
        <span className="font-semibold">{firing.rule}</span>
        {where.length > 0 && <span className="text-muted-foreground"> · {where.join(' · ')}</span>}
      </span>
      <span className="text-muted-foreground">
        {firing.firedAt === null
          ? t('systemStatus.grafana.firingBefore', {
              to: firing.resolvedAt === null ? '' : at(firing.resolvedAt),
            })
          : firing.resolvedAt === null
            ? t('systemStatus.grafana.firingRunning', { from: at(firing.firedAt) })
            : t('systemStatus.grafana.firing', {
                from: at(firing.firedAt),
                to: at(firing.resolvedAt),
              })}
      </span>
    </>
  );
}
