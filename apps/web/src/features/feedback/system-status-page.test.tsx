import type { StatusProviders, SystemStatus } from '@sodiq/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  period: '24h',
  uptimeRobot: {
    state: 'not_connected',
    dashboardUrl: 'https://dashboard.uptimerobot.com/monitors',
  },
  grafana: { state: 'not_connected', dashboardUrl: null },
  sentry: { state: 'not_connected', dashboardUrl: null },
};

const CONNECTED: StatusProviders = {
  period: '24h',
  uptimeRobot: {
    state: 'connected',
    checkedAt: CHECKED,
    attention: 1,
    dashboardUrl: 'https://dashboard.uptimerobot.com/monitors',
    monitors: [
      { name: 'app', url: 'https://app.sodiqschool.uz/', state: 'up', uptime: '99.982' },
      {
        name: 'api health',
        url: 'https://app.sodiqschool.uz/api/health',
        state: 'down',
        uptime: null,
      },
    ],
    history: {
      state: 'read',
      cut: false,
      items: [
        {
          monitor: 'api health',
          startedAt: '2026-11-19T02:00:00.000Z',
          endedAt: null,
          reason: 'Keyword Not Found',
        },
        {
          monitor: 'app',
          startedAt: '2026-11-18T22:14:00.000Z',
          endedAt: '2026-11-18T22:32:00.000Z',
          reason: 'Connection Timeout',
        },
      ],
    },
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
    history: {
      state: 'read',
      cut: false,
      items: [
        {
          rule: 'CellSavesFailing',
          branch: NORTH.id,
          detail: '/api/journal/cells',
          firedAt: '2026-11-19T03:05:00.000Z',
          resolvedAt: '2026-11-19T03:31:00.000Z',
        },
        {
          rule: 'JobsFailing',
          branch: 'an-unknown-branch',
          detail: null,
          firedAt: null,
          resolvedAt: '2026-11-19T01:00:00.000Z',
        },
      ],
    },
    schoolRules: { found: 20, of: 20 },
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
    cut: false,
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
    // Every school rule is in Grafana: no "only … of" line.
    expect(grafana.textContent).not.toContain('Only ');
    const sentry = await panel(en.systemStatus.sentry.title);
    expect(
      within(sentry)
        .getByRole('link', { name: 'TypeError in the journal grid' })
        .getAttribute('href'),
    ).toBe('https://sodiq.sentry.io/issues/10/');
  });

  // Pull request #364: a school rule missing from Grafana is seen on the page.
  it('says when Grafana holds fewer of the school rules than there are', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () =>
        json({
          ...CONNECTED,
          grafana: { ...CONNECTED.grafana, schoolRules: { found: 18, of: 20 } },
        }),
    });
    renderApp('/system-status', 'en');
    const grafana = await panel(en.systemStatus.grafana.title);
    await waitFor(() => {
      expect(grafana.textContent).toContain(
        en.systemStatus.grafana.missing_other.replace('{{found}}', '18').replace('{{count}}', '20'),
      );
    });
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

