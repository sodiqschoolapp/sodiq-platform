import { DURATION_BOUNDS, SERIES } from './series.js';

/**
 * The alert rules of Grafana (task 10.2a; `edge/system-behaviour`, "Cell saves fail in one
 * branch at 08:05"; `14`, Monitoring: "Errors and slow pages raise alerts for the developers at
 * once"; `12`, Speed targets), written here and generated into
 * `monitoring/grafana/alert-rules.yaml`, which the owner imports into Grafana Cloud as
 * Grafana-managed rules (docs/monitoring.md). Grafana is the one place these alerts are sent
 * from (owner, 28 October 2026), by email until a Telegram contact point is added (answer 8).
 *
 * The request numbers are pushed once per minute as that minute's counts (plan decision 8), so
 * every rule reads them with `sum_over_time`. A rule that must fire when its series stops (the
 * heartbeats, the counts, the backup) is written so that a missing series is a value that
 * fires (`or vector(0)`, `absent_over_time`), never left to Grafana's "no data" setting.
 */

export interface AlertRule {
  alert: string;
  /** What `edge/system-behaviour`, `14` or `12` asks for, in a few words. */
  rule: string;
  expr: string;
  for: string;
  summary: string;
  /** The API routes the expression names (checked against the registered routes). */
  routes: readonly string[];
}

const SAVE_ROUTES = [
  'POST /api/journal/lessons/:lessonId/attendance',
  'POST /api/journal/lessons/:lessonId/all-present',
  'POST /api/journal/lessons/:lessonId/scores',
] as const;
const PUBLISH_CLOSE_ROUTES = [
  'POST /api/timetable/versions/:id/publish',
  'POST /api/results/closing/:quarterId/close',
  'POST /api/results/closing/:quarterId/journals/:journalId/close',
] as const;
const JOURNAL_ROUTES = ['GET /api/journal/journals/:journalId'] as const;
const SEARCH_ROUTES = [
  'GET /api/search/students',
  'GET /api/search/relatives',
  'GET /api/search/staff',
  'GET /api/search/classes',
  'GET /api/search/groups',
] as const;
const REPORT_ROUTES = [
  'GET /api/results/rating/subject',
  'GET /api/results/rating/class',
  'GET /api/results/rating/classes',
  'GET /api/results/early-warning',
  'GET /api/results/branch-summary',
  'GET /api/journal/attendance-today',
  'GET /api/journal/lessons-today',
  'GET /api/timetable/conflicts-summary',
] as const;

/** A label matcher of the routes: their methods and patterns, as the series carry them. */
function routesMatcher(routes: readonly string[]): string {
  const methods = [...new Set(routes.map((route) => route.split(' ')[0] ?? ''))];
  const paths = routes.map((route) => route.split(' ')[1] ?? '');
  return `method=~"${methods.join('|')}",route=~"${paths.join('|')}"`;
}

const WINDOW = '10m';
const count = (matcher: string, by: string) =>
  `sum by (${by}) (sum_over_time(sodiq_requests_count{${matcher}}[${WINDOW}]))`;
const p95 = (matcher: string, by: string) =>
  `histogram_quantile(0.95, sum by (le, ${by}) (sum_over_time(sodiq_request_duration_bucket{${matcher}}[${WINDOW}])))`;

/** p95 over the target, with at least 20 answers in the window so one slow answer is no alert. */
const slow = (matcher: string, seconds: number, by = 'route, branch') =>
  `${p95(matcher, by)} > ${String(seconds)} and ${count(matcher, by)} >= 20`;

/** The mean of the same hour on each of the 7 days before. */
const sameHourLastWeek = (series: string) =>
  `(${[1, 2, 3, 4, 5, 6, 7]
    .map((day) => `max by (branch) (avg_over_time(${series}[1h] offset ${String(day)}d))`)
    .join(' + ')}) / 7`;

/** A heartbeat that stopped: nothing for 10 minutes is 0, which fires. */
const stopped = (series: string) => `(sum(sum_over_time(${series}[${WINDOW}])) or vector(0)) < 1`;

const DAY_AND_TWO_HOURS = 26 * 3600;

const NOT_FILES = 'route!~".*(export|pdf|print|xlsx|photo|file).*"';
const listed = [...JOURNAL_ROUTES, ...SEARCH_ROUTES, ...REPORT_ROUTES].map(
  (route) => route.split(' ')[1] ?? '',
);

