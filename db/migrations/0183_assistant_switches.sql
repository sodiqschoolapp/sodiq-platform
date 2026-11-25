-- 0183 The Super Admin's switches of the assistant's actions, and the
-- personal-data groups that reach the model (task 11.20, the owner's spec
-- change of 25 November 2026).
--
-- 02, Assistant, Switches: "On the Assistant settings page the Super Admin
-- sees, for each of the three roles, every action of that role grouped by
-- area ... and switches each action, or a whole area, on or off ... Each
-- change of a switch is in the audit log." Personal data and the model: "The
-- Super Admin can keep any of these groups from the model, each with its own
-- switch ... All are on at the start."
--
-- Two new tables and one column with its default on the one settings row (the
-- build plan: "A migration adds tables and columns and changes no existing
-- row"). The switches are the school's, like assistant_settings: no branch.
-- A table holds only what the Super Admin set; a missing row is the default
-- from code (assistantDefaultOn of packages/shared, plan decision 6), so a
-- route added later follows its area. No delete grant: a switch is set again.

-- ASSISTANT_ROLES of packages/shared.
create table assistant_area_switches (
  role text not null constraint assistant_area_switches_role_check check (
    role in ('super_admin', 'academic_vice_principal', 'teacher')
  ),
  -- An area of the permission table (PERMISSIONS of packages/shared).
  area text not null constraint assistant_area_switches_area_check check (
    area ~ '^[a-z_]{1,60}$'
  ),
  is_on boolean not null,
  changed_at timestamptz not null,
  changed_by uuid not null references accounts (id),
  primary key (role, area)
);

grant select, insert, update (is_on, changed_at, changed_by)
  on assistant_area_switches to sodiq_app;

create table assistant_action_switches (
  role text not null constraint assistant_action_switches_role_check check (
    role in ('super_admin', 'academic_vice_principal', 'teacher')
  ),
  -- <METHOD> /api/<path>, as Express registers it.
  route text not null constraint assistant_action_switches_route_check check (
    route ~ '^(GET|POST|PUT|PATCH|DELETE) /api/[A-Za-z0-9_:/.-]{1,190}$'
  ),
  is_on boolean not null,
  changed_at timestamptz not null,
  changed_by uuid not null references accounts (id),
  primary key (role, route)
);

grant select, insert, update (is_on, changed_at, changed_by)
  on assistant_action_switches to sodiq_app;

-- The groups switched off (ASSISTANT_DATA_GROUPS of packages/shared); empty:
-- all six on, as at the start.
alter table assistant_settings
  add column data_groups_off text[] not null default '{}'
    constraint assistant_settings_data_groups_off_check check (
      data_groups_off <@ array[
        'contact', 'identity', 'financial', 'diagnostic', 'medical', 'relatives'
      ]::text[]
    );

grant update (data_groups_off) on assistant_settings to sodiq_app;