// Pull request #363 (owner, 20 November 2026): the outside services' history of 24 hours, 7 or
// 14 days, chosen in the address; the summary stays "now".
describe('the history of the period', () => {
  it('reads the period from the address, asks the server with it, and changes it with the switch', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () => json({ ...CONNECTED, period: '7d' }),
    });
    renderApp('/system-status?period=7d', 'en');
    const switcher = await screen.findByRole('radiogroup', { name: en.systemStatus.period });
    await waitFor(() => {
      expect(
        calls
          .filter((call) => call.route === 'GET /api/system-status/providers')
          .map((call) => call.query),
      ).toEqual(['?period=7d']);
    });
    expect(
      within(switcher).getByRole<HTMLInputElement>('radio', { name: en.systemStatus.period_7d })
        .checked,
    ).toBe(true);

    fireEvent.click(within(switcher).getByRole('radio', { name: en.systemStatus.period_14d }));
    await waitFor(() => {
      expect(calls.map((call) => call.query)).toContain('?period=14d');
    });
    // 24 hours is the default: no period in the address and none sent.
    fireEvent.click(within(switcher).getByRole('radio', { name: en.systemStatus.period_24h }));
    await waitFor(() => {
      expect(
        calls.filter(
          (call) => call.route === 'GET /api/system-status/providers' && call.query === undefined,
        ),
      ).toHaveLength(1);
    });
  });

  it('lists the down periods and the alerts that fired, each alert under its branch by name', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () => json(CONNECTED),
    });
    renderApp('/system-status', 'en');
    const downs = await screen.findByRole('list', { name: en.systemStatus.uptimeRobot.downs });
    const downLines = within(downs)
      .getAllByRole('listitem')
      .map((one) => one.textContent);
    expect(downLines[0]).toContain('api health: down since');
    expect(downLines[0]).toContain('Keyword Not Found');
    expect(downLines[1]).toContain('app: down');
    expect(downLines[1]).toContain('Connection Timeout');

    // The branch names come with the own checks.
    await panel(en.systemStatus.own);
    const fired = screen.getByRole('list', { name: en.systemStatus.grafana.fired });
    const [first, second] = within(fired)
      .getAllByRole('listitem')
      .map((one) => one.textContent);
    expect(first).toContain('CellSavesFailing · North · /api/journal/cells');
    expect(first).toContain('Fired');
    // A branch the own checks do not know is named by its id, never left blank.
    expect(second).toContain('JobsFailing · an-unknown-branch');
    expect(second).toContain('Fired earlier, resolved');
  });

  it('says a history could not be read and keeps the current rows', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () =>
        json({
          ...CONNECTED,
          grafana: { ...CONNECTED.grafana, history: { state: 'unreadable' } },
        }),
    });
    renderApp('/system-status', 'en');
    const grafana = await panel(en.systemStatus.grafana.title);
    await waitFor(() => {
      expect(grafana.textContent).toContain(en.systemStatus.historyUnreadable);
    });
    expect(within(grafana).getByText('BackupOld')).toBeDefined();
  });

  it('keeps the summary "now" whatever the period', async () => {
    for (const address of ['/system-status', '/system-status?period=14d']) {
      fakeApi({
        'GET /api/auth/session': () => json(session()),
        'GET /api/system-status': () => json(own()),
        'GET /api/system-status/providers': () => json(CONNECTED),
      });
      renderApp(address, 'en');
      const summary = await panel(en.systemStatus.summary);
      await waitFor(() => {
        // 1 monitor down, 1 rule firing, 1 error now: never the history lines.
        expect(within(summary).getByRole('status').textContent).toBe(
          en.systemStatus.needAttention_other.replace('{{count}}', '3'),
        );
      });
      cleanup();
    }
  });
});

