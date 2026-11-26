-- 0190 Past marks from before go-live (task 11.26; the owner's spec change of 25 November 2026;
-- `10`, Past marks from before go-live; `edge/academic-year`, Past marks from before go-live;
-- `edge/developer-rules`, Past marks).
--
-- A branch that went live in the middle of the year imports the attendance, classwork and
-- homework of its lessons before its go-live date, for parents only. They are stored in their
-- own tables, each row with its branch and its upload, never as lessons, journal cells or works,
-- so that no query that counts, lists or calculates lessons, cells or results sees them. A
-- withdrawn upload's rows are kept and marked withdrawn ("archive, do not delete").
--
-- Nothing here changes or removes an existing row (stop-list item 3): new tables, their
-- triggers, one portal function and grants.

-- ---------------------------------------------------------------------------
-- The uploads: the shape of `subject_imports` (0167), with the file name and the withdrawal.

create table past_mark_uploads (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  file_name text not null constraint past_mark_uploads_file_name_check
    check (char_length(file_name) between 1 and 200),
  -- The SHA-256 of the file's bytes, in lower-case hex.
  file_sha256 text not null constraint past_mark_uploads_file_sha256_check
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- The rows as read (`pastMarkImportRowSchema` of `packages/shared`): what the preview and the
  -- confirm run again.
  rows jsonb not null,
  row_count integer not null constraint past_mark_uploads_row_count_check
    check (row_count between 1 and 50000),
  uploaded_by uuid not null references accounts (id),
  uploaded_at timestamptz not null,
  confirmed_by uuid references accounts (id),
  confirmed_at timestamptz,
  withdrawn_by uuid references accounts (id),
  withdrawn_at timestamptz,
  withdraw_reason text constraint past_mark_uploads_withdraw_reason_check
    check (char_length(btrim(withdraw_reason)) between 1 and 500),
  constraint past_mark_uploads_confirm_pair_check
    check ((confirmed_by is null) = (confirmed_at is null)),
  constraint past_mark_uploads_withdraw_check
    check (
      (withdrawn_by is null) = (withdrawn_at is null)
      and (withdrawn_at is null) = (withdraw_reason is null)
      and (withdrawn_at is null or confirmed_at is not null)
    )
);

create index past_mark_uploads_branch_idx on past_mark_uploads (branch_id, confirmed_at);

-- The same file is not imported twice while its upload stands (`10`, The upload).
create unique index past_mark_uploads_file_standing_idx on past_mark_uploads (branch_id, file_sha256)
  where confirmed_at is not null and withdrawn_at is null;

-- A confirm and a withdrawal are written once; nothing else of an upload ever changes.
create function past_mark_uploads_written_once() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.confirmed_at is not null
     and (new.confirmed_at is distinct from old.confirmed_at
          or new.confirmed_by is distinct from old.confirmed_by) then
    raise exception 'A past-mark upload is confirmed once.'
      using errcode = 'check_violation', constraint = 'past_mark_uploads_written_once';
  end if;
  if old.withdrawn_at is not null
     and (new.withdrawn_at is distinct from old.withdrawn_at
          or new.withdrawn_by is distinct from old.withdrawn_by
          or new.withdraw_reason is distinct from old.withdraw_reason) then
    raise exception 'A past-mark upload is withdrawn once.'
      using errcode = 'check_violation', constraint = 'past_mark_uploads_written_once';
  end if;
  return new;
end;
$$;

create trigger past_mark_uploads_written_once
  before update on past_mark_uploads
  for each row execute function past_mark_uploads_written_once();

alter table past_mark_uploads enable row level security;
create policy branch_filter on past_mark_uploads for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, insert on past_mark_uploads to sodiq_app;
grant update (confirmed_by, confirmed_at, withdrawn_by, withdrawn_at, withdraw_reason)
  on past_mark_uploads to sodiq_app;

-- ---------------------------------------------------------------------------
-- The marks. A lesson before go-live is (student, subject, date, lesson number): the number of
-- that subject's lesson on that day (`10`, The file).

