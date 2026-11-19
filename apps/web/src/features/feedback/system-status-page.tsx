import type { CheckStatus, StatusProviders, SystemStatus } from '@sodiq/shared';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircleIcon, InfoIcon, WarningIcon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL } from '@/components/ui/control';
import { formatMoment } from '@/lib/dates';
import { SYSTEM_STATUS_KEY, statusProvidersQuery, systemStatusQuery } from './feedback-reports-api';

type Provider = StatusProviders[keyof StatusProviders];

const LINK = 'font-semibold text-link underline-offset-4 hover:underline';

/**
 * The System status page of the Super Admin (pull request #361; owner, 19 November 2026: "a
 * status page by which we are able to fully see the health of current app … uptimerobot,
 * grafana etc."). The app's own checks come at once; UptimeRobot, Grafana and Sentry fill their
 * panels when the server has read them. Nothing reads on a timer: Refresh reads both again.
 */
export function SystemStatusPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const own = useQuery(systemStatusQuery());
  const providers = useQuery(statusProvidersQuery());
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
      <div className="grid max-w-5xl gap-6">
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
                    <span className="text-sm text-muted-foreground">
                      {monitor.uptime7d === null
                        ? monitor.url
                        : t('systemStatus.uptimeRobot.uptime', {
                            url: monitor.url,
                            ratio: monitor.uptime7d,
                          })}
                    </span>
                  </li>
                ))}
              </ul>
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
              <SentryIssues issues={provider.issues} />
            ))
          }
        />
      </div>
    </>
  );
}

/** A status in words beside its icon, never by colour alone (`12`, Accessibility). */
function StatusWord({ status, text }: { status: CheckStatus; text: string }) {
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
  const outside =
    providers === undefined
      ? providersFailed
        ? 1
        : 0
      : [providers.uptimeRobot, providers.grafana, providers.sentry].reduce(
          (sum, one) =>
            sum + (one.state === 'connected' ? one.attention : one.state === 'unreachable' ? 1 : 0),
          0,
        );
  const total = own.attention + outside;
  // Never "all pass" before the outside services have answered.
  const waiting = providers === undefined && !providersFailed && total === 0;
  return (
    <section className={PANEL} aria-label={t('systemStatus.summary')}>
      <p className="text-lg" role="status">
        <StatusWord
          status={waiting ? 'unknown' : total === 0 ? 'ok' : 'attention'}
          text={
            waiting
              ? t('systemStatus.readingOutside')
              : total === 0
                ? t('systemStatus.allFine')
                : t('systemStatus.needAttention', { count: total })
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
      <h2 id="system-status-own" className="mb-3 text-lg font-semibold">
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
      <h2 id="system-status-branches" className="mb-3 text-lg font-semibold">
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
}: {
  title: string;
  name: string;
  query: UseQueryResult<StatusProviders>;
  pick: (all: StatusProviders) => P;
  rows: (provider: P) => ReactNode;
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
      <h2 id={id} className="mb-3 text-lg font-semibold">
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
