// Builds the kit: two staff imports, two student imports (the first of each with planted mistakes),
// and the demo-branch data workbook. Fills the platform's own templates and reads every import
// back through the platform's own readers.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as K from './kit-data.mjs';

const API = '/home/user/sodiq-platform/apps/api';
const require = createRequire(API + '/package.json');
const ExcelJS = require('exceljs');
const shared = await import(require.resolve('@sodiq/shared'));
const staffTpl = await import(API + '/dist/modules/people/staff-import-template.js');
const staffRead = await import(API + '/dist/modules/people/staff-import-read.js');
const stuTpl = await import(API + '/dist/modules/people/student-import-template.js');
const stuRead = await import(API + '/dist/modules/people/student-import-read.js');

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const UZ = shared.STAFF_IMPORT_WORDS.uz;
const DEPT_UZ = { STEAM: 'STEAM', 'Foreign languages': 'Xorijiy tillar', National: 'Milliy fanlar', 'Natural sciences': 'Tabiiy fanlar', General: 'Umumiy fanlar', Tutors: 'Tyutorlar' };
const ACADEMIC = 'Oʻquv boʻlimi';

// ---------- lessons, groups, subjects per teacher ----------
const L = K.lessons();
const groupLessons = new Map(); // group -> unique lessons
for (const l of L) {
  if (!l.group) continue;
  const key = `${l.day}|${l.col}`;
  const m = groupLessons.get(l.group) ?? new Map();
  m.set(key, l);
  groupLessons.set(l.group, m);
}
const gradeOf = (cls) => K.CLASSES.find((c) => c.name === cls).grade;
const teach = new Map(); // teacher -> subject -> Set(grades)
for (const l of L) {
  if (l.teacher.startsWith('VACANCY') || ['Kelajak soati', 'Uy vazifasi'].includes(l.subject)) continue;
  const g = gradeOf(l.cls);
  const m = teach.get(l.teacher) ?? new Map();
  const s = m.get(l.subject) ?? new Set();
  s.add(g);
  m.set(l.subject, s);
  teach.set(l.teacher, m);
}
const gradesText = (set) => {
  const a = [...set].sort((x, y) => x - y);
  const parts = [];
  for (let i = 0; i < a.length; i += 1) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j += 1;
    parts.push(j > i ? `${a[i]}-${a[j]}` : String(a[i]));
    i = j;
  }
  return parts.join(', ');
};

// ---------- staff rows ----------
function staffRows(withMistakes) {
  return K.STAFF.map((s) => {
    const subjects = [...(teach.get(s.key) ?? new Map()).entries()].map(([subj, g]) => `${subj}: ${gradesText(g)}`);
    const row = {
      lastName: s.last, firstName: s.first, fatherName: s.father, sex: s.sex === 'm' ? UZ.sexes.male : UZ.sexes.female,
      birthDate: s.birth, educationLevel: s.education, phone: s.phone, email: '', jshshir: '',
      division: ACADEMIC, department: DEPT_UZ[s.dept],
      languages: s.both ? UZ.languages.both : UZ.languages.uz,
      admissionDate: s.admission, contractType: UZ.contractTypes.full_time, contractDate: '15.08.2026',
      role: s.role === 'Tutor' ? UZ.roles.tutor : UZ.roles.teacher,
    };
    subjects.forEach((text, i) => { row[`subject${i + 1}`] = text; });
    if (withMistakes) {
      if (s.key === 'alimov') row.role = UZ.roles.super_admin; // import_role_not_allowed
      if (s.key === 'raximova') row.phone = K.staffByKey.sharipov.phone; // duplicate_in_file
      if (s.key === 'haydarova') row.subject1 = 'Matematka qoʻshimcha: 11'; // name_unknown
    }
    return row;
  });
}

