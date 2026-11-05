import { createServer, type IncomingMessage } from 'node:http';
import { BRANCH_HEADER, REQUEST_KEY_HEADER } from '@sodiq/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { percentile95, runLoad, type LoadPerson } from './load-run.js';

// Task 10.1: the runner of the load run, against a small server of its own, so
// the Speed workflow never meets a broken runner (the plan's Tests).
const seen: { method: string; url: string; cookie: string; branch: string; key: boolean }[] = [];
const server = createServer((request: IncomingMessage, response) => {
  seen.push({
    method: request.method ?? '',
    url: request.url ?? '',
    cookie: request.headers.cookie ?? '',
    branch: String(request.headers[BRANCH_HEADER.toLowerCase()] ?? ''),
    key: request.headers[REQUEST_KEY_HEADER.toLowerCase()] !== undefined,
  });
  response.statusCode = request.url === '/refused' ? 403 : 200;
  response.end('{}');
});

afterAll(() => {
  server.close();
});

describe('percentile95', () => {
  it('is the nearest rank of the 95th percentile', () => {
    expect(percentile95(Array.from({ length: 100 }, (_, index) => index + 1))).toBe(95);
    expect(percentile95([3, 1, 2])).toBe(3);
    expect(percentile95([])).toBe(0);
  });
});

describe('runLoad', () => {
  it("runs each user's actions in turn with its own session and branch, and counts refusals", async () => {
    const person = (branchId: string, path: string): LoadPerson => ({
      role: 'teacher',
      accountId: 'unused',
      branchId,
      actions: [
        { name: 'read', method: 'GET', path },
        { name: 'save', method: 'POST', path: '/save', body: { one: 1 } },
      ],
    });
    const { times } = await runLoad(
      [server],
      [
        { person: person('branch-a', '/read'), cookie: 'session=a' },
        { person: person('branch-b', '/refused'), cookie: 'session=b' },
      ],
      { users: 2, durationMs: 1500, gapMs: [50, 100] },
    );
    expect(times.read?.runs.length).toBeGreaterThan(0);
    expect(times.save?.failures).toBe(0);
    expect(times.read?.statuses['403']).toBeGreaterThan(0);
    expect(times.read?.failures).toBe(times.read?.statuses['403']);
    expect(seen.some((one) => one.cookie === 'session=a' && one.branch === 'branch-a')).toBe(true);
    expect(seen.some((one) => one.cookie === 'session=b' && one.branch === 'branch-b')).toBe(true);
    expect(seen.filter((one) => one.method === 'POST').every((one) => one.key)).toBe(true);
    expect(seen.filter((one) => one.method === 'GET').some((one) => one.key)).toBe(false);
  });

  it('spreads the users over the processes, each user kept to one (task 10.1c: two API processes)', async () => {
    const byServer: string[][] = [[], []];
    const servers = byServer.map((cookies) =>
      createServer((request: IncomingMessage, response) => {
        cookies.push(request.headers.cookie ?? '');
        response.end('{}');
      }),
    );
    try {
      const person: LoadPerson = {
        role: 'teacher',
        accountId: 'unused',
        branchId: 'branch-a',
        actions: [{ name: 'read', method: 'GET', path: '/read' }],
      };
      const users = ['a', 'b', 'c', 'd'].map((one) => ({ person, cookie: `session=${one}` }));
      const { perProcess } = await runLoad(servers, users, {
        users: 4,
        durationMs: 1000,
        gapMs: [50, 100],
      });
      const [first = [], second = []] = byServer;
      expect(perProcess).toEqual([first.length, second.length]);
      expect(first.length).toBeGreaterThan(0);
      expect(second.length).toBeGreaterThan(0);
      // No session reaches both processes.
      expect(new Set(first).size + new Set(second).size).toBe(4);
      expect([...new Set(first)].filter((one) => second.includes(one))).toEqual([]);
    } finally {
      for (const one of servers) one.close();
    }
  });
});
