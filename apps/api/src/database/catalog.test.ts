import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addBranchFilter, insertBranch } from '../testing/branch-filter-sql.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import type { Database } from './database.js';

/**
 * Tables that do not belong to a branch, each with its reason. Every other
 * table in schema public must have `branch_id` and the branch filter. Adding a
 * name here is a decision: it means every branch may read the table.
 */
const SCHOOL_WIDE_TABLES: Record<string, string> = {
  schema_migrations: 'The list of applied migrations; the application can only read it.',
  branches: 'The branches themselves; the branch switcher shows their names.',
  travel_times:
    'A travel time belongs to a pair of branches equally (task 1.6, decision 4); the Super Admin alone writes it, and the service answers a reader the pairs of its own branch only. A row holds two branch ids and minutes.',
  request_keys: 'A key is unique across the school; a row holds ids and status only.',
  audit_log_school:
    'Audit entries of events without a branch (sign-ins, relatives); who reads them is decided by the route (task 2.6a, decision 3 of pull request #75).',
  ...auditSchoolPartitions(),
  accounts:
    'One person has one account for every branch, and sign-in happens before a branch is known; a row holds no name.',
  sessions:
    'A session belongs to an account, not to a branch; a row holds ids, moments and the name of a browser.',
  known_devices:
    'A browser that signed in to an account before; an account has no branch. A row holds a token hash, an id and a moment.',
  account_second_steps:
    'The second step of sign-in belongs to an account, which has no branch; a row holds an encrypted secret, a count and moments.',
  second_step_recovery_codes:
    'Recovery codes of the second step of an account; a row holds an id, a hash and a moment.',
  assignments:
    'The Super Admin and the Senior Head Teacher have no branch, and the roles of an account are read on every request before a branch is known; a row holds ids, a role and moments.',
  assignment_subjects:
    'The subjects of a Head Teacher or Senior Head Teacher assignment, read with the assignments on every request before a branch is known; a row holds ids, a role and the moments of its assignment (task 2.3b-1, decision 2 of pull request #63).',
  sign_in_throttle:
    'Failed sign-ins are counted before any branch is known, also for logins that do not exist; a row holds hashes, a count and moments.',
  feedback_reports:
    'A report about the app belongs to an account, which has no branch; a row holds ids, the roles of the session, the path of a page, a text and a moment. The owner reads it until a screen exists (task 0.8b-3).',
  notifications:
    'A notification belongs to an account, which has no branch, and names the branch of its event as a label; a row holds ids, a kind, the data of its text and moments. Every route reads the rows of the account of the session only (task 0.9, decided by the owner).',
  divisions:
    'docs/spec/03, Divisions: "One list for the whole school ... Divisions are the same in every branch." A row holds names, a position and moments (task 1.2, decided by the owner).',
  departments:
    'The departments of the divisions, one list for the whole school as their divisions (docs/spec/03, Division: "Departments"); a row holds ids, names, a position and moments (task 1.2, decided by the owner).',
  staff_id_counters:
    'One counter of staff IDs per year of first hire for the whole school (docs/spec/edge-cases/developer-rules.md, Identifiers: "one school-wide counter per year"); a row holds a year and a number, nothing personal (task 2.2a, confirmed at the review of pull request #53).',
  subjects:
    'One subject list for the whole school (owner, answer 3 of "Decided ahead for tasks 2.1 to 2.6"); its weights are per branch in subject_daily_weights and subject_quarter_weights. A row holds names, a department id, grades, a colour, switches and moments (task 2.1).',
  password_reset_links:
    'A link of the password reset by email belongs to an account, which has no branch, and is asked for before any branch is known; a row holds ids, a token hash and moments (task 2.3c-2, pull request #66).',
};

/**
 * School-wide tables that name a branch all the same, each with its reason.
 * Such a table is not filtered: every transaction reads all its rows. Its
 * `branch_id` must reference `branches (id)` and it must have no policy at
 * all. Every other school-wide table with a `branch_id` fails. Adding a name
 * here is a decision for the owner, like the list above.
 */
const SCHOOL_WIDE_WITH_BRANCH: Record<string, string> = {
  assignments:
    'An assignment names the branch of a role; the rows of the Super Admin and the Senior Head Teacher have none, and the roles of an account are read before a branch is known. Who may act in which branch is decided by the permission guard (task 0.7b).',
  assignment_subjects:
    'The subject rows of an assignment carry its branch so that the database holds one Head Teacher per subject per branch; the Senior Head Teacher rows have none. Read with the assignments before a branch is known; a read for anyone but the Super Admin keeps to the branch of the request in code (task 2.3b-1, decision 2 of pull request #63).',
  notifications:
    'A notification belongs to an account and names the branch of its event as a label; a person reads their notifications from every branch at once, before any branch is chosen, and an event of the whole school has none. Every route reads the rows of the account of the session only (task 0.9, decided by the owner).',
};

/**
 * The membership filters, each a policy that reads a link table which is
 * itself a branch table, as PostgreSQL writes it back: `staff_membership`
 * through `staff_branches` (owner's answer 2 on pull request #53), and
 * `relative_membership` through the live links of `student_relatives` (task
 * 2.5a, decision 2 of pull request #72, Look first). Adding one is a decision
 * for the owner.
 */
const MEMBERSHIPS = {
  staff_membership: (table: string, column: string) =>
    `(EXISTS ( SELECT 1 FROM staff_branches b WHERE (b.staff_id = ${table}.${column})))`,
  relative_membership: (table: string, column: string) =>
    `(EXISTS ( SELECT 1 FROM student_relatives l WHERE ((l.relative_id = ${table}.${column}) AND (l.unlinked_at IS NULL))))`,
} as const;

type Membership = keyof typeof MEMBERSHIPS;

/**
 * Tables filtered by membership: a row is visible and writable only when the
 * person is linked, through the link table of its policy, to a branch of the
 * transaction. Each has no `branch_id`, row security on and exactly the
 * policy named, written as `MEMBERSHIPS` has it, naming the column that holds
 * the id of the person. `openInsert`: the insert check is `true` (the record
 * is inserted before its first link; `staff_main_branch_check` and
 * `relatives_complete_check` refuse a commit without one). Adding a name here
 * is a decision for the owner, like the lists above.
 */
const MEMBERSHIP_FILTERED_TABLES: Record<
  string,
  { reason: string; policy: Membership; column: string; openInsert?: true }