async function fillTemplate(buffer, sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.getWorksheet(sheetName);
  rows.forEach((row, i) => {
    const r = sheet.getRow(3 + i);
    columns.forEach((col, j) => {
      const v = row[col];
      if (v !== undefined && v !== '') r.getCell(j + 1).value = v;
    });
    r.commit();
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// School lists as the platform would hold them (seeded and created names), for the reader.
const uid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const divisions = [{ id: uid(1), names: ['Oʻquv boʻlimi', 'Учебный отдел', 'Academic'], builtIn: true }];
const deptNames = { STEAM: ['STEAM', 'STEAM', 'STEAM'], 'Foreign languages': ['Xorijiy tillar', 'Иностранные языки', 'Foreign languages'], National: ['Milliy fanlar', 'Национальные предметы', 'National'], 'Natural sciences': ['Tabiiy fanlar', 'Естественные науки', 'Natural sciences'], General: ['Umumiy fanlar', 'Общие предметы', 'General'], Tutors: ['Tyutorlar', 'Тьюторы', 'Tutors'] };
const departments = Object.entries(deptNames).map(([, names], i) => ({ id: uid(100 + i), names, divisionId: uid(1) }));
const SEED_EXTRA = [['Adabiyot', 'Литература', 'Literature'], ['Geografiya', 'География', 'Geography'], ['Biologiya', 'Биология', 'Biology'], ['Fizika', 'Физика', 'Physics'], ['Kimyo', 'Химия', 'Chemistry'], ['Texnologiya', 'Технология', 'Technology']];
const subjects = [...K.SUBJECTS.map((s) => [s.uz, s.ru, s.en]), ...SEED_EXTRA].map((names, i) => ({ id: uid(1000 + i), names }));
const lists = { divisions, departments, subjects };

const report = [];
async function checkStaff(file) {
  const rows = await staffRead.readStaffImportWorkbook(fs.readFileSync(file));
  const parsed = rows.map((r) => staffRead.parseStaffImportRow(r, lists));
  const across = staffRead.staffFileChecks(parsed);
  const problems = [];
  for (const p of parsed) {
    const all = [...p.problems, ...(across.problems.get(p.rowNumber) ?? [])];
    if (all.length) problems.push(`row ${p.rowNumber} ${p.shown.lastName} ${p.shown.firstName}: ${all.map((x) => `${x.column}:${x.code}`).join(', ')}`);
  }
  report.push(`${path.basename(file)}: ${rows.length} rows, ${problems.length} rows with problems`, ...problems.map((x) => '  ' + x));
}

const staffBuf = await staffTpl.writeStaffImportTemplate('uz', { divisions: ['Oʻquv boʻlimi'], departments: Object.values(DEPT_UZ), subjects: K.SUBJECTS.map((s) => s.uz) });
for (const [name, mistakes] of [['1 Xodimlar importi - xatolar bilan.xlsx', true], ['2 Xodimlar importi - toza.xlsx', false]]) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, await fillTemplate(staffBuf, shared.STAFF_IMPORT_SHEET, shared.STAFF_IMPORT_COLUMNS, staffRows(mistakes)));
  await checkStaff(file);
}

// ---------- students ----------
const ST = K.buildStudents();
const byCls = (cls) => ST.filter((s) => s.cls === cls);
// Prop: siblings. A 5 Tokyo student shares the mother of a 3 Genius student.
{
  const a = byCls('3 Genius')[2];
  const b = byCls('5 Tokyo')[3];
  const stem = a.last.endsWith('a') ? a.last.slice(0, -1) : a.last;
  b.last = b.sex === 'm' ? stem : `${stem}a`;
  b.relatives[0] = { ...a.relatives[0] };
  b.relatives[1] = { ...a.relatives[1] };
  a.notes.push(`Sibling of ${b.uid} (same mother and father)`);
  b.notes.push(`Sibling of ${a.uid} (same mother and father)`);
}
// Prop: a teacher is a parent. A 6 Imperial student's father is Otabek Normatov (his staff phone).
{
  const s = byCls('6 Imperial')[4];
  const t = K.staffByKey.normatov;
  s.last = s.sex === 'm' ? 'Normatov' : 'Normatova';
  s.father = `Otabek ${s.sex === 'm' ? 'oʻgʻli' : 'qizi'}`;
  s.relatives[1] = { name: `${t.last} ${t.first} ${t.father}`, rel: 'Father', phone: t.phone };
  s.relatives[0].name = `Normatova ${s.relatives[0].name.split(' ').slice(1).join(' ')}`;
  s.notes.push('Father = teacher Otabek Normatov: "Same person as a staff member" / "Also a parent"');
}
// Prop: a student entered twice (same name and birth date): the warning, then the Super Admin's merge.
const dupOf = byCls('5 Melbourne')[6];
const dup = { ...dupOf, cls: '(merged)', uid: 'IS26901', contract: 'IST-2026/901', relatives: dupOf.relatives.map((r) => ({ ...r })), notes: [`Entered twice: same as ${dupOf.uid}. Tick the warning, then the Super Admin merges IS26901 into ${dupOf.uid}`] };
dupOf.notes.push('Has a planted duplicate IS26901');
// Prop: a student who starts later, with no class yet.
const later = {
  uid: 'IS26902', last: 'Yoʻldosheva', first: 'Samira', father: 'Bahodir qizi', sex: 'f', birth: '14.03.2015', grade: 5, className: '', cls: '', startsOn: '01.12.2026',
  contract: 'IST-2026/902', contractOn: '20.11.2026', consent: '20.11.2026', diagnostic: 71, scholarship: null, region: 'Tashkent city', address: 'Toshkent, Yunusobod tumani, 4-uy',
  relatives: [{ name: 'Yoʻldosheva Hulkar Ilhom qizi', rel: 'Mother', phone: '+998935550123' }], notes: ['Starts 01.12.2026 with no class: "Starts later"; on that day the "Students with no class" tile; the AVP then places her in 5 London'],
};
ST.push(dup, later);

const STU_COLS = shared.STUDENT_IMPORT_COLUMNS;
const SW = shared.EXPORT_TEXTS.uz.student;
const relUz = { Mother: SW.relationships.mother, Father: SW.relationships.father };
const schUz = { Merit: SW.scholarshipTypes.merit, 'Financial aid': SW.scholarshipTypes.financial_aid };
const covUz = { Full: SW.scholarshipCoverages.full, Partial: SW.scholarshipCoverages.partial };
function studentRow(s) {
  const r = {
    uid: s.uid, lastName: s.last, firstName: s.first, paternalName: s.father, sex: s.sex === 'm' ? SW.sexes.male : SW.sexes.female,
    birthDate: s.birth, grade: s.grade, className: s.className, startsOn: s.startsOn, region: SW.regions.tashkent_city, address: s.address,
    diagnosticScore: s.diagnostic === '' ? undefined : s.diagnostic, contractNumber: s.contract, contractSignedOn: s.contractOn,
    consentSignedOn: s.consent || undefined,
  };
  if (s.scholarship) {
    r.scholarshipType = schUz[s.scholarship.type];
    r.scholarshipCoverage = covUz[s.scholarship.coverage];
    if (s.scholarship.amount) r.scholarshipAmount = s.scholarship.amount;
  }
  s.relatives.forEach((rel, i) => {
    r[`relative${i + 1}FullName`] = rel.name;
    r[`relative${i + 1}Relationship`] = relUz[rel.rel];
    r[`relative${i + 1}Phone`] = rel.phone;
  });
  return r;
}
function studentRows(withMistakes) {
  return ST.map((s, i) => {
    const r = studentRow(s);
    if (withMistakes) {
      if (s.uid === 'IS26020') delete r.contractNumber; // required
      if (s.uid === 'IS26040') r.className = 'Melborne'; // class_unknown (checked by the platform at preview)
      if (s.uid === 'IS26060') r.relative1Phone = ST.find((x) => x.uid === 'IS26061').relatives[0].phone; // phone_two_names_in_file
    }
    return r;
  });
}
async function checkStudents(file) {
  const rows = await stuRead.readImportWorkbook(fs.readFileSync(file));
  const parsed = rows.map((r) => stuRead.parseImportRow(r));
  const across = stuRead.fileChecks(parsed);
  const known = new Set(K.CLASSES.map((c) => `${c.grade}|${c.label.toLowerCase()}`));
  const problems = [];
  for (const p of parsed) {
    const all = [...p.problems, ...(across.problems.get(p.rowNumber) ?? [])].map((x) => `${x.column}:${x.code}`);
    if (p.className && !known.has(`${p.grade}|${p.className.toLowerCase()}`)) all.push('className:class_unknown');
    if (all.length) problems.push(`row ${p.rowNumber} ${p.shown.uid}: ${all.join(', ')}`);
  }
  const warn = [...across.sameNameAndBirth.entries()].map(([row, earlier]) => `row ${row} same name and birth date as row ${earlier.join(', ')} (warning to tick)`);
  report.push(`${path.basename(file)}: ${rows.length} rows, ${problems.length} rows with problems`, ...problems.map((x) => '  ' + x), ...warn.map((x) => '  ' + x));
}
const stuBuf = await stuTpl.writeImportTemplate('uz');
for (const [name, mistakes] of [['3 Oʻquvchilar importi - xatolar bilan.xlsx', true], ['4 Oʻquvchilar importi - toza.xlsx', false]]) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, await fillTemplate(stuBuf, shared.STUDENT_IMPORT_SHEET, STU_COLS, studentRows(mistakes)));
  await checkStudents(file);
}

