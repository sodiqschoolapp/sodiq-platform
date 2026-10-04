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
  request_keys: 'A key is unique across the school; a row holds ids and status only.',
  audit_log_school:
    'Audit entries of events without a branch (sign-ins, relatives); who reads them is decided by the guard (task 2.6).',
  ...auditSchoolPartitions(),
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
 * with its reason. None today.
 */
const SECURITY_DEFINER_FUNCTIONS: Record<string, string> = {};

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
  filter_using: string | null;
  filter_check: string | null;
}

/** What is wrong with the tables of schema public; empty when every table is classified. */
async function tableProblems(
  database: Database,
  schoolWide: Record<string, string> = SCHOOL_WIDE_TABLES,
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
      ) as filter_check
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
    if (!table.has_branch_id) {
      if (!listed) {
        problems.push(`${table.name}: no branch_id and not in the list of school-wide tables`);
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
      array(
        select g.privilege_type::text from information_schema.role_table_grants g
        where g.table_schema = 'pgboss' and g.table_name = c.relname and g.grantee = 'sodiq_app'
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
  });

  describe('for the job queue', () => {
    it('name a table that pg-boss does not have, and a right that is not listed', async () => {
      await sql`create table pgboss.scratch_extra (id integer)`.execute(database.migrator);
      await sql`grant delete on pgboss.queue to sodiq_app`.execute(database.migrator);

      expect(await jobSchemaProblems(database.migrator)).toEqual([
        'pgboss.queue: the rights of sodiq_app are not the listed ones',
        'pgboss.scratch_extra: not a table of pg-boss 12.36.0',
      ]);
      await sql`drop table pgboss.scratch_extra`.execute(database.migrator);
      await sql`revoke delete on pgboss.queue from sodiq_app`.execute(database.migrator);
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
      await sql`drop view pgboss.scratch_view`.execute(database.migrator);
      await sql`drop function pgboss.scratch_count()`.execute(database.migrator);
      await sql`revoke create on schema pgboss from sodiq_app`.execute(database.migrator);
      expect(await jobSchemaProblems(database.migrator)).toEqual([]);
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
        await functionProblems(database.migrator, { 'scratch_count()': 'Allowed for this test.' }),
      ).toEqual([]);
      expect(
        await functionProblems(database.migrator, { 'scratch_gone()': 'Listed for this test.' }),
      ).toContain('scratch_gone(): in the allow-list but not a SECURITY DEFINER function');
      await sql`drop function scratch_count()`.execute(database.migrator);
    });
  });
});