> = {
  staff: {
    reason:
      'The staff record: one per person for every branch they work in (docs/spec/04, Teacher and staff record), with the personal data of the person.',
    policy: 'staff_membership',
    column: 'id',
    openInsert: true,
  },
  staff_divisions: {
    reason: 'The divisions and departments of a staff record.',
    policy: 'staff_membership',
    column: 'staff_id',
  },
  staff_subjects: {
    reason: 'The subjects of a staff record with the grades taught.',
    policy: 'staff_membership',
    column: 'staff_id',
  },
  staff_languages: {
    reason: 'The languages of instruction of a staff record.',
    policy: 'staff_membership',
    column: 'staff_id',
  },
  staff_statuses: {
    reason: 'The dated status history of a staff record.',
    policy: 'staff_membership',
    column: 'staff_id',
  },
  staff_status_role_ends: {
    reason:
      'The ends a "left" status wrote on the assignments of the account of a staff record, kept to put them back.',
    policy: 'staff_membership',
    column: 'staff_id',
  },
  relatives: {
    reason:
      'A close relative: one school-wide record per person, unique by main phone, opened in a branch only while a student of that branch is linked (edge/close-relatives).',
    policy: 'relative_membership',
    column: 'id',
    openInsert: true,
  },
  relative_accounts: {
    reason: 'The switched-off Parent account of a relative, written before its first link.',
    policy: 'relative_membership',
    column: 'relative_id',
    openInsert: true,
  },
};

/**
 * The partitions of `audit_log_school` (db/migrations/0003): one per month from
 * October 2026 to December 2029 and the default one. The application user has
 * no right on any of them. A migration that adds months extends this range.
 */
function auditSchoolPartitions(): Record<string, string> {
  const reason = 'A partition of audit_log_school; the application user has no right on it.';
  const partitions: Record<string, string> = { audit_log_school_default: reason };
  for (let year = 2026; year <= 2029; year += 1) {
    for (let month = year === 2026 ? 10 : 1; month <= 12; month += 1) {
      partitions[`audit_log_school_${String(year)}_${String(month).padStart(2, '0')}`] = reason;
    }
  }
  return partitions;
}

/**
 * Functions that run with the rights of their owner, who is not filtered, each
 * with its reason. Each answers a fact that rows of other branches decide and
 * returns a boolean or a count, never row data, reading the branches of the
 * transaction itself (task 2.2a, owner's answer 2 and the review of pull
 * request #53, correction 2 and decision 17). Three of task 2.2b go beyond
 * that pattern, each for its reason below (pull request #57, decision 8).
 * Two of task 2.3a answer a first and last name (pull request #62, decision 9,
 * Look first).
 */
