-- 0038 The extra phones of a relative and the mark "same person" as a staff
-- record (task 2.5b-2, pull request #74).
--
-- docs/spec/edge-cases/close-relatives.md: "Extra phones can be added; they
-- are not unique and not used for sign-in." "The staff record and the
-- relative record stay separate and are marked as the same person."
--
-- Decisions of pull request #74 (plan approved with corrections 1 and 2):
-- extra phones are a list on the record, never unique, never matched
-- (decision 2); the mark is one staff record to one relative, set where both
-- records are visible to the writing transaction (decision 4, Look first); a
-- merged record is emptied of both (decision 5).

-- At most RELATIVE_EXTRA_PHONES_MAX (3) of packages/shared, none empty, each
-- of the people phone shape (2.5a decision 9), none twice. An extra phone
-- equal to the record's own main phone passes (decision 2).
create function relative_extra_phones_valid(phones text[]) returns boolean
language sql
immutable
as $$
  select coalesce(array_ndims(phones), 1) = 1
    and cardinality(phones) <= 3
    and array_position(phones, null) is null
    and not exists (select 1 from unnest(phones) p where p !~ '^\+[0-9]{7,15}$')
    and (select count(distinct p) from unnest(phones) p) = cardinality(phones)
$$;

-- No index: an extra phone is never unique (`edge`, row 5). `relative_by_phone`
-- and `relative_release_phone` read `phone` only, so an extra phone never
-- matches.
alter table relatives add column extra_phones text[] not null default '{}'
  constraint relatives_extra_phones_check check (relative_extra_phones_valid(extra_phones));

-- The staff record of the same person (decision 4, Look first). One relative
-- per staff record; a relative has at most one by its column.
alter table relatives add column staff_id uuid
  constraint relatives_staff_id_fkey references staff (id);
create unique index relatives_staff_idx on relatives (staff_id) where staff_id is not null;

-- A merged record is emptied of both (decision 5).
alter table relatives add constraint relatives_merged_empty_check check (
  merged_into is null or (cardinality(extra_phones) = 0 and staff_id is null)
);

grant insert (extra_phones) on relatives to sodiq_app;
grant update (extra_phones, staff_id) on relatives to sodiq_app;

-- A mark names a person, never a vacancy, and a staff record the writing
-- transaction sees (the staff membership filter: a person of a branch of the
-- transaction). The kind is read through `staff_record_kind`, whatever the
-- filter shows (`.claude/rules/database.md`). Only a change to a staff record
-- is checked: a mark kept while its staff member leaves the branch stays, and
-- a removal passes. Not SECURITY DEFINER.
create function relatives_same_person_check() returns trigger
language plpgsql
as $$
begin
  if new.staff_id is null or new.staff_id is not distinct from old.staff_id then
    return new;
  end if;
  if staff_record_kind(new.staff_id) = 'vacancy' then
    raise exception 'relatives_same_person_vacancy'
      using errcode = 'check_violation', constraint = 'relatives_same_person_vacancy';
  end if;
  if not exists (select 1 from staff where id = new.staff_id) then
    raise exception 'relatives_same_person_unseen'
      using errcode = 'check_violation', constraint = 'relatives_same_person_unseen';
  end if;
  return new;
end
$$;

create trigger relatives_same_person_check
  before update of staff_id on relatives
  for each row execute function relatives_same_person_check();
