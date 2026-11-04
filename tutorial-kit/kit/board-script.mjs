// Writes out/place-lessons.js: a script to paste into the browser console on the test
// site's Draft builder (step 7, the board) or Teaching load page, signed in as the AVP
// of "Istirohat demo". It places every lesson of the kit's timetable sheets ("T <class>")
// that the open draft does not have yet, through the same request the board sends when
// a lesson is placed in an empty slot, so every rule of the board applies.
// Run: node board-script.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as K from './kit-data.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const DAY = { Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5 };
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// One entry per lesson of a unit (a class row, or a group): a group lesson appears in
// each class of the group, a block's groups at the same time; the script dedupes by block.
const seen = new Set();
const lessons = [];
for (const l of K.lessons()) {
  const unit = l.group ?? l.cls;
  const key = `${unit}|${l.subject}|${l.day}|${l.start}`;
  if (seen.has(key)) continue;
  seen.add(key);
  lessons.push({
    unit,
    kind: l.group ? 'group' : 'class',
    cls: l.cls,
    grade: K.CLASSES.find((c) => c.name === l.cls).grade,
    subject: l.subject,
    weekday: DAY[l.day],
    start: minutes(l.start),
    at: `${l.day} ${l.start}`,
    double: l.len === 2,
  });
}

const script = `// Places the lessons of "Istirohat demo" from the kit's timetable sheets, skipping those already on the board.
// Paste on app-test.sodiqschool.uz, signed in as the AVP, with the draft open (Teaching load or Draft builder).
(async () => {
  const LESSONS = ${JSON.stringify(lessons)};
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[ʻʼ'‘’\`]/g, '').replace(/[-‐–—]/g, '').replace(/\\s+/g, ' ').trim();
  let branch = null;
  const call = async (method, url, body) => {
    const headers = { 'X-App-Version': '1' };
    if (branch) headers['X-Branch-Id'] = branch;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw new Error(r.status + ' ' + text);
    return text ? JSON.parse(text) : null;
  };
  const session = await call('GET', '/api/auth/session');
  const mine = session.branches ?? [];
  const b = mine.find((x) => /istirohat/i.test(x.name)) ?? mine.find((x) => x.id === sessionStorage.getItem('sodiq.branch'));
  if (!b) throw new Error('This account has no branch named Istirohat demo.');
  branch = b.id;

  const versions = (await call('GET', '/api/timetable/versions')).versions;
  const fromUrl = new URLSearchParams(location.search).get('version');
  const version = versions.find((v) => v.id === fromUrl) ?? versions.find((v) => v.status === 'draft');
  if (!version || version.status !== 'draft') throw new Error('Open the draft first (its address has ?version=…).');

  const load = await call('GET', '/api/timetable/versions/' + version.id + '/load');
  let grid = await call('GET', '/api/timetable/versions/' + version.id + '/grid');
  const rowName = (row) => (row.unit.kind === 'class' ? row.unit.grades[0] + ' ' + row.unit.name : row.unit.name);
  const rowOf = (lesson) =>
    load.rows.find(
      (row) =>
        row.unit.kind === lesson.kind &&
        (norm(rowName(row)) === norm(lesson.unit) || norm(row.unit.name) === norm(lesson.unit)) &&
        [row.subject.names.uz, row.subject.names.ru, row.subject.names.en].some((n) => norm(n) === norm(lesson.subject)),
    );
  const blockOf = (row) => new Set([row.id, ...(row.block ?? []).map((part) => part.id)]);
  const slotOf = (lesson) => {
    const day = grid.facts.days.find((d) => d.grade === lesson.grade && d.weekday === lesson.weekday);
    if (!day || !day.day.lessons) return null;
    return day.day.day.slots.find((s) => s.kind === 'lesson' && s.start === lesson.start) ?? null;
  };

  // Check every lesson first; nothing is placed if one cannot be matched.
  const plan = [];
  const missing = [];
  for (const lesson of LESSONS) {
    const row = rowOf(lesson);
    const slot = slotOf(lesson);
    if (!row) missing.push('load row "' + lesson.unit + ' · ' + lesson.subject + '"');
    else if (!slot) missing.push('a lesson slot at ' + lesson.at + ' for grade ' + lesson.grade + ' (' + lesson.unit + ')');
    else plan.push({ lesson, row, slot });
  }
  if (missing.length) {
    console.error('Nothing placed. Not found:\\n- ' + [...new Set(missing)].join('\\n- '));
    return;
  }

  const placedAt = (row, weekday, start) => {
    const parts = blockOf(row);
    return grid.blocks.some((blk) => blk.weekday === weekday && blk.start === start && blk.lessons.some((one) => parts.has(one.loadRowId)));
  };
  let placed = 0, skipped = 0;
  const refused = [];
  for (const { lesson, row, slot } of plan) {
    if (placedAt(row, lesson.weekday, lesson.start)) { skipped += 1; continue; }
    try {
      grid = await call('POST', '/api/timetable/versions/' + version.id + '/pattern', {
        loadRowId: row.id,
        weekday: lesson.weekday,
        slotPosition: slot.position,
        ...(lesson.double ? { double: true } : {}),
      });
      placed += 1;
      console.log('Placed ' + lesson.unit + ' · ' + lesson.subject + ' · ' + lesson.at + (lesson.double ? ' (double)' : ''));
    } catch (e) {
      refused.push(lesson.unit + ' · ' + lesson.subject + ' · ' + lesson.at + ': ' + e.message);
      console.warn('Refused ' + lesson.unit + ' · ' + lesson.subject + ' · ' + lesson.at + ': ' + e.message);
    }
  }
  console.log('Done. Placed ' + placed + ', already there ' + skipped + ', refused ' + refused.length + '. Reload the page.');
  if (refused.length) console.error('Refused:\\n- ' + refused.join('\\n- '));
})();
`;
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'place-lessons.js'), script);
console.log(lessons.length, 'lessons written to out/place-lessons.js');
