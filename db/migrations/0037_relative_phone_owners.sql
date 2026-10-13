-- 0037 The new owner of a phone, "no valid phone", the merge of two relatives
-- and the notice to the other branch (task 2.5b-1, pull request #73).
--
-- docs/spec/edge-cases/close-relatives.md: "A change of name or phone is
-- logged and the other branch's Academic Vice Principal is told." "On a phone
-- match the person entering chooses \"same person\" (link) or \"different
-- person, the number has a new owner\". The second choice asks for the earlier
-- relative's new phone. If it is unknown, that relative is set to \"no valid
-- phone\": sign-in blocked, and listed for the Academic Vice Principal while a
-- linked student is active." "When a phone change is refused because the
-- number exists, \"Merge\" is offered. The Academic Vice Principal picks the
-- name and phone that stay; all links move to one record. Across branches,
-- only the Super Admin merges."
--
-- Decisions of pull request #73 (plan approved with corrections 1 to 3):
-- `relative_release_phone` changes the phone of the exact holder, visible to
-- the branch or not (decision 2, Look first); `relative_notice_accounts`
-- names the Academic Vice Principals of the other branches (decision 5, Look
-- first); the merged record keeps its history, an empty phone and
-- `merged_into`, archived and never linked again (decision 6, Look first);
-- a link racing a merge is refused after the relative's lock (decision 9,
-- Look first).

-- "No valid phone" (decision 3): a moment with an empty phone, apart from "no
-- phone of their own" (an empty phone alone). Set only by
-- `relative_release_phone`; cleared whenever a phone is written.
alter table relatives add column phone_invalid_since timestamptz;
alter table relatives add constraint relatives_phone_invalid_check check (
  phone_invalid_since is null or phone is null
);

-- The record a merged relative went into (decision 6). A merged record has no
-- phone; its account stays with it, switched off (correction 2).
alter table relatives add column merged_into uuid
  constraint relatives_merged_into_fkey references relatives (id);
alter table relatives add constraint relatives_merged_into_check check (
  merged_into is null or (phone is null and merged_into <> id)
);
create index relatives_merged_into_idx on relatives (merged_into) where merged_into is not null;

grant update (merged_into) on relatives to sodiq_app;

-- A phone written clears "no valid phone"; a merged record takes no change
-- but its archive, once (decision 6). Not SECURITY DEFINER.
create function relatives_phone_and_merge() returns trigger
language plpgsql
as $$
begin
  if old.merged_into is not null then
    if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at')
      or (old.archived_at is not null and new.archived_at is distinct from old.archived_at)
    then
      raise exception 'relative_merged'
        using errcode = 'check_violation', constraint = 'relative_merged';
    end if;
    return new;
  end if;
  if new.phone is not null then
    new.phone_invalid_since := null;
  end if;
  return new;
end
$$;

create trigger relatives_phone_and_merge
  before update on relatives
  for each row execute function relatives_phone_and_merge();

-- A merged record is archived at the commit: every live link of it, in every
-- branch, was moved (`04`: "all links move to one record"). SECURITY DEFINER:
-- the links of other branches decide it, whatever the row filter of the
-- writing transaction shows (`.claude/rules/database.md`; spec review of the
-- build, finding 5).
create function relatives_merged_archived() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.merged_into is not null and exists (
    select 1 from public.student_relatives
    where relative_id = new.id and unlinked_at is null
  ) then
    raise exception 'relative_merged_links'
      using errcode = 'check_violation', constraint = 'relative_merged_links';
  end if;
  return null;
end
$$;

revoke execute on function relatives_merged_archived() from public;

create constraint trigger relatives_merged_archived
  after update of merged_into on relatives
  deferrable initially deferred
  for each row execute function relatives_merged_archived();

-- The Parent account of a merged record stays switched off for good
-- (correction 2), also once Release 2 drops `relative_accounts_switched_off_check`.
-- SECURITY DEFINER: a merged record is archived and visible to no branch.
create function relative_accounts_merged_off() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.switched_on_at is not null and exists (
    select 1 from public.relatives where id = new.relative_id and merged_into is not null
  ) then
    raise exception 'relative_merged'
      using errcode = 'check_violation', constraint = 'relative_merged';
  end if;
  return new;
end
$$;

revoke execute on function relative_accounts_merged_off() from public;

create trigger relative_accounts_merged_off
  before update on relative_accounts
  for each row execute function relative_accounts_merged_off();

-- A merged relative is never linked again (decision 9, Look first). The
-- relative's row is locked first, in a statement of its own (the lock
-- `relatives_follow_links` takes after the insert, taken earlier), and
-- `merged_into` read after it, so a link that waited on a merge reads the
-- merge. SECURITY DEFINER: the relative may be invisible to the linking
-- branch (a holder found by phone).
create function student_relatives_not_merged() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform 1 from public.relatives where id = new.relative_id for update;
  if exists (
    select 1 from public.relatives where id = new.relative_id and merged_into is not null
  ) then
    raise exception 'relative_merged'
      using errcode = 'check_violation', constraint = 'relative_merged';
  end if;
  return new;