const SECURITY_DEFINER_FUNCTIONS: Record<string, string> = {
  'audit_names(uuid[])':
    "The first and last name of each person named by an account or staff id, in any branch, for the actor and the person of one page of the audit log (task 2.6a, decision 12 of pull request #75, Look first), and for the Head Teachers and Senior Head Teachers the appointments list of a branch answers, named in every branch (task 3.6a, the owner's answer L32, decision 1 of pull request #118, Look first); the Basic group only.",
  'assignments_class_tutors_end()':
    'Writes the end of a Tutor assignment on its class rows, which the application cannot write for a branch it does not filter to: a role end is written school-wide (task 3.1a, decision 2 of pull request #88, Look first).',
  'class_tutor_ends(uuid)':
    "The Tutor rows of one assignment in every branch, ids and end moments only, for the audit entry of a role end or a `left` that the mirror carries to the rows of another branch than the request's (task 3.1a, correction 1 of the code review of pull request #88, Look first).",
  'assignments_subjects_end()':
    'Writes the end of an assignment on its subject rows, which the application cannot update, so the exclusion constraints of one Head Teacher per subject see every end (task 2.3b-1, decision 2 of pull request #63).',
  'branch_moves_incoming(uuid)':
    "The open releases of students to one branch of the request, with the UID, name and grade of each student and nothing else of the record, for that branch's incoming list (task 3.3c, decision 2 of pull request #97, Look first): the student is still of the sending branch.",
  'branch_move_sending(uuid,uuid)':
    'The student and the sending branch of an open release to the branch of the request, ids and the date only, no lock, for Transactions.joinSendingBranch and the groups offered to the accept (task 3.3c, decision 1 of pull request #97, Look first): the release is a row of the sending branch.',
  'student_rows_elsewhere(uuid,uuid)':
    "The class rows, group rows and moves of a student of the request's branch in every other branch, ids, class and group names, dates, causes and links only, for the History tab after a move to another branch (task 3.3c, decision 3 of pull request #97, Look first).",
  'student_merged_uid_holder(text,uuid)':
    'The record a merged UID leads to, for the branch of the request named by the caller: the kept record id when it is of that branch, a row with no id otherwise, for the UID checks of the create and the correction (task 3.3d, decision 6 of pull request #98, Look first): the kept record may be of another branch.',
  'branches_without_vice_principal(timestamp with time zone)':
    "The branches (id and name only) where no Academic Vice Principal is active now, for the Super Admin's alert (Who can act); the route is school-wide, where the membership filter hides every staff row.",
  'last_email_change(uuid)':
    'Who changed the email of the person record of an account last, and when (actor id and moment only), for the entry of the public password reset by email, which sees no branch log (task 2.3c-2, correction 1 of #66).',
  'own_sign_in_history(uuid,timestamp with time zone,uuid,integer)':
    "The sign-in events of the own account from both logs, moment, event, actor and browser only, for the own sign-in history (task 2.6a, decision 10 of pull request #75); an administrator's lock or reset sits in the log of their branch, which a route without a branch cannot read.",
  'own_staff_record(uuid)':
    'The id of the person record of an account and the branch of its main link, ids only, for the own photo (task 2.3c-2); the person may see none of their branch links through the session.',
  'own_person_name(uuid)':
    "The first and last name of the staff record linked to an account, for the menu of the person's own session (pull request #61, decision 6); sign-in runs before a branch is known.",
  'password_reset_address(uuid,timestamp with time zone)':
    'The email of the person record of an account while a reset link may be sent, for the mail job only, which runs with no branch (task 2.3c-2, correction 2 of #66).',
  'password_reset_allowed(uuid,timestamp with time zone)':
    'Whether a reset link may be made for an account (not locked, not inactive or left, an email on record, written last by a Super Admin or by an Academic Vice Principal of a branch of its roles, read from audit_log through last_email_change), a yes or no for the public request before any branch is known (task 2.3c-2).',
  'personal_data_relatives(uuid)':
    "Every relative ever linked to one student, live link or not, the record's fields and its Parent account's state, for the student's personal data report, called only after the route found the student in the branch of the request (task 2.6b, decision 2 of pull request #76, Look first); relative_membership hides a relative with no live link from every transaction.",
  'relative_by_phone(text)':
    'The holder of an exact main phone in any branch, archived included: id, full name and the number of students linked live, for the phone typed first and the refused phone change (04, Close relatives: "the system shows the person"; task 2.5a, decision 3 of pull request #72, Look first).',
  'relative_links_elsewhere(uuid)':
    'The number of students of other branches linked live to a relative that the transaction sees, or null (edge/close-relatives: "students of other branches appear as a count"; task 2.5a, decision 3); a count.',
  'relative_accounts_merged_off()':
    'The trigger that keeps the Parent account of a merged relative switched off for good (task 2.5b-1, correction 2 of pull request #73); a merged record is archived and visible to no branch.',
  'relatives_merged_archived()':
    'The deferred check that a merged relative has no live link left in any branch at the commit (task 2.5b-1, decision 6); the links of other branches decide it, whatever the writing transaction sees.',
  'relative_notice_accounts(uuid,uuid)':
    'The accounts of a current Academic Vice Principal of each other branch where a relative the transaction sees is linked live, ids only, for the notice of a change of name or phone (edge/close-relatives: "the other branch\'s Academic Vice Principal is told"; task 2.5b-1, decision 5 of pull request #73, Look first).',
  'relative_release_phone(uuid,text,text,uuid)':
    'Gives the holder of an exact main phone, visible to the branch or not, a new phone or "no valid phone", and nothing else of the record, answering the notice targets as ids (edge/close-relatives: "the number has a new owner"; task 2.5b-1, decision 2 of pull request #73, Look first).',
  'relatives_follow_links()':
    'The trigger that archives a relative with no live link in any branch and restores it on a new one (04: "A relative with no linked students is archived"; task 2.5a, decisions 3, 10 and 14); the links of other branches decide it, and an archived relative is visible to no branch.',
  'subject_groups_elsewhere(uuid,smallint[],boolean)':
    'The number of active groups of a subject outside the branches of the transaction that a change of its grades or its archive would leave without the subject, a count only (task 3.2a, decisions 12 and 16 of pull request #91, Look first): the refusal names "a group of another branch" and a count.',
  'subject_group_grades(uuid)':
    'The grades of the active groups of a subject in every branch with the number of those groups outside the branches of the transaction, grades and counts only (task 3.2a, decision 12 of pull request #91, Look first): a subject cannot lose a grade, nor be archived, while a group of another branch needs it.',
  'tutor_classes_of_language(uuid,text)':
    'The classes of a language a person tutors now or later while not teaching in it: ids of the branches of the transaction only, a count of the others (task 3.1a, decision 19 and correction 4 of pull request #88, Look first); "blocked, not a warning" (05) from the staff side across branches.',
  'tutor_teaches_language(uuid,text)':
    'Whether the person of a Tutor assignment teaches in a language, whichever branch link of the record the request sees (task 3.1a, decision 19 of pull request #88, Look first); a yes or no, after a share lock on the record.',
  'reset_by_person_name(uuid)':
    'The first and last name of the administrator who reset an account\'s password, shown to that account\'s person while the reset password is in use ("your password was reset by X").',
  'student_duplicate_elsewhere(text,date)':
    'Whether a student of another branch has the same folded name and birth date (the duplicate warning across all branches, edge/students-classes-groups; task 2.4a, decision 16 of pull request #67); a yes or no.',
  'super_admin_active_count(timestamp with time zone)':
    "The number of active Super Admins (the last Super Admin rule and its banner); a Super Admin's record may be in any branch.",
  'student_relatives_not_merged()':
    'The trigger that refuses a link to a merged relative after locking its row, which the linking branch may not see (task 2.5b-1, decision 9 of pull request #73, Look first).',
  'staff_account_blocked(uuid,timestamp with time zone)':
    'Whether the staff record of an account is inactive or left today: sign-in and every request run before a branch is known.',
  'staff_availability_elsewhere(uuid)':
    'The working hours of the other branches of one record linked to a branch of the transaction, read only (06: the Academic Vice Principal "sees the others read only"); rows of hours, nothing personal.',
  'staff_count_by_division(timestamp with time zone)':
    'The number of people per main division for the school-wide list of divisions.',
  'same_person_relative(uuid[])':
    'The relative whose main phone is the phone of each staff record named, in any branch, archived included: the mark "same person" read from the phones (task 3.6b-1, decision 3 of pull request #119, Look first); ids only.',
  'same_person_staff(uuid[])':
    'The staff record whose phone is the main phone of each relative named, in any branch: the mark "same person" read from the phones (task 3.6b-1, decision 3 of pull request #119, Look first); ids only.',
  'staff_duplicate_elsewhere(text,text,date,text)':
    "Whether a person of another branch has the same name and birth date (the duplicate warning, the owner's answer); since task 3.6b-1 the phone argument is not read, a taken phone is refused.",
  'staff_phone_elsewhere(text)':
    'Whether a staff record of another branch holds a phone, for the refusal before Save (task 3.6b-1: "that record is shown" in the branch, told across branches); a boolean only.',
  'staff_in_division(uuid,uuid,timestamp with time zone)':
    'Whether anybody who has not left is in a division or a department: the school-wide archives.',
  'staff_out_for_good(uuid,timestamp with time zone)':
    'Whether one record is out of the school and stays out (no re-hire planned), whichever branch link the request sees.',
  'staff_period_start(uuid,timestamp with time zone)':
    'The moment the current employment period of one record began, in the time zone of its main branch, so that "never used" (task 2.3c-1, correction 2 of #65) is the same for every reader whichever branch link the request sees; one moment, nothing personal.',
  'staff_record_kind(uuid)':
    'The kind of one record by id, or null when it does not exist, so that a check never depends on what the membership filter shows; no row data.',
  'staff_subject_in_use(uuid,smallint[],uuid,timestamp with time zone)':
    "How many people of other branches a change of a subject's department or grades would leave outside it.",
  'department_move_loads(uuid,uuid,uuid,uuid,date)':
    'The teaching load rows a department move of a teacher or a subject would leave with a teacher outside the subject\'s department, by id and version for the branch of the request named by the caller and one count per other branch, never a row, a name or a subject of another branch, so that "those loads are listed for reassignment first" (edge/people-roles-accounts, row 15; task 3.4c, decision 3 of pull request #101, Look first).',
  'teacher_load_elsewhere(uuid,uuid[],date)':
    'The lessons per week each teacher or vacancy linked to a branch of the transaction has in the version running in every other branch, counts and branch ids only, so that "the teacher\'s total across branches is shown to both" (06, Weekly load; task 3.4b, decision 8 of pull request #100, Look first).',
  'teacher_claims_elsewhere(uuid,uuid,timestamp with time zone,timestamp with time zone)':
    'The start, end and branch of each lesson or exam a teacher linked to a branch of the transaction holds in any branch over a range, no class, subject, room or name, so that a Tutor lesson that follows a change of Tutor is checked for a clash and the travel time across branches (06, Teachers who work in several branches, "One clash check"; task 3.6c-2, decision 13 of pull request #125, Look first).',
  'timetable_busy_elsewhere(uuid,uuid[],date)':
    'The weekday, start and end of each pattern entry a teacher linked to the branch of the request holds in the published version in force on a date in every other branch, with the branch id and whether it is a Tutor lesson, no class, group, subject, room or name, so that "the teacher\'s lessons in other branches show as grey blocks" and count in every clash and the travel time (06, Teachers who work in several branches, Busy elsewhere; task 5.4b-1, decisions 2 and 3 of pull request #132, Look first).',
  'timetable_drafts_elsewhere(uuid,uuid[],date,date)':
    'The weekday, start and end of each pattern entry a teacher linked to the branch of the request holds in the drafts of every other branch that can overlap a range, with the branch id only, so that "each grid warns that the teacher is also planned in a draft of the other branch" (06, Two drafts at once; task 5.4b-1, decisions 2 and 3 of pull request #132, Look first).',
  'vacancy_close_holders(uuid,uuid,date)':
    'What still holds a vacancy for a close, past the row filter: the ids and numbers of the versions whose load rows still hold it and the first date of the lessons under it, no class, subject, person or name, so that the deferred refusal of a closed vacancy row and the close route read one query that does not depend on what the closing transaction sees (04, Vacancy: "cannot be closed while a load row names it or a future lesson is under it"; task 5.5c-2b, decisions 1 and 9 of pull request #157, Look first). It reads the branch it is given, and an application caller is refused a branch outside its transaction or a record that is not a vacancy of that branch.',
  'vacancy_delete(uuid)':
    'Deletes one vacancy of a branch of the transaction with every row of it (04: one that never held a load can be deleted); the membership filter hides the record once its link is gone, and sodiq_app keeps no delete right on staff or its history.',
};

