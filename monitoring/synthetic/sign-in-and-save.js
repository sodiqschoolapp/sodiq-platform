// The sign-in-and-save check (task 10.2b; `edge/system-behaviour`: "A test teacher account signs
// in and saves a cell in a test class every 5 minutes from 07:00"). A Grafana Synthetic Monitoring
// k6 scripted check, job `sign-in-and-save`, every 5 minutes from an EU probe
// (`docs/monitoring.md`, step 10). The owner pastes this file as it is; the login and the password
// of the test teacher are the check's two secrets, never written here.
//
// It signs in, reads today's 06:30 lesson of the hidden Monitoring branch from the teacher's home,
// reads the first student's attendance cell from the journal, switches it between present (1)
// and late (2) with the cell's version, so each run is a real save with its history, and signs
// out. A step that fails, or a save slower than 0.3 s (`12`, cell save), fails the run. Nothing
// of an answer is logged.
import http from 'k6/http';
import secrets from 'k6/secrets';
import { check, fail } from 'k6';

const BASE = __ENV.SODIQ_BASE_URL || 'https://app.sodiqschool.uz';
const PRESENT = 1;
const LATE = 2;
const SAVE_MS = 300;
const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

function key() {
  // A fresh request key for each change (the server refuses a reused one).
  let hex = '';
  for (let index = 0; index < 32; index += 1) hex += Math.floor(Math.random() * 16).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

async function call(method, path, body, branch, name) {
  const headers = { ...JSON_HEADERS };
  if (branch !== undefined) headers['X-Branch-Id'] = branch;
  if (method !== 'GET') headers['Idempotency-Key'] = key();
  const response = await http.asyncRequest(
    method,
    `${BASE}${path}`,
    method === 'GET' ? null : JSON.stringify(body),
    { headers, tags: { name } },
  );
  if (!check(response, { [`${name} answered 2xx`]: (r) => r.status >= 200 && r.status < 300 })) {
    fail(`${name}: ${String(response.status)}`);
  }
  return response;
}

export default async function () {
  const login = await secrets.get('monitoring-teacher-login');
  const password = await secrets.get('monitoring-teacher-password');

  const session = (
    await call('POST', '/api/auth/sign-in', { login, password }, undefined, 'sign-in')
  ).json();
  const branch = session.branches.length === 1 ? session.branches[0].id : undefined;
  if (branch === undefined) fail('sign-in: the test teacher has not exactly one branch');
  try {
    const home = (await call('GET', '/api/timetable/home', undefined, branch, 'home')).json();
    const lesson = home.lessons.find((one) => one.date === home.today && one.journalId !== null);
    if (lesson === undefined) fail('home: no lesson of today with a journal');

    const grid = (
      await call('GET', `/api/journal/journals/${lesson.journalId}`, undefined, branch, 'journal')
    ).json();
    const column = grid.lessons.findIndex((one) => one.id === lesson.id);
    const student = grid.students[0];
    const cell = student === undefined || column < 0 ? undefined : student.cells[column];
    if (cell === undefined) fail('journal: no cell of the lesson');

    const save = await call(
      'POST',
      `/api/journal/lessons/${lesson.id}/attendance`,
      {
        saves: [
          {
            studentId: student.id,
            mark: cell.mark === PRESENT ? LATE : PRESENT,
            version: cell.version,
          },
        ],
      },
      branch,
      'save',
    );
    if (!check(save, { 'save under 0.3 s': (r) => r.timings.duration < SAVE_MS })) {
      fail(`save: ${String(Math.round(save.timings.duration))} ms`);
    }
  } finally {
    await call('POST', '/api/auth/sign-out', {}, branch, 'sign-out');
  }
}
