import type { GrafanaFiring, StatusProviders, SystemStatus, UptimeDownPeriod } from '@sodiq/shared';

type Issue = Extract<StatusProviders['sentry'], { state: 'connected' }>['issues'][number];

/** What a service's history says, or that it was not read (not connected, out of reach, unreadable). */
export type HistoryReading<T> =
  { kind: 'read'; items: readonly T[]; cut: boolean } | { kind: 'not_read' };

const NOT_READ = { kind: 'not_read' } as const;

/**
 * The one reading of the outside services' history (pull request #363, review of the plan,
 * correction 4): the System status page lists exactly these lines and the home card counts
 * exactly these, so the card never counts a line the page does not show. A service that was not
 * read is "not read", never an empty history.
 */
export function historyOf(providers: StatusProviders): {
  downs: HistoryReading<UptimeDownPeriod>;
  firings: HistoryReading<GrafanaFiring>;
  errors: HistoryReading<Issue>;
} {
  const { uptimeRobot, grafana, sentry } = providers;
  return {
    downs:
      uptimeRobot.state === 'connected' && uptimeRobot.history.state === 'read'
        ? { kind: 'read', items: uptimeRobot.history.items, cut: uptimeRobot.history.cut }
        : NOT_READ,
    firings:
      grafana.state === 'connected' && grafana.history.state === 'read'
        ? { kind: 'read', items: grafana.history.items, cut: grafana.history.cut }
        : NOT_READ,
    errors:
      sentry.state === 'connected'
        ? { kind: 'read', items: sentry.issues, cut: sentry.cut }
        : NOT_READ,
  };
}

/**
 * How many checks need attention now (#361's summary, shared with the home card): the own checks
 * and each outside service once it answered, a failed read of them counting as one. `waiting`
 * while the outside services are still being read and nothing else needs attention, so neither
 * says "all pass" before they answered. A history line never counts: it already recovered.
 */
export function attentionOf(
  own: SystemStatus,
  providers: StatusProviders | undefined,
  providersFailed: boolean,
): { kind: 'waiting' } | { kind: 'fine' } | { kind: 'attention'; count: number } {
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
  const count = own.attention + outside;
  if (count > 0) return { kind: 'attention', count };
  return providers === undefined && !providersFailed ? { kind: 'waiting' } : { kind: 'fine' };
}