/** The filter of db/migrations/0002, as PostgreSQL writes it back. */
const FILTER_EXPRESSION =
  '(branch_id = ANY (( SELECT app_branch_ids() AS app_branch_ids)::uuid[]))';

interface TableRow {
  name: string;
  has_branch_id: boolean;
  branch_id_not_null: boolean;
  references_branches: boolean;
  row_security: boolean;
  policies: number;
  filter_policies: number;
  membership_policy: string | null;
  membership_using: string | null;
  membership_check: string | null;
  filter_using: string | null;
  filter_check: string | null;
}

/** What is wrong with the tables of schema public; empty when every table is classified. */
async function tableProblems(
  database: Database,
  schoolWide: Record<string, string> = SCHOOL_WIDE_TABLES,
  schoolWideWithBranch: Record<string, string> = SCHOOL_WIDE_WITH_BRANCH,
  membership: typeof MEMBERSHIP_FILTERED_TABLES = MEMBERSHIP_FILTERED_TABLES,
): Promise<string[]> {
  const found = await sql<TableRow>`
    select
      c.relname as name,
      a.attname is not null as has_branch_id,
      coalesce(a.attnotnull, false) as branch_id_not_null,
      exists (
        select from pg_constraint k
        where k.conrelid = c.oid and k.contype = 'f'
          and k.confrelid = 'public.branches'::regclass and k.conkey = array[a.attnum]
      ) as references_branches,
      c.relrowsecurity as row_security,
      (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
      (
        select count(*)::int from pg_policy p
        where p.polrelid = c.oid and p.polname = 'branch_filter' and p.polcmd = '*'
          and p.polpermissive
          and p.polroles = array[(select oid from pg_roles where rolname = 'sodiq_app')]
      ) as filter_policies,
      (
        select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
        where p.polrelid = c.oid and p.polname = 'branch_filter'
      ) as filter_using,
      (
        select pg_get_expr(p.polwithcheck, p.polrelid) from pg_policy p
        where p.polrelid = c.oid and p.polname = 'branch_filter'
      ) as filter_check,
      (
        select p.polname from pg_policy p
        where p.polrelid = c.oid and p.polname <> 'branch_filter' and p.polcmd = '*'
          and p.polpermissive
          and p.polroles = array[(select oid from pg_roles where rolname = 'sodiq_app')]
        order by p.polname
        limit 1
      ) as membership_policy,
      (
        select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
        where p.polrelid = c.oid and p.polname <> 'branch_filter'
        order by p.polname
        limit 1
      ) as membership_using,
      (
        select pg_get_expr(p.polwithcheck, p.polrelid) from pg_policy p
        where p.polrelid = c.oid and p.polname <> 'branch_filter'
        order by p.polname
        limit 1
      ) as membership_check
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a
      on a.attrelid = c.oid and a.attname = 'branch_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  `.execute(database);

  const problems: string[] = [];
  const squeeze = (text: string | null) => text?.replace(/\s+/g, ' ') ?? '';
  for (const table of found.rows) {
    const listed = table.name in schoolWide;
    const withBranch = table.name in schoolWideWithBranch;
    const member = membership[table.name];
    if (member !== undefined) {
      if (table.has_branch_id) {
        problems.push(`${table.name}: filtered by membership but has branch_id`);
      }
      if (listed || withBranch) {
        problems.push(`${table.name}: filtered by membership and listed as school-wide`);
      }
      if (!table.row_security) {
        problems.push(`${table.name}: row security is off`);
      }
      const expected = MEMBERSHIPS[member.policy](table.name, member.column);
      if (
        table.membership_policy !== member.policy ||
        table.policies !== 1 ||
        squeeze(table.membership_using) !== expected ||
        squeeze(table.membership_check) !== (member.openInsert === true ? 'true' : expected)
      ) {
        problems.push(
          `${table.name}: the ${member.policy} policy is missing, not the standard one, or not alone`,
        );
      }
      continue;
    }
    if (!table.has_branch_id) {
      if (!listed) {
        problems.push(`${table.name}: no branch_id and not in the list of school-wide tables`);
      }
      if (withBranch) {
        problems.push(`${table.name}: named as school-wide with a branch but has no branch_id`);
      }
      continue;
    }
    if (withBranch) {
      if (!listed) {
        problems.push(
          `${table.name}: named as school-wide with a branch but not in the list of school-wide tables`,
        );
      }
      if (!table.references_branches) {
        problems.push(`${table.name}: branch_id does not reference branches (id)`);
      }
      if (table.row_security || table.policies > 0) {
        problems.push(`${table.name}: school-wide with a branch but has row security or a policy`);
      }
      continue;
    }
    if (listed) {
      problems.push(`${table.name}: listed as school-wide but has branch_id`);
    }
    if (!table.branch_id_not_null) {
      problems.push(`${table.name}: branch_id may be empty`);
    }
    if (!table.references_branches) {
      problems.push(`${table.name}: branch_id does not reference branches (id)`);
    }
    if (!table.row_security) {
      problems.push(`${table.name}: row security is off`);
    }
    if (
      table.filter_policies !== 1 ||
      squeeze(table.filter_using) !== FILTER_EXPRESSION ||
      squeeze(table.filter_check) !== FILTER_EXPRESSION
    ) {
      problems.push(`${table.name}: the branch_filter policy is missing or not the standard one`);
    }
    if (table.policies > 1) {
      problems.push(`${table.name}: has a policy besides branch_filter`);
    }
  }
  const names = new Set(found.rows.map((table) => table.name));
  for (const name of Object.keys(schoolWide)) {
    if (!names.has(name)) {
      problems.push(`${name}: listed as school-wide but does not exist`);
    }
  }
  for (const name of Object.keys(schoolWideWithBranch)) {
    if (!names.has(name)) {
      problems.push(`${name}: named as school-wide with a branch but does not exist`);
    }
  }
  for (const name of Object.keys(membership)) {
    if (!names.has(name)) {
      problems.push(`${name}: filtered by membership but does not exist`);
    }
  }
  return problems;
}

