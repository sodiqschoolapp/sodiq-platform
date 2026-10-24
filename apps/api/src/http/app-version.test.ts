import { APP_VERSION, APP_VERSION_HEADER, OLDEST_APP_VERSION } from '@sodiq/shared';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { appVersionCheck } from './app-version.js';

interface Outcome {
  passed: boolean;
  status?: number;
  code?: string;
}

/** Runs the check with the oldest accepted version 3 on one request. */
function run(method: string, path: string, version?: string): Outcome {
  const outcome: Outcome = { passed: false };
  const headers: Record<string, string> = {};
  const request = {
    method,
    path,
    headers: version === undefined ? {} : { [APP_VERSION_HEADER.toLowerCase()]: version },
  } as unknown as Request;
  const response = {
    headersSent: false,
    getHeader: (name: string) => headers[name],
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    status(status: number) {
      outcome.status = status;
      return this;
    },
    json(body: { error?: { code?: string } }) {
      outcome.code = body.error?.code;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    outcome.passed = true;
  };
  appVersionCheck(3)(request, response, next);
  return outcome;
}

// Task 8.3a: docs/spec/edge-cases/system-behaviour.md, "A release goes out at
// 19:00; a tab opened at 14:00 sends old-format entries next morning": "Every
// request carries the application version. Entries from the previous version
// are accepted for at least one release; otherwise the page asks to reload".
describe('the application version of a request', () => {
  it('accepts the previous release', () => {
    expect(OLDEST_APP_VERSION).toBe(APP_VERSION - 1);
  });

  it('refuses a write from a version older than the oldest accepted with app_outdated', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(run(method, '/api/journal/lessons/x/attendance', '2'), method).toEqual({
        passed: false,
        status: 409,
        code: 'app_outdated',
      });
    }
  });

  it('accepts a write of the oldest accepted version, a newer one and one without the header', () => {
    for (const version of ['3', '4', undefined]) {
      expect(run('POST', '/api/things', version).passed, String(version)).toBe(true);
    }
  });

  it('refuses a version that is not a whole number with 400', () => {
    for (const version of ['x', '1.5', '-1', '']) {
      expect(run('POST', '/api/things', version), version).toEqual({
        passed: false,
        status: 400,
        code: 'validation_failed',
      });
    }
  });

  it('never refuses a read, the sign-in or a feedback report for the version (decision 9)', () => {
    expect(run('GET', '/api/journal/journals', '1').passed).toBe(true);
    expect(run('HEAD', '/api/journal/journals', 'x').passed).toBe(true);
    expect(run('POST', '/api/auth/sign-in', '1').passed).toBe(true);
    expect(run('POST', '/api/auth/second-step', 'x').passed).toBe(true);
    // A feedback report from an outdated page still arrives, with its version.
    expect(run('POST', '/api/feedback', '1').passed).toBe(true);
    // A path that only begins with the same letters is a write like any other.
    expect(run('POST', '/api/authors', '1').passed).toBe(false);
  });
});
