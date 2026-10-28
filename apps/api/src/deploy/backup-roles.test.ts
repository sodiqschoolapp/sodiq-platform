import { describe, expect, it } from 'vitest';
import { createRolesSql, rolesOfSchema } from './backup-roles.js';

// Task 10.2a, pull request #256 (plan review, correction 5): the restore proof creates every
// role the dump names before it restores owners, grants and policies.
describe('the roles a dump names', () => {
  it('reads owners, grantees, policy roles and default-privilege roles, once each', () => {
    const schema = [
      'ALTER TABLE public.lessons OWNER TO sodiq_migrator;',
      'GRANT SELECT,INSERT ON TABLE public.lessons TO sodiq_app;',
      'GRANT ALL ON SCHEMA public TO neon_superuser WITH GRANT OPTION;',
      'REVOKE ALL ON SCHEMA public FROM PUBLIC;',
      'CREATE POLICY branch_filter ON public.lessons TO sodiq_app USING ((branch_id = ANY (app_branch_ids())));',
      'ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser;',
      'GRANT USAGE ON SCHEMA pgboss TO sodiq_app, "Odd ""Role""";',
      'ALTER SCHEMA pgboss OWNER TO CURRENT_USER;',
    ].join('\n');
    expect(rolesOfSchema(schema)).toEqual([
      'sodiq_migrator',
      'sodiq_app',
      'neon_superuser',
      'Odd "Role"',
      'cloud_admin',
    ]);
  });

  it('creates each missing role unable to sign in, quoting its name', () => {
    expect(createRolesSql(['neon_superuser', 'Odd "Role"'])).toBe(
      [
        'do $$ begin if not exists (select from pg_roles where rolname = \'neon_superuser\') then create role "neon_superuser" nologin; end if; end $$;',
        'do $$ begin if not exists (select from pg_roles where rolname = \'Odd "Role"\') then create role "Odd ""Role""" nologin; end if; end $$;',
      ].join('\n'),
    );
  });
});