create table past_attendance (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  upload_id uuid not null references past_mark_uploads (id),
  academic_year_id uuid not null references academic_years (id),
  student_id uuid not null references students (id),
  subject_id uuid not null references subjects (id),
  school_date date not null,
  lesson_number smallint not null constraint past_attendance_lesson_number_check
    check (lesson_number between 1 and 12),
  -- `07`, Entering data: 0 absent, 1 present, 2 late, 3 skipped; 4 and 5 exempt.
  mark smallint not null constraint past_attendance_mark_check check (mark between 0 and 5),
  withdrawn_at timestamptz
);

-- One standing attendance mark per lesson (`edge/academic-year`: "A lesson … has at most one
-- attendance mark … in the file and across the uploads that stand").
create unique index past_attendance_standing_idx
  on past_attendance (branch_id, student_id, subject_id, school_date, lesson_number)
  where withdrawn_at is null;
create index past_attendance_student_idx on past_attendance (student_id, school_date);
create index past_attendance_upload_idx on past_attendance (upload_id);

-- The key a title is compared by: case, apostrophes and spacing left out (the spelling rules of
-- `edge/academic-year`, applied to titles). The reader of the file gives the same key
-- (`pastMarkTitleKey` of `packages/shared`; a test runs the same titles through both).
create function past_mark_title_key(title text) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(
    translate(lower(normalize(title, NFKC)), 'ʻʼ''`‘’', ''),
    '\s+', ' ', 'g'))
$$;

grant execute on function past_mark_title_key(text) to sodiq_app;

create table past_works (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  upload_id uuid not null references past_mark_uploads (id),
  academic_year_id uuid not null references academic_years (id),
  student_id uuid not null references students (id),
  subject_id uuid not null references subjects (id),
  school_date date not null,
  lesson_number smallint not null constraint past_works_lesson_number_check
    check (lesson_number between 1 and 12),
  kind text not null constraint past_works_kind_check check (kind in ('classwork', 'homework')),
  -- Its place among the lesson's works of that kind in the upload, from 1 (the file's order).
  position smallint not null constraint past_works_position_check check (position >= 1),
  title text not null constraint past_works_title_check
    check (char_length(title) between 1 and 60 and title = btrim(title)),
  title_key text generated always as (past_mark_title_key(title)) stored,
  -- `10`, The rules of a row: a total from 1 to 1000 and a score from 0 to the total, each with
  -- at most two digits after the point (the domain of 0188).
  total work_amount not null constraint past_works_total_check check (total >= 1),
  score work_amount not null,
  withdrawn_at timestamptz,
  constraint past_works_score_check check (score <= total)
);

-- A work (the same lesson, kind and title) appears once across the uploads that stand.
create unique index past_works_standing_idx
  on past_works (branch_id, student_id, subject_id, school_date, lesson_number, kind, title_key)
  where withdrawn_at is null;
create index past_works_student_idx on past_works (student_id, school_date);
create index past_works_upload_idx on past_works (upload_id);

-- A mark is of its upload's branch; `withdrawn_at` is set once, only to its upload's moment of
-- withdrawal, and never back; nothing else of a mark changes but the student of a merge.
create function past_marks_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  upload record;
begin
  select u.branch_id, u.withdrawn_at into upload
  from public.past_mark_uploads u where u.id = new.upload_id;
  if tg_op = 'INSERT' then
    if upload.branch_id is distinct from new.branch_id then
      raise exception 'A past mark is of its upload''s branch.'
        using errcode = 'check_violation', constraint = 'past_marks_upload_branch';
    end if;
    if new.withdrawn_at is not null then
      raise exception 'A past mark is written standing.'
        using errcode = 'check_violation', constraint = 'past_marks_withdrawn_once';
    end if;
    return new;
  end if;
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'A withdrawn past mark stays withdrawn.'
      using errcode = 'check_violation', constraint = 'past_marks_withdrawn_once';
  end if;
  if old.withdrawn_at is null and new.withdrawn_at is not null
     and new.withdrawn_at is distinct from upload.withdrawn_at then
    raise exception 'A past mark is withdrawn with its upload.'
      using errcode = 'check_violation', constraint = 'past_marks_withdrawn_once';
  end if;
  return new;
end;
$$;

create trigger past_attendance_guard
  before insert or update on past_attendance
  for each row execute function past_marks_guard();