export const ALERT_RULES: readonly AlertRule[] = [
  {
    alert: 'CellSavesFailing',
    rule: 'failed cell saves',
    expr: `${count(`${routesMatcher(SAVE_ROUTES)},status="5xx"`, 'branch')} > 0`,
    for: '0m',
    summary: 'Cell saves answer 500 in branch {{ $labels.branch }}.',
    routes: SAVE_ROUTES,
  },
  {
    alert: 'CellSavesSlow',
    rule: 'slow cell saves',
    expr: slow(routesMatcher(SAVE_ROUTES), 0.3, 'branch'),
    for: '10m',
    summary:
      'Cell saves take over 0.3 s (95th percentile) in branch {{ $labels.branch }} (12, Speed targets).',
    routes: SAVE_ROUTES,
  },
  {
    alert: 'RefusedSavesJump',
    rule: 'a jump in refused saves',
    expr: `max by (branch) (sodiq_branch_refused_saves) >= 20 and max by (branch) (sodiq_branch_refused_saves) > 3 * ${sameHourLastWeek('sodiq_branch_refused_saves')}`,
    for: '5m',
    summary:
      'Refused saves jumped in branch {{ $labels.branch }}: over 3 times the same hour of last week.',
    routes: [],
  },
  {
    alert: 'JobsFailing',
    rule: 'failed jobs',
    expr: 'sum by (branch, name) (sodiq_jobs_failed) > 0',
    for: '0m',
    summary: 'Job {{ $labels.name }} failed in the last hour (branch {{ $labels.branch }}).',
    routes: [],
  },
  {
    alert: 'BranchExportsFailing',
    rule: 'failed jobs',
    expr: 'max by (branch) (sodiq_branch_failed_exports) > 0',
    for: '0m',
    summary: 'A branch export failed in the last hour in branch {{ $labels.branch }}.',
    routes: [],
  },
  {
    alert: 'PublishOrCloseFailed',
    rule: 'a failed publish or close',
    expr: `${count(`${routesMatcher(PUBLISH_CLOSE_ROUTES)},status="5xx"`, 'route, branch')} > 0`,
    for: '0m',
    summary:
      'A publish or a close failed (500) in branch {{ $labels.branch }}: {{ $labels.route }}.',
    routes: PUBLISH_CLOSE_ROUTES,
  },
  {
    alert: 'NightlyCheckDifference',
    rule: 'a nightly-check difference',
    expr: 'max by (branch) (sodiq_branch_check_differences) > 0',
    for: '0m',
    summary: 'The nightly check found differences in branch {{ $labels.branch }}.',
    routes: [],
  },
  {
    alert: 'NightlyCheckLate',
    rule: 'a check that did not run',
    expr: `time() - max by (branch) (sodiq_branch_check_finished) > ${String(DAY_AND_TWO_HOURS)}`,
    for: '0m',
    summary: 'No nightly check finished in branch {{ $labels.branch }} for over 26 hours.',
    routes: [],
  },
  {
    alert: 'DailyWorkLate',
    rule: 'the daily work did not run',
    expr: `time() - max by (branch) (sodiq_branch_daily_enqueued) > ${String(DAY_AND_TWO_HOURS)}`,
    for: '0m',
    summary:
      'No daily work was enqueued in branch {{ $labels.branch }} for over 26 hours: the worker or its schedule is down.',
    routes: [],
  },
  {
    alert: 'BackupOld',
    rule: 'a backup older than 24 hours',
    expr: '(time() - max(max_over_time(sodiq_backup_last_success[48h]))) > 86400 or absent_over_time(sodiq_backup_last_success[48h])',
    for: '0m',
    summary: 'The newest daily export is older than 24 hours (Actions, Backup).',
    routes: [],
  },
  {
    alert: 'FirstSlotFewMarks',
    rule: 'few first-slot attendance marks by 09:00',
    // 04:00 to 04:30 UTC is 09:00 to 09:30 in Tashkent.
    expr:
      'max by (branch) (sodiq_branch_first_slot_lessons) >= 5' +
      ' and max by (branch) (sodiq_branch_first_slot_baseline_lessons) > 0' +
      ' and (max by (branch) (sodiq_branch_first_slot_marked) / max by (branch) (sodiq_branch_first_slot_lessons))' +
      ' < 0.5 * (max by (branch) (sodiq_branch_first_slot_baseline_marked) / max by (branch) (sodiq_branch_first_slot_baseline_lessons))' +
      ' and on () (hour() == 4 and minute() < 30)',
    for: '0m',
    summary:
      'Far fewer first-slot lessons have attendance by 09:00 than usual in branch {{ $labels.branch }}.',
    routes: [],
  },
  {
    alert: 'ServerErrors',
    rule: 'errors raise alerts at once',
    expr: `${count('status="5xx"', 'route')} > 0`,
    for: '0m',
    summary: 'The API answered 500 on {{ $labels.route }}.',
    routes: [],
  },
  {
    alert: 'SlowJournal',
    rule: 'slow pages: a quarter journal under 1 s',
    expr: slow(routesMatcher(JOURNAL_ROUTES), 1),
    for: '10m',
    summary: 'A quarter journal takes over 1 s in branch {{ $labels.branch }}.',
    routes: JOURNAL_ROUTES,
  },
  {
    alert: 'SlowSearch',
    rule: 'slow pages: search under 0.2 s',
    expr: slow(routesMatcher(SEARCH_ROUTES), 0.2),
    for: '10m',
    summary: 'Search takes over 0.2 s in branch {{ $labels.branch }}: {{ $labels.route }}.',
    routes: SEARCH_ROUTES,
  },
  {
    alert: 'SlowReports',
    rule: 'slow pages: a report under 2 s',
    expr: slow(routesMatcher(REPORT_ROUTES), 2),
    for: '10m',
    summary: 'A report takes over 2 s in branch {{ $labels.branch }}: {{ $labels.route }}.',
    routes: REPORT_ROUTES,
  },
  {
    alert: 'SlowPages',
    rule: 'slow pages: any other page under 1 s',
    expr: slow(`method="GET",route!="unmatched",${NOT_FILES},route!~"${listed.join('|')}"`, 1),
    for: '10m',
    summary: 'A page takes over 1 s in branch {{ $labels.branch }}: {{ $labels.route }}.',
    routes: [],
  },
  {
    alert: 'ApiSilent',
    rule: 'the push down',
    expr: stopped('sodiq_process_up{service="api"}'),
    for: '0m',
    summary: 'No numbers from the API for 10 minutes: the API or its push to Grafana is down.',
    routes: [],
  },
  {
    alert: 'WorkerSilent',
    rule: 'the worker down',
    expr: stopped('sodiq_process_up{service="worker"}'),
    for: '0m',
    summary: 'No numbers from the worker for 10 minutes: the worker or its push is down.',
    routes: [],
  },
  {
    alert: 'CountsSilent',
    rule: 'the counts stop arriving',
    expr: stopped('sodiq_counts_pushed'),
    for: '0m',
    summary:
      'The counts per branch stopped arriving for 10 minutes: the worker or pg-boss is down.',
    routes: [],
  },
];

/** The series every rule reads, by name. */
export function seriesOfRule(rule: AlertRule): string[] {
  return [...new Set(rule.expr.match(/\bsodiq_[a-z_]+/g) ?? [])];
}

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** The rule file in Prometheus rule format, as Grafana imports it. */
export function alertRulesYaml(): string {
  const lines = [
    '# Generated from apps/api/src/monitoring/alert-rules.ts (task 10.2a); do not edit.',
    '# Write it again with: pnpm --filter @sodiq/api monitoring:rules',
    '# Imported by the owner into Grafana Cloud (docs/monitoring.md).',
    `# Request durations are pushed per bound in seconds: ${DURATION_BOUNDS.join(', ')}, +Inf.`,
    `# Series: ${SERIES.join(', ')}.`,
    'groups:',
    '  - name: sodiq-production',
    '    interval: 1m',
    '    rules:',
  ];
  for (const rule of ALERT_RULES) {
    lines.push(
      `      - alert: ${rule.alert}`,
      `        expr: ${quote(rule.expr)}`,
      `        for: ${rule.for}`,
      '        labels:',
      '          severity: alert',
      '        annotations:',
      `          summary: ${quote(rule.summary)}`,
      `          rule: ${quote(rule.rule)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
