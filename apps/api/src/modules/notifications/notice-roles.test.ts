import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Task 10.11 (pull request #371), build line: "a test walks every call of `notifications.send`
// and fails for one that names no role". Every call of `Notifications.send` in the code of
// the application (and the browser tests' tool) is found with the TypeScript parser and must
// give `to`, whose type requires the roles of each person (`NotificationRecipient.for`), and
// never the `accountIds` of before; the database refuses an empty list (0177). The sites are
// held exact: a new call is added here, with the roles it names.

const SOURCE = join(import.meta.dirname, '..', '..');

/** Every call, as `<file>: <kind>` (the kind as written at the call). */
const SITES = [
  'modules/journal/corrections.ts: journal.correction',
  'modules/journal/corrections.ts: journal.correction_lesson',
  'modules/journal/corrections.ts: journal.correction_total',
  'modules/journal/exemption-effects.ts: journal.exemption_reopened',
  'modules/journal/exemption-follow.ts: journal.exemption_kept_block',
  'modules/journal/exemption-follow.ts: journal.exemption_offer',
  'modules/journal/exemptions.service.ts: journal.exemption_changed',
  'modules/journal/exemptions.service.ts: journal.exemption_granted',
  'modules/journal/unlocks.service.ts: journal.unlock_approved',
  'modules/journal/unlocks.service.ts: journal.unlock_refused',
  'modules/journal/unlocks.service.ts: journal.unlock_requested',
  'modules/people/relative-writes.ts: kind',
  'modules/plans/plan-delivery.service.ts: plans.not_delivered',
  'modules/plans/plan-follow.ts: plans.followed',
  'modules/plans/plan-follow.ts: plans.followed_counts',
  'modules/plans/plan-requests.service.ts: plans.request_approved',
  'modules/plans/plan-requests.service.ts: plans.request_approved',
  'modules/plans/plan-requests.service.ts: plans.request_refused',
  'modules/plans/plan-requests.service.ts: plans.request_sent',
  "modules/plans/plan-windows.service.ts: existing === undefined ? 'plans.window_opened' : 'plans.window_changed'",
  'modules/plans/plan-windows.service.ts: plans.window_extended',
  'modules/results/closing.service.ts: results.closing_reminder',
  'modules/results/closing.service.ts: results.quarter_locked_now',
  'modules/results/closing.service.ts: results.recalculated',
  'modules/results/daily/daily.service.ts: journal.lesson_about_to_lock',
  'modules/results/daily/daily.service.ts: plans.request_unsent',
  'modules/results/daily/daily.service.ts: plans.window_ending',
  'modules/results/daily/daily.service.ts: plans.window_last_day',
  'modules/results/daily/daily.service.ts: plans.window_missing',
  'modules/results/daily/daily.service.ts: results.check_difference',
  'modules/results/daily/daily.service.ts: results.check_missed',
  'modules/results/daily/daily.service.ts: results.closing_overdue',
  'modules/setup/subjects.service.ts: setup.quarter_weights_changed',
  'modules/timetable/absences.service.ts: kind',
  'modules/timetable/absences.service.ts: kind',
  'modules/timetable/calendar-lessons.ts: timetable.exam_day_off',
  'modules/timetable/forced-deletes.service.ts: kind',
  'modules/timetable/timetable.service.ts: timetable.draft_taken_over',
  'modules/timetable/tutor-changes.ts: timetable.tutor_changed',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: event.kind',
  'modules/timetable/week-changes.ts: timetable.substitution_assigned',
  'modules/timetable/week-changes.ts: timetable.substitutions_assigned',
  'testing/e2e/notify.ts: sample.message',
];

/** The `.ts` files of the application, without the tests. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** `this.notifications.send(…)`, `notifications.send(…)`, `app.get(Notifications).send(…)`. */
function isNoticeSend(call: ts.CallExpression, file: ts.SourceFile): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'send') return false;
  const receiver = callee.expression.getText(file);
  return /(^|\.)notifications$/.test(receiver) || receiver === 'app.get(Notifications)';
}

interface Site {
  name: string;
  fault: string | undefined;
}

function sitesOf(path: string): Site[] {
  const text = readFileSync(path, 'utf8');
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const name = relative(SOURCE, path).split('\\').join('/');
  const found: Site[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isNoticeSend(node, file)) {
      const notice = node.arguments[1];
      if (notice === undefined || !ts.isObjectLiteralExpression(notice)) {
        found.push({ name: `${name}: ?`, fault: 'the notice is not written at the call' });
      } else {
        const property = (key: string) =>
          notice.properties.find(
            (one) =>
              (ts.isPropertyAssignment(one) || ts.isShorthandPropertyAssignment(one)) &&
              one.name.getText(file) === key,
          );
        const kind = property('kind');
        const kindText =
          kind === undefined
            ? '?'
            : ts.isPropertyAssignment(kind)
              ? kind.initializer.getText(file).replace(/^'([^']*)'$/, '$1')
              : 'kind';
        found.push({
          name: `${name}: ${kindText.replace(/\s+/g, ' ')}`,
          fault:
            property('accountIds') !== undefined
              ? 'gives accountIds, which name no role'
              : property('to') === undefined
                ? 'names no recipient with roles (to)'
                : undefined,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('every call of notifications.send', () => {
  const sites = sources(SOURCE).flatMap(sitesOf);

  it('names the roles of each person it tells', () => {
    expect(sites.filter((site) => site.fault !== undefined)).toEqual([]);
  });

  it('is on the list, and the list holds every call (52)', () => {
    expect(sites.map((site) => site.name).sort()).toEqual([...SITES].sort());
    expect(SITES).toHaveLength(52);
  });

  it('would catch a call that names no role', () => {
    const file = ts.createSourceFile(
      'sample.ts',
      "await this.notifications.send(transaction, { kind: 'sample.message', accountIds: [id] });",
      ts.ScriptTarget.Latest,
      true,
    );
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isNoticeSend(node, file)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(calls).toHaveLength(1);
  });
});
