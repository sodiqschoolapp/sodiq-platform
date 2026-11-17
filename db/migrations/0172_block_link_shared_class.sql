-- 0172 Parallel groups form one block only through a shared class (task 5.15;
-- the owner's spec change of 17 November 2026).
--
-- docs/spec/06-timetable.md, Model, Parallel group lessons: "All groups of
-- one subject that share a class, directly or through other groups of that
-- subject [...] placed in the same period, each with its own teacher and room.
-- Placed and moved as one block. Groups that share no class are separate
-- blocks, even in one grade".
--
-- `load_block_rows` (0056) linked two groups of one subject by a shared class
-- or by being groups across classes of the same grade or pair of grades. The
-- grade link goes (Look first: the requirement changed); the shared-class link
-- stays, followed through other groups of the subject, as `groupsLinked` of
-- packages/timetable-rules does. The same signature, so the block triggers of
-- `teaching_load_rows_blocks` (0171), which call it by name, follow without
-- being replaced. The link is looser than before, so every stored row that
-- passed the old block rules passes these: no row is changed or removed.
-- 0056 and 0171 are not edited.

create or replace function load_block_rows(row_ref uuid)
returns table (
  id uuid,
  group_id uuid,
  teacher_id uuid,
  lessons_per_week smallint,
  mixed_block boolean,
  classes uuid[]
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with recursive parts as (
    select r.id, r.group_id, r.teacher_id, r.lessons_per_week, r.mixed_block, g.classes
    from teaching_load_rows r
    join teaching_load_rows self on self.id = row_ref
      and self.group_id is not null
      and r.version_id = self.version_id
      and r.subject_id = self.subject_id
    cross join lateral load_group_classes(r.group_id) g
    where r.group_id is not null
  ), block(id) as (
    select row_ref
    union
    select other.id
    from block b
    join parts one on one.id = b.id
    join parts other on other.id <> one.id and one.classes && other.classes
  )
  select p.id, p.group_id, p.teacher_id, p.lessons_per_week, p.mixed_block, p.classes
  from parts p
  where p.id in (select b.id from block b)
$$;

comment on function load_block_rows(uuid) is
  'Task 5.15: the rows of the block of a group row in its version, the row included; groups of one subject are linked by a shared class only (06, Model, Parallel group lessons, changed 17 November 2026).';

grant execute on function load_block_rows(uuid) to sodiq_app;
