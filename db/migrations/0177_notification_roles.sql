-- 0177 The roles a notice was sent for (task 10.11; owner, 21 November 2026,
-- in chat; plan approved on pull request #371).
--
-- Build plan 10.11: "every notice records the role or roles it is sent for:
-- the post by which the sender chose that person … notices stored before this
-- task name none." Through an integration key the person reads only the
-- notices sent for a Teacher, Head Teacher or Senior Head Teacher role (`02`,
-- Integration keys: "Their other roles do not count through a key").
--
-- Nullable with no default: the catalog changes and no existing row is
-- rewritten or changed (stop-list item 3). An existing row reads null, "names
-- none", and is never shown through a key.

alter table notifications add column for_roles text[];

-- The staff roles: ROLES of packages/shared/src/roles.ts without `student` and
-- `parent` (NOTICE_ROLES; a test compares them). A null passes a check, so the
-- old rows stay valid and their read mark can still be written.
alter table notifications add constraint notifications_for_roles_check check (
  for_roles is null or (
    cardinality(for_roles) >= 1
    and for_roles <@ array[
      'super_admin', 'principal', 'academic_vice_principal', 'spiritual_vice_principal',
      'head_tutor', 'tutor', 'class_teacher', 'senior_head_teacher', 'head_teacher', 'teacher',
      'hr', 'nurse', 'psychologist', 'librarian'
    ]::text[]
  )
);

-- A new notice names its roles. A check cannot say "new rows only" (a `not
-- valid` check would refuse the read mark of an old row), so a trigger on
-- insert does. The roles never change afterwards: the update grant of 0013 is
-- `read_at` alone.
create function notifications_for_roles_required() returns trigger
language plpgsql as $$
begin
  if new.for_roles is null then
    raise exception 'A notification names the roles it was sent for.'
      using errcode = '23514', constraint = 'notifications_for_roles_check';
  end if;
  return new;
end;
$$;

create trigger notifications_for_roles_required
  before insert on notifications
  for each row execute function notifications_for_roles_required();
