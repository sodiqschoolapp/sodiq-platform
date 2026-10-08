import type { ErrorEvent } from '@sentry/browser';
import { describe, expect, it, vi } from 'vitest';
import { pageOf, REPORTED_KEYS, reportedEvent, rootOptions } from './reporting';

const INVENTED_PERSON = 'Nodira Rasulova';

/** An event as the SDK could build it in a browser, with everything that must not leave. */
function fullEvent(): ErrorEvent {
  return {
    type: undefined,
    event_id: 'e1',
    timestamp: 1_760_000_000,
    platform: 'javascript',
    level: 'error',
    environment: 'test',
    release: 'abc123',
    sdk: { name: 'sentry.javascript.browser', version: '0.0.0' },
    transaction: `/people?search=${encodeURIComponent(INVENTED_PERSON)}`,
    breadcrumbs: [{ category: 'fetch', data: { url: `/api/people?search=${INVENTED_PERSON}` } }],
    contexts: { browser: { name: 'Chrome' }, os: { name: 'Windows' } },
    extra: { row: { name: INVENTED_PERSON } },
    user: { id: 'account-1', ip_address: '10.0.0.1' },
    tags: { page: 'people' },
    request: {
      url: `https://app-test.example/people?search=${encodeURIComponent(INVENTED_PERSON)}#row-3`,
      headers: { 'User-Agent': 'Chrome', Referer: `https://app-test.example/people?search=x` },
    },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'x is not a function',
          mechanism: { type: 'onerror', handled: false },
          stacktrace: {
            frames: [
              {
                filename: 'index-abc.js',
                function: 'draw',
                lineno: 1,
                vars: { p: INVENTED_PERSON },
              },
            ],
          },
        },
      ],
    },
  };
}

// docs/spec/13-technology.md, Monitoring: Sentry for errors. CLAUDE.md: no
// personal data in error reports. The list pattern puts the typed search in
// the address of the page (0.8b-1), so the address leaves without its query.
describe('what a report of the web app holds', () => {
  it('keeps exactly the allowed keys, whatever the SDK added', () => {
    expect(Object.keys(reportedEvent(fullEvent())).sort()).toEqual([...REPORTED_KEYS].sort());
    expect(Object.keys(fullEvent()).length).toBeGreaterThan(REPORTED_KEYS.length);
  });

  it('keeps the page without its query and hash, and no header', () => {
    expect(reportedEvent(fullEvent()).request).toEqual({ url: 'https://app-test.example/people' });
    expect(reportedEvent({ ...fullEvent(), request: {} })).not.toHaveProperty('request');
  });

  it('keeps the error with its frames, without their variables', () => {
    expect(reportedEvent(fullEvent()).exception).toEqual({
      values: [
        {
          type: 'TypeError',
          value: 'x is not a function',
          mechanism: { type: 'onerror', handled: false },
          stacktrace: { frames: [{ filename: 'index-abc.js', function: 'draw', lineno: 1 }] },
        },
      ],
    });
  });

  it('leaves nothing of the person, the session, the search or the browser', () => {
    const text = JSON.stringify(reportedEvent(fullEvent()));

    for (const secret of [
      INVENTED_PERSON,
      'Nodira',
      'search=',
      '#row-3',
      'account-1',
      '10.0.0.1',
      'Chrome',
      'Windows',
      'Referer',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it.each([
    ['https://app-test.example/people?search=x', 'https://app-test.example/people'],
    ['https://app-test.example/people#row', 'https://app-test.example/people'],
    ['/journal/42?week=3#cell', '/journal/42'],
    ['/timetable', '/timetable'],
  ])('cuts %s to %s', (url, page) => {
    expect(pageOf(url)).toBe(page);
  });
});

describe("React's root", () => {
  it('reports a fault it caught and one nobody caught', () => {
    const report = vi.fn();
    const options = rootOptions(report);
    const uncaught = new Error('while drawing');
    const caught = new Error('in a boundary');

    options.onUncaughtError(uncaught);
    options.onCaughtError(caught);

    expect(report.mock.calls).toEqual([[uncaught], [caught]]);
  });
});