end
$$;

revoke execute on function student_relatives_not_merged() from public;

create trigger student_relatives_not_merged
  before insert on student_relatives
  for each row execute function student_relatives_not_merged();

-- The accounts to tell of a change of a relative: a current Academic Vice
-- Principal of each branch other than the branch of the request where the
-- relative is linked live (`edge`, row 1). Ids only. Not callable by the
-- application; the two definer functions below call it.
create function relative_notice_targets(relative_id uuid, request_branch uuid)
returns table (branch_id uuid, account_id uuid)
language sql
stable
set search_path = pg_catalog, public
as $$
  select distinct l.branch_id, a.account_id
  from public.student_relatives l
  join public.assignments a
    on a.branch_id = l.branch_id and a.role = 'academic_vice_principal'
  where l.relative_id = relative_notice_targets.relative_id
    and l.unlinked_at is null
    and l.branch_id <> relative_notice_targets.request_branch
    and a.valid_from <= nullif(current_setting('app.now', true), '')::timestamptz
    and (
      a.valid_until is null
      or a.valid_until > nullif(current_setting('app.now', true), '')::timestamptz
    )
  order by 1, 2
$$;

revoke execute on function relative_notice_targets(uuid, uuid) from public;

-- The notice targets of a relative the transaction sees (decision 5, Look
-- first). "Other" is against the branch of the request, which must be one of
-- the transaction's, so the Super Admin's every-branch merge still tells the
-- other branches. Nothing for a relative the transaction does not see.
create function relative_notice_accounts(relative_id uuid, request_branch uuid)
returns table (branch_id uuid, account_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if request_branch is null or not (request_branch = any (public.app_branch_ids())) then
    raise exception 'relative_request_branch'
      using errcode = 'check_violation', constraint = 'relative_request_branch';
  end if;
  if not exists (
    select 1 from public.student_relatives l
    where l.relative_id = relative_notice_accounts.relative_id
      and l.unlinked_at is null
      and l.branch_id = any (public.app_branch_ids())
  ) then
    return;
  end if;
  return query
    select t.branch_id, t.account_id
    from public.relative_notice_targets(relative_notice_accounts.relative_id, request_branch) t;
end
$$;

revoke execute on function relative_notice_accounts(uuid, uuid) from public;
grant execute on function relative_notice_accounts(uuid, uuid) to sodiq_app;

-- "Different person, the number has a new owner" (`edge`, row 2; decision 2,
-- Look first): the holder of exactly `phone` gets `new_phone`, or "no valid
-- phone" from the moment of the transaction when it is empty. Its row is
-- locked first, in a statement of its own, and read again after the lock; a
-- holder whose phone moved is refused and nothing changes (a merged record
-- has no phone, so it is refused the same way).
-- Only the phone is written. Answers the notice targets of that relative,
-- which the branch of the request may not see (review finding 1). The branch
-- of the request must be one of the transaction's (correction 3). A taken
-- `new_phone` raises `relatives_phone_idx` as any write.
create function relative_release_phone(
  relative_id uuid, phone text, new_phone text, request_branch uuid
)
returns table (branch_id uuid, account_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  held text;
  found_id uuid;
  moment timestamptz;
begin
  if request_branch is null or not (request_branch = any (public.app_branch_ids())) then
    raise exception 'relative_request_branch'
      using errcode = 'check_violation', constraint = 'relative_request_branch';
  end if;
  perform 1 from public.relatives r where r.id = relative_release_phone.relative_id for update;
  select r.id, r.phone into found_id, held
    from public.relatives r
    where r.id = relative_release_phone.relative_id;
  if found_id is null or held is distinct from relative_release_phone.phone then
    raise exception 'relative_phone_changed'
      using errcode = 'check_violation', constraint = 'relative_phone_changed';
  end if;
  if new_phone is null then
    moment := nullif(current_setting('app.now', true), '')::timestamptz;
    if moment is null then
      raise exception 'relatives_archive_moment'
        using errcode = 'check_violation', constraint = 'relatives_archive_moment';
    end if;
    update public.relatives r set phone = null, phone_invalid_since = moment
      where r.id = relative_release_phone.relative_id;
  else
    update public.relatives r set phone = new_phone
      where r.id = relative_release_phone.relative_id;
  end if;
  return query
    select t.branch_id, t.account_id
    from public.relative_notice_targets(relative_release_phone.relative_id, request_branch) t;
end
$$;

revoke execute on function relative_release_phone(uuid, text, text, uuid) from public;
grant execute on function relative_release_phone(uuid, text, text, uuid) to sodiq_app;