describe('the system status card of the home page', () => {
  const principal = () =>
    sessionOf({ assignments: [{ role: 'principal', branchId: NORTH.id }], branches: [NORTH] });

  it('shows the Super Admin what needs attention now, the last 24 hours and the new feedback', async () => {
    const calls = fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () => json(CONNECTED),
    });
    renderApp('/', 'en');
    const card = await screen.findByRole('region', { name: en.home.status.title });
    await waitFor(() => {
      expect(within(card).getByRole('status').textContent).toBe(
        en.systemStatus.needAttention_other.replace('{{count}}', '3'),
      );
    });
    // The same lines the page lists: 2 down periods, 2 alerts fired, 1 error.
    expect(card.textContent).toContain(
      en.home.status.lastDay.replace(
        '{{list}}',
        [
          en.home.status.downs_other.replace('{{count}}', '2'),
          en.home.status.firings_other.replace('{{count}}', '2'),
          en.home.status.errors_one.replace('{{count}}', '1'),
        ].join(', '),
      ),
    );
    expect(
      within(card)
        .getByRole('link', { name: en.systemStatus.newFeedback_other.replace('{{count}}', '3') })
        .getAttribute('href'),
    ).toBe('/feedback-reports');
    expect(within(card).getByRole('link', { name: en.home.status.open }).getAttribute('href')).toBe(
      '/system-status',
    );
    // The home card reads the last 24 hours, whatever the page last chose.
    expect(
      calls
        .filter((call) => call.route === 'GET /api/system-status/providers')
        .map((call) => call.query),
    ).toEqual([undefined]);
  });

  it('names a service not read, never counting it as 0', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () =>
        json({
          ...CONNECTED,
          uptimeRobot: { ...CONNECTED.uptimeRobot, history: { state: 'unreadable' } },
          sentry: { state: 'not_connected', dashboardUrl: null },
        }),
    });
    renderApp('/', 'en');
    const card = await screen.findByRole('region', { name: en.home.status.title });
    await waitFor(() => {
      expect(card.textContent).toContain(en.home.status.notRead.replace('{{name}}', 'UptimeRobot'));
    });
    expect(card.textContent).toContain(en.home.status.notRead.replace('{{name}}', 'Sentry'));
    expect(card.textContent).toContain(en.home.status.firings_other.replace('{{count}}', '2'));
    expect(card.textContent).not.toContain(en.home.status.downs_other.replace('{{count}}', '0'));
  });

  it('shows a failure of the own checks with a retry', async () => {
    let fail = true;
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () =>
        fail
          ? json({ error: { code: 'internal_error', message: 'Failed.', requestId: 'r1' } }, 500)
          : json(own()),
      'GET /api/system-status/providers': () => json(CONNECTED),
    });
    renderApp('/', 'en');
    const card = await screen.findByRole('region', { name: en.home.status.title });
    await within(card).findByRole('alert');
    fail = false;
    fireEvent.click(within(card).getByRole('button', { name: en.problems.retry }));
    await waitFor(() => {
      expect(within(card).getByRole('status').textContent).toBe(
        en.systemStatus.needAttention_other.replace('{{count}}', '3'),
      );
    });
  });

  it('is neither drawn nor read for the Principal, who shares the branch summary', async () => {
    const calls = fakeApi({ 'GET /api/auth/session': () => json(principal()) });
    renderApp('/', 'en');
    await screen.findByRole('heading', { name: en.home.title });
    // The branch summary's own call has been made by now.
    await waitFor(() => {
      expect(calls.some((call) => call.route === 'GET /api/results/branch-summary')).toBe(true);
    });
    expect(screen.queryByRole('region', { name: en.home.status.title })).toBeNull();
    expect(calls.filter((call) => call.route.startsWith('GET /api/system-status'))).toEqual([]);
  });
});

describe('the review of the code of #363', () => {
  it('shows a failure of the outside services on the home card with a retry', async () => {
    let fail = true;
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () =>
        fail
          ? json({ error: { code: 'internal_error', message: 'Failed.', requestId: 'r1' } }, 500)
          : json(CONNECTED),
    });
    renderApp('/', 'en');
    const card = await screen.findByRole('region', { name: en.home.status.title });
    expect((await within(card).findByRole('alert')).textContent).toBe(en.home.status.lastDayFailed);
    fail = false;
    fireEvent.click(within(card).getByRole('button', { name: en.problems.retry }));
    await waitFor(() => {
      expect(card.textContent).toContain(en.home.status.firings_other.replace('{{count}}', '2'));
    });
  });

  it('never shows a branch id while the branch names are not read', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      // The own checks never answer: the branch names are not known.
      'GET /api/system-status': () => new Promise<Response>(() => undefined),
      'GET /api/system-status/providers': () => json(CONNECTED),
    });
    renderApp('/system-status', 'en');
    const fired = await screen.findByRole('list', { name: en.systemStatus.grafana.fired });
    const [first] = within(fired)
      .getAllByRole('listitem')
      .map((one) => one.textContent);
    expect(first).toContain('CellSavesFailing · /api/journal/cells');
    expect(first).not.toContain(NORTH.id);
  });

  it('gives a down period its length', async () => {
    fakeApi({
      'GET /api/auth/session': () => json(session()),
      'GET /api/system-status': () => json(own()),
      'GET /api/system-status/providers': () => json(CONNECTED),
    });
    renderApp('/system-status', 'en');
    const downs = await screen.findByRole('list', { name: en.systemStatus.uptimeRobot.downs });
    // 22:14 to 22:32: 18 minutes.
    expect(within(downs).getAllByRole('listitem')[1]?.textContent).toContain('(18 min)');
  });
});