/**
 * A view runs with the rights of its owner unless it is created with
 * `security_invoker = true`; the owner is not filtered. A materialized view
 * holds a copy of the rows and cannot be filtered at all.
 */
async function viewProblems(database: Database): Promise<string[]> {
  const found = await sql<{ name: string; kind: string; invoker: boolean }>`
    select
      c.relname as name,
      c.relkind as kind,
      coalesce(
        (
          select o.option_value from pg_options_to_table(c.reloptions) o
          where o.option_name = 'security_invoker'
        ) in ('true', 'on'),
        false
      ) as invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
    order by c.relname
  `.execute(database);
  return found.rows
    .filter((view) => view.kind === 'm' || !view.invoker)
    .map((view) =>
      view.kind === 'm'
        ? `${view.name}: a materialized view is not filtered by branch`
        : `${view.name}: view without security_invoker = true`,
    );
}

async function functionProblems(
  database: Database,
  allowed: Record<string, string> = SECURITY_DEFINER_FUNCTIONS,
): Promise<string[]> {
  const found = await sql<{ name: string }>`
    select p.oid::regprocedure::text as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
    order by 1
  `.execute(database);
  const problems = found.rows
    .filter((row) => !(row.name in allowed))
    .map((row) => `${row.name}: SECURITY DEFINER and not in the allow-list`);
  const names = new Set(found.rows.map((row) => row.name));
  for (const name of Object.keys(allowed)) {
    if (!names.has(name)) {
      problems.push(`${name}: in the allow-list but not a SECURITY DEFINER function`);
    }
  }
  return problems;
}

/**
 * The tables of pg-boss 12.36.0 (db/migrations/0004) and what the application
 * user may do with each. They have no branch filter: a job holds ids and the
 * branches it works for, never personal data (docs/decisions.md). An upgrade of
 * pg-boss that adds a table, or a migration that widens a right, fails here.
 */
const JOB_TABLE_RIGHTS: Record<string, string[]> = {
  bam: [],
  instance: ['DELETE', 'SELECT', 'UPDATE'],
  job: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  job_common: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  job_dependency: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  queue: ['INSERT', 'SELECT', 'UPDATE'],
  queue_stats: [],
  schedule: [],
  subscription: [],
  version: ['SELECT', 'UPDATE'],
  warning: [],
};

/**
 * What is wrong with schema pgboss; empty when it is as migration 0004 leaves
 * it: owned by the migration user, nothing that runs with the owner's rights,
 * and the application user unable to create or change anything in it.
 */
async function jobSchemaProblems(database: Database): Promise<string[]> {
  const problems: string[] = [];

  const schema = await sql<{ owner: string; app_creates: boolean }>`
    select pg_get_userbyid(nspowner) as owner,
      has_schema_privilege('sodiq_app', oid, 'CREATE') as app_creates
    from pg_namespace where nspname = 'pgboss'
  `.execute(database);
  if (schema.rows[0]?.owner !== 'sodiq_migrator') {
    problems.push('pgboss: the schema is not owned by sodiq_migrator');
  }
  if (schema.rows[0]?.app_creates !== false) {
    problems.push('pgboss: sodiq_app may create objects in the schema');
  }

  const relations = await sql<{ name: string; kind: string; owner: string; rights: string[] }>`
    select c.relname as name, c.relkind as kind, pg_get_userbyid(c.relowner) as owner,
      -- The effective rights: also through a grant to public or on single columns.
      array(
        select p from unnest(
          array['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']
        ) p
        where has_table_privilege('sodiq_app', c.oid, p)
          or (
            p in ('INSERT', 'REFERENCES', 'SELECT', 'UPDATE')
            and has_any_column_privilege('sodiq_app', c.oid, p)
          )
        order by 1
      ) as rights
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pgboss' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    order by c.relname
  `.execute(database);
  for (const relation of relations.rows) {
    const name = `pgboss.${relation.name}`;
    if (relation.owner !== 'sodiq_migrator') {
      problems.push(`${name}: not owned by sodiq_migrator`);
    }
    const expected = JOB_TABLE_RIGHTS[relation.name];
    if (!['r', 'p'].includes(relation.kind) || expected === undefined) {
      problems.push(`${name}: not a table of pg-boss 12.36.0`);
    } else if (relation.rights.join(',') !== expected.join(',')) {
      problems.push(`${name}: the rights of sodiq_app are not the listed ones`);
    }
  }
  const names = new Set(relations.rows.map((relation) => relation.name));
  for (const name of Object.keys(JOB_TABLE_RIGHTS)) {
    if (!names.has(name)) {
      problems.push(`pgboss.${name}: listed but does not exist`);
    }
  }

  const functions = await sql<{ name: string; owner: string; definer: boolean }>`
    select p.oid::regprocedure::text as name, pg_get_userbyid(p.proowner) as owner,
      p.prosecdef as definer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pgboss'
    order by 1
  `.execute(database);
  for (const found of functions.rows) {
    if (found.owner !== 'sodiq_migrator') {
      problems.push(`${found.name}: not owned by sodiq_migrator`);
    }
    if (found.definer) {
      problems.push(`${found.name}: SECURITY DEFINER`);
    }
  }
  return problems;
}

