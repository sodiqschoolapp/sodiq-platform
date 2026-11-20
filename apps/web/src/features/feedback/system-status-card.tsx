import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingOutline } from '@/components/states';
import { Button } from '@/components/ui/button';
import { PANEL, SECTION_TITLE } from '@/components/ui/control';
import { statusProvidersQuery, systemStatusQuery } from './feedback-reports-api';
import { attentionOf, historyOf, type HistoryReading } from './status-history';
import { StatusWord } from './system-status-page';

const LINK = 'font-semibold text-link underline-offset-4 hover:underline';

/**
 * The Super Admin's first screen, above the branch summary (pull request #363; owner,
 * 20 November 2026: "add a section for home page if it is a good idea"): what needs attention
 * now, as the System status page counts it, what happened in the last 24 hours, and the new
 * feedback reports. Drawn only for a role that views `monitoring`. It fills after the page
 * opens: the own checks answer at once, the outside services when the server has read them.
 */
export function SystemStatusCard() {
  const { t } = useTranslation();
  const own = useQuery(systemStatusQuery());
  const providers = useQuery(statusProvidersQuery('24h'));
  return (
    <section className={PANEL} aria-labelledby="home-system-status">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-system-status" className={SECTION_TITLE}>
          {t('home.status.title')}
        </h2>
        <Link to="/system-status" className={LINK}>
          {t('home.status.open')}
        </Link>
      </div>
      {own.isError ? (
        <ErrorState
          error={own.error}
          onRetry={() => {
            void own.refetch();
          }}
        />
      ) : own.data === undefined ? (
        <LoadingOutline lines={2} />
      ) : (
        <div className="grid gap-2">
          <p role="status">
            <Attention summary={attentionOf(own.data, providers.data, providers.isError)} />
          </p>
          <p className="text-sm">
            <LastDay
              history={providers.data === undefined ? undefined : historyOf(providers.data)}
              failed={providers.isError}
              onRetry={() => {
                void providers.refetch();
              }}
            />
          </p>
          <p className="text-sm">
            <Link to="/feedback-reports" className={LINK}>
              {t('systemStatus.newFeedback', { count: own.data.newFeedback })}
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

function Attention({ summary }: { summary: ReturnType<typeof attentionOf> }) {
  const { t } = useTranslation();
  return (
    <StatusWord
      status={summary.kind === 'waiting' ? 'unknown' : summary.kind === 'fine' ? 'ok' : 'attention'}
      text={
        summary.kind === 'waiting'
          ? t('systemStatus.readingOutside')
          : summary.kind === 'fine'
            ? t('systemStatus.allFine')
            : t('systemStatus.needAttention', { count: summary.count })
      }
    />
  );
}

/**
 * The last 24 hours of the three services, counted from the same reading the page lists: a
 * service not read is named "not read", never counted as 0.
 */
function LastDay({
  history,
  failed,
  onRetry,
}: {
  history: ReturnType<typeof historyOf> | undefined;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (history === undefined) {
    // A failure of the second query, with its retry (web rules; spec review of #363, must-fix 3).
    return failed ? (
      <span className="inline-flex flex-wrap items-center gap-3">
        <span role="alert">{t('home.status.lastDayFailed')}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('problems.retry')}
        </Button>
      </span>
    ) : (
      <span className="text-muted-foreground">{t('systemStatus.readingOutside')}</span>
    );
  }
  const part = (
    reading: HistoryReading<unknown>,
    counted: (count: number) => string,
    name: string,
  ): string =>
    reading.kind === 'read' ? counted(reading.items.length) : t('home.status.notRead', { name });
  const parts = [
    part(
      history.downs,
      (count) => t('home.status.downs', { count }),
      t('systemStatus.uptimeRobot.name'),
    ),
    part(
      history.firings,
      (count) => t('home.status.firings', { count }),
      t('systemStatus.grafana.name'),
    ),
    part(
      history.errors,
      (count) => t('home.status.errors', { count }),
      t('systemStatus.sentry.name'),
    ),
  ];
  return <span>{t('home.status.lastDay', { list: parts.join(', ') })}</span>;
}