// ---------- group members ----------
const members = new Map(K.GROUPS.map((g) => [g.name, []]));
const put = (g, s) => members.get(g).push(s);
const g5 = [...byCls('5 Melbourne'), ...byCls('5 Tokyo'), ...byCls('5 London')];
g5.forEach((s, i) => { put(['Matematika 5A', 'Matematika 5B', 'Matematika 5C'][i % 3], s); put(['Ingliz 5A', 'Ingliz 5B', 'Ingliz 5C'][(i + 1) % 3], s); });
// The duplicate is merged into ${dupOf.uid} before groups are filled: no group rows of its own.
const g3 = [...byCls('3 Genius'), ...byCls('3 Indigo')];
g3.forEach((s, i) => put(['Ingliz 3-1', 'Ingliz 3-2', 'Ingliz 3-3'][i % 3], s));
for (const cls of ['3 Genius', '3 Indigo']) byCls(cls).forEach((s, i) => put(`Arab ${cls} ${(i % 2) + 1}`, s));
for (const g of K.GROUPS.filter((x) => x.sex)) {
  for (const cls of g.classes) for (const s of byCls(cls)) if (s.sex === g.sex) put(g.name, s);
}
const g11 = [...byCls('11 Princeton'), ...byCls('11 Yale')];
g11.forEach((s) => put('Moliya 11AB', s));
const moliyaExempt = new Set(g11.filter((_, i) => i % 8 !== 0 && i % 8 !== 3 && i % 8 !== 5).map((s) => s.uid));

