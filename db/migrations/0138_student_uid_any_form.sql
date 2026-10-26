-- 0138 A student's UID typed in any form (task 9.4c, pull request #240).
--
-- docs/spec-changes.md, 26 October 2026; docs/spec/04-people.md, UID sets,
-- Release 1: "The UID is typed by hand, in any form: digits, letters or both,
-- up to 20 characters. The system refuses an empty UID and one already used by
-- any student, compared without spaces and ignoring upper and lower case."
-- docs/spec/edge-cases/developer-rules.md, Identifiers: "a unique constraint
-- across the school guarantees it is never used twice".
--
-- The seven-digit checks of 0032 and 0054 are replaced (plan decision 1, Look
-- first: the requirement changed; 0032 and 0054 are not edited). A UID is
-- stored as `studentUidSchema` of packages/shared leaves it: spaces and
-- invisible control or format characters removed, the case as typed (decision
-- 4). It is compared by `student_uid_key`, its upper case, through a stored
-- key on `students` and on `student_uids`: every UID ever held, released,
-- corrected-away and merged-away ones included, is unique by key. No existing
-- row changes: every stored UID is seven digits.

-- What the checks refuse: an empty UID, more than 20 characters, a space, a
-- control character or a common invisible format character. The schema of
-- packages/shared removes all of these (and every other `\p{Cf}`) before a
-- UID reaches the database, so it is never wider than this check.
create function student_uid_valid(uid text) returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select char_length(uid) between 1 and 20
    and uid !~ '[[:space:][:cntrl:]­​-‏‪-‮⁠-⁤﻿]'
$$;

-- The form a UID is compared by: its upper case, with the full case mapping
-- of PostgreSQL's built-in Unicode provider (the fold of `studentUidKey` of
-- packages/shared, JS `toUpperCase`). `pg_unicode_fast` is versioned with
-- PostgreSQL, not with the operating system's library, so the stored keys do
-- not change under it.
create function student_uid_key(uid text) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select upper(uid collate pg_unicode_fast)
$$;

alter table students drop constraint students_uid_check;
alter table students add constraint students_uid_check check (student_uid_valid(uid));
alter table student_uids drop constraint student_uids_uid_check;
alter table student_uids add constraint student_uids_uid_check check (student_uid_valid(uid));

alter table students add column uid_key text not null
  generated always as (student_uid_key(uid)) stored;
alter table student_uids add column uid_key text not null
  generated always as (student_uid_key(uid)) stored;

-- A UID is unique by key across the school; `student_uids_pkey` (exact)
-- stays and is implied.
drop index students_uid_idx;
create unique index students_uid_key_idx on students (uid_key);
create unique index student_uids_uid_key_idx on student_uids (uid_key);

-- The current UID is one the student holds, compared by key (decision 3): a
-- correction may change only the case of a UID the student holds; the
-- reservation keeps the spelling it was first held in.
alter table student_uids add constraint student_uids_student_uid_key_key
  unique (student_id, uid_key);
alter table students drop constraint students_uid_held_fkey;
alter table students add constraint students_uid_held_fkey foreign key (id, uid_key)
  references student_uids (student_id, uid_key) deferrable initially deferred;

alter table student_merges drop constraint student_merges_kept_uid_check;
alter table student_merges add constraint student_merges_kept_uid_check
  check (student_uid_valid(kept_uid));
alter table student_merges drop constraint student_merges_merged_uid_check;
alter table student_merges add constraint student_merges_merged_uid_check
  check (student_uid_valid(merged_uid));

-- The record a merged UID leads to (0054, decision 6), the UID compared by key.
create or replace function student_merged_uid_holder(uid text, branch uuid)
returns table (student_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when s.branch_id = student_merged_uid_holder.branch then s.id end
  from public.student_merges m
  join public.students s on s.id = m.kept_id
  where exists (
      select from unnest(m.merged_uids) as merged (uid)
      where public.student_uid_key(merged.uid) = public.student_uid_key(student_merged_uid_holder.uid)
    )
    and student_merged_uid_holder.branch = any (public.app_branch_ids())
  limit 1
$$;
