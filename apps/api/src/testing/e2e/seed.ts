import { NestFactory } from '@nestjs/core';
import { createDatabase } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { Assignments } from '../../modules/access/assignments.service.js';
import { Audit } from '../../modules/audit/audit.service.js';
import { Accounts } from '../../modules/auth/accounts.service.js';
import { FirstAccountModule } from '../../modules/auth/first-account.command.js';
import { relativeNameKey, studentNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import { insertBranch, setEditDays } from '../branch-filter-sql.js';
import { LessonsKit } from '../lessons-kit.js';
import { linkRelative } from '../relatives-kit.js';
import { e2eDatabaseUrls } from './database.js';
import { E2E_RESET_EMAIL } from './mail.js';

// Run by Playwright's global setup after the API of the browser tests has
// started: creates the accounts the tests sign in with, in `sodiq_e2e` only,
// and prints them as one line of JSON. No route creates an account before
// task 2.3. Every name is invented.

/** An account without a role per test: a first password and no required second step. */
const WITHOUT_ROLE = {
  uz: ['Dilnoza', 'Rahimova'],
  ru: ['Timur', 'Aliev'],
  en: ['Kamila', 'Yusupova'],
  wrongPassword: ['Bobur', 'Karimov'],
  trust: ['Zarina', 'Tursunova'],
  patterns: ['Malika', 'Sobirova'],
  forms: ['Sardor', 'Nazarov'],
  shellTools: ['Nilufar', 'Qodirova'],
  account: ['Gulnoza', 'Mirzayeva'],
  accountSecondStep: ['Otabek', 'Rashidov'],
  notifications: ['Sabina', 'Toshmatova'],
} as const;

type Credentials = { login: string; password: string };

const urls = e2eDatabaseUrls();
process.env.DATABASE_URL = urls.appUrl;

const migrator = createDatabase(urls.migrationUrl);
const app = await NestFactory.createApplicationContext(FirstAccountModule, { logger: ['error'] });
try {
  const transactions = app.get(Transactions, { strict: false });
  const accounts = app.get(Accounts, { strict: false });
  const assignments = app.get(Assignments, { strict: false });
  const audit = app.get(Audit, { strict: false });

  const create = async (firstName: string, lastName: string) =>
    transactions.run([], (transaction) =>
      accounts.create(transaction, { firstName, lastName, createdBy: null }),
    );

  const seeded: Record<string, Credentials> = {};
  // Task 3.1b, decision 2: a student who starts today or earlier joins a
  // class, so the branches whose tests add students get a class of grades 7
  // and 8 in each of their years.
  const classBranches: string[] = [];
  for (const [key, [firstName, lastName]] of Object.entries(WITHOUT_ROLE)) {
    const account = await create(firstName, lastName);
    seeded[key] = { login: account.login, password: account.firstPassword };
  }

  // The second step is required for the Academic Vice Principal of a branch.
  const branchId = await insertBranch(migrator, 'Browser test branch');
  const vicePrincipal = await create('Sardor', 'Nazarov');
  await transactions.run([branchId], (transaction) =>
    assignments.give(transaction, {
      accountId: vicePrincipal.id,
      role: 'academic_vice_principal',
      branchId,
      givenBy: null,
    }),
  );
  seeded.vicePrincipal = { login: vicePrincipal.login, password: vicePrincipal.firstPassword };

  // The Super Admin of the setup tests (task 1.1): the role only; the test
  // sets up the required second step itself, as the Academic Vice Principal's does.
  const superAdmin = await create('Nodira', 'Ergasheva');
  await transactions.run([], (transaction) =>
    assignments.give(transaction, {
      accountId: superAdmin.id,
      role: 'super_admin',
      branchId: null,
      givenBy: null,
    }),
  );
  seeded.superAdmin = { login: superAdmin.login, password: superAdmin.firstPassword };

  // The Super Admin of the divisions test (task 1.2): the same, one account per test.
  const divisions = await create('Gulnora', 'Yusupova');
  await transactions.run([], (transaction) =>
    assignments.give(transaction, {
      accountId: divisions.id,
      role: 'super_admin',
      branchId: null,
      givenBy: null,
    }),
  );
  seeded.divisions = { login: divisions.login, password: divisions.firstPassword };

  // The Super Admin of the academic years test (task 1.3), with a branch of
  // its own, so that its years and its top bar meet no other test's.
  await insertBranch(migrator, 'Years browser test branch');
  const years = await create('Shahlo', 'Nurmatova');
  await transactions.run([], (transaction) =>
    assignments.give(transaction, {
      accountId: years.id,
      role: 'super_admin',
      branchId: null,
      givenBy: null,
    }),
  );
  seeded.years = { login: years.login, password: years.firstPassword };

  // The Academic Vice Principal of the day templates test (task 1.5), in a
  // branch of its own, so that its slot types and templates meet no other test's.
  const templatesBranch = await insertBranch(migrator, 'Templates browser test branch');
  const templates = await create('Malika', 'Tursunova');
  await transactions.run([templatesBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: templates.id,
      role: 'academic_vice_principal',
      branchId: templatesBranch,
      givenBy: null,
    }),
  );
  seeded.templates = { login: templates.login, password: templates.firstPassword };

  // The Academic Vice Principal of the calendar test (task 1.4), in a branch of
  // its own with a year around today and a default template "Main" of two
  // lessons, written by the migrator: the calendar needs both, and no route of
  // this role writes a year. The year starts 100 days before today in
  // Tashkent and lasts 364 days, moved earlier when it would end in its own
  // calendar year (a year ends in the next one, task 1.3).
  const calendarBranch = await insertBranch(migrator, 'Calendar browser test branch');
  const calendar = await create('Feruza', 'Xolmatova');
  await transactions.run([calendarBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: calendar.id,
      role: 'academic_vice_principal',
      branchId: calendarBranch,
      givenBy: null,
    }),
  );
  const dayMs = 24 * 60 * 60 * 1000;
  const tashkentToday = new Date(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(Date.now()),
  );
  let yearStart = new Date(tashkentToday.getTime() - 100 * dayMs);
  if (new Date(yearStart.getTime() + 364 * dayMs).getUTCFullYear() === yearStart.getUTCFullYear()) {
    yearStart = new Date(yearStart.getTime() - 10 * dayMs);
  }
  const isoDate = (moment: Date) => moment.toISOString().slice(0, 10);
  const startDate = isoDate(yearStart);
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: calendarBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: calendarBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const lesson = await transaction
      .insertInto('slot_types')
      .values({ branch_id: calendarBranch, name: 'Lesson 45', kind: 'lesson' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('slot_type_lengths')
      .values({
        branch_id: calendarBranch,
        slot_type_id: lesson.id,
        length_minutes: 45,
        valid_from: startDate,
      })
      .execute();
    const template = await transaction
      .insertInto('day_templates')
      .values({ branch_id: calendarBranch, name: 'Main' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const version = await transaction
      .insertInto('day_template_versions')
      .values({
        branch_id: calendarBranch,
        day_template_id: template.id,
        start_minutes: 480,
        valid_from: startDate,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('day_template_slots')
      .values(
        [1, 2].map((position) => ({
          version_id: version.id,
          branch_id: calendarBranch,
          position,
          slot_type_id: lesson.id,
        })),
      )
      .execute();
    await transaction
      .insertInto('day_template_assignments')
      .values({
        branch_id: calendarBranch,
        level: 'default',
        day_template_id: template.id,
        valid_from: startDate,
      })
      .execute();
  });
  seeded.calendar = { login: calendar.login, password: calendar.firstPassword };

  // The Academic Vice Principal of the settings test (task 1.6), in a branch
  // of its own with a planned year around today of four undated quarters,
  // written by the migrator (no route of this role writes a year).
  const settingsBranch = await insertBranch(migrator, 'Settings browser test branch');
  const settings = await create('Sevara', 'Qodirova');
  await transactions.run([settingsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: settings.id,
      role: 'academic_vice_principal',
      branchId: settingsBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: settingsBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: settingsBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
  });
  seeded.settings = { login: settings.login, password: settings.firstPassword };

  // The Academic Vice Principal of the subjects test (task 2.1), in a branch
  // of its own with a planned year of four undated quarters, written by the
  // migrator as for the settings test.
  const subjectsBranch = await insertBranch(migrator, 'Subjects browser test branch');
  const subjects = await create('Malika', 'Yusupova');
  await transactions.run([subjectsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: subjects.id,
      role: 'academic_vice_principal',
      branchId: subjectsBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: subjectsBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: subjectsBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
  });
  seeded.subjects = { login: subjects.login, password: subjects.firstPassword };

  // The Academic Vice Principal of the staff test (task 2.2a) in a branch of
  // its own, a teacher of that branch and a subject of STEAM to give the
  // teacher. The Super Admin, who alone adds a person, cannot be seeded once
  // more: at most 3 exist (MAX_SUPER_ADMINS), and the setup tests hold them.
  // Written by the migrator.
  const staffBranch = await insertBranch(migrator, 'Staff browser test branch');
  const staff = await create('Sevara', 'Nurmatova');
  await transactions.run([staffBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: staff.id,
      role: 'academic_vice_principal',
      branchId: staffBranch,
      givenBy: null,
    }),
  );
  const academic = await migrator
    .selectFrom('divisions')
    .select('id')
    .where('built_in', '=', true)
    .executeTakeFirstOrThrow();
  const steam = await migrator
    .selectFrom('departments')
    .select('id')
    .where('name_en', '=', 'STEAM')
    .executeTakeFirstOrThrow();
  await migrator
    .insertInto('subjects')
    .values({
      name_uz: 'Geometriya',
      name_ru: 'Геометрия',
      name_en: 'Geometry',
      department_id: steam.id,
      grades: [7, 8, 9],
      colour: 'green',
      journal_type: 'graded',
    })
    .execute();
  await migrator.transaction().execute(async (transaction) => {
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269001',
        first_name: 'Oybek',
        last_name: 'Qoʻchqorov',
        sex: 'male',
        birth_date: '1987-04-12',
        phone: '+998935554433',
        admission_date: '2026-09-01',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: staffBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
  });
  seeded.staff = { login: staff.login, password: staff.firstPassword };

  // A person with no account, in a branch of its own, for the account test
  // (task 2.3a): the Super Admin of the divisions test creates the account
  // and gives a role, since no fourth Super Admin can be seeded.
  const accountsBranch = await insertBranch(migrator, 'Accounts browser test branch');
  await migrator.transaction().execute(async (transaction) => {
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269010',
        first_name: 'Feruza',
        last_name: 'Aminova',
        sex: 'female',
        birth_date: '1991-02-14',
        phone: '+998935550101',
        admission_date: '2026-09-01',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: accountsBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
  });

  // Two people with accounts and two subjects in the same branch, for the
  // Head Teacher appointments of task 2.3b-1: the divisions test's Super Admin
  // appoints the first and is refused a second Head Teacher of a subject.
  for (const [n, first, last, phone] of [
    [1, 'Rustam', 'Nazarov', '+998935550102'],
    [2, 'Saida', 'Yusupova', '+998935550103'],
  ] as const) {
    const account = await create(first, last);
    await migrator.transaction().execute(async (transaction) => {
      const person = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: `S-26902${String(n)}`,
          first_name: first,
          last_name: last,
          sex: n === 1 ? 'male' : 'female',
          birth_date: '1985-05-20',
          phone,
          admission_date: '2026-09-01',
          account_id: account.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: person.id, branch_id: accountsBranch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: person.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
    });
  }
  for (const [uz, ru, enName] of [
    ['Algebra', 'Алгебра', 'Algebra'],
    ['Trigonometriya', 'Тригонометрия', 'Trigonometry'],
  ] as const) {
    await migrator
      .insertInto('subjects')
      .values({
        name_uz: uz,
        name_ru: ru,
        name_en: enName,
        department_id: steam.id,
        grades: [9, 10, 11],
        colour: 'indigo',
        journal_type: 'graded',
      })
      .execute();
  }

  // A second Academic Vice Principal of that branch exports its staff list
  // (task 2.2c-1); the export reads and changes nothing.
  const staffExport = await create('Kamola', 'Rasulova');
  await transactions.run([staffBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: staffExport.id,
      role: 'academic_vice_principal',
      branchId: staffBranch,
      givenBy: null,
    }),
  );
  seeded.staffExport = { login: staffExport.login, password: staffExport.firstPassword };

  // A third one opens the staff list in both themes for the design screenshots
  // (task 2.2d-1, pull request #60); it reads and changes nothing but the theme.
  const design = await create('Shahlo', 'Usmonova');
  await transactions.run([staffBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: design.id,
      role: 'academic_vice_principal',
      branchId: staffBranch,
      givenBy: null,
    }),
  );
  seeded.design = { login: design.login, password: design.firstPassword };

  // The Academic Vice Principal of a branch of its own, with three rooms there,
  // who also teaches there and in the first branch: the one-row top bar with
  // both switchers (the Teacher has two branches) and the Rooms list at a
  // laptop width (task 2.7b-2, finding 14).
  // The seed has its three Super Admins already, so the alerts line of a phone
  // (finding 30) is proved by the unit tests.
  const topBarBranch = await insertBranch(migrator, 'Top bar browser test branch');
  const topBar = await create('Dildora', 'Rasulova');
  for (const teaches of [branchId, topBarBranch]) {
    await transactions.run([teaches], (transaction) =>
      assignments.give(transaction, {
        accountId: topBar.id,
        role: 'teacher',
        branchId: teaches,
        givenBy: null,
      }),
    );
  }
  await transactions.run([topBarBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: topBar.id,
      role: 'academic_vice_principal',
      branchId: topBarBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const building = await transaction
      .insertInto('buildings')
      .values({ branch_id: topBarBranch, name: 'Main building with a long name' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const floor = await transaction
      .insertInto('floors')
      .values({ branch_id: topBarBranch, building_id: building.id, name: 'Ground floor' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('rooms')
      .values(
        (['101', '102', 'Sports hall'] as const).map((name, index) => ({
          branch_id: topBarBranch,
          floor_id: floor.id,
          name,
          type: index === 2 ? 'sports_hall' : 'classroom',
          capacity: index === 2 ? 120 : 28,
          status: 'in_use',
          shared: index === 2,
          max_simultaneous_lessons: index === 2 ? 2 : null,
        })),
      )
      .execute();
  });
  seeded.topBar = { login: topBar.login, password: topBar.firstPassword };

  // A branch of its own with an Academic Vice Principal who adds the photo of
  // a person of the branch (task 2.2c-2, decision 2); the photos of the
  // browser tests live in memory (PHOTOS_IN_MEMORY of server.ts).
  const photoBranch = await insertBranch(migrator, 'Photo browser test branch');
  const staffPhoto = await create('Malika', 'Tursunova');
  await transactions.run([photoBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: staffPhoto.id,
      role: 'academic_vice_principal',
      branchId: photoBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269002',
        first_name: 'Shahzod',
        last_name: 'Mirzayev',
        sex: 'male',
        birth_date: '1989-11-03',
        phone: '+998935550022',
        admission_date: '2026-09-01',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: photoBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
  });
  seeded.staffPhoto = { login: staffPhoto.login, password: staffPhoto.firstPassword };

  // A branch of its own with an Academic Vice Principal for the brand moments
  // (task 2.2d-2): one person of the branch for a list with its side panel,
  // and no vacancy, so the vacancies page is an empty page. Nothing else
  // writes to this branch.
  const brandBranch = await insertBranch(migrator, 'Brand browser test branch');
  const brand = await create('Feruza', 'Abdullayeva');
  await transactions.run([brandBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: brand.id,
      role: 'academic_vice_principal',
      branchId: brandBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269003',
        first_name: 'Gʻayrat',
        last_name: 'Oʻrinboyev',
        sex: 'male',
        birth_date: '1990-02-21',
        phone: '+998935550033',
        admission_date: '2026-09-01',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: brandBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
  });
  seeded.brand = { login: brand.login, password: brand.firstPassword };

  // A branch of its own with an Academic Vice Principal who locks, unlocks
  // and resets the password of a Teacher of the branch (task 2.3c-1). The
  // Teacher's account is linked to the record and nobody signs in with it.
  const accessBranch = await insertBranch(migrator, 'Access browser test branch');
  const accessVice = await create('Zarina', 'Qosimova');
  await transactions.run([accessBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: accessVice.id,
      role: 'academic_vice_principal',
      branchId: accessBranch,
      givenBy: null,
    }),
  );
  const accessTeacher = await create('Sherzod', 'Valiyev');
  await transactions.run([accessBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: accessTeacher.id,
      role: 'teacher',
      branchId: accessBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269004',
        first_name: 'Sherzod',
        last_name: 'Valiyev',
        sex: 'male',
        birth_date: '1991-07-14',
        phone: '+998935550044',
        admission_date: '2026-09-01',
        account_id: accessTeacher.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: accessBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
  });
  seeded.accountAccess = { login: accessVice.login, password: accessVice.firstPassword };

  // The Academic Vice Principal of the students test (task 2.4a), in a branch
  // of its own with a planned year around today of four undated quarters,
  // written by the migrator as for the settings test: the UID set of a new
  // student is read from the year of its start date.
  const studentsBranch = await insertBranch(migrator, 'Students browser test branch');
  classBranches.push(studentsBranch);
  const studentsVice = await create('Nilufar', 'Ahmedova');
  await transactions.run([studentsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: studentsVice.id,
      role: 'academic_vice_principal',
      branchId: studentsBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: studentsBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: studentsBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
  });
  seeded.students = { login: studentsVice.login, password: studentsVice.firstPassword };

  // The Academic Vice Principal of the leaving test (task 2.4b-1), in a branch
  // of its own with the same planned year around today.
  const leavingBranch = await insertBranch(migrator, 'Leaving browser test branch');
  classBranches.push(leavingBranch);
  const leavingVice = await create('Sevara', 'Xolmatova');
  await transactions.run([leavingBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: leavingVice.id,
      role: 'academic_vice_principal',
      branchId: leavingBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: leavingBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: leavingBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
  });
  seeded.leaving = { login: leavingVice.login, password: leavingVice.firstPassword };

  // The Academic Vice Principal of the student export test (task 2.4b-2), in
  // a branch of its own with the same planned year around today.
  const exportBranch = await insertBranch(migrator, 'Student export browser test branch');
  classBranches.push(exportBranch);
  const exportVice = await create('Dilfuza', 'Saidova');
  await transactions.run([exportBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: exportVice.id,
      role: 'academic_vice_principal',
      branchId: exportBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: exportBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: exportBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
  });
  seeded.studentExport = { login: exportVice.login, password: exportVice.firstPassword };

  // An Academic Vice Principal of two branches, each with the planned year
  // around today, for a relative shared across branches (task 2.5a).
  const relativesVice = await create('Shahlo', 'Mirzayeva');
  for (const name of ['Relatives browser test branch A', 'Relatives browser test branch B']) {
    const relativesBranch = await insertBranch(migrator, name);
    classBranches.push(relativesBranch);
    await transactions.run([relativesBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: relativesVice.id,
        role: 'academic_vice_principal',
        branchId: relativesBranch,
        givenBy: null,
      }),
    );
    await migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({
          branch_id: relativesBranch,
          start_date: startDate,
          end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('quarters')
        .values(
          [1, 2, 3, 4].map((number) => ({
            branch_id: relativesBranch,
            academic_year_id: year.id,
            number,
          })),
        )
        .execute();
    });
  }
  seeded.relatives = { login: relativesVice.login, password: relativesVice.firstPassword };

  // Two branches, each with an Academic Vice Principal of its own, for the
  // new owner of a phone (task 2.5b-1): branch B has a student whose relative
  // holds +998 90 555 01 37; the Academic Vice Principal of A gives the number
  // to a new relative and the one of B is told.
  const ownersVice = await create('Mohira', 'Tojiyeva');
  const ownersOtherVice = await create('Ulugʻbek', 'Hamroyev');
  for (const [name, vice] of [
    ['Phone owners browser test branch A', ownersVice],
    ['Phone owners browser test branch B', ownersOtherVice],
  ] as const) {
    const ownersBranch = await insertBranch(migrator, name);
    classBranches.push(ownersBranch);
    await transactions.run([ownersBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: vice.id,
        role: 'academic_vice_principal',
        branchId: ownersBranch,
        givenBy: null,
      }),
    );
    await migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({
          branch_id: ownersBranch,
          start_date: startDate,
          end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('quarters')
        .values(
          [1, 2, 3, 4].map((number) => ({
            branch_id: ownersBranch,
            academic_year_id: year.id,
            number,
          })),
        )
        .execute();
      if (vice !== ownersOtherVice) {
        return;
      }
      const student = await transaction
        .insertInto('students')
        .values({
          branch_id: ownersBranch,
          uid: '9999301',
          first_name: 'Bekzod',
          last_name: 'Aliyev',
          name_key: studentNameKey('Aliyev', 'Bekzod'),
          sex: 'male',
          birth_date: '2013-03-04',
          grade: 8,
          starts_on: startDate,
          created_by: vice.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('student_uids')
        .values({
          uid: '9999301',
          student_id: student.id,
          branch_id: ownersBranch,
          held_from: new Date(),
        })
        .execute();
      await transaction
        .insertInto('student_contracts')
        .values({
          student_id: student.id,
          branch_id: ownersBranch,
          number: 'E2E-OWNERS-1',
          signed_on: startDate,
        })
        .execute();
      await transaction
        .insertInto('student_statuses')
        .values({
          student_id: student.id,
          branch_id: ownersBranch,
          status: 'active',
          valid_from: startDate,
          cause: 'start',
        })
        .execute();
      await transaction
        .insertInto('student_accounts')
        .values({ student_id: student.id, branch_id: ownersBranch, created_at: new Date() })
        .execute();
      await linkRelative(transaction, student.id, ownersBranch, new Date(), {
        fullName: 'Zarina Aliyeva',
        phone: '+998905550137',
      });
    });
  }
  seeded.phoneOwners = { login: ownersVice.login, password: ownersVice.firstPassword };
  seeded.phoneOwnersOther = {
    login: ownersOtherVice.login,
    password: ownersOtherVice.firstPassword,
  };

  // A branch with a parent and a teacher of the same family name, for the
  // extra phone and the mark "same person" (task 2.5b-2).
  const sameVice = await create('Dildora', 'Rahmonova');
  const sameBranch = await insertBranch(migrator, 'Same person browser test branch');
  classBranches.push(sameBranch);
  await transactions.run([sameBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: sameVice.id,
      role: 'academic_vice_principal',
      branchId: sameBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: sameBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: sameBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const student = await transaction
      .insertInto('students')
      .values({
        branch_id: sameBranch,
        uid: '9999401',
        first_name: 'Sevara',
        last_name: 'Yusupova',
        name_key: studentNameKey('Yusupova', 'Sevara'),
        sex: 'female',
        birth_date: '2014-06-07',
        grade: 7,
        starts_on: startDate,
        created_by: sameVice.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('student_uids')
      .values({
        uid: '9999401',
        student_id: student.id,
        branch_id: sameBranch,
        held_from: new Date(),
      })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({
        student_id: student.id,
        branch_id: sameBranch,
        number: 'E2E-SAME-1',
        signed_on: startDate,
      })
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: student.id,
        branch_id: sameBranch,
        status: 'active',
        valid_from: startDate,
        cause: 'start',
      })
      .execute();
    await transaction
      .insertInto('student_accounts')
      .values({ student_id: student.id, branch_id: sameBranch, created_at: new Date() })
      .execute();
    await linkRelative(transaction, student.id, sameBranch, new Date(), {
      fullName: 'Kamola Yusupova',
      phone: '+998905550141',
    });
    // Farrux Yusupov takes Kamola Yusupova's phone in the test; a new parent
    // is added with Dilnoza Qodirova's and takes her name and email (task 3.6b-1).
    for (const teacher of [
      {
        staff_id: 'S-269401',
        first_name: 'Farrux',
        last_name: 'Yusupov',
        sex: 'male',
        birth_date: '1983-02-10',
        phone: '+998935550141',
        email: null,
      },
      {
        staff_id: 'S-269402',
        first_name: 'Dilnoza',
        last_name: 'Qodirova',
        sex: 'female',
        birth_date: '1986-05-12',
        phone: '+998935550143',
        email: 'd.qodirova@example.uz',
      },
    ] as const) {
      const person = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          ...teacher,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: person.id, branch_id: sameBranch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: person.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
    }
  });
  seeded.samePerson = { login: sameVice.login, password: sameVice.firstPassword };

  // A Tutor in one branch and a Teacher in two: the role and branch switchers.
  const second = await insertBranch(migrator, 'Second browser test branch');
  const switchers = await create('Jamshid', 'Ismoilov');
  for (const held of [
    { role: 'tutor', branchId },
    { role: 'teacher', branchId },
    { role: 'teacher', branchId: second },
  ] as const) {
    await transactions.run([held.branchId], (transaction) =>
      assignments.give(transaction, { accountId: switchers.id, ...held, givenBy: null }),
    );
  }
  seeded.switchers = { login: switchers.login, password: switchers.firstPassword };

  // A teacher with an email on the record, in a branch of their own, for the
  // password reset by email and the own photo (task 2.3c-2). The address is
  // invented; the mail is only written to the outbox of the browser tests.
  const resetBranch = await insertBranch(migrator, 'Email reset browser test branch');
  const emailReset = await create('Madina', 'Xolmatova');
  await transactions.run([resetBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: emailReset.id,
      role: 'teacher',
      branchId: resetBranch,
      givenBy: null,
    }),
  );
  const resetPerson = await migrator.transaction().execute(async (transaction) => {
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269040',
        first_name: 'Madina',
        last_name: 'Xolmatova',
        sex: 'female',
        birth_date: '1993-03-15',
        phone: '+998935550140',
        email: E2E_RESET_EMAIL,
        admission_date: '2026-09-01',
        account_id: emailReset.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: resetBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
    return person.id;
  });
  // The entry a Super Admin's creation of the record writes: an email that no
  // entry names opens no account (decision 22 of pull request #66).
  const adminAssignment = await migrator
    .selectFrom('assignments')
    .select('id')
    .where('account_id', '=', superAdmin.id)
    .where('role', '=', 'super_admin')
    .executeTakeFirstOrThrow();
  await transactions.run([resetBranch], (transaction) =>
    audit.record(transaction, {
      branchId: resetBranch,
      actorId: superAdmin.id,
      assignmentId: adminAssignment.id,
      personId: resetPerson,
      action: 'staff.create',
      record: { type: 'staff', id: resetPerson },
      newValue: { email: E2E_RESET_EMAIL },
    }),
  );
  seeded.emailReset = { login: emailReset.login, password: emailReset.firstPassword };

  // The Audit log (task 2.6a): an Academic Vice Principal and a Principal of a
  // branch of their own, with one student and the entry of its creation by the
  // Academic Vice Principal, its address among the values (Identity, hidden
  // from the Principal with a logged show).
  const auditBranch = await insertBranch(migrator, 'Audit browser test branch');
  const auditVice = await create('Rustam', 'Ergashev');
  const auditPrincipal = await create('Shahnoza', 'Yoqubova');
  const auditGiven = await transactions.run([auditBranch], async (transaction) => {
    const vice = await assignments.give(transaction, {
      accountId: auditVice.id,
      role: 'academic_vice_principal',
      branchId: auditBranch,
      givenBy: null,
    });
    await assignments.give(transaction, {
      accountId: auditPrincipal.id,
      role: 'principal',
      branchId: auditBranch,
      givenBy: null,
    });
    return vice;
  });
  const auditStudent = await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: auditBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: auditBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    // The staff record of the Academic Vice Principal: the log names the actor.
    const viceRecord = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269050',
        first_name: 'Rustam',
        last_name: 'Ergashev',
        sex: 'male',
        birth_date: '1984-05-06',
        phone: '+998935550150',
        admission_date: '2026-09-01',
        account_id: auditVice.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: viceRecord.id, branch_id: auditBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: viceRecord.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: viceRecord.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
    const student = await transaction
      .insertInto('students')
      .values({
        branch_id: auditBranch,
        uid: '9999501',
        first_name: 'Oydin',
        last_name: 'Murodova',
        name_key: studentNameKey('Murodova', 'Oydin'),
        sex: 'female',
        birth_date: '2013-09-14',
        address: 'Bodomzor 9',
        grade: 7,
        starts_on: startDate,
        created_by: auditVice.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('student_uids')
      .values({
        uid: '9999501',
        student_id: student.id,
        branch_id: auditBranch,
        held_from: new Date(),
      })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({
        student_id: student.id,
        branch_id: auditBranch,
        number: 'E2E-AUDIT-1',
        signed_on: startDate,
      })
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: student.id,
        branch_id: auditBranch,
        status: 'active',
        valid_from: startDate,
        cause: 'start',
      })
      .execute();
    await transaction
      .insertInto('student_accounts')
      .values({ student_id: student.id, branch_id: auditBranch, created_at: new Date() })
      .execute();
    await linkRelative(transaction, student.id, auditBranch, new Date(), {
      fullName: 'Feruza Murodova',
    });
    return student.id;
  });
  await transactions.run([auditBranch], (transaction) =>
    audit.record(transaction, {
      branchId: auditBranch,
      actorId: auditVice.id,
      assignmentId: auditGiven.id,
      action: 'student.create',
      record: { type: 'student', id: auditStudent },
      newValue: {
        uid: '9999501',
        firstName: 'Oydin',
        lastName: 'Murodova',
        birthDate: '2013-09-14',
        address: 'Bodomzor 9',
      },
    }),
  );
  seeded.auditVice = { login: auditVice.login, password: auditVice.firstPassword };
  seeded.auditPrincipal = { login: auditPrincipal.login, password: auditPrincipal.firstPassword };

  // A Principal of a branch of their own, who reads every section of People:
  // the People tabs at phone width (task 2.7a, finding 8 of the hand test of
  // 13 October 2026). Reads only.
  const tabsBranch = await insertBranch(migrator, 'People tabs browser test branch');
  const peopleTabs = await create('Zilola', 'Hamroyeva');
  await transactions.run([tabsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: peopleTabs.id,
      role: 'principal',
      branchId: tabsBranch,
      givenBy: null,
    }),
  );
  seeded.peopleTabs = { login: peopleTabs.login, password: peopleTabs.firstPassword };

  // The visit of every page of Phases 0 to 2 (task 2.7c-1, pull request #80,
  // decision 8): an Academic Vice Principal who also teaches, in a branch of
  // its own with one record of each list (a building with a floor and rooms,
  // a year with quarters, a slot type, a template, a person, a student and a
  // parent), so every list has a record to open in its side panel. Written by
  // the migrator; the test reads and changes nothing but the theme.
  // Also opened by the Super Admin in setup.spec.ts for the new-record panels
  // of task 2.7c-2a: "Add room" there needs this branch's active floor.
  const pagesBranch = await insertBranch(migrator, 'Pages browser test branch');
  const pages = await create('Jasur', 'Tojiboyev');
  const pagesGiven = await transactions.run([pagesBranch], async (transaction) => {
    const vice = await assignments.give(transaction, {
      accountId: pages.id,
      role: 'academic_vice_principal',
      branchId: pagesBranch,
      givenBy: null,
    });
    await assignments.give(transaction, {
      accountId: pages.id,
      role: 'teacher',
      branchId: pagesBranch,
      givenBy: null,
    });
    return vice;
  });
  await migrator.transaction().execute(async (transaction) => {
    const building = await transaction
      .insertInto('buildings')
      .values({ branch_id: pagesBranch, name: 'Main building' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const floor = await transaction
      .insertInto('floors')
      .values({ branch_id: pagesBranch, building_id: building.id, name: 'First floor' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('rooms')
      .values(
        (['201', '202'] as const).map((name) => ({
          branch_id: pagesBranch,
          floor_id: floor.id,
          name,
          type: 'classroom' as const,
          capacity: 26,
          status: 'in_use' as const,
          shared: false,
          max_simultaneous_lessons: null,
        })),
      )
      .execute();
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: pagesBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: pagesBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    // Task 3.1a: a class, so that the class list opens with a record.
    await transaction
      .insertInto('classes')
      .values({
        branch_id: pagesBranch,
        academic_year_id: year.id,
        grade: 5,
        name: 'Cambridge',
        language: 'uz',
        max_size: 24,
      })
      .execute();
    // Task 3.2a: a class of grade 7 with a group, so that the group list opens
    // with a record. The group comes after the class rows of the class, below.
    await transaction
      .insertInto('classes')
      .values({
        branch_id: pagesBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Harvard',
        language: 'uz',
        max_size: 24,
      })
      .execute();
    const lesson = await transaction
      .insertInto('slot_types')
      .values({ branch_id: pagesBranch, name: 'Lesson 45', kind: 'lesson' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('slot_type_lengths')
      .values({
        branch_id: pagesBranch,
        slot_type_id: lesson.id,
        length_minutes: 45,
        valid_from: startDate,
      })
      .execute();
    const template = await transaction
      .insertInto('day_templates')
      .values({ branch_id: pagesBranch, name: 'Main' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const version = await transaction
      .insertInto('day_template_versions')
      .values({
        branch_id: pagesBranch,
        day_template_id: template.id,
        start_minutes: 480,
        valid_from: startDate,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('day_template_slots')
      .values(
        [1, 2].map((position) => ({
          version_id: version.id,
          branch_id: pagesBranch,
          position,
          slot_type_id: lesson.id,
        })),
      )
      .execute();
    await transaction
      .insertInto('day_template_assignments')
      .values({
        branch_id: pagesBranch,
        level: 'default',
        day_template_id: template.id,
        valid_from: startDate,
      })
      .execute();
    // Task 2.7c-2b-1: a setting that can be ended, an entry of the calendar a
    // month ahead and a division that is not built in, so the browser check
    // opens the form of each of these panels too.
    await transaction
      .insertInto('day_template_assignments')
      .values({
        branch_id: pagesBranch,
        level: 'weekday',
        weekday: 5,
        day_template_id: template.id,
        valid_from: startDate,
      })
      .execute();
    const monthAhead = isoDate(new Date(tashkentToday.getTime() + 30 * dayMs));
    await transaction
      .insertInto('calendar_entries')
      .values({
        branch_id: pagesBranch,
        kind: 'day_off',
        name: 'Pages day off',
        first_date: monthAhead,
        last_date: monthAhead,
      })
      .execute();
    const lastDivision = await transaction
      .selectFrom('divisions')
      .select((eb) => eb.fn.max('position').as('position'))
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('divisions')
      .values({
        name_uz: 'Sahifalar boʻlimi',
        name_ru: 'Отдел страниц',
        name_en: 'Pages division',
        position: Number(lastDivision.position ?? 0) + 1,
      })
      .execute();
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269060',
        first_name: 'Lola',
        last_name: 'Saidova',
        sex: 'female',
        birth_date: '1990-02-17',
        phone: '+998935550160',
        admission_date: '2026-09-01',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: pagesBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
    const student = await transaction
      .insertInto('students')
      .values({
        branch_id: pagesBranch,
        uid: '9999601',
        first_name: 'Shahzod',
        last_name: 'Ibragimov',
        name_key: studentNameKey('Ibragimov', 'Shahzod'),
        sex: 'male',
        birth_date: '2012-03-21',
        address: 'Yunusobod 4',
        grade: 8,
        starts_on: startDate,
        created_by: pages.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('student_uids')
      .values({
        uid: '9999601',
        student_id: student.id,
        branch_id: pagesBranch,
        held_from: new Date(),
      })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({
        student_id: student.id,
        branch_id: pagesBranch,
        number: 'E2E-PAGES-1',
        signed_on: startDate,
      })
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: student.id,
        branch_id: pagesBranch,
        status: 'active',
        valid_from: startDate,
        cause: 'start',
      })
      .execute();
    await transaction
      .insertInto('student_accounts')
      .values({ student_id: student.id, branch_id: pagesBranch, created_at: new Date() })
      .execute();
    await linkRelative(transaction, student.id, pagesBranch, new Date(), {
      fullName: 'Malika Ibragimova',
      phone: '+998935550161',
    });
  });
  // A vacancy, and its creation in the log, so the Vacancies and Audit log
  // lists have a record to open too.
  const pagesVacancy = await migrator.transaction().execute(async (transaction) => {
    const vacancy = await transaction
      .insertInto('staff')
      .values({ kind: 'vacancy', vacancy_name: 'Geometry vacancy 1' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: vacancy.id, branch_id: pagesBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: vacancy.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: vacancy.id, status: 'open', valid_from: startDate })
      .execute();
    return vacancy.id;
  });
  await transactions.run([pagesBranch], (transaction) =>
    audit.record(transaction, {
      branchId: pagesBranch,
      actorId: pages.id,
      assignmentId: pagesGiven.id,
      action: 'vacancy.create',
      record: { type: 'staff', id: pagesVacancy },
      newValue: { name: 'Geometry vacancy 1', status: 'open', from: startDate },
    }),
  );
  /**
   * An active student of grade 7 in a class from the start of the year (task
   * 3.2b), with a contract and a mother: the students the group placement
   * tests place.
   */
  const studentInClass = async (
    transaction: Parameters<Parameters<ReturnType<typeof migrator.transaction>['execute']>[0]>[0],
    input: {
      branch: string;
      /** None: a student with no class yet (task 3.2c, put into a class in the browser test). */
      classId: string | null;
      uid: string;
      first: string;
      last: string;
      createdBy: string;
      phone: string;
      /** The first day, the year's start unless given (task 3.3d). */
      from?: string;
    },
  ): Promise<string> => {
    const from = input.from ?? startDate;
    const student = await transaction
      .insertInto('students')
      .values({
        branch_id: input.branch,
        uid: input.uid,
        first_name: input.first,
        last_name: input.last,
        name_key: studentNameKey(input.last, input.first),
        sex: 'female',
        birth_date: '2013-05-11',
        grade: 7,
        starts_on: from,
        created_by: input.createdBy,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('student_uids')
      .values({
        uid: input.uid,
        student_id: student.id,
        branch_id: input.branch,
        held_from: new Date(),
      })
      .execute();
    await transaction
      .insertInto('student_contracts')
      .values({
        student_id: student.id,
        branch_id: input.branch,
        number: `E2E-${input.uid}`,
        signed_on: startDate,
      })
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: student.id,
        branch_id: input.branch,
        status: 'active',
        valid_from: from,
        cause: 'start',
      })
      .execute();
    await transaction
      .insertInto('student_accounts')
      .values({ student_id: student.id, branch_id: input.branch, created_at: new Date() })
      .execute();
    if (input.classId !== null) {
      await transaction
        .insertInto('class_memberships')
        .values({
          branch_id: input.branch,
          student_id: student.id,
          class_id: input.classId,
          valid_from: from,
          valid_until: isoDate(new Date(yearStart.getTime() + 365 * dayMs)),
          own_until: isoDate(new Date(yearStart.getTime() + 365 * dayMs)),
          cause: 'placement',
        })
        .execute();
    }
    await linkRelative(transaction, student.id, input.branch, new Date(), {
      fullName: `Mother of ${input.first}`,
      phone: input.phone,
    });
    return student.id;
  };

  // Task 3.2b: a student of 7 Harvard in no group, so the group placement
  // screen opens with a record.
  await migrator.transaction().execute(async (transaction) => {
    const harvard = await transaction
      .selectFrom('classes')
      .select('id')
      .where('branch_id', '=', pagesBranch)
      .where('name', '=', 'Harvard')
      .executeTakeFirstOrThrow();
    await studentInClass(transaction, {
      branch: pagesBranch,
      classId: harvard.id,
      uid: '9999602',
      first: 'Sabina',
      last: 'Yoqubova',
      createdBy: pages.id,
      phone: '+998935550162',
    });
  });
  // Task 3.2a: the group of 7 Harvard, in a later transaction than the class
  // row of its student (task 3.2c): only the insert of a class row needs its
  // group rows (0049), so the student stays not yet placed.
  await migrator.transaction().execute(async (transaction) => {
    const harvard = await transaction
      .selectFrom('classes')
      .select(['id', 'academic_year_id'])
      .where('branch_id', '=', pagesBranch)
      .where('name', '=', 'Harvard')
      .executeTakeFirstOrThrow();
    const geometry = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('name_en', '=', 'Geometry')
      .executeTakeFirstOrThrow();
    const pagesGroup = await transaction
      .insertInto('groups')
      .values({
        branch_id: pagesBranch,
        academic_year_id: harvard.academic_year_id,
        subject_id: geometry.id,
        name: '7-G-1',
        language: 'uz',
        max_size: 20,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('group_classes')
      .values({ group_id: pagesGroup.id, class_id: harvard.id, branch_id: pagesBranch })
      .execute();
  });
  // Task 3.4a: a draft of the year with a load row of 7 Harvard, so the
  // teaching load list opens with a record; the seeded vacancy teaches
  // Geometry in grade 7, in Uzbek.
  await migrator.transaction().execute(async (transaction) => {
    const harvard = await transaction
      .selectFrom('classes')
      .select(['id', 'academic_year_id'])
      .where('branch_id', '=', pagesBranch)
      .where('name', '=', 'Harvard')
      .executeTakeFirstOrThrow();
    const geometry = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('name_en', '=', 'Geometry')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_languages')
      .values({ staff_id: pagesVacancy, language: 'uz' })
      .execute();
    await transaction
      .insertInto('staff_subjects')
      .values({ staff_id: pagesVacancy, subject_id: geometry.id, grades: [7] })
      .execute();
    const version = await transaction
      .insertInto('timetable_versions')
      .values({
        branch_id: pagesBranch,
        academic_year_id: harvard.academic_year_id,
        number: 1,
        starts_on: startDate,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('teaching_load_rows')
      .values({
        branch_id: pagesBranch,
        version_id: version.id,
        class_id: harvard.id,
        subject_id: geometry.id,
        teacher_id: pagesVacancy,
        lessons_per_week: 3,
      })
      .execute();
  });
  seeded.pages = { login: pages.login, password: pages.firstPassword };

  // The Academic Vice Principal of the classes test (task 3.1a), in a branch
  // of its own with a planned year around today and two people with the Tutor
  // role there: one who teaches in Uzbek, one in Russian only.
  const classesBranch = await insertBranch(migrator, 'Classes browser test branch');
  const classesVice = await create('Feruza', 'Olimova');
  await transactions.run([classesBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: classesVice.id,
      role: 'academic_vice_principal',
      branchId: classesBranch,
      givenBy: null,
    }),
  );
  const tutors = [
    { first: 'Zuhra', last: 'Salimova', phone: '+998901110301', languages: ['uz'] },
    { first: 'Pavel', last: 'Smirnov', phone: '+998901110302', languages: ['ru'] },
  ];
  for (const [index, tutor] of tutors.entries()) {
    const account = await create(tutor.first, tutor.last);
    await transactions.run([classesBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: account.id,
        role: 'tutor',
        branchId: classesBranch,
        givenBy: null,
      }),
    );
    await migrator.transaction().execute(async (transaction) => {
      const academic = await transaction
        .selectFrom('divisions')
        .select('id')
        .where('name_en', '=', 'Academic')
        .executeTakeFirstOrThrow();
      const steam = await transaction
        .selectFrom('departments')
        .select('id')
        .where('name_en', '=', 'STEAM')
        .executeTakeFirstOrThrow();
      const person = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: `S-2698${String(index + 1).padStart(2, '0')}`,
          account_id: account.id,
          first_name: tutor.first,
          last_name: tutor.last,
          sex: 'female',
          birth_date: '1991-02-03',
          phone: tutor.phone,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: person.id, branch_id: classesBranch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: person.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      for (const language of tutor.languages) {
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: person.id, language })
          .execute();
      }
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
    });
  }
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: classesBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: classesBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
  });
  seeded.classes = { login: classesVice.login, password: classesVice.firstPassword };

  // The Academic Vice Principal of the groups test (task 3.2a), in a branch
  // of its own with a planned year around today and three classes of grade 7:
  // two Uzbek ones and a Russian one.
  const groupsBranch = await insertBranch(migrator, 'Groups browser test branch');
  const groupsVice = await create('Nilufar', 'Hasanova');
  await transactions.run([groupsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: groupsVice.id,
      role: 'academic_vice_principal',
      branchId: groupsBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: groupsBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: groupsBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    for (const [name, language] of [
      ['Oxford', 'uz'],
      ['Princeton', 'uz'],
      ['Yale', 'ru'],
    ] as const) {
      await transaction
        .insertInto('classes')
        .values({
          branch_id: groupsBranch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language,
          max_size: 25,
        })
        .execute();
    }
  });
  seeded.groups = { login: groupsVice.login, password: groupsVice.firstPassword };

  // The Academic Vice Principal of the membership test (task 3.1b), in a
  // branch of its own with the year around today, the class 7 Oxford and two
  // active students of grade 7 with no class yet.
  const membersBranch = await insertBranch(migrator, 'Members browser test branch');
  const membersVice = await create('Gulnoza', 'Karimova');
  await transactions.run([membersBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: membersVice.id,
      role: 'academic_vice_principal',
      branchId: membersBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: membersBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: membersBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    await transaction
      .insertInto('classes')
      .values({
        branch_id: membersBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 25,
      })
      .execute();
    for (const [index, [first, last]] of [
      ['Madina', 'Qosimova'],
      ['Javohir', 'Nurmatov'],
    ].entries()) {
      const uid = String(9999701 + index);
      const student = await transaction
        .insertInto('students')
        .values({
          branch_id: membersBranch,
          uid,
          first_name: first ?? '',
          last_name: last ?? '',
          name_key: studentNameKey(last ?? '', first ?? ''),
          sex: index === 0 ? 'female' : 'male',
          birth_date: '2013-09-0' + String(index + 1),
          grade: 7,
          starts_on: startDate,
          created_by: membersVice.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('student_uids')
        .values({ uid, student_id: student.id, branch_id: membersBranch, held_from: new Date() })
        .execute();
      await transaction
        .insertInto('student_contracts')
        .values({
          student_id: student.id,
          branch_id: membersBranch,
          number: `E2E-MEMBER-${String(index + 1)}`,
          signed_on: startDate,
        })
        .execute();
      await transaction
        .insertInto('student_statuses')
        .values({
          student_id: student.id,
          branch_id: membersBranch,
          status: 'active',
          valid_from: startDate,
          cause: 'start',
        })
        .execute();
      await transaction
        .insertInto('student_accounts')
        .values({ student_id: student.id, branch_id: membersBranch, created_at: new Date() })
        .execute();
      await linkRelative(transaction, student.id, membersBranch, new Date(), {
        fullName: `Dilbar ${last ?? ''}`,
        phone: `+99890555016${String(index + 1)}`,
      });
    }
  });
  seeded.members = { login: membersVice.login, password: membersVice.firstPassword };

  // The Academic Vice Principal of the group membership test (task 3.2b), in
  // a branch of its own with the year around today, the class 7 Oxford with
  // four students, and two Geometry groups of it, 7-G-1 and 7-G-2.
  const groupMembersBranch = await insertBranch(migrator, 'Group members browser test branch');
  const groupMembersVice = await create('Sevinch', 'Tursunova');
  await transactions.run([groupMembersBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: groupMembersVice.id,
      role: 'academic_vice_principal',
      branchId: groupMembersBranch,
      givenBy: null,
    }),
  );
  const groupMembersSetting = await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: groupMembersBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: groupMembersBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const oxford = await transaction
      .insertInto('classes')
      .values({
        branch_id: groupMembersBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 25,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [index, [first, last]] of [
      ['Nodira', 'Aliyeva'],
      ['Feruza', 'Bakirova'],
      ['Gulchehra', 'Davronova'],
      ['Iroda', 'Ergasheva'],
    ].entries()) {
      await studentInClass(transaction, {
        branch: groupMembersBranch,
        classId: oxford.id,
        uid: String(9999901 + index),
        first: first ?? '',
        last: last ?? '',
        createdBy: groupMembersVice.id,
        phone: `+99890555036${String(index + 1)}`,
      });
    }
    // Task 3.2c: a student with no class yet, put into 7 Oxford in the browser
    // test, and placed into a group of it automatically.
    await studentInClass(transaction, {
      branch: groupMembersBranch,
      classId: null,
      uid: '9999905',
      first: 'Komila',
      last: 'Fozilova',
      createdBy: groupMembersVice.id,
      phone: '+998905550365',
    });
    return { year: year.id, oxford: oxford.id };
  });
  // The groups of 7 Oxford come in a later transaction than the class rows
  // (task 3.2c): only the insert of a class row needs its group rows (0049),
  // so the four students stay not yet placed.
  await migrator.transaction().execute(async (transaction) => {
    const geometry = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('name_en', '=', 'Geometry')
      .executeTakeFirstOrThrow();
    for (const name of ['7-G-1', '7-G-2']) {
      const group = await transaction
        .insertInto('groups')
        .values({
          branch_id: groupMembersBranch,
          academic_year_id: groupMembersSetting.year,
          subject_id: geometry.id,
          name,
          language: 'uz',
          max_size: 20,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('group_classes')
        .values({
          group_id: group.id,
          class_id: groupMembersSetting.oxford,
          branch_id: groupMembersBranch,
        })
        .execute();
    }
  });
  seeded.groupMembers = {
    login: groupMembersVice.login,
    password: groupMembersVice.firstPassword,
  };

  // The Tutor of the class scope test (task 3.1c), in a branch of its own with
  // the year around today: the Tutor of 7 Oxford, who teaches in Uzbek, and a
  // student in 7 Oxford and one in 7 Yale, each with a mother and her phone.
  const scopeBranch = await insertBranch(migrator, 'Tutor scope browser test branch');
  const scopeTutor = await create('Shoira', 'Ahmedova');
  const scopeAssignment = await transactions.run([scopeBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: scopeTutor.id,
      role: 'tutor',
      branchId: scopeBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const academic = await transaction
      .selectFrom('divisions')
      .select('id')
      .where('name_en', '=', 'Academic')
      .executeTakeFirstOrThrow();
    const steam = await transaction
      .selectFrom('departments')
      .select('id')
      .where('name_en', '=', 'STEAM')
      .executeTakeFirstOrThrow();
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269901',
        account_id: scopeTutor.id,
        first_name: 'Shoira',
        last_name: 'Ahmedova',
        sex: 'female',
        birth_date: '1990-04-05',
        phone: '+998901110401',
        admission_date: '2026-09-01',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: scopeBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_languages')
      .values({ staff_id: person.id, language: 'uz' })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: scopeBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: scopeBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const classIds: string[] = [];
    for (const name of ['Oxford', 'Yale']) {
      const row = await transaction
        .insertInto('classes')
        .values({
          branch_id: scopeBranch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language: 'uz',
          max_size: 25,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      classIds.push(row.id);
    }
    await transaction
      .insertInto('class_tutors')
      .values({
        branch_id: scopeBranch,
        class_id: classIds[0] ?? '',
        assignment_id: scopeAssignment.id,
        kind: 'tutor',
        valid_from: new Date(),
        own_until: null,
        given_by: scopeTutor.id,
      })
      .execute();
    for (const [index, [first, last]] of [
      ['Nilufar', 'Tojiyeva'],
      ['Sherzod', 'Aliyev'],
    ].entries()) {
      const uid = String(9999801 + index);
      const student = await transaction
        .insertInto('students')
        .values({
          branch_id: scopeBranch,
          uid,
          first_name: first ?? '',
          last_name: last ?? '',
          name_key: studentNameKey(last ?? '', first ?? ''),
          sex: index === 0 ? 'female' : 'male',
          birth_date: '2013-10-0' + String(index + 1),
          grade: 7,
          starts_on: startDate,
          created_by: scopeTutor.id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('student_uids')
        .values({ uid, student_id: student.id, branch_id: scopeBranch, held_from: new Date() })
        .execute();
      await transaction
        .insertInto('student_contracts')
        .values({
          student_id: student.id,
          branch_id: scopeBranch,
          number: `E2E-SCOPE-${String(index + 1)}`,
          signed_on: startDate,
        })
        .execute();
      await transaction
        .insertInto('student_statuses')
        .values({
          student_id: student.id,
          branch_id: scopeBranch,
          status: 'active',
          valid_from: startDate,
          cause: 'start',
        })
        .execute();
      await transaction
        .insertInto('student_accounts')
        .values({ student_id: student.id, branch_id: scopeBranch, created_at: new Date() })
        .execute();
      await transaction
        .insertInto('class_memberships')
        .values({
          branch_id: scopeBranch,
          student_id: student.id,
          class_id: classIds[index] ?? '',
          valid_from: startDate,
          valid_until: isoDate(new Date(yearStart.getTime() + 365 * dayMs)),
          own_until: isoDate(new Date(yearStart.getTime() + 365 * dayMs)),
          cause: 'placement',
        })
        .execute();
      await linkRelative(transaction, student.id, scopeBranch, new Date(), {
        fullName: `Dilnoza ${last ?? ''}`,
        phone: `+99890555026${String(index + 1)}`,
      });
    }
  });
  seeded.tutorScope = { login: scopeTutor.login, password: scopeTutor.firstPassword };

  // The Academic Vice Principal of the record search (task 3.2d), in a branch
  // of its own with a planned year around today and the classes 7 Oxford and
  // 7 Yale.
  const searchBranch = await insertBranch(migrator, 'Search browser test branch');
  const searchVice = await create('Mohira', 'Ismoilova');
  await transactions.run([searchBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: searchVice.id,
      role: 'academic_vice_principal',
      branchId: searchBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: searchBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: searchBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    for (const name of ['Oxford', 'Yale']) {
      await transaction
        .insertInto('classes')
        .values({
          branch_id: searchBranch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language: 'uz',
          max_size: 25,
        })
        .execute();
    }
  });
  seeded.recordSearch = { login: searchVice.login, password: searchVice.firstPassword };

  // The Academic Vice Principal of the class transfer test (task 3.3a), in a
  // branch of its own with the year around today, the classes 7 Oxford and
  // 7 Yale, and a student in 7 Oxford.
  const movesBranch = await insertBranch(migrator, 'Moves browser test branch');
  const movesVice = await create('Lobar', 'Nazarova');
  await transactions.run([movesBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: movesVice.id,
      role: 'academic_vice_principal',
      branchId: movesBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: movesBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: movesBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const classIds: string[] = [];
    for (const name of ['Oxford', 'Yale']) {
      const row = await transaction
        .insertInto('classes')
        .values({
          branch_id: movesBranch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language: 'uz',
          max_size: 25,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      classIds.push(row.id);
    }
    await studentInClass(transaction, {
      branch: movesBranch,
      classId: classIds[0] ?? null,
      uid: '9999931',
      first: 'Sabina',
      last: 'Qosimova',
      createdBy: movesVice.id,
      phone: '+998905550391',
    });
  });
  seeded.moves = { login: movesVice.login, password: movesVice.firstPassword };

  // The Academic Vice Principal of the return test (task 3.3b), in a branch
  // of its own with the year around today, the classes 7 Oxford (Uzbek) and
  // 7 Yale (Russian), and a student in 7 Oxford from the start of the year.
  const returnsBranch = await insertBranch(migrator, 'Returns browser test branch');
  const returnsVice = await create('Nilufar', 'Olimova');
  await transactions.run([returnsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: returnsVice.id,
      role: 'academic_vice_principal',
      branchId: returnsBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: returnsBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: returnsBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const classIds: string[] = [];
    for (const [name, language] of [
      ['Oxford', 'uz'],
      ['Yale', 'ru'],
    ] as const) {
      const row = await transaction
        .insertInto('classes')
        .values({
          branch_id: returnsBranch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language,
          max_size: 25,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      classIds.push(row.id);
    }
    await studentInClass(transaction, {
      branch: returnsBranch,
      classId: classIds[0] ?? null,
      uid: '9999941',
      first: 'Muxlisa',
      last: 'Hamroyeva',
      createdBy: returnsVice.id,
      phone: '+998905550401',
    });
  });
  seeded.returns = { login: returnsVice.login, password: returnsVice.firstPassword };

  // The Academic Vice Principal of the return in August (task 3.6b-2, L170),
  // in a branch of its own: the year around today, the next year planned
  // right after it with the class 7 Cambridge, and a student in 7 Oxford.
  const augustBranch = await insertBranch(migrator, 'August return browser test branch');
  const augustVice = await create('Zarina', 'Ismoilova');
  await transactions.run([augustBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: augustVice.id,
      role: 'academic_vice_principal',
      branchId: augustBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const nextStart = new Date(yearStart.getTime() + 365 * dayMs);
    const years: { id: string; name: string; start: Date; end: Date }[] = [];
    for (const [name, start] of [
      ['current', yearStart],
      ['next', nextStart],
    ] as const) {
      const row = await transaction
        .insertInto('academic_years')
        .values({
          branch_id: augustBranch,
          start_date: isoDate(start),
          end_date: isoDate(new Date(start.getTime() + 364 * dayMs)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('quarters')
        .values(
          [1, 2, 3, 4].map((number) => ({
            branch_id: augustBranch,
            academic_year_id: row.id,
            number,
          })),
        )
        .execute();
      years.push({ id: row.id, name, start, end: new Date(start.getTime() + 364 * dayMs) });
    }
    const classIds: string[] = [];
    for (const [yearIndex, name] of [
      [0, 'Oxford'],
      [1, 'Cambridge'],
    ] as const) {
      const row = await transaction
        .insertInto('classes')
        .values({
          branch_id: augustBranch,
          academic_year_id: years[yearIndex]?.id ?? '',
          grade: 7,
          name,
          language: 'uz',
          max_size: 25,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      classIds.push(row.id);
    }
    // The current year is current; the next one stays planned.
    await transaction
      .updateTable('academic_years')
      .set({ status: 'current' })
      .where('id', '=', years[0]?.id ?? '')
      .execute();
    await studentInClass(transaction, {
      branch: augustBranch,
      classId: classIds[0] ?? null,
      uid: '9999971',
      first: 'Madina',
      last: 'Ergasheva',
      createdBy: augustVice.id,
      phone: '+998905550711',
    });
  });
  seeded.returnAugust = { login: augustVice.login, password: augustVice.firstPassword };

  // The Academic Vice Principal of two branches for the move to another
  // branch (task 3.3c): the sending branch with 7 Oxford and a student in it,
  // the receiving branch with 7 Cambridge, each with the year around today;
  // one account releases in one branch and accepts in the other.
  const sendingBranch = await insertBranch(migrator, 'Sending browser test branch');
  const receivingBranch = await insertBranch(migrator, 'Receiving browser test branch');
  const branchMovesVice = await create('Sevara', 'Ismoilova');
  for (const branch of [sendingBranch, receivingBranch]) {
    await transactions.run([branch], (transaction) =>
      assignments.give(transaction, {
        accountId: branchMovesVice.id,
        role: 'academic_vice_principal',
        branchId: branch,
        givenBy: null,
      }),
    );
  }
  await migrator.transaction().execute(async (transaction) => {
    const classOf: Record<string, string> = {};
    for (const [branch, name] of [
      [sendingBranch, 'Oxford'],
      [receivingBranch, 'Cambridge'],
    ] as const) {
      const year = await transaction
        .insertInto('academic_years')
        .values({
          branch_id: branch,
          start_date: startDate,
          end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('quarters')
        .values(
          [1, 2, 3, 4].map((number) => ({
            branch_id: branch,
            academic_year_id: year.id,
            number,
          })),
        )
        .execute();
      const row = await transaction
        .insertInto('classes')
        .values({
          branch_id: branch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language: 'uz',
          max_size: 25,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      classOf[branch] = row.id;
    }
    await studentInClass(transaction, {
      branch: sendingBranch,
      classId: classOf[sendingBranch] ?? null,
      uid: '9999951',
      first: 'Gulshan',
      last: 'Qosimova',
      createdBy: branchMovesVice.id,
      phone: '+998905550501',
    });
  });
  seeded.branchMoves = { login: branchMovesVice.login, password: branchMovesVice.firstPassword };

  // The merge of two student records (task 3.3d): a branch of its own with
  // 7 Oxford, a student who left 20 days after the year's start, and the
  // same student created again 40 days after it, in 7 Oxford. The seed holds
  // no fourth Super Admin (at most three, correction 1 of the review of
  // #87): the divisions test's Super Admin merges them at the end of its session.
  const mergesBranch = await insertBranch(migrator, 'Merges browser test branch');
  const merges = divisions;
  const mergesClass = await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: mergesBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: mergesBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const row = await transaction
      .insertInto('classes')
      .values({
        branch_id: mergesBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 25,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  });
  await migrator.transaction().execute(async (transaction) => {
    const left = await studentInClass(transaction, {
      branch: mergesBranch,
      classId: null,
      uid: '9999961',
      first: 'Dilnoza',
      last: 'Karimova',
      createdBy: merges.id,
      phone: '+998905550601',
    });
    const leftOn = isoDate(new Date(yearStart.getTime() + 20 * dayMs));
    await transaction
      .updateTable('student_statuses')
      .set({ valid_until: leftOn })
      .where('student_id', '=', left)
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: left,
        branch_id: mergesBranch,
        status: 'inactive',
        valid_from: leftOn,
        cause: 'leaving',
        reason: 'Moved to another city',
      })
      .execute();
  });
  await migrator.transaction().execute((transaction) =>
    studentInClass(transaction, {
      branch: mergesBranch,
      classId: mergesClass,
      uid: '9999962',
      first: 'Dilnoza',
      last: 'Karimova',
      createdBy: merges.id,
      phone: '+998905550602',
      from: isoDate(new Date(yearStart.getTime() + 40 * dayMs)),
    }),
  );

  // The Academic Vice Principal of the teaching load test (task 3.4a), in a
  // branch of its own with a planned year around today, 7 Oxford (Uzbek), a
  // teacher of Geometry in grade 7 and one of Geometry in grade 8 only. Task
  // 3.6c-2: 7 Oxford has a Tutor, and the Homework slot is a subject of the
  // Tutors department, whose row holds the Tutor.
  const loadBranch = await insertBranch(migrator, 'Teaching load browser test branch');
  const loadVice = await create('Shahlo', 'Rasulova');
  const loadTutor = await create('Gulnora', 'Tursunova');
  const loadTutorRole = await transactions.run([loadBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: loadTutor.id,
      role: 'tutor',
      branchId: loadBranch,
      givenBy: null,
    }),
  );
  await transactions.run([loadBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: loadVice.id,
      role: 'academic_vice_principal',
      branchId: loadBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: loadBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: loadBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    await transaction
      .insertInto('classes')
      .values({
        branch_id: loadBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 25,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then(async (oxford) => {
        const tutors = await transaction
          .selectFrom('departments')
          .select('id')
          .where('tutors', '=', true)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('subjects')
          .values({
            name_uz: 'Uy vazifasi soati',
            name_ru: 'Час домашнего задания',
            name_en: 'Homework slot',
            department_id: tutors.id,
            grades: [7],
            colour: 'green',
            journal_type: 'attendance_only',
            rating_exam: false,
            language_rule: true,
          })
          .execute();
        const tutor = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: 'S-269303',
            account_id: loadTutor.id,
            first_name: 'Gulnora',
            last_name: 'Tursunova',
            sex: 'female',
            birth_date: '1987-02-11',
            phone: '+998935557303',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: tutor.id, branch_id: loadBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: tutor.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: tutor.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: tutor.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        await transaction
          .insertInto('class_tutors')
          .values({
            branch_id: loadBranch,
            class_id: oxford.id,
            assignment_id: loadTutorRole.id,
            kind: 'tutor',
            valid_from: new Date(),
            own_until: null,
            given_by: loadVice.id,
          })
          .execute();
      });
    const geometry = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('name_en', '=', 'Geometry')
      .executeTakeFirstOrThrow();
    for (const [staffId, first, last, phone, grade] of [
      ['S-269301', 'Aziza', 'Karimova', '+998935557301', 7],
      ['S-269302', 'Nodira', 'Usmonova', '+998935557302', 8],
    ] as const) {
      const person = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: staffId,
          first_name: first,
          last_name: last,
          sex: 'female',
          birth_date: '1988-05-14',
          phone,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: person.id, branch_id: loadBranch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: person.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: person.id, language: 'uz' })
        .execute();
      await transaction
        .insertInto('staff_subjects')
        .values({ staff_id: person.id, subject_id: geometry.id, grades: [grade] })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
    }
  });
  seeded.teachingLoad = { login: loadVice.login, password: loadVice.firstPassword };

  // The Academic Vice Principal of the blocks test (task 3.4b), in a branch of
  // its own with a planned year around today, 7 Oxford (Uzbek) split for
  // Geometry into 7-G-1 and 7-G-2, and two teachers of Geometry in grade 7.
  const blocksBranch = await insertBranch(migrator, 'Load blocks browser test branch');
  const blocksVice = await create('Feruza', 'Tursunova');
  await transactions.run([blocksBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: blocksVice.id,
      role: 'academic_vice_principal',
      branchId: blocksBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: blocksBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: blocksBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const oxford = await transaction
      .insertInto('classes')
      .values({
        branch_id: blocksBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 25,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const geometry = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('name_en', '=', 'Geometry')
      .executeTakeFirstOrThrow();
    for (const name of ['7-G-1', '7-G-2']) {
      const group = await transaction
        .insertInto('groups')
        .values({
          branch_id: blocksBranch,
          academic_year_id: year.id,
          subject_id: geometry.id,
          name,
          language: 'uz',
          max_size: 15,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('group_classes')
        .values({ group_id: group.id, class_id: oxford.id, branch_id: blocksBranch })
        .execute();
    }
    for (const [staffId, first, last, phone] of [
      ['S-269311', 'Madina', 'Saidova', '+998935557311'],
      ['S-269312', 'Zarina', 'Olimova', '+998935557312'],
    ] as const) {
      const person = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: staffId,
          first_name: first,
          last_name: last,
          sex: 'female',
          birth_date: '1989-03-22',
          phone,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: person.id, branch_id: blocksBranch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: person.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: person.id, language: 'uz' })
        .execute();
      await transaction
        .insertInto('staff_subjects')
        .values({ staff_id: person.id, subject_id: geometry.id, grades: [7] })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
    }
  });
  seeded.teachingBlocks = { login: blocksVice.login, password: blocksVice.firstPassword };

  // The Academic Vice Principal of the draft builder test (task 5.3a), in a
  // branch of its own with a year around today, 7 Oxford, and one default day
  // template of three 45-minute lessons from the year's start.
  const builderBranch = await insertBranch(migrator, 'Draft builder browser test branch');
  const builderVice = await create('Shahlo', 'Ergasheva');
  await transactions.run([builderBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: builderVice.id,
      role: 'academic_vice_principal',
      branchId: builderBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: builderBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: builderBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    await transaction
      .insertInto('classes')
      .values({
        branch_id: builderBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 25,
      })
      .execute();
    const lesson = await transaction
      .insertInto('slot_types')
      .values({ branch_id: builderBranch, name: 'Lesson 45', kind: 'lesson' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('slot_type_lengths')
      .values({
        branch_id: builderBranch,
        slot_type_id: lesson.id,
        length_minutes: 45,
        valid_from: startDate,
      })
      .execute();
    const template = await transaction
      .insertInto('day_templates')
      .values({ branch_id: builderBranch, name: 'Main' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const version = await transaction
      .insertInto('day_template_versions')
      .values({
        branch_id: builderBranch,
        day_template_id: template.id,
        start_minutes: 480,
        valid_from: startDate,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('day_template_slots')
      .values(
        [1, 2, 3].map((position) => ({
          version_id: version.id,
          branch_id: builderBranch,
          position,
          slot_type_id: lesson.id,
        })),
      )
      .execute();
    await transaction
      .insertInto('day_template_assignments')
      .values({
        branch_id: builderBranch,
        level: 'default',
        day_template_id: template.id,
        valid_from: startDate,
      })
      .execute();
  });
  seeded.draftBuilder = { login: builderVice.login, password: builderVice.firstPassword };

  // The Academic Vice Principal of the grid test (task 5.4a), in a branch of
  // its own with a year around today, 7 Oxford and 7 Princeton, one default
  // day template of three 45-minute lessons from 08:00, and a draft whose one
  // Geometry teacher has a row of three lessons in each class: Oxford's first
  // lesson on Monday at 08:00, Princeton's on Monday at 08:45.
  const gridScene = async (scene: {
    branch: string;
    vice: readonly [string, string];
    staffId: string;
    phone: string;
    rooms: readonly string[];
    /** Task 5.4c-3a: the rows allow double lessons. */
    doubleLessons?: boolean;
    /**
     * Task 5.4c-3b: 7 Oxford's physical education and technology split into
     * boys' and girls' groups, marked mixed, with a second teacher (the staff
     * id and phone given) of both subjects.
     */
    mixed?: { readonly staffId: string; readonly phone: string };
    /**
     * Task 5.5a-1: a draft that can be published: four dated quarters, one
     * lesson a week per row (each placed), and Geometry's distributions in
     * the branch.
     */
    publishable?: boolean;
    /**
     * Task 5.12b: no version at all (no draft, no rows, no lessons placed);
     * the browser walk builds and publishes one.
     */
    empty?: boolean;
    /**
     * Task 5.6c-2: a block shared by both classes (the group 7-Ecology of
     * 7 Oxford and 7 Princeton, Monday slot 3, Aliyeva's) and a person with
     * no lessons to invigilate (the staff id and phone given).
     */
    examShared?: { readonly staffId: string; readonly phone: string };
    /**
     * Task 5.7a-3b: both Geometry rows are under "Geometry vacancy 2" (Uzbek
     * and Russian), 7 Princeton is taught in Russian, so Aliyeva (Uzbek only)
     * fits 7 Oxford's row only, and a second person (the staff id and phone
     * given; Russian) fits 7 Princeton's.
     */
    vacancyFill?: { readonly staffId: string; readonly phone: string };
    /**
     * Task 5.7b-2: a second teacher of Geometry in Uzbek (the staff id and
     * phone given), free all day, to substitute the scene's teacher.
     */
    secondTeacher?: { readonly staffId: string; readonly phone: string };
  }) => {
    const gridBranch = await insertBranch(migrator, scene.branch);
    const gridVice = await create(scene.vice[0], scene.vice[1]);
    await transactions.run([gridBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: gridVice.id,
        role: 'academic_vice_principal',
        branchId: gridBranch,
        givenBy: null,
      }),
    );
    await migrator.transaction().execute(async (transaction) => {
      const year = await transaction
        .insertInto('academic_years')
        .values({
          branch_id: gridBranch,
          start_date: startDate,
          end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const quarters = await transaction
        .insertInto('quarters')
        .values(
          [1, 2, 3, 4].map((number) => ({
            branch_id: gridBranch,
            academic_year_id: year.id,
            number,
            ...(scene.publishable === true
              ? {
                  start_date: isoDate(new Date(yearStart.getTime() + (number - 1) * 91 * dayMs)),
                  end_date: isoDate(
                    new Date(yearStart.getTime() + (number === 4 ? 364 : number * 91 - 1) * dayMs),
                  ),
                }
              : {}),
          })),
        )
        .returning('id')
        .execute();
      const classes = [];
      for (const name of ['Oxford', 'Princeton']) {
        classes.push(
          await transaction
            .insertInto('classes')
            .values({
              branch_id: gridBranch,
              academic_year_id: year.id,
              grade: 7,
              name,
              language: scene.vacancyFill !== undefined && name === 'Princeton' ? 'ru' : 'uz',
              max_size: 25,
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );
      }
      const lesson = await transaction
        .insertInto('slot_types')
        .values({ branch_id: gridBranch, name: 'Lesson 45', kind: 'lesson' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('slot_type_lengths')
        .values({
          branch_id: gridBranch,
          slot_type_id: lesson.id,
          length_minutes: 45,
          valid_from: startDate,
        })
        .execute();
      const template = await transaction
        .insertInto('day_templates')
        .values({ branch_id: gridBranch, name: 'Main' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const templateVersion = await transaction
        .insertInto('day_template_versions')
        .values({
          branch_id: gridBranch,
          day_template_id: template.id,
          start_minutes: 480,
          valid_from: startDate,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('day_template_slots')
        .values(
          [1, 2, 3].map((position) => ({
            version_id: templateVersion.id,
            branch_id: gridBranch,
            position,
            slot_type_id: lesson.id,
          })),
        )
        .execute();
      await transaction
        .insertInto('day_template_assignments')
        .values({
          branch_id: gridBranch,
          level: 'default',
          day_template_id: template.id,
          valid_from: startDate,
        })
        .execute();
      const geometry = await transaction
        .selectFrom('subjects')
        .select('id')
        .where('name_en', '=', 'Geometry')
        .executeTakeFirstOrThrow();
      const person = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: scene.staffId,
          first_name: 'Zarina',
          last_name: 'Aliyeva',
          sex: 'female',
          birth_date: '1987-03-21',
          phone: scene.phone,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: person.id, branch_id: gridBranch, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: person.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: person.id, language: 'uz' })
        .execute();
      await transaction
        .insertInto('staff_subjects')
        .values({ staff_id: person.id, subject_id: geometry.id, grades: [7] })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
      const hours = await transaction
        .insertInto('staff_availability')
        .values({ branch_id: gridBranch, staff_id: person.id, valid_from: startDate })
        .returning(['id', 'valid_until'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_availability_ranges')
        .values(
          [1, 2, 3, 4, 5].map((weekday) => ({
            entry_id: hours.id,
            branch_id: gridBranch,
            staff_id: person.id,
            weekday,
            start_minutes: 0,
            end_minutes: 1440,
            valid_from: startDate,
            valid_until: hours.valid_until,
          })),
        )
        .execute();
      if (scene.publishable === true) {
        // Task 5.5a-2a: from quarter 3 the teacher's hours end at 01:00, so
        // the dates from then are warnings by date that do not stop the publish.
        const later = isoDate(new Date(yearStart.getTime() + 2 * 91 * dayMs));
        await transaction
          .updateTable('staff_availability')
          .set({ valid_until: later })
          .where('id', '=', hours.id)
          .execute();
        await transaction
          .updateTable('staff_availability_ranges')
          .set({ valid_until: later })
          .where('entry_id', '=', hours.id)
          .execute();
        const laterHours = await transaction
          .insertInto('staff_availability')
          .values({ branch_id: gridBranch, staff_id: person.id, valid_from: later })
          .returning(['id', 'valid_until'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_availability_ranges')
          .values(
            [1, 2, 3, 4, 5].map((weekday) => ({
              entry_id: laterHours.id,
              branch_id: gridBranch,
              staff_id: person.id,
              weekday,
              start_minutes: 0,
              end_minutes: 60,
              valid_from: later,
              valid_until: laterHours.valid_until,
            })),
          )
          .execute();
      }
      // Task 5.7a-3b: the vacancy that holds both rows, and the second person.
      let rowTeacher = person.id;
      if (scene.vacancyFill !== undefined) {
        const vacancy = await transaction
          .insertInto('staff')
          .values({ kind: 'vacancy', vacancy_name: 'Geometry vacancy 2' })
          .returning('id')
          .executeTakeFirstOrThrow();
        rowTeacher = vacancy.id;
        const second = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: scene.vacancyFill.staffId,
            first_name: 'Bekzod',
            last_name: 'Aliyev',
            sex: 'male',
            birth_date: '1989-06-02',
            phone: scene.vacancyFill.phone,
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [id, languages, status] of [
          [vacancy.id, ['uz', 'ru'], 'open'],
          [second.id, ['ru'], 'active'],
        ] as const) {
          await transaction
            .insertInto('staff_branches')
            .values({ staff_id: id, branch_id: gridBranch, is_main: true })
            .execute();
          await transaction
            .insertInto('staff_divisions')
            .values({
              staff_id: id,
              division_id: academic.id,
              department_id: steam.id,
              is_main: true,
            })
            .execute();
          for (const language of languages) {
            await transaction
              .insertInto('staff_languages')
              .values({ staff_id: id, language })
              .execute();
          }
          await transaction
            .insertInto('staff_subjects')
            .values({ staff_id: id, subject_id: geometry.id, grades: [7] })
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({
              staff_id: id,
              status,
              valid_from: status === 'open' ? startDate : '2026-09-01',
            })
            .execute();
          const own = await transaction
            .insertInto('staff_availability')
            .values({ branch_id: gridBranch, staff_id: id, valid_from: startDate })
            .returning(['id', 'valid_until'])
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('staff_availability_ranges')
            .values(
              [1, 2, 3, 4, 5].map((weekday) => ({
                entry_id: own.id,
                branch_id: gridBranch,
                staff_id: id,
                weekday,
                start_minutes: 0,
                end_minutes: 1440,
                valid_from: startDate,
                valid_until: own.valid_until,
              })),
            )
            .execute();
        }
      }
      // Task 5.7b-2: a second teacher of Geometry, to substitute the first.
      if (scene.secondTeacher !== undefined) {
        const second = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: scene.secondTeacher.staffId,
            first_name: 'Nodir',
            last_name: 'Rahimov',
            sex: 'male',
            birth_date: '1990-02-11',
            phone: scene.secondTeacher.phone,
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: second.id, branch_id: gridBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: second.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: second.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: second.id, subject_id: geometry.id, grades: [7] })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: second.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        const own = await transaction
          .insertInto('staff_availability')
          .values({ branch_id: gridBranch, staff_id: second.id, valid_from: startDate })
          .returning(['id', 'valid_until'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_availability_ranges')
          .values(
            [1, 2, 3, 4, 5].map((weekday) => ({
              entry_id: own.id,
              branch_id: gridBranch,
              staff_id: second.id,
              weekday,
              start_minutes: 0,
              end_minutes: 1440,
              valid_from: startDate,
              valid_until: own.valid_until,
            })),
          )
          .execute();
      }
      // Task 5.4b-2a: rooms of the branch for the room picker.
      if (scene.rooms.length > 0) {
        const building = await transaction
          .insertInto('buildings')
          .values({ branch_id: gridBranch, name: 'Main building' })
          .returning('id')
          .executeTakeFirstOrThrow();
        const floor = await transaction
          .insertInto('floors')
          .values({ branch_id: gridBranch, building_id: building.id, name: 'First' })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('rooms')
          .values(
            scene.rooms.map((name) => ({
              branch_id: gridBranch,
              floor_id: floor.id,
              name,
              type: 'classroom',
              capacity: 30,
              status: 'in_use',
            })),
          )
          .execute();
      }
      if (scene.publishable === true) {
        await transaction
          .insertInto('subject_daily_weights')
          .values({
            branch_id: gridBranch,
            subject_id: geometry.id,
            attendance: 20,
            classwork: 40,
            homework: 40,
          })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: gridBranch,
              subject_id: geometry.id,
              quarter_id: quarter.id,
              attendance: 20,
              classwork: 40,
              homework: 40,
            })),
          )
          .execute();
      }
      // Task 5.12b: the browser walk starts from no version.
      if (scene.empty === true) return;
      const draft = await transaction
        .insertInto('timetable_versions')
        .values({
          branch_id: gridBranch,
          academic_year_id: year.id,
          number: 1,
          starts_on: isoDate(new Date(tashkentToday.getTime() + 7 * dayMs)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [index, one] of classes.entries()) {
        const row = await transaction
          .insertInto('teaching_load_rows')
          .values({
            branch_id: gridBranch,
            version_id: draft.id,
            class_id: one.id,
            subject_id: geometry.id,
            teacher_id: rowTeacher,
            lessons_per_week: scene.publishable === true ? 1 : 3,
            double_lessons: scene.doubleLessons ?? false,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        // Monday, slot 1 (08:00–08:45) for Oxford and slot 2 (08:45–09:30) for Princeton.
        const start = 480 + index * 45;
        const block = await transaction
          .insertInto('pattern_blocks')
          .values({
            branch_id: gridBranch,
            version_id: draft.id,
            weekday: 1,
            slot_position: index + 1,
            start_minutes: start,
            end_minutes: start + 45,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('pattern_entries')
          .values({
            branch_id: gridBranch,
            version_id: draft.id,
            block_id: block.id,
            weekday: 1,
            start_minutes: start,
            end_minutes: start + 45,
            load_row_id: row.id,
            teacher_id: rowTeacher,
          })
          .execute();
      }
      if (scene.examShared !== undefined) {
        const ecology = await transaction
          .insertInto('subjects')
          .values({
            name_uz: 'Ekologiya',
            name_ru: 'Экология',
            name_en: 'Ecology',
            department_id: steam.id,
            grades: [7],
            colour: 'violet',
            journal_type: 'attendance_only',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: person.id, subject_id: ecology.id, grades: [7] })
          .execute();
        const group = await transaction
          .insertInto('groups')
          .values({
            branch_id: gridBranch,
            academic_year_id: year.id,
            subject_id: ecology.id,
            name: '7-Ecology',
            language: 'uz',
            max_size: 40,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('group_classes')
          .values(
            classes.map((one) => ({ group_id: group.id, class_id: one.id, branch_id: gridBranch })),
          )
          .execute();
        const row = await transaction
          .insertInto('teaching_load_rows')
          .values({
            branch_id: gridBranch,
            version_id: draft.id,
            group_id: group.id,
            subject_id: ecology.id,
            teacher_id: person.id,
            lessons_per_week: 1,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        // Monday, slot 3 (09:30–10:15).
        const block = await transaction
          .insertInto('pattern_blocks')
          .values({
            branch_id: gridBranch,
            version_id: draft.id,
            weekday: 1,
            slot_position: 3,
            start_minutes: 570,
            end_minutes: 615,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('pattern_entries')
          .values({
            branch_id: gridBranch,
            version_id: draft.id,
            block_id: block.id,
            weekday: 1,
            start_minutes: 570,
            end_minutes: 615,
            load_row_id: row.id,
            teacher_id: person.id,
          })
          .execute();
        const invigilator = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: scene.examShared.staffId,
            first_name: 'Rustam',
            last_name: 'Nazarov',
            sex: 'male',
            birth_date: '1984-02-14',
            phone: scene.examShared.phone,
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: invigilator.id, branch_id: gridBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: invigilator.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: invigilator.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: invigilator.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        const invigilatorHours = await transaction
          .insertInto('staff_availability')
          .values({ branch_id: gridBranch, staff_id: invigilator.id, valid_from: startDate })
          .returning(['id', 'valid_until'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_availability_ranges')
          .values(
            [1, 2, 3, 4, 5].map((weekday) => ({
              entry_id: invigilatorHours.id,
              branch_id: gridBranch,
              staff_id: invigilator.id,
              weekday,
              start_minutes: 0,
              end_minutes: 1440,
              valid_from: startDate,
              valid_until: invigilatorHours.valid_until,
            })),
          )
          .execute();
      }
      if (scene.mixed !== undefined) {
        const [pe, tech] = await Promise.all(
          (
            [
              ['Jismoniy tarbiya', 'Физкультура', 'Physical education', 'orange'],
              ['Texnologiya', 'Технология', 'Technology', 'teal'],
            ] as const
          ).map(([uz, ru, enName, colour]) =>
            transaction
              .insertInto('subjects')
              .values({
                name_uz: uz,
                name_ru: ru,
                name_en: enName,
                department_id: steam.id,
                grades: [7],
                colour,
                journal_type: 'graded',
              })
              .returning('id')
              .executeTakeFirstOrThrow(),
          ),
        );
        if (pe === undefined || tech === undefined) throw new Error('No mixed subjects.');
        const second = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: scene.mixed.staffId,
            first_name: 'Nargiza',
            last_name: 'Tojiyeva',
            sex: 'female',
            birth_date: '1990-06-11',
            phone: scene.mixed.phone,
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: second.id, branch_id: gridBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: second.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: second.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: second.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values(
            [person.id, second.id].flatMap((staffId) =>
              [pe.id, tech.id].map((subjectId) => ({
                staff_id: staffId,
                subject_id: subjectId,
                grades: [7],
              })),
            ),
          )
          .execute();
        const secondHours = await transaction
          .insertInto('staff_availability')
          .values({ branch_id: gridBranch, staff_id: second.id, valid_from: startDate })
          .returning(['id', 'valid_until'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_availability_ranges')
          .values(
            [1, 2, 3, 4, 5].map((weekday) => ({
              entry_id: secondHours.id,
              branch_id: gridBranch,
              staff_id: second.id,
              weekday,
              start_minutes: 0,
              end_minutes: 1440,
              valid_from: startDate,
              valid_until: secondHours.valid_until,
            })),
          )
          .execute();
        const [oxford] = classes;
        if (oxford === undefined) throw new Error('No Oxford.');
        // The boys' halves are Aliyeva's, the girls' Tojiyeva's: neither a
        // split nor a pairing of a boys' and a girls' half has one teacher twice.
        for (const [name, subjectId, teacherId] of [
          ['7-PE-B', pe.id, person.id],
          ['7-PE-G', pe.id, second.id],
          ['7-T-B', tech.id, person.id],
          ['7-T-G', tech.id, second.id],
        ] as const) {
          const group = await transaction
            .insertInto('groups')
            .values({
              branch_id: gridBranch,
              academic_year_id: year.id,
              subject_id: subjectId,
              name,
              language: 'uz',
              max_size: 20,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('group_classes')
            .values({ group_id: group.id, class_id: oxford.id, branch_id: gridBranch })
            .execute();
          await transaction
            .insertInto('teaching_load_rows')
            .values({
              branch_id: gridBranch,
              version_id: draft.id,
              group_id: group.id,
              subject_id: subjectId,
              teacher_id: teacherId,
              lessons_per_week: 1,
              mixed_block: true,
            })
            .execute();
        }
      }
    });
    return gridVice;
  };
  const gridVice = await gridScene({
    branch: 'Grid browser test branch',
    vice: ['Malika', 'Saidova'],
    staffId: 'S-269331',
    phone: '+998935557331',
    rooms: [],
  });
  seeded.draftGrid = { login: gridVice.login, password: gridVice.firstPassword };

  // The panels of the grid (task 5.4b-2a): the same scene in a branch of its
  // own, with two rooms for the room picker.
  const panelsVice = await gridScene({
    branch: 'Grid panels browser test branch',
    vice: ['Nodira', 'Yusupova'],
    staffId: 'S-269332',
    phone: '+998935557332',
    rooms: ['Room 21', 'Room 22'],
  });
  seeded.draftGridPanels = { login: panelsVice.login, password: panelsVice.firstPassword };

  // "Suggest a place" (task 5.4b-2b): the same scene in a branch of its own.
  const suggestVice = await gridScene({
    branch: 'Grid suggestions browser test branch',
    vice: ['Shahnoza', 'Qodirova'],
    staffId: 'S-269333',
    phone: '+998935557333',
    rooms: [],
  });
  seeded.draftGridSuggest = { login: suggestVice.login, password: suggestVice.firstPassword };

  // The takeover of a draft's edit lock (task 5.4c-1): the grid scene's
  // Academic Vice Principal holds the lock and was last active 10 minutes
  // before the seed ran; a second Academic Vice Principal of the branch takes
  // over, and the first is told.
  const lockHolder = await gridScene({
    branch: 'Grid lock browser test branch',
    vice: ['Gulnora', 'Ismoilova'],
    staffId: 'S-269334',
    phone: '+998935557334',
    rooms: [],
  });
  const lockBranch = await migrator
    .selectFrom('branches')
    .select('id')
    .where('name', '=', 'Grid lock browser test branch')
    .executeTakeFirstOrThrow();
  const lockTaker = await create('Zarina', 'Hakimova');
  await transactions.run([lockBranch.id], (transaction) =>
    assignments.give(transaction, {
      accountId: lockTaker.id,
      role: 'academic_vice_principal',
      branchId: lockBranch.id,
      givenBy: null,
    }),
  );
  await migrator
    .updateTable('timetable_versions')
    .set({ edit_holder_id: lockHolder.id, edit_seen_at: new Date(Date.now() - 10 * 60_000) })
    .where('branch_id', '=', lockBranch.id)
    .execute();
  seeded.draftLockHolder = { login: lockHolder.login, password: lockHolder.firstPassword };
  seeded.draftLockTaker = { login: lockTaker.login, password: lockTaker.firstPassword };

  // Undo and redo of the grid (task 5.4c-2): the same scene in a branch of its own.
  const undoVice = await gridScene({
    branch: 'Grid undo browser test branch',
    vice: ['Kamola', 'Ergasheva'],
    staffId: 'S-269335',
    phone: '+998935557335',
    rooms: [],
  });
  seeded.draftGridUndo = { login: undoVice.login, password: undoVice.firstPassword };

  // Double lessons (task 5.4c-3a): the same scene in a branch of its own, its
  // rows allowing double lessons.
  const doubleVice = await gridScene({
    branch: 'Grid doubles browser test branch',
    vice: ['Dilfuza', 'Rahimova'],
    staffId: 'S-269336',
    phone: '+998935557336',
    rooms: [],
    doubleLessons: true,
  });
  seeded.draftGridDouble = { login: doubleVice.login, password: doubleVice.firstPassword };

  // Mixed pairings (task 5.4c-3b): the same scene in a branch of its own, with
  // 7 Oxford's physical education and technology split and marked mixed.
  const mixedVice = await gridScene({
    branch: 'Grid mixed browser test branch',
    vice: ['Sabina', 'Nurmatova'],
    staffId: 'S-269337',
    phone: '+998935557337',
    rooms: [],
    mixed: { staffId: 'S-269338', phone: '+998935557338' },
  });
  seeded.draftGridMixed = { login: mixedVice.login, password: mixedVice.firstPassword };

  // Publish (task 5.5a-1): the same scene in a branch of its own, one lesson a
  // week per row, with four dated quarters and Geometry's distributions.
  const publishVice = await gridScene({
    branch: 'Grid publish browser test branch',
    vice: ['Gulnora', 'Rahimova'],
    staffId: 'S-269339',
    phone: '+998935557339',
    rooms: [],
    publishable: true,
  });
  seeded.draftPublish = { login: publishVice.login, password: publishVice.firstPassword };

  // The browser walk (task 5.12b): the publishable scene's branch with its
  // dated quarters, Geometry's distributions and one room, but no version:
  // the Academic Vice Principal builds a draft, publishes it and reads the
  // published week.
  const walkVice = await gridScene({
    branch: 'Build walk browser test branch',
    vice: ['Sevara', 'Toshmatova'],
    staffId: 'S-269368',
    phone: '+998935557368',
    rooms: ['Room 31'],
    publishable: true,
    empty: true,
  });
  seeded.buildWalk = { login: walkVice.login, password: walkVice.firstPassword };

  // One-day changes (task 5.6a-1): the publishable scene again, in a branch
  // of its own, which the browser test publishes before it cancels and
  // restores a lesson.
  const dayVice = await gridScene({
    branch: 'Day changes browser test branch',
    vice: ['Kamola', 'Rashidova'],
    staffId: 'S-269340',
    phone: '+998935557340',
    // Task 5.6a-2: a room for the one-day room change.
    rooms: ['Room 21'],
    publishable: true,
  });
  seeded.dayChanges = { login: dayVice.login, password: dayVice.firstPassword };

  // Exams (task 5.6c-2): the publishable scene again, in a branch of its
  // own, with a block shared by 7 Oxford and 7 Princeton and a person to
  // invigilate; the browser test publishes, makes an exam of 7 Oxford over
  // the shared block and cancels it.
  const examVice = await gridScene({
    branch: 'Exams browser test branch',
    vice: ['Ozoda', 'Komilova'],
    staffId: 'S-269341',
    phone: '+998935557341',
    rooms: ['Room 31'],
    publishable: true,
    examShared: { staffId: 'S-269342', phone: '+998935557342' },
  });
  seeded.exams = { login: examVice.login, password: examVice.firstPassword };

  // Absences (task 5.7a-1): the publishable scene again, in a branch of its
  // own; the browser test publishes, enters an absence of the scene's
  // teacher, finds her lessons under "needs a teacher" on the home page and
  // shortens the absence.
  const absenceVice = await gridScene({
    branch: 'Absences browser test branch',
    vice: ['Sevara', 'Yusupova'],
    staffId: 'S-269343',
    phone: '+998935557343',
    rooms: [],
    publishable: true,
  });
  seeded.absences = { login: absenceVice.login, password: absenceVice.firstPassword };

  // Room closures (task 5.7a-2b): the publishable scene again, in a branch of
  // its own, with two rooms; the browser test publishes, puts 7 Oxford's
  // Monday lesson into Room 41 for the day, closes Room 41 that day, finds the
  // lesson under "needs a room" on the home page and moves it to Room 42.
  const closureVice = await gridScene({
    branch: 'Room closures browser test branch',
    vice: ['Nilufar', 'Saidova'],
    staffId: 'S-269344',
    phone: '+998935557344',
    rooms: ['Room 41', 'Room 42'],
    publishable: true,
  });
  seeded.roomClosures = { login: closureVice.login, password: closureVice.firstPassword };

  // Vacancy fill (task 5.7a-3b): the publishable scene again, in a branch of
  // its own, with both Geometry rows under a vacancy; the browser test
  // publishes, fills the vacancy with Aliyeva (7 Princeton's row is left:
  // taught in Russian), then with Aliyev, and the vacancy is closed.
  const fillVice = await gridScene({
    branch: 'Vacancy fill browser test branch',
    vice: ['Malika', 'Karimova'],
    staffId: 'S-269345',
    phone: '+998935557345',
    rooms: [],
    publishable: true,
    vacancyFill: { staffId: 'S-269346', phone: '+998935557346' },
  });
  seeded.vacancyFill = { login: fillVice.login, password: fillVice.firstPassword };

  // The acting teacher (task 5.7a-3c): the vacancy fill's scene again, in a
  // branch of its own; the browser test publishes, names Aliyeva the acting
  // teacher of 7 Oxford's Geometry journal from the vacancy's record and
  // finds the period there, 7 Princeton's journal still with no teacher.
  const actingVice = await gridScene({
    branch: 'Acting teacher browser test branch',
    vice: ['Dildora', 'Rasulova'],
    staffId: 'S-269347',
    phone: '+998935557347',
    rooms: [],
    publishable: true,
    vacancyFill: { staffId: 'S-269348', phone: '+998935557348' },
  });
  seeded.actingTeacher = { login: actingVice.login, password: actingVice.firstPassword };

  // The substitution of a lesson (task 5.7b-1): the vacancy fill's scene
  // again, in a branch of its own; the browser test publishes, substitutes
  // 7 Oxford's Geometry lesson of the vacancy with Aliyev (who cannot teach
  // in Uzbek, so it asks the tick), finds the lesson no longer needing a
  // teacher, and withdraws the substitution.
  const substitutionVice = await gridScene({
    branch: 'Substitution browser test branch',
    vice: ['Mohira', 'Sobirova'],
    staffId: 'S-269349',
    phone: '+998935557349',
    rooms: [],
    publishable: true,
    vacancyFill: { staffId: 'S-269350', phone: '+998935557350' },
  });
  seeded.substitution = {
    login: substitutionVice.login,
    password: substitutionVice.firstPassword,
  };

  // The substitution from an absence (task 5.7b-2): the publishable scene
  // again, in a branch of its own, with a second teacher of Geometry; the
  // browser test publishes, enters Aliyeva's absence for two weeks and
  // Rahimov's for the first, substitutes Rahimov for 7 Oxford's Geometry for
  // the whole absence (the first week is listed as blocked), and shortens
  // Aliyeva's absence to the first week: the second week's lessons return.
  const absenceSubstitutionVice = await gridScene({
    branch: 'Absence substitution browser test branch',
    vice: ['Gulnora', 'Tojiyeva'],
    staffId: 'S-269351',
    phone: '+998935557351',
    rooms: [],
    publishable: true,
    secondTeacher: { staffId: 'S-269352', phone: '+998935557352' },
  });
  seeded.absenceSubstitution = {
    login: absenceSubstitutionVice.login,
    password: absenceSubstitutionVice.firstPassword,
  };

  // Version history (task 5.8a): the publishable scene in a branch of its
  // own, 7 Princeton's Geometry in Room 31, then the version published and
  // Room 31 closed: the browser test sees the quarter it is in force on,
  // restores it as a new draft whose "To place" lists that lesson ("its room
  // is closed"), and compares the two versions.
  const historyVice = await gridScene({
    branch: 'Version history browser test branch',
    vice: ['Feruza', 'Usmonova'],
    staffId: 'S-269363',
    phone: '+998935557353',
    rooms: ['Room 31'],
    publishable: true,
  });
  const historyBranch = await migrator
    .selectFrom('branches')
    .select('id')
    .where('name', '=', 'Version history browser test branch')
    .executeTakeFirstOrThrow();
  const room31 = await migrator
    .selectFrom('rooms')
    .select('id')
    .where('branch_id', '=', historyBranch.id)
    .where('name', '=', 'Room 31')
    .executeTakeFirstOrThrow();
  const historyVersion = await migrator
    .selectFrom('timetable_versions')
    .select('id')
    .where('branch_id', '=', historyBranch.id)
    .executeTakeFirstOrThrow();
  await migrator
    .updateTable('pattern_entries')
    .set({ room_id: room31.id })
    .where('version_id', '=', historyVersion.id)
    .where('start_minutes', '=', 525)
    .execute();
  await migrator
    .updateTable('timetable_versions')
    .set({ status: 'published' })
    .where('id', '=', historyVersion.id)
    .execute();
  await migrator
    .updateTable('rooms')
    .set({ status: 'closed' })
    .where('id', '=', room31.id)
    .execute();
  seeded.versionHistory = { login: historyVice.login, password: historyVice.firstPassword };

  // The timetable views (task 5.9a): the publishable scene in a branch of its
  // own; the browser test publishes, cancels 7 Oxford's Monday lesson for the
  // day with a reason, and finds it in the class's week and on the school
  // view of Timetable views, "Cancelled" and "Changed".
  const viewsVice = await gridScene({
    branch: 'Timetable views browser test branch',
    vice: ['Lola', 'Ahmedova'],
    staffId: 'S-269365',
    phone: '+998935557355',
    rooms: [],
    publishable: true,
  });
  seeded.timetableViews = { login: viewsVice.login, password: viewsVice.firstPassword };

  // Print, PDF and Excel of the timetable views (task 5.9c-1): the publishable
  // scene in a branch of its own; the browser test publishes, downloads the
  // school week as a PDF in Russian and a teacher's week in Uzbek, and reads
  // the fonts and the text of every page of each file.
  const filesVice = await gridScene({
    branch: 'Timetable files browser test branch',
    vice: ['Munisa', 'Rahmonova'],
    staffId: 'S-269366',
    phone: '+998935557366',
    rooms: [],
    publishable: true,
  });
  // The scene's second class with a name in Uzbek Cyrillic (ў, ғ, қ, ҳ), letters only
  // the cyrillic-ext file of Golos Text holds; names are printed as entered.
  const filesBranch = await migrator
    .selectFrom('branches')
    .select('id')
    .where('name', '=', 'Timetable files browser test branch')
    .executeTakeFirstOrThrow();
  await migrator
    .updateTable('classes')
    .set({ name: 'Ғўзақаҳ' })
    .where('branch_id', '=', filesBranch.id)
    .where('name', '=', 'Princeton')
    .execute();
  seeded.timetableFiles = { login: filesVice.login, password: filesVice.firstPassword };

  // The print of a version (task 5.9c-2): the publishable scene in a branch of
  // its own, left a draft; the browser test prints the draft from Version
  // history in English, Russian and Uzbek and reads DRAFT, the fonts and the
  // text of every page. The second class is named in Uzbek Cyrillic, as above.
  const versionFilesVice = await gridScene({
    branch: 'Version files browser test branch',
    vice: ['Zarina', 'Usmonova'],
    staffId: 'S-269367',
    phone: '+998935557377',
    rooms: [],
    publishable: true,
  });
  const versionFilesBranch = await migrator
    .selectFrom('branches')
    .select('id')
    .where('name', '=', 'Version files browser test branch')
    .executeTakeFirstOrThrow();
  await migrator
    .updateTable('classes')
    .set({ name: 'Ғўзақаҳ' })
    .where('branch_id', '=', versionFilesBranch.id)
    .where('name', '=', 'Princeton')
    .execute();
  seeded.versionFiles = {
    login: versionFilesVice.login,
    password: versionFilesVice.firstPassword,
  };

  // The forced delete of a lesson (task 5.8b): the publishable scene in a
  // branch of its own. The forced delete is the Super Admin's only, and the
  // seed holds no fourth Super Admin (at most three, correction 1 of the
  // review of #87): the first setup test's Super Admin, at the end of its
  // session, publishes, deletes 7 Oxford's Monday lesson for good, restores
  // it from Deleted lessons and reads both lines in the lesson's history
  // (apps/web/e2e/timetable-forced-delete.ts). The scene's Academic Vice
  // Principal signs in to nothing.
  await gridScene({
    branch: 'Forced delete browser test branch',
    vice: ['Shoira', 'Abdullayeva'],
    staffId: 'S-269364',
    phone: '+998935557354',
    rooms: [],
    publishable: true,
  });

  // The department move (task 3.4c): a branch of its own with a year around
  // today, 7 Oxford, the attendance-only subject Cosmology of STEAM and a
  // draft whose row of it names a STEAM teacher who no longer has it in the
  // profile, so that only the load keeps the move. The seed holds no fourth
  // Super Admin: the years test's Super Admin moves it at the end of its
  // session.
  const moveBranch = await insertBranch(migrator, 'Department move browser test branch');
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: moveBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: moveBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const oxford = await transaction
      .insertInto('classes')
      .values({
        branch_id: moveBranch,
        academic_year_id: year.id,
        grade: 7,
        name: 'Oxford',
        language: 'uz',
        max_size: 25,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const cosmology = await transaction
      .insertInto('subjects')
      .values({
        name_uz: 'Kosmologiya',
        name_ru: 'Космология',
        name_en: 'Cosmology',
        department_id: steam.id,
        grades: [7],
        colour: 'indigo',
        journal_type: 'attendance_only',
        rating_exam: false,
        language_rule: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269321',
        first_name: 'Malika',
        last_name: 'Qodirova',
        sex: 'female',
        birth_date: '1987-11-02',
        phone: '+998935557321',
        admission_date: '2026-09-01',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: person.id, branch_id: moveBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: person.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_languages')
      .values({ staff_id: person.id, language: 'uz' })
      .execute();
    await transaction
      .insertInto('staff_subjects')
      .values({ staff_id: person.id, subject_id: cosmology.id, grades: [7] })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
      .execute();
    const version = await transaction
      .insertInto('timetable_versions')
      .values({ branch_id: moveBranch, academic_year_id: year.id, number: 1, starts_on: startDate })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('teaching_load_rows')
      .values({
        branch_id: moveBranch,
        version_id: version.id,
        class_id: oxford.id,
        subject_id: cosmology.id,
        teacher_id: person.id,
        lessons_per_week: 1,
      })
      .execute();
    // The profile row goes; the load row stays (3.4a decision 3).
    await transaction.deleteFrom('staff_subjects').where('staff_id', '=', person.id).execute();
  });

  // Task 3.5a (issue #105): the hand test pages at 375 and 1440 px in Uzbek
  // and in Russian, one Academic Vice Principal each. 7 Oxford holds a
  // student, one whose leaving is scheduled and one who starts later; 7
  // Princeton is empty (H18); the parents are written surname first (H7); a
  // draft holds a load row (H21). All names are invented.
  const handBranch = await insertBranch(migrator, 'Hand test 3.5a branch');
  const handTestUz = await create('Dildora', 'Ahmedova');
  const handTestRu = await create('Ruslan', 'Sharipov');
  for (const account of [handTestUz, handTestRu]) {
    await transactions.run([handBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: account.id,
        role: 'academic_vice_principal',
        branchId: handBranch,
        givenBy: null,
      }),
    );
  }
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: handBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: handBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const written = await transaction
      .insertInto('classes')
      .values([
        {
          branch_id: handBranch,
          academic_year_id: year.id,
          grade: 7,
          name: 'Oxford',
          language: 'uz',
          max_size: 24,
        },
        {
          branch_id: handBranch,
          academic_year_id: year.id,
          grade: 7,
          name: 'Princeton',
          language: 'ru',
          max_size: 24,
        },
      ])
      .returning(['id', 'name'])
      .execute();
    // Picked by name: the order of the rows an insert returns is not relied on.
    const oxford = written.find((one) => one.name === 'Oxford');
    if (oxford === undefined) {
      throw new Error('7 Oxford was not written.');
    }
    const leaveFrom = isoDate(new Date(tashkentToday.getTime() + 5 * dayMs));
    const startsLater = isoDate(new Date(tashkentToday.getTime() + 7 * dayMs));
    const students = [
      { uid: '9999711', first: 'Bekzod', last: 'Aliyev', parent: 'Aliyeva Zarina' },
      { uid: '9999712', first: 'Malika', last: 'Karimova', parent: 'Karimova Gulnora' },
      {
        uid: '9999713',
        first: 'Nodira',
        last: 'Rasulova',
        parent: 'Rasulova Dilfuza',
        from: startsLater,
      },
    ];
    const ids: string[] = [];
    for (const [index, student] of students.entries()) {
      ids.push(
        await studentInClass(transaction, {
          branch: handBranch,
          // Malika's stay is written below, ending at her leaving.
          classId: index === 1 ? null : oxford.id,
          uid: student.uid,
          first: student.first,
          last: student.last,
          createdBy: handTestUz.id,
          phone: `+9989355507${String(11 + index)}`,
          ...(student.from === undefined ? {} : { from: student.from }),
        }),
      );
      // H7: the parent's one "Full name" field, typed surname first.
      const linked = await transaction
        .selectFrom('student_relatives')
        .select('relative_id')
        .where('student_id', '=', ids[index] ?? '')
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('relatives')
        .set({ full_name: student.parent, name_key: relativeNameKey(student.parent) })
        .where('id', '=', linked.relative_id)
        .execute();
    }
    // H3: Malika's leaving is scheduled, her last day the day before leaveFrom.
    const leaving = ids[1] ?? '';
    await transaction
      .insertInto('class_memberships')
      .values({
        branch_id: handBranch,
        student_id: leaving,
        class_id: oxford.id,
        valid_from: startDate,
        valid_until: leaveFrom,
        own_until: leaveFrom,
        cause: 'placement',
      })
      .execute();
    await transaction
      .updateTable('student_statuses')
      .set({ valid_until: leaveFrom })
      .where('student_id', '=', leaving)
      .execute();
    await transaction
      .insertInto('student_statuses')
      .values({
        student_id: leaving,
        branch_id: handBranch,
        status: 'inactive',
        valid_from: leaveFrom,
        cause: 'leaving',
        reason: 'Oila boshqa shaharga koʻchdi',
      })
      .execute();
    // H21: a draft with a load row of 7 Oxford, taught by a vacancy.
    const geometry = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('name_en', '=', 'Geometry')
      .executeTakeFirstOrThrow();
    const vacancy = await transaction
      .insertInto('staff')
      .values({ kind: 'vacancy', vacancy_name: 'Geometry vacancy 2' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('staff_branches')
      .values({ staff_id: vacancy.id, branch_id: handBranch, is_main: true })
      .execute();
    await transaction
      .insertInto('staff_divisions')
      .values({
        staff_id: vacancy.id,
        division_id: academic.id,
        department_id: steam.id,
        is_main: true,
      })
      .execute();
    await transaction
      .insertInto('staff_statuses')
      .values({ staff_id: vacancy.id, status: 'open', valid_from: startDate })
      .execute();
    await transaction
      .insertInto('staff_languages')
      .values({ staff_id: vacancy.id, language: 'uz' })
      .execute();
    await transaction
      .insertInto('staff_subjects')
      .values({ staff_id: vacancy.id, subject_id: geometry.id, grades: [7] })
      .execute();
    const version = await transaction
      .insertInto('timetable_versions')
      .values({ branch_id: handBranch, academic_year_id: year.id, number: 1, starts_on: startDate })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('teaching_load_rows')
      .values({
        branch_id: handBranch,
        version_id: version.id,
        class_id: oxford.id,
        subject_id: geometry.id,
        teacher_id: vacancy.id,
        lessons_per_week: 3,
      })
      .execute();
  });
  seeded.handTestUz = { login: handTestUz.login, password: handTestUz.firstPassword };
  seeded.handTestRu = { login: handTestRu.login, password: handTestRu.firstPassword };

  // Task 3.5b (issue #105, Part C): one Academic Vice Principal per browser
  // test. 7 Yale is full (H24); the mother of a student of 7 Oxford has a
  // known phone (H26, H33); the switch account works in a second branch
  // (H32). All names and phones are invented.
  const formsBranch = await insertBranch(migrator, 'Hand test 3.5b branch');
  const secondBranch = await insertBranch(migrator, 'Hand test 3.5b second branch');
  const handForms = await create('Shahzoda', 'Yoqubova');
  const handSwitch = await create('Temur', 'Nazarov');
  const handSearch = await create('Laylo', 'Hamroyeva');
  for (const [account, branchId] of [
    [handForms, formsBranch],
    [handSwitch, formsBranch],
    [handSwitch, secondBranch],
    [handSearch, formsBranch],
  ] as const) {
    await transactions.run([branchId], (transaction) =>
      assignments.give(transaction, {
        accountId: account.id,
        role: 'academic_vice_principal',
        branchId,
        givenBy: null,
      }),
    );
  }
  await migrator.transaction().execute(async (transaction) => {
    const classIds = new Map<string, string>();
    for (const branchId of [formsBranch, secondBranch]) {
      const year = await transaction
        .insertInto('academic_years')
        .values({
          branch_id: branchId,
          start_date: startDate,
          end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('quarters')
        .values(
          [1, 2, 3, 4].map((number) => ({
            branch_id: branchId,
            academic_year_id: year.id,
            number,
          })),
        )
        .execute();
      const names = branchId === formsBranch ? ['Oxford', 'Yale'] : ['Cambridge'];
      for (const name of names) {
        const written = await transaction
          .insertInto('classes')
          .values({
            branch_id: branchId,
            academic_year_id: year.id,
            grade: 7,
            name,
            language: 'uz',
            max_size: name === 'Yale' ? 1 : 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        classIds.set(name, written.id);
      }
    }
    const pupils = [
      {
        uid: '9999811',
        first: 'Sevinch',
        last: 'Qodirova',
        parent: 'Qodirova Dilbar',
        klass: 'Oxford',
        phone: '+998935553311',
      },
      {
        uid: '9999812',
        first: 'Akmal',
        last: 'Tursunov',
        parent: 'Tursunova Zulfiya',
        klass: 'Yale',
        phone: '+998935553312',
      },
    ];
    for (const pupil of pupils) {
      const id = await studentInClass(transaction, {
        branch: formsBranch,
        classId: classIds.get(pupil.klass) ?? null,
        uid: pupil.uid,
        first: pupil.first,
        last: pupil.last,
        createdBy: handForms.id,
        phone: pupil.phone,
      });
      const linked = await transaction
        .selectFrom('student_relatives')
        .select('relative_id')
        .where('student_id', '=', id)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable('relatives')
        .set({ full_name: pupil.parent, name_key: relativeNameKey(pupil.parent) })
        .where('id', '=', linked.relative_id)
        .execute();
    }
  });
  seeded.handTest35bForms = { login: handForms.login, password: handForms.firstPassword };
  seeded.handTest35bSwitch = { login: handSwitch.login, password: handSwitch.firstPassword };
  seeded.handTest35bSearch = { login: handSearch.login, password: handSearch.firstPassword };

  // Task 3.5c (issue #105, Part D, H36): one Academic Vice Principal, a
  // student of 7 Oxford and 7 Princeton beside it, in a branch of their own.
  // All names and phones are invented.
  const staysBranch = await insertBranch(migrator, 'Hand test 3.5c branch');
  const handStays = await create('Dilshod', 'Ergashev');
  await transactions.run([staysBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: handStays.id,
      role: 'academic_vice_principal',
      branchId: staysBranch,
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: staysBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({
          branch_id: staysBranch,
          academic_year_id: year.id,
          number,
        })),
      )
      .execute();
    const classIds = new Map<string, string>();
    for (const name of ['Oxford', 'Princeton']) {
      const written = await transaction
        .insertInto('classes')
        .values({
          branch_id: staysBranch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language: 'uz',
          max_size: 24,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      classIds.set(name, written.id);
    }
    await studentInClass(transaction, {
      branch: staysBranch,
      classId: classIds.get('Oxford') ?? null,
      uid: '9999821',
      first: 'Sardor',
      last: 'Usmonov',
      createdBy: handStays.id,
      phone: '+998935553321',
    });
  });
  seeded.handTest35cStays = { login: handStays.login, password: handStays.firstPassword };

  // Task 3.6a (the owner's answers L32, L48, L59 on issue #42): a Teacher of
  // 7 Oxford in the published load, with a student of 7 Oxford and one of 7
  // Yale; a Head Tutor; a Head Teacher of Seismology and a Senior Head Teacher
  // of it whose staff record is in another branch. All names are invented.
  const whoBranch = await insertBranch(migrator, 'Who sees what browser test branch');
  const whoOther = await insertBranch(migrator, 'Who sees what other branch');
  const whoTeacher = await create('Dilshod', 'Aminov');
  const whoHeadTutor = await create('Mohira', 'Saidova');
  const whoHeadTeacher = await create('Ravshan', 'Tolipov');
  const whoSenior = await create('Bahrom', 'Toshev');
  const seismology = await migrator.transaction().execute(async (transaction) => {
    const steam = await transaction
      .selectFrom('departments')
      .select('id')
      .where('name_en', '=', 'STEAM')
      .executeTakeFirstOrThrow();
    return (
      await transaction
        .insertInto('subjects')
        .values({
          name_uz: 'Seysmologiya',
          name_ru: 'Сейсмология',
          name_en: 'Seismology',
          department_id: steam.id,
          grades: [7],
          colour: 'indigo',
          journal_type: 'graded',
          rating_exam: false,
          language_rule: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });
  for (const [account, role, branchId] of [
    [whoTeacher, 'teacher', whoBranch],
    [whoHeadTutor, 'head_tutor', whoBranch],
  ] as const) {
    await transactions.run([branchId], (transaction) =>
      assignments.give(transaction, { accountId: account.id, role, branchId, givenBy: null }),
    );
  }
  await transactions.run([whoBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: whoHeadTeacher.id,
      role: 'head_teacher',
      branchId: whoBranch,
      subjectIds: [seismology],
      givenBy: null,
    }),
  );
  await transactions.run([], (transaction) =>
    assignments.give(transaction, {
      accountId: whoSenior.id,
      role: 'senior_head_teacher',
      branchId: null,
      subjectIds: [seismology],
      givenBy: null,
    }),
  );
  await migrator.transaction().execute(async (transaction) => {
    const academic = await transaction
      .selectFrom('divisions')
      .select('id')
      .where('name_en', '=', 'Academic')
      .executeTakeFirstOrThrow();
    const steam = await transaction
      .selectFrom('departments')
      .select('id')
      .where('name_en', '=', 'STEAM')
      .executeTakeFirstOrThrow();
    const staffOf = async (input: {
      accountId: string;
      first: string;
      last: string;
      staffId: string;
      phone: string;
      branchId: string;
    }) => {
      const person = await transaction
        .insertInto('staff')
        .values({
          kind: 'person',
          staff_id: input.staffId,
          account_id: input.accountId,
          first_name: input.first,
          last_name: input.last,
          sex: 'male',
          birth_date: '1986-02-03',
          phone: input.phone,
          admission_date: '2026-09-01',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('staff_branches')
        .values({ staff_id: person.id, branch_id: input.branchId, is_main: true })
        .execute();
      await transaction
        .insertInto('staff_divisions')
        .values({
          staff_id: person.id,
          division_id: academic.id,
          department_id: steam.id,
          is_main: true,
        })
        .execute();
      await transaction
        .insertInto('staff_languages')
        .values({ staff_id: person.id, language: 'uz' })
        .execute();
      await transaction
        .insertInto('staff_subjects')
        .values({ staff_id: person.id, subject_id: seismology, grades: [7] })
        .execute();
      await transaction
        .insertInto('staff_statuses')
        .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
        .execute();
      return person.id;
    };
    const teacherStaff = await staffOf({
      accountId: whoTeacher.id,
      first: 'Dilshod',
      last: 'Aminov',
      staffId: 'S-269361',
      phone: '+998935553361',
      branchId: whoBranch,
    });
    // The Senior Head Teacher's record is of the other branch only (L32).
    await staffOf({
      accountId: whoSenior.id,
      first: 'Bahrom',
      last: 'Toshev',
      staffId: 'S-269362',
      phone: '+998935553362',
      branchId: whoOther,
    });
    const year = await transaction
      .insertInto('academic_years')
      .values({
        branch_id: whoBranch,
        start_date: startDate,
        end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('quarters')
      .values(
        [1, 2, 3, 4].map((number) => ({ branch_id: whoBranch, academic_year_id: year.id, number })),
      )
      .execute();
    const classIds = new Map<string, string>();
    for (const name of ['Oxford', 'Yale']) {
      const written = await transaction
        .insertInto('classes')
        .values({
          branch_id: whoBranch,
          academic_year_id: year.id,
          grade: 7,
          name,
          language: 'uz',
          max_size: 24,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      classIds.set(name, written.id);
    }
    for (const [uid, first, last, klass, phone] of [
      ['9999831', 'Madina', 'Yoqubova', 'Oxford', '+998935553331'],
      ['9999832', 'Javohir', 'Nurmatov', 'Yale', '+998935553332'],
    ] as const) {
      const id = await studentInClass(transaction, {
        branch: whoBranch,
        classId: classIds.get(klass) ?? null,
        uid,
        first,
        last,
        createdBy: whoHeadTutor.id,
        phone,
      });
      await transaction
        .updateTable('students')
        .set({ diagnostic_score: 68 })
        .where('id', '=', id)
        .execute();
    }
    // The load is written into a draft and published here: publishing
    // comes with task 5.5 (decision 4 of pull request #118).
    const version = await transaction
      .insertInto('timetable_versions')
      .values({ branch_id: whoBranch, academic_year_id: year.id, number: 1, starts_on: startDate })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('teaching_load_rows')
      .values({
        branch_id: whoBranch,
        version_id: version.id,
        class_id: classIds.get('Oxford') ?? '',
        subject_id: seismology,
        teacher_id: teacherStaff,
        lessons_per_week: 2,
      })
      .execute();
    await transaction
      .updateTable('timetable_versions')
      .set({ status: 'published' })
      .where('id', '=', version.id)
      .execute();
  });
  seeded.whoTeacher = { login: whoTeacher.login, password: whoTeacher.firstPassword };
  seeded.whoHeadTutor = { login: whoHeadTutor.login, password: whoHeadTutor.firstPassword };
  seeded.whoHeadTeacher = { login: whoHeadTeacher.login, password: whoHeadTeacher.firstPassword };

  // The journal grid (task 6.2): a teacher's class journal with a quarter of
  // lessons, every day from two weeks ago to a week ahead at 08:00, the first
  // quarter around today, three students, and marks and a classwork on every
  // lesson before today, written as the migrator as `CellsKit` writes them.
  // The browser test opens it from the home page at today's lesson and reads
  // the grid. All names are invented.
  const journalBranch = await insertBranch(migrator, 'Journal browser test branch');
  const journalTeacher = await create('Sanjar', 'Qodirov');
  await transactions.run([journalBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: journalTeacher.id,
      role: 'teacher',
      branchId: journalBranch,
      givenBy: null,
    }),
  );
  {
    const todayDate = isoDate(tashkentToday);
    const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
    const lessonsKit = await LessonsKit.create(migrator);
    const geography = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Geography',
      journalType: 'graded',
    });
    const { yearId, classId, staffId, studentIds, quarterIds } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const person = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: 'S-269399',
            account_id: journalTeacher.id,
            first_name: 'Sanjar',
            last_name: 'Qodirov',
            sex: 'male',
            birth_date: '1987-03-04',
            phone: '+998935557399',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: person.id, branch_id: journalBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: person.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: person.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: person.id, subject_id: geography, grades: [7] })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: journalBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const quarterDates: [string, string][] = [
          [startDate, plus(20)],
          [plus(30), plus(90)],
          [plus(100), plus(170)],
          [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
        ];
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            quarterDates.map(([start, end], index) => ({
              branch_id: journalBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const weights = { attendance: 20, classwork: 40, homework: 40 };
        await transaction
          .insertInto('subject_daily_weights')
          .values({ branch_id: journalBranch, subject_id: geography, ...weights })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: journalBranch,
              subject_id: geography,
              quarter_id: quarter.id,
              ...weights,
            })),
          )
          .execute();
        const oxford = await transaction
          .insertInto('classes')
          .values({
            branch_id: journalBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Oxford',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const students: string[] = [];
        for (const [uid, first, last, phone] of [
          ['9999841', 'Nodira', 'Zokirova', '+998935553341'],
          ['9999842', 'Bekzod', 'Oʻktamov', '+998935553342'],
          ['9999843', 'Lola', 'Abdullayeva', '+998935553343'],
        ] as const) {
          students.push(
            await studentInClass(transaction, {
              branch: journalBranch,
              classId: oxford.id,
              uid,
              first,
              last,
              createdBy: journalTeacher.id,
              phone,
            }),
          );
        }
        return {
          yearId: year.id,
          classId: oxford.id,
          staffId: person.id,
          studentIds: students,
          quarterIds: quarters.map((one) => one.id),
        };
      });
    const source = await lessonsKit.source(
      journalBranch,
      yearId,
      [{ classId, groupId: null, subjectId: geography, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: journalBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: geography,
        runs: `{[${startDate},)}`,
      })
      .execute();
    for (let offset = -14; offset <= 7; offset += 1) {
      const date = plus(offset);
      const lessonId = await migrator.transaction().execute(async (transaction) => {
        const block = await transaction
          .insertInto('lesson_blocks')
          .values({
            branch_id: journalBranch,
            academic_year_id: yearId,
            quarter_id: quarterIds[0] ?? '',
            lesson_date: date,
            starts_at: new Date(`${date}T08:00:00+05:00`),
            ends_at: new Date(`${date}T08:45:00+05:00`),
            version_id: source.versionId,
            pattern_block_id: source.patternBlockId,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        return (
          await transaction
            .insertInto('lessons')
            .values({
              branch_id: journalBranch,
              block_id: block.id,
              lesson_date: block.lesson_date,
              starts_at: block.starts_at,
              ends_at: block.ends_at,
              class_id: classId,
              subject_id: geography,
              teacher_id: staffId,
              load_row_id: source.lessons[0]?.loadRowId ?? '',
              pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      });
      if (date >= todayDate) continue;
      await migrator.transaction().execute(async (transaction) => {
        await sql`select set_config('app.now', ${`${date}T09:00:00+05:00`}, true)`.execute(
          transaction,
        );
        const work = await transaction
          .insertInto('journal_works')
          .values({
            branch_id: journalBranch,
            lesson_id: lessonId,
            // Task 8.1 (0119): a classwork's source is its own lesson.
            source_lesson_id: lessonId,
            kind: 'classwork',
            total: 10,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [index, studentId] of studentIds.entries()) {
          await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: journalBranch,
              lesson_id: lessonId,
              student_id: studentId,
              mark: index === 2 && offset % 3 === 0 ? 0 : index === 1 && offset % 4 === 0 ? 2 : 1,
              version: 1,
              changed_by: journalTeacher.id,
              changed_how: 'entry',
              changed_at: new Date(`${date}T09:00:00+05:00`),
            })
            .execute();
          if (index < 2) {
            await transaction
              .insertInto('journal_cells')
              .values({
                branch_id: journalBranch,
                lesson_id: lessonId,
                student_id: studentId,
                work_id: work.id,
                score: 5 + ((offset + index) % 6),
                version: 1,
                changed_by: journalTeacher.id,
                changed_how: 'entry',
                changed_at: new Date(`${date}T09:00:00+05:00`),
              })
              .execute();
          }
        }
      });
    }
  }
  seeded.journalTeacher = { login: journalTeacher.login, password: journalTeacher.firstPassword };

  // Task 6.3: a branch of its own for attendance entry: a class of three
  // students, a teacher of its statistics with one lesson yesterday at 08:00
  // (started whatever the hour of the test; spec review of the code, should-fix 7), and the class's Tutor with a staff record. The
  // browser test marks "all present", types a 0, and the Tutor records the
  // reason. All names are invented.
  const attendanceBranch = await insertBranch(migrator, 'Attendance browser test branch');
  const attendanceTeacher = await create('Dilshod', 'Rasulov');
  const attendanceTutor = await create('Madina', 'Yusupova');
  await transactions.run([attendanceBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: attendanceTeacher.id,
      role: 'teacher',
      branchId: attendanceBranch,
      givenBy: null,
    }),
  );
  const attendanceTutorRole = await transactions.run([attendanceBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: attendanceTutor.id,
      role: 'tutor',
      branchId: attendanceBranch,
      givenBy: null,
    }),
  );
  {
    const yesterday = isoDate(new Date(tashkentToday.getTime() - dayMs));
    const lessonsKit = await LessonsKit.create(migrator);
    const algebra = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Statistics',
      journalType: 'graded',
    });
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const people: string[] = [];
        for (const [accountId, staffNumber, first, last, phone] of [
          [attendanceTeacher.id, 'S-777701', 'Dilshod', 'Rasulov', '+998935557401'],
          [attendanceTutor.id, 'S-777702', 'Madina', 'Yusupova', '+998935557402'],
        ] as const) {
          const person = await transaction
            .insertInto('staff')
            .values({
              kind: 'person',
              staff_id: staffNumber,
              account_id: accountId,
              first_name: first,
              last_name: last,
              sex: 'female',
              birth_date: '1988-05-06',
              phone,
              admission_date: '2026-09-01',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('staff_branches')
            .values({ staff_id: person.id, branch_id: attendanceBranch, is_main: true })
            .execute();
          await transaction
            .insertInto('staff_divisions')
            .values({
              staff_id: person.id,
              division_id: academic.id,
              department_id: steam.id,
              is_main: true,
            })
            .execute();
          await transaction
            .insertInto('staff_languages')
            .values({ staff_id: person.id, language: 'uz' })
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
            .execute();
          people.push(person.id);
        }
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: people[0] ?? '', subject_id: algebra, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: attendanceBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: attendanceBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const weights = { attendance: 20, classwork: 40, homework: 40 };
        await transaction
          .insertInto('subject_daily_weights')
          .values({ branch_id: attendanceBranch, subject_id: algebra, ...weights })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: attendanceBranch,
              subject_id: algebra,
              quarter_id: quarter.id,
              ...weights,
            })),
          )
          .execute();
        const cambridge = await transaction
          .insertInto('classes')
          .values({
            branch_id: attendanceBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Cambridge',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('class_tutors')
          .values({
            branch_id: attendanceBranch,
            class_id: cambridge.id,
            assignment_id: attendanceTutorRole.id,
            kind: 'tutor',
            valid_from: new Date(),
            own_until: null,
            given_by: attendanceTutor.id,
          })
          .execute();
        for (const [uid, first, last, phone] of [
          ['9999851', 'Kamola', 'Ergasheva', '+998935553351'],
          ['9999852', 'Jasur', 'Toshmatov', '+998935553352'],
          ['9999853', 'Aziz', 'Normatov', '+998935553353'],
        ] as const) {
          await studentInClass(transaction, {
            branch: attendanceBranch,
            classId: cambridge.id,
            uid,
            first,
            last,
            createdBy: attendanceTeacher.id,
            phone,
          });
        }
        return {
          yearId: year.id,
          classId: cambridge.id,
          staffId: people[0] ?? '',
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      attendanceBranch,
      yearId,
      [{ classId, groupId: null, subjectId: algebra, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: attendanceBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: algebra,
        runs: `{[${startDate},)}`,
      })
      .execute();
    await migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: attendanceBranch,
          academic_year_id: yearId,
          quarter_id: quarterId,
          lesson_date: yesterday,
          starts_at: new Date(`${yesterday}T08:00:00+05:00`),
          ends_at: new Date(`${yesterday}T08:45:00+05:00`),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('lessons')
        .values({
          branch_id: attendanceBranch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: algebra,
          teacher_id: staffId,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .execute();
    });
  }
  seeded.attendanceTeacher = {
    login: attendanceTeacher.login,
    password: attendanceTeacher.firstPassword,
  };
  seeded.attendanceTutor = {
    login: attendanceTutor.login,
    password: attendanceTutor.firstPassword,
  };

  // Task 8.7: a branch of its own for the lesson status: a class of two students, a teacher
  // of its "Cartography" (graded) with one lesson today at 00:05 (held whatever the hour of
  // the test) and a classwork of total 10 on it. The browser test marks attendance, types one
  // number, sets the other "not graded" and reads the status on the journal and the home
  // page. All names are invented.
  const statusBranch = await insertBranch(migrator, 'Status browser test branch');
  const statusTeacher = await create('Shahlo', 'Nazarova');
  await transactions.run([statusBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: statusTeacher.id,
      role: 'teacher',
      branchId: statusBranch,
      givenBy: null,
    }),
  );
  {
    const today = isoDate(tashkentToday);
    const lessonsKit = await LessonsKit.create(migrator);
    const cartography = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Cartography',
      journalType: 'graded',
    });
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const person = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: 'S-778701',
            account_id: statusTeacher.id,
            first_name: 'Shahlo',
            last_name: 'Nazarova',
            sex: 'female',
            birth_date: '1986-02-03',
            phone: '+998935558701',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: person.id, branch_id: statusBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: person.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: person.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: person.id, subject_id: cartography, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: statusBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: statusBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const weights = { attendance: 20, classwork: 40, homework: 40 };
        await transaction
          .insertInto('subject_daily_weights')
          .values({ branch_id: statusBranch, subject_id: cartography, ...weights })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: statusBranch,
              subject_id: cartography,
              quarter_id: quarter.id,
              ...weights,
            })),
          )
          .execute();
        const leeds = await transaction
          .insertInto('classes')
          .values({
            branch_id: statusBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Leeds',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [uid, first, last, phone] of [
          ['9999891', 'Sardor', 'Alimov', '+998935553391'],
          ['9999892', 'Zarina', 'Botirova', '+998935553392'],
        ] as const) {
          await studentInClass(transaction, {
            branch: statusBranch,
            classId: leeds.id,
            uid,
            first,
            last,
            createdBy: statusTeacher.id,
            phone,
          });
        }
        return {
          yearId: year.id,
          classId: leeds.id,
          staffId: person.id,
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      statusBranch,
      yearId,
      [{ classId, groupId: null, subjectId: cartography, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: statusBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: cartography,
        runs: `{[${startDate},)}`,
      })
      .execute();
    await migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: statusBranch,
          academic_year_id: yearId,
          quarter_id: quarterId,
          lesson_date: today,
          starts_at: new Date(`${today}T00:05:00+05:00`),
          ends_at: new Date(`${today}T00:50:00+05:00`),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const lesson = await transaction
        .insertInto('lessons')
        .values({
          branch_id: statusBranch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: cartography,
          teacher_id: staffId,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await sql`select set_config('app.now', ${`${today}T00:06:00+05:00`}, true)`.execute(
        transaction,
      );
      await transaction
        .insertInto('journal_works')
        .values({
          branch_id: statusBranch,
          lesson_id: lesson.id,
          source_lesson_id: lesson.id,
          kind: 'classwork',
          total: 10,
        })
        .execute();
    });
  }
  seeded.statusTeacher = { login: statusTeacher.login, password: statusTeacher.firstPassword };

  // Task 8.8: a branch of its own for plans in the journal: a class of two students, a teacher
  // of its "Geodesy" (graded) with a lesson yesterday and one today at 00:05 (both held), and
  // a plan item on yesterday's row with the homework "Read the map". The browser test opens
  // yesterday's lesson card, marks the homework "not given", and today's homework column is
  // gone. All names are invented.
  const deliveryBranch = await insertBranch(migrator, 'Plans in the journal browser test branch');
  const deliveryTeacher = await create('Dilfuza', 'Rahimova');
  await transactions.run([deliveryBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: deliveryTeacher.id,
      role: 'teacher',
      branchId: deliveryBranch,
      givenBy: null,
    }),
  );
  {
    const today = isoDate(tashkentToday);
    const lessonsKit = await LessonsKit.create(migrator);
    const geodesy = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Geodesy',
      journalType: 'graded',
    });
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const person = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: 'S-778801',
            account_id: deliveryTeacher.id,
            first_name: 'Dilfuza',
            last_name: 'Rahimova',
            sex: 'female',
            birth_date: '1986-02-03',
            phone: '+998935558801',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: person.id, branch_id: deliveryBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: person.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: person.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: person.id, subject_id: geodesy, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: deliveryBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: deliveryBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const weights = { attendance: 20, classwork: 40, homework: 40 };
        await transaction
          .insertInto('subject_daily_weights')
          .values({ branch_id: deliveryBranch, subject_id: geodesy, ...weights })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: deliveryBranch,
              subject_id: geodesy,
              quarter_id: quarter.id,
              ...weights,
            })),
          )
          .execute();
        const bristol = await transaction
          .insertInto('classes')
          .values({
            branch_id: deliveryBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Bristol',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [uid, first, last, phone] of [
          ['9999651', 'Sardor', 'Alimov', '+998935553301'],
          ['9999652', 'Zarina', 'Botirova', '+998935553302'],
        ] as const) {
          await studentInClass(transaction, {
            branch: deliveryBranch,
            classId: bristol.id,
            uid,
            first,
            last,
            createdBy: deliveryTeacher.id,
            phone,
          });
        }
        return {
          yearId: year.id,
          classId: bristol.id,
          staffId: person.id,
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      deliveryBranch,
      yearId,
      [{ classId, groupId: null, subjectId: geodesy, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: deliveryBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: geodesy,
        runs: `{[${startDate},)}`,
      })
      .execute();
    const yesterday = isoDate(new Date(tashkentToday.getTime() - dayMs));
    const lessonIds: string[] = [];
    for (const day of [yesterday, today]) {
      await migrator.transaction().execute(async (transaction) => {
        const block = await transaction
          .insertInto('lesson_blocks')
          .values({
            branch_id: deliveryBranch,
            academic_year_id: yearId,
            quarter_id: quarterId,
            lesson_date: day,
            starts_at: new Date(`${day}T00:05:00+05:00`),
            ends_at: new Date(`${day}T00:50:00+05:00`),
            version_id: source.versionId,
            pattern_block_id: source.patternBlockId,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        const lesson = await transaction
          .insertInto('lessons')
          .values({
            branch_id: deliveryBranch,
            block_id: block.id,
            lesson_date: block.lesson_date,
            starts_at: block.starts_at,
            ends_at: block.ends_at,
            class_id: classId,
            subject_id: geodesy,
            teacher_id: staffId,
            load_row_id: source.lessons[0]?.loadRowId ?? '',
            pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        lessonIds.push(lesson.id);
      });
    }
    const plan = await migrator
      .selectFrom('lesson_plan_journals')
      .innerJoin('journals', 'journals.id', 'lesson_plan_journals.journal_id')
      .select(['lesson_plan_journals.plan_id', 'lesson_plan_journals.journal_id'])
      .where('journals.class_id', '=', classId)
      .where('lesson_plan_journals.quarter_id', '=', quarterId)
      .executeTakeFirstOrThrow();
    const item = await migrator
      .insertInto('lesson_plan_items')
      .values({ branch_id: deliveryBranch, plan_id: plan.plan_id, topic: 'Contour lines' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await migrator
      .insertInto('lesson_plan_works')
      .values({
        branch_id: deliveryBranch,
        item_id: item.id,
        kind: 'homework',
        position: 1,
        title: 'Read the map',
      })
      .execute();
    await migrator
      .insertInto('lesson_plan_places')
      .values({
        branch_id: deliveryBranch,
        plan_id: plan.plan_id,
        journal_id: plan.journal_id,
        item_id: item.id,
        position: 1,
      })
      .execute();
  }
  seeded.deliveryTeacher = {
    login: deliveryTeacher.login,
    password: deliveryTeacher.firstPassword,
  };

  // Task 8.9: the Principal of the same branch (a whole-branch reader) exports a journal and the whole
  // branch (the job runs in the worker of the browser tests). All names are invented.
  const exportsPrincipal = await create('Shahnoza', 'Qodirova');
  await transactions.run([deliveryBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: exportsPrincipal.id,
      role: 'principal',
      branchId: deliveryBranch,
      givenBy: null,
    }),
  );
  seeded.exportsPrincipal = {
    login: exportsPrincipal.login,
    password: exportsPrincipal.firstPassword,
  };

  // Task 9.1: another Principal of the same branch opens a student's Results tab and the
  // lessons behind a result. All names are invented.
  const resultsPrincipal = await create('Madina', 'Tursunova');
  await transactions.run([deliveryBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: resultsPrincipal.id,
      role: 'principal',
      branchId: deliveryBranch,
      givenBy: null,
    }),
  );
  seeded.resultsPrincipal = {
    login: resultsPrincipal.login,
    password: resultsPrincipal.firstPassword,
  };

  // Task 7.1a: a branch of its own for lesson plans: a class with a teacher of
  // its "Planning" (a graded subject) and two lessons, tomorrow and in eight
  // days at 08:00. The browser test fills the plan's two rows. All names are invented.
  const plansBranch = await insertBranch(migrator, 'Plans browser test branch');
  const plansTeacher = await create('Gulnora', 'Saidova');
  await transactions.run([plansBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: plansTeacher.id,
      role: 'teacher',
      branchId: plansBranch,
      givenBy: null,
    }),
  );
  {
    const lessonsKit = await LessonsKit.create(migrator);
    const planning = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Planning',
      journalType: 'graded',
    });
    const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const person = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: 'S-777801',
            account_id: plansTeacher.id,
            first_name: 'Gulnora',
            last_name: 'Saidova',
            sex: 'female',
            birth_date: '1987-03-04',
            phone: '+998935557801',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: person.id, branch_id: plansBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: person.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: person.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: person.id, subject_id: planning, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: plansBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: plansBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const harvard = await transaction
          .insertInto('classes')
          .values({
            branch_id: plansBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Harvard',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return {
          yearId: year.id,
          classId: harvard.id,
          staffId: person.id,
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      plansBranch,
      yearId,
      [{ classId, groupId: null, subjectId: planning, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: plansBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: planning,
        runs: `{[${startDate},)}`,
      })
      .execute();
    for (const date of [plus(1), plus(8)]) {
      await migrator.transaction().execute(async (transaction) => {
        const block = await transaction
          .insertInto('lesson_blocks')
          .values({
            branch_id: plansBranch,
            academic_year_id: yearId,
            quarter_id: quarterId,
            lesson_date: date,
            starts_at: new Date(`${date}T08:00:00+05:00`),
            ends_at: new Date(`${date}T08:45:00+05:00`),
            version_id: source.versionId,
            pattern_block_id: source.patternBlockId,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('lessons')
          .values({
            branch_id: plansBranch,
            block_id: block.id,
            lesson_date: block.lesson_date,
            starts_at: block.starts_at,
            ends_at: block.ends_at,
            class_id: classId,
            subject_id: planning,
            teacher_id: staffId,
            load_row_id: source.lessons[0]?.loadRowId ?? '',
            pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
          })
          .execute();
      });
    }
    // Task 7.2: the plan window of quarter 1, from the first day of the year.
    await sql`
      insert into lesson_plan_windows
        (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
      values (${plansBranch}, ${quarterId}, ${startDate}::date, ${plus(20)}::date,
        (${startDate}::date)::timestamp at time zone 'Asia/Tashkent',
        ((${plus(20)}::date + 1)::timestamp at time zone 'Asia/Tashkent') - interval '1 millisecond',
        now(), (select id from accounts order by id limit 1))
    `.execute(migrator);
  }
  seeded.plansTeacher = { login: plansTeacher.login, password: plansTeacher.firstPassword };

  // Task 7.3: the same branch for master plans, its window open, with a Head
  // Teacher of "Planning M". The browser test has the Head Teacher write a
  // master and the teacher copy it into the plan. All names are invented.
  const mastersBranch = await insertBranch(migrator, 'Masters browser test branch');
  const mastersTeacher = await create('Kamola', 'Ergasheva');
  const mastersHead = await create('Shahnoza', 'Valiyeva');
  await transactions.run([mastersBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: mastersTeacher.id,
      role: 'teacher',
      branchId: mastersBranch,
      givenBy: null,
    }),
  );
  {
    const lessonsKit = await LessonsKit.create(migrator);
    const planning = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Planning M',
      journalType: 'graded',
    });
    const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const person = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: 'S-777803',
            account_id: mastersTeacher.id,
            first_name: 'Kamola',
            last_name: 'Ergasheva',
            sex: 'female',
            birth_date: '1987-03-04',
            phone: '+998935557803',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: person.id, branch_id: mastersBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: person.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: person.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: person.id, subject_id: planning, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: mastersBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: mastersBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const harvard = await transaction
          .insertInto('classes')
          .values({
            branch_id: mastersBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Harvard',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return {
          yearId: year.id,
          classId: harvard.id,
          staffId: person.id,
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      mastersBranch,
      yearId,
      [{ classId, groupId: null, subjectId: planning, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: mastersBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: planning,
        runs: `{[${startDate},)}`,
      })
      .execute();
    for (const date of [plus(1), plus(8)]) {
      await migrator.transaction().execute(async (transaction) => {
        const block = await transaction
          .insertInto('lesson_blocks')
          .values({
            branch_id: mastersBranch,
            academic_year_id: yearId,
            quarter_id: quarterId,
            lesson_date: date,
            starts_at: new Date(`${date}T08:00:00+05:00`),
            ends_at: new Date(`${date}T08:45:00+05:00`),
            version_id: source.versionId,
            pattern_block_id: source.patternBlockId,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('lessons')
          .values({
            branch_id: mastersBranch,
            block_id: block.id,
            lesson_date: block.lesson_date,
            starts_at: block.starts_at,
            ends_at: block.ends_at,
            class_id: classId,
            subject_id: planning,
            teacher_id: staffId,
            load_row_id: source.lessons[0]?.loadRowId ?? '',
            pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
          })
          .execute();
      });
    }
    // Task 7.2: the plan window of quarter 1, from the first day of the year.
    await sql`
      insert into lesson_plan_windows
        (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
      values (${mastersBranch}, ${quarterId}, ${startDate}::date, ${plus(20)}::date,
        (${startDate}::date)::timestamp at time zone 'Asia/Tashkent',
        ((${plus(20)}::date + 1)::timestamp at time zone 'Asia/Tashkent') - interval '1 millisecond',
        now(), (select id from accounts order by id limit 1))
    `.execute(migrator);
    await transactions.run([mastersBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: mastersHead.id,
        role: 'head_teacher',
        branchId: mastersBranch,
        subjectIds: [planning],
        givenBy: null,
      }),
    );
  }
  seeded.mastersTeacher = { login: mastersTeacher.login, password: mastersTeacher.firstPassword };
  seeded.mastersHead = { login: mastersHead.login, password: mastersHead.firstPassword };

  // Task 7.2: the same branch for the plan requests, whose window of quarter 1
  // ended yesterday, with a Head Teacher of "Planning". The browser test asks to
  // edit, the Head Teacher approves, the teacher fills a row. All names are invented.
  const requestsBranch = await insertBranch(migrator, 'Plan requests browser test branch');
  const requestsTeacher = await create('Feruza', 'Olimova');
  const requestsHead = await create('Zarina', 'Qodirova');
  await transactions.run([requestsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: requestsTeacher.id,
      role: 'teacher',
      branchId: requestsBranch,
      givenBy: null,
    }),
  );
  {
    const lessonsKit = await LessonsKit.create(migrator);
    const planning = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Planning B',
      journalType: 'graded',
    });
    const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const person = await transaction
          .insertInto('staff')
          .values({
            kind: 'person',
            staff_id: 'S-777802',
            account_id: requestsTeacher.id,
            first_name: 'Feruza',
            last_name: 'Olimova',
            sex: 'female',
            birth_date: '1987-03-04',
            phone: '+998935557802',
            admission_date: '2026-09-01',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('staff_branches')
          .values({ staff_id: person.id, branch_id: requestsBranch, is_main: true })
          .execute();
        await transaction
          .insertInto('staff_divisions')
          .values({
            staff_id: person.id,
            division_id: academic.id,
            department_id: steam.id,
            is_main: true,
          })
          .execute();
        await transaction
          .insertInto('staff_languages')
          .values({ staff_id: person.id, language: 'uz' })
          .execute();
        await transaction
          .insertInto('staff_statuses')
          .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
          .execute();
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: person.id, subject_id: planning, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: requestsBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: requestsBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const harvard = await transaction
          .insertInto('classes')
          .values({
            branch_id: requestsBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Harvard',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return {
          yearId: year.id,
          classId: harvard.id,
          staffId: person.id,
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      requestsBranch,
      yearId,
      [{ classId, groupId: null, subjectId: planning, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: requestsBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: planning,
        runs: `{[${startDate},)}`,
      })
      .execute();
    for (const date of [plus(1), plus(8)]) {
      await migrator.transaction().execute(async (transaction) => {
        const block = await transaction
          .insertInto('lesson_blocks')
          .values({
            branch_id: requestsBranch,
            academic_year_id: yearId,
            quarter_id: quarterId,
            lesson_date: date,
            starts_at: new Date(`${date}T08:00:00+05:00`),
            ends_at: new Date(`${date}T08:45:00+05:00`),
            version_id: source.versionId,
            pattern_block_id: source.patternBlockId,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('lessons')
          .values({
            branch_id: requestsBranch,
            block_id: block.id,
            lesson_date: block.lesson_date,
            starts_at: block.starts_at,
            ends_at: block.ends_at,
            class_id: classId,
            subject_id: planning,
            teacher_id: staffId,
            load_row_id: source.lessons[0]?.loadRowId ?? '',
            pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
          })
          .execute();
      });
    }
    // Task 7.2: the plan window of quarter 1, from the first day of the year.
    await sql`
      insert into lesson_plan_windows
        (branch_id, quarter_id, start_date, end_date, starts_at, ends_at, opened_at, opened_by)
      values (${requestsBranch}, ${quarterId}, ${startDate}::date, ${plus(-1)}::date,
        (${startDate}::date)::timestamp at time zone 'Asia/Tashkent',
        ((${plus(-1)}::date + 1)::timestamp at time zone 'Asia/Tashkent') - interval '1 millisecond',
        now(), (select id from accounts order by id limit 1))
    `.execute(migrator);
    await transactions.run([requestsBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: requestsHead.id,
        role: 'head_teacher',
        branchId: requestsBranch,
        subjectIds: [planning],
        givenBy: null,
      }),
    );
  }
  seeded.requestsTeacher = {
    login: requestsTeacher.login,
    password: requestsTeacher.firstPassword,
  };
  seeded.requestsHead = { login: requestsHead.login, password: requestsHead.firstPassword };

  // Task 8.4: a branch of its own for the edit period: a class of three students, a teacher
  // of its "Measures" (a graded subject) with one lesson five days ago at 08:00 and one edit day,
  // so the lesson is locked; the Head Teacher of the subject and the Academic Vice Principal.
  // The browser test asks to unlock it, the Head Teacher approves, the teacher enters, and the
  // Academic Vice Principal corrects. All names are invented.
  const locksBranch = await insertBranch(migrator, 'Locks browser test branch');
  await setEditDays(migrator, locksBranch, 1);
  const locksVice = await create('Shahlo', 'Ismoilova');
  await transactions.run([locksBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: locksVice.id,
      role: 'academic_vice_principal',
      branchId: locksBranch,
      givenBy: null,
    }),
  );
  const locksTeacher = await create('Nodir', 'Karimov');
  const locksHead = await create('Gavhar', 'Yuldasheva');
  await transactions.run([locksBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: locksTeacher.id,
      role: 'teacher',
      branchId: locksBranch,
      givenBy: null,
    }),
  );
  {
    const lessonDay = isoDate(new Date(tashkentToday.getTime() - 5 * dayMs));
    const lessonsKit = await LessonsKit.create(migrator);
    const algebra = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Measures',
      journalType: 'graded',
    });
    await transactions.run([locksBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: locksHead.id,
        role: 'head_teacher',
        branchId: locksBranch,
        givenBy: null,
        subjectIds: [algebra],
      }),
    );
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const people: string[] = [];
        for (const [accountId, staffNumber, first, last, phone] of [
          [locksTeacher.id, 'S-777711', 'Nodir', 'Karimov', '+998935557411'],
          [locksHead.id, 'S-777712', 'Gavhar', 'Yuldasheva', '+998935557412'],
        ] as const) {
          const person = await transaction
            .insertInto('staff')
            .values({
              kind: 'person',
              staff_id: staffNumber,
              account_id: accountId,
              first_name: first,
              last_name: last,
              sex: 'female',
              birth_date: '1988-05-06',
              phone,
              admission_date: '2026-09-01',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('staff_branches')
            .values({ staff_id: person.id, branch_id: locksBranch, is_main: true })
            .execute();
          await transaction
            .insertInto('staff_divisions')
            .values({
              staff_id: person.id,
              division_id: academic.id,
              department_id: steam.id,
              is_main: true,
            })
            .execute();
          await transaction
            .insertInto('staff_languages')
            .values({ staff_id: person.id, language: 'uz' })
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
            .execute();
          people.push(person.id);
        }
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: people[0] ?? '', subject_id: algebra, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: locksBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: locksBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const weights = { attendance: 20, classwork: 40, homework: 40 };
        await transaction
          .insertInto('subject_daily_weights')
          .values({ branch_id: locksBranch, subject_id: algebra, ...weights })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: locksBranch,
              subject_id: algebra,
              quarter_id: quarter.id,
              ...weights,
            })),
          )
          .execute();
        const cambridge = await transaction
          .insertInto('classes')
          .values({
            branch_id: locksBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Kent',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [uid, first, last, phone] of [
          ['9999861', 'Sevara', 'Alimova', '+998935553361'],
          ['9999862', 'Bekzod', 'Rahimov', '+998935553362'],
          ['9999863', 'Lola', 'Sobirova', '+998935553363'],
        ] as const) {
          await studentInClass(transaction, {
            branch: locksBranch,
            classId: cambridge.id,
            uid,
            first,
            last,
            createdBy: locksTeacher.id,
            phone,
          });
        }
        return {
          yearId: year.id,
          classId: cambridge.id,
          staffId: people[0] ?? '',
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      locksBranch,
      yearId,
      [{ classId, groupId: null, subjectId: algebra, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: locksBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: algebra,
        runs: `{[${startDate},)}`,
      })
      .execute();
    await migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: locksBranch,
          academic_year_id: yearId,
          quarter_id: quarterId,
          lesson_date: lessonDay,
          starts_at: new Date(`${lessonDay}T08:00:00+05:00`),
          ends_at: new Date(`${lessonDay}T08:45:00+05:00`),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('lessons')
        .values({
          branch_id: locksBranch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: algebra,
          teacher_id: staffId,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .execute();
    });
  }
  seeded.locksTeacher = { login: locksTeacher.login, password: locksTeacher.firstPassword };
  seeded.locksHead = { login: locksHead.login, password: locksHead.firstPassword };
  seeded.locksVice = { login: locksVice.login, password: locksVice.firstPassword };

  // Task 8.5: a branch of its own for exemptions, the shape of the 8.4 branch: a class of three
  // students, a teacher of its "Measures" with one lesson five days ago, locked by one edit day,
  // Alimova marked present in it, and the Academic Vice Principal, who enters a late exemption
  // through the lock and chooses "Exempt and clear"; the teacher then sees 4 in the cell. All
  // names are invented.
  const exemptionsBranch = await insertBranch(migrator, 'Exemptions browser test branch');
  await setEditDays(migrator, exemptionsBranch, 1);
  const exemptionsVice = await create('Barno', 'Xolmatova');
  await transactions.run([exemptionsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: exemptionsVice.id,
      role: 'academic_vice_principal',
      branchId: exemptionsBranch,
      givenBy: null,
    }),
  );
  const exemptionsTeacher = await create('Ulugbek', 'Tojiyev');
  const exemptionsHead = await create('Kamola', 'Ergasheva');
  await transactions.run([exemptionsBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: exemptionsTeacher.id,
      role: 'teacher',
      branchId: exemptionsBranch,
      givenBy: null,
    }),
  );
  {
    const lessonDay = isoDate(new Date(tashkentToday.getTime() - 5 * dayMs));
    const lessonsKit = await LessonsKit.create(migrator);
    const algebra = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Measures E',
      journalType: 'graded',
    });
    await transactions.run([exemptionsBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: exemptionsHead.id,
        role: 'head_teacher',
        branchId: exemptionsBranch,
        givenBy: null,
        subjectIds: [algebra],
      }),
    );
    const { yearId, classId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const people: string[] = [];
        for (const [accountId, staffNumber, first, last, phone] of [
          [exemptionsTeacher.id, 'S-777721', 'Ulugbek', 'Tojiyev', '+998935557421'],
          [exemptionsHead.id, 'S-777722', 'Kamola', 'Ergasheva', '+998935557422'],
        ] as const) {
          const person = await transaction
            .insertInto('staff')
            .values({
              kind: 'person',
              staff_id: staffNumber,
              account_id: accountId,
              first_name: first,
              last_name: last,
              sex: 'female',
              birth_date: '1988-05-06',
              phone,
              admission_date: '2026-09-01',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('staff_branches')
            .values({ staff_id: person.id, branch_id: exemptionsBranch, is_main: true })
            .execute();
          await transaction
            .insertInto('staff_divisions')
            .values({
              staff_id: person.id,
              division_id: academic.id,
              department_id: steam.id,
              is_main: true,
            })
            .execute();
          await transaction
            .insertInto('staff_languages')
            .values({ staff_id: person.id, language: 'uz' })
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
            .execute();
          people.push(person.id);
        }
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: people[0] ?? '', subject_id: algebra, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: exemptionsBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: exemptionsBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const weights = { attendance: 20, classwork: 40, homework: 40 };
        await transaction
          .insertInto('subject_daily_weights')
          .values({ branch_id: exemptionsBranch, subject_id: algebra, ...weights })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: exemptionsBranch,
              subject_id: algebra,
              quarter_id: quarter.id,
              ...weights,
            })),
          )
          .execute();
        const cambridge = await transaction
          .insertInto('classes')
          .values({
            branch_id: exemptionsBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Kent',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [uid, first, last, phone] of [
          ['9999871', 'Sevara', 'Alimova', '+998935553371'],
          ['9999872', 'Bekzod', 'Rahimov', '+998935553372'],
          ['9999873', 'Lola', 'Sobirova', '+998935553373'],
        ] as const) {
          await studentInClass(transaction, {
            branch: exemptionsBranch,
            classId: cambridge.id,
            uid,
            first,
            last,
            createdBy: exemptionsTeacher.id,
            phone,
          });
        }
        return {
          yearId: year.id,
          classId: cambridge.id,
          staffId: people[0] ?? '',
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      exemptionsBranch,
      yearId,
      [{ classId, groupId: null, subjectId: algebra, rowTeacherId: staffId }],
      startDate,
    );
    await migrator
      .insertInto('journals')
      .values({
        branch_id: exemptionsBranch,
        academic_year_id: yearId,
        class_id: classId,
        group_id: null,
        subject_id: algebra,
        runs: `{[${startDate},)}`,
      })
      .execute();
    await migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: exemptionsBranch,
          academic_year_id: yearId,
          quarter_id: quarterId,
          lesson_date: lessonDay,
          starts_at: new Date(`${lessonDay}T08:00:00+05:00`),
          ends_at: new Date(`${lessonDay}T08:45:00+05:00`),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('lessons')
        .values({
          branch_id: exemptionsBranch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: algebra,
          teacher_id: staffId,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then(async (lesson) => {
          const alimova = await transaction
            .selectFrom('students')
            .select('id')
            .where('uid', '=', '9999871')
            .executeTakeFirstOrThrow();
          await sql`select set_config('app.now', ${`${lessonDay}T09:00:00+05:00`}, true)`.execute(
            transaction,
          );
          await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: exemptionsBranch,
              lesson_id: lesson.id,
              student_id: alimova.id,
              mark: 1,
              version: 1,
              changed_by: exemptionsTeacher.id,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute();
        });
    });
  }
  seeded.exemptionsTeacher = {
    login: exemptionsTeacher.login,
    password: exemptionsTeacher.firstPassword,
  };
  seeded.exemptionsVice = { login: exemptionsVice.login, password: exemptionsVice.firstPassword };

  // Task 8.6: a branch of its own for a late class move: two classes of grade 7, 7 Kent and
  // 7 Leeds, with a journal of "Measures T" each, a teacher, the Academic Vice Principal and
  // Qodirova in 7 Kent, marked present in a Kent lesson five days ago; a Leeds lesson four days
  // ago. The Academic Vice Principal moves her to 7 Leeds from six days ago, sees the Kent entry
  // and voids it with a reason; 7 Leeds then shows her figures carried in and the optional cell.
  // All names are invented.
  const transfersBranch = await insertBranch(migrator, 'Transfers browser test branch');
  await setEditDays(migrator, transfersBranch, 1);
  const transfersVice = await create('Nargiza', 'Qosimova');
  await transactions.run([transfersBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: transfersVice.id,
      role: 'academic_vice_principal',
      branchId: transfersBranch,
      givenBy: null,
    }),
  );
  const transfersTeacher = await create('Sardor', 'Mirzayev');
  const transfersHead = await create('Feruza', 'Nabiyeva');
  await transactions.run([transfersBranch], (transaction) =>
    assignments.give(transaction, {
      accountId: transfersTeacher.id,
      role: 'teacher',
      branchId: transfersBranch,
      givenBy: null,
    }),
  );
  {
    const lessonDay = isoDate(new Date(tashkentToday.getTime() - 5 * dayMs));
    const lessonsKit = await LessonsKit.create(migrator);
    const algebra = await lessonsKit.load.classes.subject({
      grades: [7],
      name: 'Measures T',
      journalType: 'graded',
    });
    await transactions.run([transfersBranch], (transaction) =>
      assignments.give(transaction, {
        accountId: transfersHead.id,
        role: 'head_teacher',
        branchId: transfersBranch,
        givenBy: null,
        subjectIds: [algebra],
      }),
    );
    const { yearId, classId, leedsId, staffId, quarterId } = await migrator
      .transaction()
      .execute(async (transaction) => {
        const academic = await transaction
          .selectFrom('divisions')
          .select('id')
          .where('name_en', '=', 'Academic')
          .executeTakeFirstOrThrow();
        const steam = await transaction
          .selectFrom('departments')
          .select('id')
          .where('name_en', '=', 'STEAM')
          .executeTakeFirstOrThrow();
        const people: string[] = [];
        for (const [accountId, staffNumber, first, last, phone] of [
          [transfersTeacher.id, 'S-777731', 'Sardor', 'Mirzayev', '+998935557431'],
          [transfersHead.id, 'S-777732', 'Feruza', 'Nabiyeva', '+998935557432'],
        ] as const) {
          const person = await transaction
            .insertInto('staff')
            .values({
              kind: 'person',
              staff_id: staffNumber,
              account_id: accountId,
              first_name: first,
              last_name: last,
              sex: 'female',
              birth_date: '1988-05-06',
              phone,
              admission_date: '2026-09-01',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await transaction
            .insertInto('staff_branches')
            .values({ staff_id: person.id, branch_id: transfersBranch, is_main: true })
            .execute();
          await transaction
            .insertInto('staff_divisions')
            .values({
              staff_id: person.id,
              division_id: academic.id,
              department_id: steam.id,
              is_main: true,
            })
            .execute();
          await transaction
            .insertInto('staff_languages')
            .values({ staff_id: person.id, language: 'uz' })
            .execute();
          await transaction
            .insertInto('staff_statuses')
            .values({ staff_id: person.id, status: 'active', valid_from: '2026-09-01' })
            .execute();
          people.push(person.id);
        }
        await transaction
          .insertInto('staff_subjects')
          .values({ staff_id: people[0] ?? '', subject_id: algebra, grades: [7] })
          .execute();
        const year = await transaction
          .insertInto('academic_years')
          .values({
            branch_id: transfersBranch,
            start_date: startDate,
            end_date: isoDate(new Date(yearStart.getTime() + 364 * dayMs)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const plus = (days: number) => isoDate(new Date(tashkentToday.getTime() + days * dayMs));
        const quarters = await transaction
          .insertInto('quarters')
          .values(
            [
              [startDate, plus(20)],
              [plus(30), plus(90)],
              [plus(100), plus(170)],
              [plus(180), isoDate(new Date(yearStart.getTime() + 364 * dayMs))],
            ].map(([start, end], index) => ({
              branch_id: transfersBranch,
              academic_year_id: year.id,
              number: index + 1,
              start_date: start,
              end_date: end,
            })),
          )
          .returning('id')
          .execute();
        const weights = { attendance: 20, classwork: 40, homework: 40 };
        await transaction
          .insertInto('subject_daily_weights')
          .values({ branch_id: transfersBranch, subject_id: algebra, ...weights })
          .execute();
        await transaction
          .insertInto('subject_quarter_weights')
          .values(
            quarters.map((quarter) => ({
              branch_id: transfersBranch,
              subject_id: algebra,
              quarter_id: quarter.id,
              ...weights,
            })),
          )
          .execute();
        const cambridge = await transaction
          .insertInto('classes')
          .values({
            branch_id: transfersBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Kent',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const leeds = await transaction
          .insertInto('classes')
          .values({
            branch_id: transfersBranch,
            academic_year_id: year.id,
            grade: 7,
            name: 'Leeds',
            language: 'uz',
            max_size: 24,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const [uid, first, last, phone] of [
          ['9999881', 'Dilfuza', 'Qodirova', '+998935553381'],
        ] as const) {
          await studentInClass(transaction, {
            branch: transfersBranch,
            classId: cambridge.id,
            uid,
            first,
            last,
            createdBy: transfersTeacher.id,
            phone,
          });
        }
        return {
          yearId: year.id,
          classId: cambridge.id,
          leedsId: leeds.id,
          staffId: people[0] ?? '',
          quarterId: quarters[0]?.id ?? '',
        };
      });
    const source = await lessonsKit.source(
      transfersBranch,
      yearId,
      [{ classId, groupId: null, subjectId: algebra, rowTeacherId: staffId }],
      startDate,
    );
    // 7 Leeds of a source of its own: one pattern entry per teacher and time (`pattern_entries_teacher_excl`).
    const leedsSource = await lessonsKit.source(
      transfersBranch,
      yearId,
      [{ classId: leedsId, groupId: null, subjectId: algebra, rowTeacherId: staffId }],
      startDate,
    );
    for (const unit of [classId, leedsId]) {
      await migrator
        .insertInto('journals')
        .values({
          branch_id: transfersBranch,
          academic_year_id: yearId,
          class_id: unit,
          group_id: null,
          subject_id: algebra,
          runs: `{[${startDate},)}`,
        })
        .execute();
    }
    await migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: transfersBranch,
          academic_year_id: yearId,
          quarter_id: quarterId,
          lesson_date: lessonDay,
          starts_at: new Date(`${lessonDay}T08:00:00+05:00`),
          ends_at: new Date(`${lessonDay}T08:45:00+05:00`),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('lessons')
        .values({
          branch_id: transfersBranch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: algebra,
          teacher_id: staffId,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then(async (lesson) => {
          const qodirova = await transaction
            .selectFrom('students')
            .select('id')
            .where('uid', '=', '9999881')
            .executeTakeFirstOrThrow();
          await sql`select set_config('app.now', ${`${lessonDay}T09:00:00+05:00`}, true)`.execute(
            transaction,
          );
          await transaction
            .insertInto('journal_cells')
            .values({
              branch_id: transfersBranch,
              lesson_id: lesson.id,
              student_id: qodirova.id,
              mark: 1,
              version: 1,
              changed_by: transfersTeacher.id,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute();
        });
    });
    // A Kent lesson eight days ago, before the move's date, with Qodirova present: her
    // result is carried into 7 Leeds (07, Transfers).
    const earlierDay = isoDate(new Date(tashkentToday.getTime() - 8 * dayMs));
    await migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: transfersBranch,
          academic_year_id: yearId,
          quarter_id: quarterId,
          lesson_date: earlierDay,
          starts_at: new Date(`${earlierDay}T08:00:00+05:00`),
          ends_at: new Date(`${earlierDay}T08:45:00+05:00`),
          version_id: source.versionId,
          pattern_block_id: source.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      const lesson = await transaction
        .insertInto('lessons')
        .values({
          branch_id: transfersBranch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: classId,
          subject_id: algebra,
          teacher_id: staffId,
          load_row_id: source.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const qodirova = await transaction
        .selectFrom('students')
        .select('id')
        .where('uid', '=', '9999881')
        .executeTakeFirstOrThrow();
      await sql`select set_config('app.now', ${`${earlierDay}T09:00:00+05:00`}, true)`.execute(
        transaction,
      );
      await transaction
        .insertInto('journal_cells')
        .values({
          branch_id: transfersBranch,
          lesson_id: lesson.id,
          student_id: qodirova.id,
          mark: 1,
          version: 1,
          changed_by: transfersTeacher.id,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .execute();
    });
    const leedsDay = isoDate(new Date(tashkentToday.getTime() - 4 * dayMs));
    await migrator.transaction().execute(async (transaction) => {
      const block = await transaction
        .insertInto('lesson_blocks')
        .values({
          branch_id: transfersBranch,
          academic_year_id: yearId,
          quarter_id: quarterId,
          lesson_date: leedsDay,
          starts_at: new Date(`${leedsDay}T08:00:00+05:00`),
          ends_at: new Date(`${leedsDay}T08:45:00+05:00`),
          version_id: leedsSource.versionId,
          pattern_block_id: leedsSource.patternBlockId,
        })
        .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('lessons')
        .values({
          branch_id: transfersBranch,
          block_id: block.id,
          lesson_date: block.lesson_date,
          starts_at: block.starts_at,
          ends_at: block.ends_at,
          class_id: leedsId,
          subject_id: algebra,
          teacher_id: staffId,
          load_row_id: leedsSource.lessons[0]?.loadRowId ?? '',
          pattern_entry_id: leedsSource.lessons[0]?.patternEntryId ?? '',
        })
        .execute();
    });
  }
  seeded.transfersTeacher = {
    login: transfersTeacher.login,
    password: transfersTeacher.firstPassword,
  };
  seeded.transfersVice = { login: transfersVice.login, password: transfersVice.firstPassword };

  for (const branch of classBranches) {
    const years = await migrator
      .selectFrom('academic_years')
      .select('id')
      .where('branch_id', '=', branch)
      .execute();
    for (const year of years) {
      for (const grade of [7, 8]) {
        await migrator
          .insertInto('classes')
          .values({
            branch_id: branch,
            academic_year_id: year.id,
            grade,
            name: 'Seeded',
            language: 'uz',
            max_size: 30,
          })
          .execute();
      }
    }
  }

  console.log(JSON.stringify(seeded));
} finally {
  await app.close();
  await migrator.destroy();
}
