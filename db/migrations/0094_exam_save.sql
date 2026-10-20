-- 0094 The exam save: the link from a lesson to the exams that cancelled it
-- (task 5.6c-1, pull request #181, decisions 3 and 4, spec review of the
-- plan must-fixes 1 and 3).
--
-- docs/spec/06-timetable.md, Changes after publishing, Exam: "It replaces the
-- regular lessons of its classes in its slots: those not already cancelled
-- are cancelled with the reason 'exam' in the same save, both halves of a
-- double lesson together, and cancelling the exam restores only the lessons
-- it cancelled, by the rule for a restored lesson." The From line of 5.1b
-- (decision 9): "This task adds the link from a lesson to the exam that
-- cancelled it, so that cancelling the exam restores only those lessons."
--
-- One row per exam over a lesson: a lesson of a shared block can lie under
-- two exams (class X sits exam A, class Y exam B, both "cancel the whole
-- block"), and it is held again only when no standing exam keeps it. At the
-- commit a lesson is cancelled 'exam' exactly when it has a link
-- (`lessons_exam_link`).

create table lesson_exam_cancels (
  branch_id uuid not null references branches (id),
  lesson_id uuid not null,
  exam_id uuid not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint lesson_exam_cancels_pkey primary key (lesson_id, exam_id, branch_id),
  -- A lesson removed by a rewrite of its date takes its links with it.
  constraint lesson_exam_cancels_lesson_fkey foreign key (lesson_id, branch_id)
    references lessons (id, branch_id) on delete cascade,
  constraint lesson_exam_cancels_exam_fkey foreign key (exam_id, branch_id)
    references exams (id, branch_id)
);

create index lesson_exam_cancels_exam_idx on lesson_exam_cancels (exam_id);

alter table lesson_exam_cancels enable row level security;
create policy branch_filter on lesson_exam_cancels for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on lesson_exam_cancels to sodiq_app;
grant insert (branch_id, lesson_id, exam_id) on lesson_exam_cancels to sodiq_app;

-- ---------------------------------------------------------------------------
-- The rows the calendar path of 5.6b-2c-1 wrote, cancelled 'exam' without a
-- link, in every shape `examWriteOf.end` writes them (spec review of the
-- plan, must-fix 1): a lesson is linked to every standing exam of its date
-- that overlaps its block or the other half of its double, and that seats a
-- class or group of one of those blocks (a shared block cancelled whole holds
-- lessons of classes that do not sit).

insert into lesson_exam_cancels (branch_id, lesson_id, exam_id)
select distinct l.branch_id, l.id, e.id
from lessons l
join lesson_blocks b on b.id = l.block_id
join exams e
  on e.branch_id = l.branch_id and e.exam_date = l.lesson_date and e.cancel_cause is null
where l.cancel_cause = 'exam'
  and exists (
    select 1
    from lesson_blocks ub
    join lessons u on u.block_id = ub.id
    where (ub.id = b.id or (b.double_pair_id is not null and ub.double_pair_id = b.double_pair_id
        and ub.lesson_date = b.lesson_date))
      and tstzrange(ub.starts_at, ub.ends_at) && tstzrange(e.starts_at, e.ends_at)
      and exists (
        select 1 from exam_room_classes rc
        where rc.exam_id = e.id
          and (
            rc.class_id = u.class_id
            or rc.group_id = u.group_id
            or rc.class_id in (select gc.class_id from group_classes gc where gc.group_id = u.group_id)
          )
      )
  );

-- No such lesson can be left without an exam: the calendar save holds again
-- every lesson cancelled 'exam' that no standing exam covers. One left is a
-- fault to look at, never a row to change silently.
do $$
begin
  if exists (
    select 1 from lessons l
    where l.cancel_cause = 'exam'
      and not exists (select 1 from lesson_exam_cancels c where c.lesson_id = l.id)
  ) then
    raise exception 'a lesson cancelled exam has no standing exam to link';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- A lesson is cancelled 'exam' exactly when it has a link, at the commit.
-- Runs as the invoker.

create function lessons_exam_link() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  lesson_ref uuid;
  cause text;
begin
  if tg_table_name = 'lessons' then
    lesson_ref := new.id;
  elsif tg_op = 'DELETE' then
    lesson_ref := old.lesson_id;
  else
    lesson_ref := new.lesson_id;
  end if;
  select l.cancel_cause into cause from lessons l where l.id = lesson_ref;
  if not found then
    -- Removed with its links.
    return null;
  end if;
  if (cause is not distinct from 'exam')
    <> exists (select 1 from lesson_exam_cancels c where c.lesson_id = lesson_ref) then
    raise exception 'lessons_exam_link'
      using errcode = 'check_violation', constraint = 'lessons_exam_link';
  end if;
  return null;
end;
$$;

create constraint trigger lessons_exam_link
  after insert or update of cancel_cause on lessons
  deferrable initially deferred
  for each row execute function lessons_exam_link();
create constraint trigger lesson_exam_cancels_link
  after insert or delete on lesson_exam_cancels
  deferrable initially deferred
  for each row execute function lessons_exam_link();
