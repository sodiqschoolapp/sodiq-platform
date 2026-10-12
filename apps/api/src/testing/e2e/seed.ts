import { NestFactory } from '@nestjs/core';
import { createDatabase } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { Assignments } from '../../modules/access/assignments.service.js';
import { Accounts } from '../../modules/auth/accounts.service.js';
import { FirstAccountModule } from '../../modules/auth/first-account.command.js';
import { insertBranch } from '../branch-filter-sql.js';
import { e2eDatabaseUrls } from './database.js';

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

  const create = async (firstName: string, lastName: string) =>
    transactions.run([], (transaction) =>
      accounts.create(transaction, { firstName, lastName, createdBy: null }),
    );

  const seeded: Record<string, Credentials> = {};
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

  console.log(JSON.stringify(seeded));
} finally {
  await app.close();
  await migrator.destroy();
}
