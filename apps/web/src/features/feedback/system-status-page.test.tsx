import type { StatusProviders, SystemStatus } from '@sodiq/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { fakeApi, json, NORTH, renderApp, sessionOf } from '@/testing/render-app';

// Pull request #361 (owner, 19 November 2026): the Super Admin's System status page. The own
// checks come at once; the outside services fill their panels when the server has read them.
// All names are invented.

const CHECKED = '2026-11-19T05:00:00.000Z';

const own = (fields: Partial<SystemStatus> = {}): SystemStatus => ({
  checkedAt: CHECKED,
  attention: 0,
  worker: { status: 'ok', lastRunAt: '2026-11-19T04:59:00.000Z' },
  failedJobs: { status: 'ok', jobs: [] },
  newFeedback: 3,
  branches: [
    {
      id: NORTH.id,
      name: 'North',
      nightlyCheck: { status: 'ok', finishedAt: '2026-11-18T21:10:00.000Z', differences: 0 },
      dailyWork: { status: 'ok', enqueuedAt: '2026-11-19T02:00:00.000Z' },
      failedExports: { status: 'ok', count: 0 },
      refusedSaves: 4,
    },
  ],
  ...fields,
});

const NOT_CONNECTED: StatusProviders = {
  uptimeRobot: {
    state: 'not_connected',
    dashboardUrl: 'https://dashboard.uptimerobot.com/monitors',
  },
  grafana: { state: 'not_connected', dashboardUrl: null },
  sentry: { state: 'not_connected', dashboardUrl: null },
};

const CONNECTED: StatusProviders = {
  uptimeRobot: {
    state: 'connected',
    checkedAt: CHECKED,
    attention: 1,
    dashboardUrl: 'https://dashboard.uptimerobot.com/monitors',
    monitors: [
      { name: 'app', url: 'https://app.sodiqschool.uz/', state: 'up', uptime7d: '99.982' },
      {
        name: 'api health',
        url: 'https://app.sodiqschool.uz/api/health',
        state: 'down',
        uptime7d: null,
      },
    ],
  },
  grafana: {
    state: 'connected',
    checkedAt: CHECKED,
    attention: 1,
    dashboardUrl: 'https://sodiq.grafana.net/alerting/list',
    rules: [
      { name: 'BackupOld', state: 'firing', health: 'ok' },
      { name: 'CellSavesSlow', state: 'normal', health: 'ok' },
      { name: 'JobsFailing', state: 'normal', health: 'ok' },
    ],
  },
  sentry: {
    state: 'connected',
    checkedAt: CHECKED,
    attention: 1,
    dashboardUrl: 'https://sodiq.sentry.io/issues/',
    issues: [
      {
        title: 'TypeError in the journal grid',
        shortId: 'SODIQ-PRODUCTION-4A',
        events: '17',
        lastSeen: '2026-11-19T04:40:00.000Z',
        link: 'https://sodiq.sentry.io/issues/10/',
      },
    ],
  },
};

const session = () =>
  sessionOf({ assignments: [{ role: 'super_admin', branchId: null }], branches: [NORTH] });

const panel = (name: string) => screen.findByRole('region', { name });

