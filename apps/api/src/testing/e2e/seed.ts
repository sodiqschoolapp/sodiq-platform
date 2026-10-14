import { NestFactory } from '@nestjs/core';
import { createDatabase } from '../../database/database.js';
import { Transactions } from '../../database/transactions.js';
import { Assignments } from '../../modules/access/assignments.service.js';
import { Audit } from '../../modules/audit/audit.service.js';
import { Accounts } from '../../modules/auth/accounts.service.js';
import { FirstAccountModule } from '../../modules/auth/first-account.command.js';
import { studentNameKey } from '@sodiq/shared';
import { insertBranch } from '../branch-filter-sql.js';
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
    const person = await transaction
      .insertInto('staff')
      .values({
        kind: 'person',
        staff_id: 'S-269401',
        first_name: 'Farrux',
        last_name: 'Yusupov',
        sex: 'male',
        birth_date: '1983-02-10',
        phone: '+998935550141',
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
