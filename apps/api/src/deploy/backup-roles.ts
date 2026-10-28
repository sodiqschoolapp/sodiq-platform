/**
 * The roles a dump names (task 10.2a; plan review, correction 5). The restore proof of
 * `backup.yml` restores owners, grants and row-filter policies as they are, so every role the
 * schema names must exist first: `sodiq_migrator`, `sodiq_app`, and any role of Neon's own that
 * owns or is granted something (`neon_superuser`, the project's own role). Read from the schema
 * of the dump (`pg_restore --schema-only --file=-`), never from its rows.
 */

const NAME = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const LIST = String.raw`${NAME}(?:\s*,\s*${NAME})*`;

/** Words that stand where a role would, but are none. */
const NOT_ROLES = new Set(['public', 'current_user', 'session_user', 'current_role']);

const PATTERNS = [
  new RegExp(String.raw`\bOWNER TO (${NAME})`, 'g'),
  new RegExp(String.raw`\bGRANT\b[^;]*?\bTO (${LIST})`, 'g'),
  new RegExp(String.raw`\bREVOKE\b[^;]*?\bFROM (${LIST})`, 'g'),
  new RegExp(String.raw`\bCREATE POLICY\b[^;]*?\bTO (${LIST})`, 'g'),
  new RegExp(String.raw`\bFOR ROLE (${LIST})`, 'g'),
];

function namesOf(list: string): string[] {
  const names: string[] = [];
  const one = new RegExp(NAME, 'g');
  for (const match of list.matchAll(one)) {
    const text = match[0];
    names.push(text.startsWith('"') ? text.slice(1, -1).replace(/""/g, '"') : text.toLowerCase());
  }
  return names;
}

/** Every role the schema names, in order of first mention. */
export function rolesOfSchema(schema: string): string[] {
  const roles: string[] = [];
  for (const pattern of PATTERNS) {
    for (const match of schema.matchAll(pattern)) {
      for (const name of namesOf(match[1] ?? '')) {
        if (!NOT_ROLES.has(name.toLowerCase()) && !roles.includes(name)) roles.push(name);
      }
    }
  }
  return roles;
}

const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
const literal = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** SQL that creates each role that does not exist yet, unable to sign in. */
export function createRolesSql(roles: readonly string[]): string {
  return roles
    .map(
      (role) =>
        `do $$ begin if not exists (select from pg_roles where rolname = ${literal(role)}) then ` +
        `create role ${quoted(role)} nologin; end if; end $$;`,
    )
    .join('\n');
}