// CLAUDE.md, "Branch on every row": every table that belongs to a branch has a
// branch column and the row filter. These checks read the catalog of a database
// built from the real migrations, so a later migration cannot forget the rule.
describe('the migrations', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('give every table the branch filter or name it as school-wide', async () => {
    expect(await tableProblems(database.migrator)).toEqual([]);
  });

  // The checks above read schema public only; `jobSchemaProblems` reads the
  // schema of the job queue. Another schema must be looked at and given checks
  // of its own before this list grows.
  it('keep everything in schema public, apart from the job queue', async () => {
    const found = await sql<{ name: string }>`
      select nspname as name from pg_namespace
      where nspname !~ '^pg_' and nspname <> 'information_schema'
      order by nspname
    `.execute(database.migrator);

    expect(found.rows.map((row) => row.name)).toEqual(['pgboss', 'public']);
  });

  it('leave the job queue to its owner, with only the listed rights for the application user', async () => {
    expect(await jobSchemaProblems(database.migrator)).toEqual([]);
  });

  // The policies do nothing for a superuser, a user with BYPASSRLS or a member
  // of the owner of the tables.
  it('leave the application user subject to row security', async () => {
    const found = await sql<{ rolsuper: boolean; rolbypassrls: boolean; memberships: number }>`
      select r.rolsuper, r.rolbypassrls,
        (select count(*)::int from pg_auth_members m where m.member = r.oid) as memberships
      from pg_roles r where r.rolname = 'sodiq_app'
    `.execute(database.migrator);

    expect(found.rows).toEqual([{ rolsuper: false, rolbypassrls: false, memberships: 0 }]);
  });

  it('give every school-wide table a reason', () => {
    for (const reason of Object.values(SCHOOL_WIDE_TABLES)) {
      expect(reason.length).toBeGreaterThan(10);
    }
    for (const reason of Object.values(SECURITY_DEFINER_FUNCTIONS)) {
      expect(reason.length).toBeGreaterThan(10);
    }
    for (const { reason } of Object.values(MEMBERSHIP_FILTERED_TABLES)) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  it('create every view with security_invoker = true', async () => {
    expect(await viewProblems(database.migrator)).toEqual([]);
  });

  it('create no SECURITY DEFINER function outside the allow-list', async () => {
    expect(await functionProblems(database.migrator)).toEqual([]);
  });
});

// The checks above are only worth something if they fail when they should.
describe('the catalog checks', () => {
  let database: TestDatabase;
  let north: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    north = await insertBranch(database.migrator, 'North');
  });

  afterAll(async () => {
    await database.destroy();
  });

  async function scratchTable(name: string, branchColumn: string | null): Promise<void> {
    await sql`
      create table ${sql.table(name)} (
        id integer primary key
        ${branchColumn === null ? sql`` : sql.raw(`, branch_id ${branchColumn}`)}
      )
    `.execute(database.migrator);
  }

  const BRANCH_COLUMN = 'uuid not null references branches (id)';

  describe('for tables', () => {
    // Also after a failed test, so one failure does not show up in the next test.
    afterEach(async () => {
      const found = await sql<{ name: string }>`
        select tablename as name from pg_tables
        where schemaname = 'public' and starts_with(tablename, 'scratch_')
      `.execute(database.migrator);
      for (const table of found.rows) {
        await sql`drop table ${sql.table(table.name)}`.execute(database.migrator);
      }
    });

    it('name a table that has no branch_id and is not listed', async () => {
      await scratchTable('scratch_unclassified', null);

      expect(await tableProblems(database.migrator)).toEqual([
        'scratch_unclassified: no branch_id and not in the list of school-wide tables',
      ]);
      expect(
        await tableProblems(database.migrator, {
          ...SCHOOL_WIDE_TABLES,
          scratch_unclassified: 'Listed for this test.',
        }),
      ).toEqual([]);
    });

    it('name a table with branch_id whose row security is off', async () => {
      await scratchTable('scratch_open', BRANCH_COLUMN);

      expect(await tableProblems(database.migrator)).toEqual([
        'scratch_open: row security is off',
        'scratch_open: the branch_filter policy is missing or not the standard one',
      ]);
    });

    it('accept a table with the standard filter', async () => {
      await scratchTable('scratch_filtered', BRANCH_COLUMN);
      await addBranchFilter(database.migrator, 'scratch_filtered');

      expect(await tableProblems(database.migrator)).toEqual([]);
    });

    it('name a table whose branch_id may be empty', async () => {
      await scratchTable('scratch_nullable', 'uuid references branches (id)');
      await addBranchFilter(database.migrator, 'scratch_nullable');

      expect(await tableProblems(database.migrator)).toEqual([
        'scratch_nullable: branch_id may be empty',
      ]);
    });

    it('name a table whose branch_id does not point at a branch', async () => {
      await scratchTable('scratch_loose', 'uuid not null');
      await addBranchFilter(database.migrator, 'scratch_loose');

      expect(await tableProblems(database.migrator)).toEqual([
        'scratch_loose: branch_id does not reference branches (id)',
      ]);
    });

    // Audit and history will be partitioned by month (task 0.5). A partition
    // that is read directly is not covered by the policy of its parent.
    it('name each partition as a table of its own', async () => {
      await sql`
        create table scratch_parted (id integer, branch_id uuid not null references branches (id))
        partition by range (id)
      `.execute(database.migrator);
      await addBranchFilter(database.migrator, 'scratch_parted');
      await sql`
        create table scratch_parted_1 partition of scratch_parted for values from (0) to (10)
      `.execute(database.migrator);

      expect(await tableProblems(database.migrator)).toEqual([
        'scratch_parted_1: row security is off',
        'scratch_parted_1: the branch_filter policy is missing or not the standard one',
      ]);
      await sql`drop table scratch_parted`.execute(database.migrator);
    });

    it('name a table with a second policy that lets more through', async () => {
      await scratchTable('scratch_widened', BRANCH_COLUMN);
      await addBranchFilter(database.migrator, 'scratch_widened');
      await sql`create policy read_all on scratch_widened for select to sodiq_app using (true)`.execute(
        database.migrator,
      );

      expect(await tableProblems(database.migrator)).toEqual([
        'scratch_widened: has a policy besides branch_filter',
      ]);
    });

    it.each([
      [
        'a weaker condition',
        `create policy branch_filter on scratch_weak for all to sodiq_app
           using (branch_id = any ((select app_branch_ids())::uuid[]) or true)`,
      ],
      [
        'no check on written rows',
        `create policy branch_filter on scratch_weak for all to sodiq_app
           using (branch_id = any ((select app_branch_ids())::uuid[])) with check (true)`,
      ],
      [
        'reading only',
        `create policy branch_filter on scratch_weak for select to sodiq_app
           using (branch_id = any ((select app_branch_ids())::uuid[]))`,
      ],
      [
        'every user instead of the application user',
        `create policy branch_filter on scratch_weak for all
           using (branch_id = any ((select app_branch_ids())::uuid[]))
           with check (branch_id = any ((select app_branch_ids())::uuid[]))`,
      ],
    ])('name a table whose branch_filter policy has %s', async (_name, statement) => {
      await scratchTable('scratch_weak', BRANCH_COLUMN);
      await sql`alter table scratch_weak enable row level security`.execute(database.migrator);
      await sql.raw(statement).execute(database.migrator);

      expect(await tableProblems(database.migrator)).toEqual([
        'scratch_weak: the branch_filter policy is missing or not the standard one',
      ]);
    });

    it('name a school-wide table that has a branch_id, and a listed table that does not exist', async () => {
      await scratchTable('scratch_listed', BRANCH_COLUMN);
      await addBranchFilter(database.migrator, 'scratch_listed');

      expect(
        await tableProblems(database.migrator, {
          ...SCHOOL_WIDE_TABLES,
          scratch_listed: 'Listed for this test.',
          scratch_gone: 'Listed for this test.',
        }),
      ).toEqual([
        'scratch_listed: listed as school-wide but has branch_id',
        'scratch_gone: listed as school-wide but does not exist',
      ]);
    });

    // Owner's answer 2 on pull request #53: the tables of a staff record are
    // filtered by membership. The exception is by name and by exact policy.
    describe('with the list of tables filtered by membership', () => {
      const memberAs = (name: string) => ({
        ...MEMBERSHIP_FILTERED_TABLES,
        [name]: {
          reason: 'Named for this test.',
          policy: 'staff_membership' as const,
          column: 'staff_id',
        },
      });
      const scratchMember = async (name: string) => {
        await sql`
          create table ${sql.table(name)} (id integer primary key, staff_id uuid not null)
        `.execute(database.migrator);
        await sql`alter table ${sql.table(name)} enable row level security`.execute(
          database.migrator,
        );
      };

      it('accept a named table with the standard policy', async () => {
        await scratchMember('scratch_member');
        await sql`
          create policy staff_membership on scratch_member for all to sodiq_app
            using (exists (select 1 from staff_branches b where b.staff_id = scratch_member.staff_id))
            with check (exists (select 1 from staff_branches b where b.staff_id = scratch_member.staff_id))
        `.execute(database.migrator);

        expect(
          await tableProblems(
            database.migrator,
            SCHOOL_WIDE_TABLES,
            SCHOOL_WIDE_WITH_BRANCH,
            memberAs('scratch_member'),
          ),
        ).toEqual([]);
        expect(await tableProblems(database.migrator)).toEqual([
          'scratch_member: no branch_id and not in the list of school-wide tables',
        ]);
      });

      it.each([
        [
          'no check on written rows',
          `create policy staff_membership on scratch_member for all to sodiq_app
             using (exists (select 1 from staff_branches b where b.staff_id = scratch_member.staff_id))
             with check (true)`,
        ],
        [
          'a weaker condition',
          `create policy staff_membership on scratch_member for all to sodiq_app
             using (true)
             with check (exists (select 1 from staff_branches b where b.staff_id = scratch_member.staff_id))`,
        ],
        [
          'a second policy that lets more through',
          `create policy staff_membership on scratch_member for all to sodiq_app
             using (exists (select 1 from staff_branches b where b.staff_id = scratch_member.staff_id))
             with check (exists (select 1 from staff_branches b where b.staff_id = scratch_member.staff_id));
           create policy read_all on scratch_member for select to sodiq_app using (true)`,
        ],
      ])('name a named table whose policy has %s', async (_name, statement) => {
        await scratchMember('scratch_member');
        await sql.raw(statement).execute(database.migrator);

        expect(
          await tableProblems(
            database.migrator,
            SCHOOL_WIDE_TABLES,
            SCHOOL_WIDE_WITH_BRANCH,
            memberAs('scratch_member'),
          ),
        ).toEqual([
          'scratch_member: the staff_membership policy is missing, not the standard one, or not alone',
        ]);
      });

      // Task 2.5a, decision 2 of pull request #72: the second filter, through the live links.
      it('accept a named table with the relative membership through live links only', async () => {
        await scratchMember('scratch_member');
        await sql`
          create policy relative_membership on scratch_member for all to sodiq_app
            using (exists (select 1 from student_relatives l
              where l.relative_id = scratch_member.staff_id and l.unlinked_at is null))
            with check (true)
        `.execute(database.migrator);
        const named = {
          ...MEMBERSHIP_FILTERED_TABLES,
          scratch_member: {
            reason: 'Named for this test.',
            policy: 'relative_membership' as const,
            column: 'staff_id',
            openInsert: true as const,
          },
        };

        expect(
          await tableProblems(
            database.migrator,
            SCHOOL_WIDE_TABLES,
            SCHOOL_WIDE_WITH_BRANCH,
            named,
          ),
        ).toEqual([]);
        // Named with the other filter, or with unlinked rows let through, it fails.
        expect(
          await tableProblems(database.migrator, SCHOOL_WIDE_TABLES, SCHOOL_WIDE_WITH_BRANCH, {
            ...named,
            scratch_member: { ...named.scratch_member, policy: 'staff_membership' as const },
          }),
        ).toEqual([
          'scratch_member: the staff_membership policy is missing, not the standard one, or not alone',
        ]);
        await sql`
          alter policy relative_membership on scratch_member
            using (exists (select 1 from student_relatives l
              where l.relative_id = scratch_member.staff_id))
        `.execute(database.migrator);
        expect(
          await tableProblems(
            database.migrator,
            SCHOOL_WIDE_TABLES,
            SCHOOL_WIDE_WITH_BRANCH,
            named,
          ),
        ).toEqual([
          'scratch_member: the relative_membership policy is missing, not the standard one, or not alone',
        ]);
      });

      it('name a named table with row security off and one that does not exist', async () => {
        await sql`create table scratch_member (id integer primary key, staff_id uuid)`.execute(
          database.migrator,
        );

        expect(
          await tableProblems(database.migrator, SCHOOL_WIDE_TABLES, SCHOOL_WIDE_WITH_BRANCH, {
            ...memberAs('scratch_member'),
            scratch_gone: {
              reason: 'Named for this test.',
              policy: 'staff_membership' as const,
              column: 'staff_id',
            },
          }),
        ).toEqual([
          'scratch_member: row security is off',
          'scratch_member: the staff_membership policy is missing, not the standard one, or not alone',
          'scratch_gone: filtered by membership but does not exist',
        ]);
      });
    });

    // Decided by the owner at task 0.7a: `assignments` is school-wide and names
    // a branch. The exception is by name; nothing else gets through with it.
    describe('with the list of school-wide tables that name a branch', () => {
      const listedAs = (name: string) => ({
        ...SCHOOL_WIDE_TABLES,
        [name]: 'Listed for this test.',
      });
      const namedAs = (...names: string[]) => ({
        ...SCHOOL_WIDE_WITH_BRANCH,
        ...Object.fromEntries(names.map((name) => [name, 'Named for this test.'])),
      });

      // Each name is a decision: assignments (0.7b), notifications (0.9), assignment_subjects
      // (decision 2 of pull request #63, Look first).
      it('hold exactly the assignments, their subjects and the notifications', () => {
        expect(Object.keys(SCHOOL_WIDE_WITH_BRANCH)).toEqual([
          'assignments',
          'assignment_subjects',
          'notifications',
        ]);
      });

      it('accept a named table whose branch_id may be empty and points at a branch', async () => {
        await scratchTable('scratch_named', 'uuid references branches (id)');

        expect(
          await tableProblems(
            database.migrator,
            listedAs('scratch_named'),
            namedAs('scratch_named'),
          ),
        ).toEqual([]);
      });

      it('still name a school-wide table with a branch_id that is not named', async () => {
        await scratchTable('scratch_unnamed', 'uuid references branches (id)');

        expect(await tableProblems(database.migrator, listedAs('scratch_unnamed'))).toContain(
          'scratch_unnamed: listed as school-wide but has branch_id',
        );
      });

      it('name a named table that is not in the list of school-wide tables', async () => {
        await scratchTable('scratch_named', 'uuid references branches (id)');

        expect(
          await tableProblems(database.migrator, SCHOOL_WIDE_TABLES, namedAs('scratch_named')),
        ).toEqual([
          'scratch_named: named as school-wide with a branch but not in the list of school-wide tables',
        ]);
      });

      it('name a named table whose branch_id does not point at a branch', async () => {
        await scratchTable('scratch_named', 'uuid');

        expect(
          await tableProblems(
            database.migrator,
            listedAs('scratch_named'),
            namedAs('scratch_named'),
          ),
        ).toEqual(['scratch_named: branch_id does not reference branches (id)']);
      });

      it('name a named table with row security or a policy: it would look filtered and is not', async () => {
        await scratchTable('scratch_named', 'uuid references branches (id)');
        await addBranchFilter(database.migrator, 'scratch_named');

        expect(
          await tableProblems(
            database.migrator,
            listedAs('scratch_named'),
            namedAs('scratch_named'),
          ),
        ).toEqual(['scratch_named: school-wide with a branch but has row security or a policy']);
      });

      it('name a named table without a branch_id, and one that does not exist', async () => {
        await scratchTable('scratch_named', null);

        expect(
          await tableProblems(
            database.migrator,
            listedAs('scratch_named'),
            namedAs('scratch_named', 'scratch_gone'),
          ),
        ).toEqual([
          'scratch_named: named as school-wide with a branch but has no branch_id',
          'scratch_gone: named as school-wide with a branch but does not exist',
        ]);
      });
    });
  });

  describe('for the job queue', () => {
    // Also after a failed test, so one failure does not show up in the next test.
    afterEach(async () => {
      for (const statement of [
        'drop table if exists pgboss.scratch_extra',
        'drop view if exists pgboss.scratch_view',
        'drop function if exists pgboss.scratch_count()',
        'revoke delete on pgboss.queue from sodiq_app',
        'revoke select on pgboss.warning from public',
        'revoke update (message) on pgboss.warning from sodiq_app',
        'revoke create on schema pgboss from sodiq_app',
      ]) {
        await sql.raw(statement).execute(database.migrator);
      }
      expect(await jobSchemaProblems(database.migrator)).toEqual([]);
    });

    it('name a table that pg-boss does not have, and a right that is not listed', async () => {
      await sql`create table pgboss.scratch_extra (id integer)`.execute(database.migrator);
      await sql`grant delete on pgboss.queue to sodiq_app`.execute(database.migrator);

      expect(await jobSchemaProblems(database.migrator)).toEqual([
        'pgboss.queue: the rights of sodiq_app are not the listed ones',
        'pgboss.scratch_extra: not a table of pg-boss 12.36.0',
      ]);
    });

    it.each([
      ['a grant to every user', 'grant select on pgboss.warning to public'],
      ['a grant on one column', 'grant update (message) on pgboss.warning to sodiq_app'],
    ])('name a right that reaches the application user through %s', async (_name, statement) => {
      await sql.raw(statement).execute(database.migrator);

      expect(await jobSchemaProblems(database.migrator)).toEqual([
        'pgboss.warning: the rights of sodiq_app are not the listed ones',
      ]);
    });

    it('name a view, a SECURITY DEFINER function and the right to create', async () => {
      await sql`create view pgboss.scratch_view as select * from pgboss.job`.execute(
        database.migrator,
      );
      await sql`
        create function pgboss.scratch_count() returns integer language sql security definer
        as 'select count(*)::int from pgboss.job'
      `.execute(database.migrator);
      await sql`grant create on schema pgboss to sodiq_app`.execute(database.migrator);

      expect(await jobSchemaProblems(database.migrator)).toEqual([
        'pgboss: sodiq_app may create objects in the schema',
        'pgboss.scratch_view: not a table of pg-boss 12.36.0',
        'pgboss.scratch_count(): SECURITY DEFINER',
      ]);
    });
  });

  describe('for views and functions', () => {
    beforeAll(async () => {
      await scratchTable('scratch_viewed', BRANCH_COLUMN);
      await addBranchFilter(database.migrator, 'scratch_viewed');
      await sql`grant select on scratch_viewed to sodiq_app`.execute(database.migrator);
      await sql`insert into scratch_viewed (id, branch_id) values (1, ${north})`.execute(
        database.migrator,
      );
    });

    const count = async (relation: string): Promise<number> =>
      (
        await sql<{
          rows: number;
        }>`select count(*)::int as rows from ${sql.table(relation)}`.execute(database.app)
      ).rows[0]?.rows ?? -1;

    it('name a view without security_invoker, which shows every branch', async () => {
      await sql`create view scratch_view as select * from scratch_viewed`.execute(
        database.migrator,
      );
      await sql`grant select on scratch_view to sodiq_app`.execute(database.migrator);

      // No branch is set: the table shows nothing, the view shows the row.
      expect(await count('scratch_viewed')).toBe(0);
      expect(await count('scratch_view')).toBe(1);
      expect(await viewProblems(database.migrator)).toEqual([
        'scratch_view: view without security_invoker = true',
      ]);
    });

    it('accept the view once it has security_invoker = true, and then it is filtered', async () => {
      await sql`alter view scratch_view set (security_invoker = true)`.execute(database.migrator);

      expect(await count('scratch_view')).toBe(0);
      expect(await viewProblems(database.migrator)).toEqual([]);
      await sql`drop view scratch_view`.execute(database.migrator);
    });

    it('name a materialized view', async () => {
      await sql`create materialized view scratch_copy as select * from scratch_viewed`.execute(
        database.migrator,
      );

      expect(await viewProblems(database.migrator)).toEqual([
        'scratch_copy: a materialized view is not filtered by branch',
      ]);
      await sql`drop materialized view scratch_copy`.execute(database.migrator);
    });

    it('name a SECURITY DEFINER function, which reads every branch', async () => {
      await sql`
        create function scratch_count() returns integer language sql security definer
        as 'select count(*)::int from scratch_viewed'
      `.execute(database.migrator);

      const seen = await sql<{ rows: number }>`select scratch_count() as rows`.execute(
        database.app,
      );
      expect(seen.rows[0]?.rows).toBe(1);
      expect(await functionProblems(database.migrator)).toEqual([
        'scratch_count(): SECURITY DEFINER and not in the allow-list',
      ]);
      expect(
        await functionProblems(database.migrator, {
          ...SECURITY_DEFINER_FUNCTIONS,
          'scratch_count()': 'Allowed for this test.',
        }),
      ).toEqual([]);
      expect(
        await functionProblems(database.migrator, { 'scratch_gone()': 'Listed for this test.' }),
      ).toContain('scratch_gone(): in the allow-list but not a SECURITY DEFINER function');
      await sql`drop function scratch_count()`.execute(database.migrator);
    });
  });
});
