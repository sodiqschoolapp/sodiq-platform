// Writes out/add-teaching-load.js: a script to paste into the browser console on the
// test site's Teaching load page (signed in as the AVP of "Istirohat demo"). It adds
// every row of sheet "7 Teaching load" that the open draft does not have yet, through
// the same requests the "Add row" form sends, so every rule and the audit log apply.
// Run: node load-script.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as K from './kit-data.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const L = K.lessons();

const teacherOf = (key, subject) => {
  if (key.startsWith('VACANCY')) return { vacancy: key.split(':')[1] };
  if (['Kelajak soati', 'Uy vazifasi'].includes(subject)) return { tutor: true };
  return { person: K.fullName(K.staffByKey[key]) };
};

const rows = [];
const groupLessons = new Map();
for (const l of L) {
  if (!l.group) continue;
  const m = groupLessons.get(l.group) ?? new Map();
  m.set(`${l.day}|${l.col}`, l);
  groupLessons.set(l.group, m);
}
for (const [g, m] of groupLessons) {
  const ls = [...m.values()];
  const def = K.GROUPS.find((x) => x.name === g);
  rows.push({
    unit: g,
    kind: 'group',
    subject: def.subj,
    teacher: teacherOf(def.teacher, def.subj),
    lessons: ls.reduce((a, l) => a + l.len, 0),
    room: def.room || null,
    double: ls.some((l) => l.len === 2),
  });
}
const cl = new Map();
for (const l of L.filter((x) => !x.group)) {
  const k = `${l.cls}|${l.subject}`;
  const e = cl.get(k) ?? { cls: l.cls, subject: l.subject, teacher: l.teacher, n: 0, dbl: false };
  e.n += l.len;
  e.dbl ||= l.len === 2;
  cl.set(k, e);
}
for (const e of cl.values()) {
  rows.push({
    unit: e.cls,
    kind: 'class',
    subject: e.subject,
    teacher: teacherOf(e.teacher, e.subject),
    lessons: e.n,
    room: null,
    double: e.dbl,
  });
}
rows.sort((a, b) => a.unit.localeCompare(b.unit) || a.subject.localeCompare(b.subject));