// ---------- the data workbook ----------
const wb = new ExcelJS.Workbook();
const head = (ws, cols) => {
  ws.columns = cols.map(([h, w]) => ({ header: h, width: w }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
};
{
  const ws = wb.addWorksheet('1 Subjects');
  head(ws, [['Name (uz)', 26], ['Name (ru)', 28], ['Name (en)', 28], ['Department', 18], ['Grades', 9], ['Group subject', 13], ['Already there?', 16], ['Note', 46]]);
  for (const s of K.SUBJECTS) ws.addRow([s.uz, s.ru, s.en, s.dept, s.grades, s.group ? 'Yes' : '', s.seed ? 'Yes (demo seed)' : 'Create', s.note ?? '']);
}
{
  const ws = wb.addWorksheet('2 Rooms');
  head(ws, [['Name or number', 16], ['Floor', 7], ['Type', 14], ['Capacity', 10], ['Lessons at the same time', 22], ['Used for', 70]]);
  ws.addRow(['Building: "Asosiy bino" (Main building), floors 1, 2 and 4']);
  for (const r of K.ROOMS) ws.addRow(r);
}
{
  const ws = wb.addWorksheet('3 Day templates');
  head(ws, [['Template', 22], ['Where it applies', 42], ['Slots in order from 09:00', 120]]);
  const L4 = 'Lesson 40, Break 15';
  ws.addRow(['Asosiy 5-8', 'The whole branch (default)', 'Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lunch 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40  → lunch 12:40–13:20, ends 16:05']);
  ws.addRow(['Boshlangʻich 1-4', 'A range of grades: 1 to 4', 'Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lunch 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40  → lunch 11:45–12:25, ends 16:05']);
  ws.addRow(['Yuqori 9-11', 'A range of grades: 9 to 11', 'Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lesson 40, Break 15, Lunch 40, Break 15, Lesson 40, Break 15, Lesson 40  → lunch 13:35–14:15, ends 16:05']);
  ws.addRow(['Juma 5-11', 'A weekday and a range of grades: Friday, 5 to 11', `${L4}, ${L4}, ${L4}, Lesson 40, Juma 125, Lesson 40, Break 15, Lesson 40  → free 12:25–14:30, ends 16:05`]);
  ws.addRow([]);
  ws.addRow(['Slot types', '', 'Lesson 40 (Lesson, 40) · Break 15 (Break, 15) · Lunch 40 (Break, 40) · Juma 125 (Break, 125)']);
  ws.addRow(['If two breaks may not follow each other', '', 'Use one break of 70 minutes in place of "Break 15, Lunch 40, Break 15"']);
}
{
  const ws = wb.addWorksheet('4 Classes and Tutors');
  head(ws, [['Class', 14], ['Grade', 7], ['Name', 12], ['Language', 10], ['Main classroom', 15], ['Max. students', 13], ['Tutor or Class teacher', 26], ['Role to give first (Super Admin)', 30]]);
  for (const c of K.CLASSES) ws.addRow([c.name, c.grade, c.label, c.lang === 'Rus' ? 'Russian' : 'Uzbek', c.room, 30, K.fullName(K.staffByKey[c.teacher]), c.role]);
}
{
  const ws = wb.addWorksheet('5 Groups');
  head(ws, [['Group', 22], ['Subject', 18], ['Classes', 34], ['Kind on screen', 40], ['Teacher', 26], ['Room', 12], ['Students', 9]]);
  for (const g of K.GROUPS) {
    const t = g.teacher.startsWith('VACANCY') ? `Vacancy: ${g.teacher.split(':')[1]}` : K.fullName(K.staffByKey[g.teacher]);
    ws.addRow([g.name, g.subj, g.classes.join(', '), g.kind, t, g.room, members.get(g.name).length]);
  }
}
{
  const ws = wb.addWorksheet('6 Group members');
  head(ws, [['Group', 22], ['UID', 10], ['Surname and name', 30], ['Class', 14], ['Sex', 6], ['Note', 50]]);
  for (const g of K.GROUPS) for (const s of members.get(g.name)) ws.addRow([g.name, s.uid, `${s.last} ${s.first}`, s.cls, s.sex === 'm' ? 'Boy' : 'Girl', g.name === 'Moliya 11AB' && moliyaExempt.has(s.uid) ? 'Does not take Moliya: full exemption (Journal → Exemptions)' : '']);
}
{
  const ws = wb.addWorksheet('7 Teaching load');
  head(ws, [['Class or group', 22], ['Subject', 22], ['Teacher', 28], ['Lessons per week', 15], ['Room', 12], ['Double lessons allowed', 20], ['Block with', 40]]);
  const rows = [];
  for (const [g, m] of groupLessons) {
    const ls = [...m.values()];
    const def = K.GROUPS.find((x) => x.name === g);
    const t = def.teacher.startsWith('VACANCY') ? `Vacancy: ${def.teacher.split(':')[1]}` : K.fullName(K.staffByKey[def.teacher]);
    const block = K.GROUPS.filter((x) => x !== def && x.subj === def.subj && x.classes.join() === def.classes.join()).map((x) => x.name).join(', ');
    rows.push([g, def.subj, t, ls.reduce((a, l) => a + l.len, 0), def.room, ls.some((l) => l.len === 2) ? 'Yes' : '', block || '(one group)']);
  }
  const cl = new Map();
  for (const l of L.filter((x) => !x.group)) {
    const k = `${l.cls}|${l.subject}`;
    const e = cl.get(k) ?? { cls: l.cls, subject: l.subject, teacher: l.teacher, n: 0, dbl: false };
    e.n += l.len; e.dbl ||= l.len === 2; cl.set(k, e);
  }
  for (const e of cl.values()) {
    const auto = ['Kelajak soati', 'Uy vazifasi'].includes(e.subject);
    const t = e.teacher.startsWith('VACANCY') ? `Vacancy: ${e.teacher.split(':')[1]}` : auto ? `(fills itself: ${K.fullName(K.staffByKey[e.teacher])})` : K.fullName(K.staffByKey[e.teacher]);
    rows.push([e.cls, e.subject, t, e.n, '', e.dbl ? 'Yes' : '', '']);
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
  for (const r of rows) ws.addRow(r);
  ws.addRow([]);
  ws.addRow(['Room empty = the class’s main classroom. 6 Imperial: Matematika and Ingliz tili entered as whole-class rows (its real grade-6 blocks are not built).']);
}
// Timetable grids, one sheet per class.
for (const c of K.CLASSES) {
  const ws = wb.addWorksheet(`T ${c.name}`.slice(0, 31));
  ws.columns = [{ width: 11 }, ...K.COL.map(() => ({ width: 24 }))];
  ws.addRow([c.name, ...K.COL.map((t, i) => `${t}–${K.END[i]}`)]).font = { bold: true };
  const lunchCol = c.grade <= 4 ? 4 : c.grade <= 8 ? 5 : 6;
  for (const d of K.DAYS) {
    const cells = K.COL.map(() => '');
    if (d !== 'Fr' || c.grade <= 4) cells[lunchCol - 1] = 'LUNCH (Oshxona)';
    for (const l of L.filter((x) => x.cls === c.name && x.day === d)) {
      const t = l.teacher.startsWith('VACANCY') ? `Vacancy: ${l.teacher.split(':')[1]}` : K.fullName(K.staffByKey[l.teacher]);
      const text = `${l.subject}${l.group ? ` [${l.group}]` : ''}\n${t} · ${l.room}${l.len === 2 ? '\n(double)' : ''}`;
      for (let i = 0; i < l.len; i += 1) cells[l.col - 1 + i] = cells[l.col - 1 + i] ? `${cells[l.col - 1 + i]}\n—\n${text}` : text;
    }
    const row = ws.addRow([K.DAY_NAMES[d], ...cells]);
    row.alignment = { wrapText: true, vertical: 'top' };
    row.height = 75;
  }
}
{
  const ws = wb.addWorksheet('8 Working hours');
  head(ws, [['Teacher', 30], ['Monday–Friday', 18], ['Note', 60]]);
  for (const s of K.STAFF) ws.addRow([K.fullName(s), '09:00–16:05', s.role === 'Tutor' ? 'Tutor: holds Kelajak soati, so needs hours too' : 'People → Staff → the teacher → Availability → Change from a date']);
}
{
  const ws = wb.addWorksheet('9 Planted props');
  head(ws, [['Where', 26], ['Who', 34], ['What it unlocks', 90]]);
  ws.addRow(['1 Staff import (mistakes)', 'Alimov Bobur', 'Role "Super administrator": "import_role_not_allowed" — only Teacher or Tutor can be imported']);
  ws.addRow(['1 Staff import (mistakes)', 'Raximova Laylo', 'Same phone as Sharipov Ilhom: both rows refused as a duplicate in the file']);
  ws.addRow(['1 Staff import (mistakes)', 'Haydarova Gulnoza', 'Subject "Matematka qoʻshimcha" (typo): no such subject']);
  ws.addRow(['3 Student import (mistakes)', 'IS26020', 'No contract number: required']);
  ws.addRow(['3 Student import (mistakes)', 'IS26040', 'Class "Melborne" (typo): no such class']);
  ws.addRow(['3 Student import (mistakes)', 'IS26060', 'Mother’s phone is another family’s phone under another name: refused until fixed']);
  for (const s of ST.filter((x) => x.notes.length)) ws.addRow(['4 Student import (clean)', `${s.uid} ${s.last} ${s.first}`, s.notes.join('; ')]);
  ws.addRow(['4 Student import (clean)', 'eight students (one per class)', 'No consent date: the Students filter "Active, no consent"']);
  ws.addRow(['4 Student import (clean)', 'two per class', 'Scholarships (Merit full, Financial aid partial): the Contract and scholarship tab']);
  ws.addRow(['Staff (clean)', 'Normatov Otabek', '"Also a parent" once the student import is saved']);
  ws.addRow(['Staff (clean)', 'every imported teacher', 'No working hours: builder step 3 "No hours set" until sheet 8 is entered']);
}
const dataFile = path.join(OUT, '5 Demo filial maʼlumotlari.xlsx');
await wb.xlsx.writeFile(dataFile);

fs.writeFileSync(path.join(OUT, 'check-report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
console.log('students', ST.length, 'staff', K.STAFF.length, 'moliya exempt', moliyaExempt.size);
for (const [g, m] of members) console.log(g, m.length);