create trigger past_works_guard
  before insert or update on past_works
  for each row execute function past_marks_guard();

alter table past_attendance enable row level security;
create policy branch_filter on past_attendance for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));
alter table past_works enable row level security;
create policy branch_filter on past_works for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

-- Archive, do not delete: no delete; the withdrawal and the merge's carry are the only updates.
grant select, insert on past_attendance to sodiq_app;
grant update (withdrawn_at, student_id) on past_attendance to sodiq_app;
grant select, insert on past_works to sodiq_app;
grant update (withdrawn_at, student_id) on past_works to sodiq_app;

-- ---------------------------------------------------------------------------
-- The portal (plan decision 1, Look first): the branches holding the standing past marks of a
-- child the account may see at that moment (the child scope inside, as `portal_child_branches`
-- of 0159), so that the family of a child who moved still sees them (`edge/academic-year`: "a
-- branch move keeps them"). Another account's child gives nothing.

create function portal_past_mark_branches(account_id uuid, student_id uuid, at timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select b.branch_id
  from (
    select a.branch_id from public.past_attendance a
    where a.student_id = portal_past_mark_branches.student_id and a.withdrawn_at is null
    union
    select w.branch_id from public.past_works w
    where w.student_id = portal_past_mark_branches.student_id and w.withdrawn_at is null
  ) b
  where exists (
    select 1
    from public.portal_children(portal_past_mark_branches.account_id, portal_past_mark_branches.at) k
    where k.student_id = portal_past_mark_branches.student_id
  )
  order by b.branch_id
$$;

revoke execute on function portal_past_mark_branches(uuid, uuid, timestamptz) from public;
grant execute on function portal_past_mark_branches(uuid, uuid, timestamptz) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The students a file of past marks names (review correction 1 of the plan): the record of a
-- student is of their present branch, so a student who moved from A to B after A's go-live is not
-- readable from A, though A imports A's own lessons for them. For the UIDs given, the students
-- whose present branch is the branch of the import or who have a class membership there that
-- holds days, each with their name and every class membership (grade and days; the branch only
-- when it is the branch of the import, `null` otherwise); nobody else. The branch must be one of
-- the transaction's (the branch of the request). Called with `lock` by the confirm: the rows are
-- taken `for key share` in the order of their id, so a merge or a branch move of one of them
-- waits for the confirm, or commits first and the confirm reads it.

create function past_mark_students(branch uuid, uids text[], lock boolean)
returns table (
  student_id uuid,
  uid text,
  last_name text,
  first_name text,
  home_branch_id uuid,
  memberships jsonb
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  found uuid[];
begin
  if not (branch = any ((select public.app_branch_ids())::uuid[])) then
    raise exception 'past_mark_students reads the branch of the request only.'
      using errcode = 'insufficient_privilege';
  end if;
  select coalesce(array_agg(s.id order by s.id), '{}') into found
  from public.students s
  where s.uid = any (uids)
    and (s.branch_id = branch
         or exists (select 1 from public.class_memberships m
                    where m.student_id = s.id and m.branch_id = branch
                      and m.valid_from < m.valid_until));
  if lock then
    perform 1 from public.students s where s.id = any (found) order by s.id for key share;
  end if;
  return query
    select s.id, s.uid, s.last_name, s.first_name,
      case when s.branch_id = branch then s.branch_id end,
      coalesce((
        select jsonb_agg(jsonb_build_object(
            'branchId', case when m.branch_id = branch then m.branch_id end, 'grade', c.grade,
            'validFrom', m.valid_from, 'validUntil', m.valid_until)
          order by m.valid_from)
        from public.class_memberships m
        join public.classes c on c.id = m.class_id
        where m.student_id = s.id and m.valid_from < m.valid_until
      ), '[]'::jsonb)
    from public.students s
    where s.id = any (found)
      and (s.branch_id = branch
           or exists (select 1 from public.class_memberships m
                      where m.student_id = s.id and m.branch_id = branch
                        and m.valid_from < m.valid_until));
end;
$$;

revoke execute on function past_mark_students(uuid, text[], boolean) from public;
grant execute on function past_mark_students(uuid, text[], boolean) to sodiq_app;