const script = `// Adds the teaching load of "Istirohat demo" (sheet 7 of the kit), skipping rows already there.
// Paste on app-test.sodiqschool.uz, Timetable → Teaching load, signed in as the AVP, with the draft open.
(async () => {
  const ROWS = ${JSON.stringify(rows)};
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[ʻʼ'‘’\`]/g, '').replace(/\\s+/g, ' ').trim();
  let branch = null;
  const call = async (method, url, body) => {
    const headers = { 'X-App-Version': '1' };
    if (branch) headers['X-Branch-Id'] = branch;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + text);
    return data;
  };
  const list = (answer, key) => (Array.isArray(answer) ? answer : answer[key]);

  // The branch: the one this tab chose in the switcher, else Istirohat demo among the account's branches.
  const session = await call('GET', '/api/auth/session');
  const mine = session.branches ?? [];
  const b = mine.find((x) => /istirohat/i.test(x.name)) ?? mine.find((x) => x.id === sessionStorage.getItem('sodiq.branch'));
  if (!b) throw new Error('This account has no branch named Istirohat demo. Its branches: ' + mine.map((x) => x.name).join(', '));
  branch = b.id;

  const versions = list(await call('GET', '/api/timetable/versions'), 'versions');
  const fromUrl = new URLSearchParams(location.search).get('version');
  const version = versions.find((v) => v.id === fromUrl) ?? versions.find((v) => v.status === 'draft');
  if (!version) throw new Error('Open the draft on the Teaching load page first.');

  const classes = list(await call('GET', '/api/classes'), 'classes').filter((c) => !version.academicYearId || c.academicYearId === version.academicYearId);
  const groups = list(await call('GET', '/api/groups'), 'groups').filter((g) => !version.academicYearId || g.academicYearId === version.academicYearId);
  const subjects = list(await call('GET', '/api/setup/subjects'), 'subjects');
  const rooms = list(await call('GET', '/api/setup/rooms'), 'rooms');
  const load = await call('GET', '/api/timetable/versions/' + version.id + '/load');

  const unitOf = (row) =>
    row.kind === 'class'
      ? classes.find((c) => norm(c.grade + ' ' + c.name) === norm(row.unit) || norm(c.name) === norm(row.unit))
      : groups.find((g) => norm(g.name) === norm(row.unit));
  const subjectOf = (name) =>
    subjects.find((s) => [s.names.uz, s.names.ru, s.names.en].some((n) => norm(n) === norm(name)));
  const roomOf = (name) => rooms.find((r) => norm(r.name) === norm(name));
  const have = new Set(load.rows.map((r) => r.unit.id + '|' + r.subject.id));

  // Check every name first; nothing is saved if one is missing.
  const plan = [];
  const missing = [];
  for (const row of ROWS) {
    const unit = unitOf(row);
    const subject = subjectOf(row.subject);
    const room = row.room ? roomOf(row.room) : null;
    if (!unit) missing.push('class or group "' + row.unit + '"');
    if (!subject) missing.push('subject "' + row.subject + '" (' + row.unit + ')');
    if (row.room && !room) missing.push('room "' + row.room + '" (' + row.unit + ')');
    if (unit && subject) plan.push({ row, unit, subject, room });
  }
  if (missing.length) {
    console.error('Nothing saved. Not found on the site:\\n- ' + [...new Set(missing)].join('\\n- '));
    return;
  }

  let added = 0, skipped = 0;
  for (const { row, unit, subject, room } of plan) {
    if (have.has(unit.id + '|' + subject.id)) { skipped += 1; continue; }
    const where = row.kind === 'class' ? { classId: unit.id } : { groupId: unit.id };
    const q = new URLSearchParams({ ...where, subjectId: subject.id });
    const t = await call('GET', '/api/timetable/versions/' + version.id + '/load/teachers?' + q);
    let teacherId = null;
    if (!t.tutorRow) {
      const found = row.teacher.vacancy
        ? t.teachers.find((x) => x.kind === 'vacancy' && norm(x.name).includes(norm(row.teacher.vacancy)))
        : (t.teachers.find((x) => x.kind === 'person' && norm(x.name).startsWith(norm(row.teacher.person))) ??
          t.teachers.find((x) => x.kind === 'person' && norm(row.teacher.person).split(' ').every((w) => norm(x.name).includes(w))));
      if (!found) {
        console.error('Stopped at ' + row.unit + ' · ' + row.subject + ': teacher "' + (row.teacher.person ?? row.teacher.vacancy) + '" is not offered. Offered: ' + t.teachers.map((x) => x.name).join(', '));
        return;
      }
      teacherId = found.id;
    }
    try {
      await call('POST', '/api/timetable/versions/' + version.id + '/load', {
        ...(row.kind === 'class' ? { classId: unit.id, groupId: null } : { classId: null, groupId: unit.id }),
        subjectId: subject.id,
        teacherId,
        lessonsPerWeek: row.lessons,
        roomId: room ? room.id : null,
        roomType: null,
        doubleLessons: row.double,
        mixedBlock: false,
      });
      added += 1;
      console.log('Added ' + row.unit + ' · ' + row.subject + ' (' + row.lessons + ')');
    } catch (e) {
      console.error('Stopped at ' + row.unit + ' · ' + row.subject + ': ' + e.message);
      console.log('Added ' + added + ', already there ' + skipped + '. Fix the problem and paste the script again: it skips what is saved.');
      return;
    }
  }
  console.log('Done. Added ' + added + ' rows, ' + skipped + ' were already there. Reload the page.');
})();
`;
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'add-teaching-load.js'), script);
console.log(rows.length, 'rows written to out/add-teaching-load.js');