describe('the system status', () => {
  it('shows the own checks, and says each outside service is not connected without its key', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () => json(NOT_CONNECTED),
    });
    renderApp('/system-status', 'en');
    await screen.findByRole('heading', { name: en.systemStatus.title });

    const summary = await panel(en.systemStatus.summary);
    expect(within(summary).getByRole('status').textContent).toBe(en.systemStatus.allFine);
    const app = await panel(en.systemStatus.own);
    expect(within(app).getByText(en.systemStatus.noFailedJobs)).toBeDefined();
    expect(
      within(app).getByRole('link', {
        name: en.systemStatus.newFeedback_other.replace('{{count}}', '3'),
      }),
    ).toBeDefined();
    const branches = await panel(en.systemStatus.branches);
    const row = within(branches).getByRole('row', { name: /North/ });
    expect(within(row).getByText('4')).toBeDefined();

    const uptime = await panel(en.systemStatus.uptimeRobot.title);
    await waitFor(() => {
      expect(uptime.textContent).toContain(
        en.systemStatus.notConnected.replace('{{name}}', 'UptimeRobot'),
      );
    });
    expect(
      within(uptime).getByRole('link', { name: 'Open UptimeRobot' }).getAttribute('href'),
    ).toBe('https://dashboard.uptimerobot.com/monitors');
    // No address known for Grafana without its key: no link.
    const grafana = await panel(en.systemStatus.grafana.title);
    expect(within(grafana).queryByRole('link')).toBeNull();
  });

  it('counts what needs attention, the own checks and each outside service', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () =>
        json(
          own({
            attention: 1,
            failedJobs: {
              status: 'attention',
              jobs: [{ name: 'journal.branch_export', failed: 2 }],
            },
          }),
        ),
      'GET /api/system-status/providers': () => json(CONNECTED),
    });
    renderApp('/system-status', 'en');
    const summary = await panel(en.systemStatus.summary);
    // 1 own, 1 monitor down, 1 rule firing, 1 Sentry issue.
    await waitFor(() => {
      expect(within(summary).getByRole('status').textContent).toBe(
        en.systemStatus.needAttention_other.replace('{{count}}', '4'),
      );
    });
    const app = await panel(en.systemStatus.own);
    expect(app.textContent).toContain(
      en.systemStatus.failedJob_other
        .replace('{{name}}', 'journal.branch_export')
        .replace('{{count}}', '2'),
    );

    const uptime = await panel(en.systemStatus.uptimeRobot.title);
    expect(uptime.textContent).toContain(en.systemStatus.uptimeRobot.state_down);
    expect(uptime.textContent).toContain('99.982');
    const grafana = await panel(en.systemStatus.grafana.title);
    expect(within(grafana).getByText('BackupOld')).toBeDefined();
    expect(grafana.textContent).toContain(en.systemStatus.grafana.state_firing);
    // The normal rules are counted, not listed.
    expect(within(grafana).queryByText('CellSavesSlow')).toBeNull();
    expect(grafana.textContent).toContain(
      en.systemStatus.grafana.normal_other.replace('{{count}}', '2'),
    );
    const sentry = await panel(en.systemStatus.sentry.title);
    expect(
      within(sentry)
        .getByRole('link', { name: 'TypeError in the journal grid' })
        .getAttribute('href'),
    ).toBe('https://sodiq.sentry.io/issues/10/');
  });

  it('says a service could not be read, and counts it', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () =>
        json({
          ...NOT_CONNECTED,
          grafana: {
            state: 'unreachable',
            checkedAt: CHECKED,
            dashboardUrl: 'https://sodiq.grafana.net/alerting/list',
          },
        }),
    });
    renderApp('/system-status', 'en');
    const grafana = await panel(en.systemStatus.grafana.title);
    await waitFor(() => {
      expect(grafana.textContent).toContain('Could not read Grafana');
    });
    const summary = await panel(en.systemStatus.summary);
    expect(within(summary).getByRole('status').textContent).toBe(
      en.systemStatus.needAttention_one.replace('{{count}}', '1'),
    );
  });

  it('shows the own checks while the outside services are still being read', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () => new Promise<Response>(() => undefined),
    });
    renderApp('/system-status', 'en');
    await panel(en.systemStatus.own);
    const uptime = await panel(en.systemStatus.uptimeRobot.title);
    expect(within(uptime).getByRole('status').getAttribute('aria-busy')).toBe('true');
    // Never "all pass" before the outside services have answered.
    const summary = await panel(en.systemStatus.summary);
    expect(within(summary).getByRole('status').textContent).toBe(en.systemStatus.readingOutside);
  });

  it('counts a failed read of the outside services, and offers a retry in their panels', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () =>
        json({ error: { code: 'internal_error', message: 'Failed.', requestId: 'r1' } }, 500),
    });
    renderApp('/system-status', 'en');
    const summary = await panel(en.systemStatus.summary);
    await waitFor(() => {
      expect(within(summary).getByRole('status').textContent).toBe(
        en.systemStatus.needAttention_one.replace('{{count}}', '1'),
      );
    });
    const grafana = await panel(en.systemStatus.grafana.title);
    expect(within(grafana).getByRole('button', { name: en.problems.retry })).toBeDefined();
  });

  it('reads both again on Refresh, and never on its own', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () => json(NOT_CONNECTED),
    });
    renderApp('/system-status', 'en');
    await panel(en.systemStatus.own);
    const reads = (route: string) => calls.filter((call) => call.route === route).length;
    await waitFor(() => {
      expect(reads('GET /api/system-status/providers')).toBe(1);
    });
    expect(reads('GET /api/system-status')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: en.systemStatus.refresh }));
    await waitFor(() => {
      expect(reads('GET /api/system-status')).toBe(2);
      expect(reads('GET /api/system-status/providers')).toBe(2);
    });
  });

  it('shows a failure of the own checks with a retry', async () => {
    let fail = true;
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () =>
        fail
          ? json({ error: { code: 'internal_error', message: 'Failed.', requestId: 'r1' } }, 500)
          : json(own()),
      'GET /api/system-status/providers': () => json(NOT_CONNECTED),
    });
    renderApp('/system-status', 'en');
    await screen.findByRole('alert');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: en.problems.retry }));
    await panel(en.systemStatus.own);
  });
});
