-- 0066 No extra lessons: every dated lesson comes from a version's pattern
-- (task 3.6c-1, pull request #124).
--
-- Owner's answer 1 of 15 October 2026 (issue #42): "The school never holds an
-- extra lesson or a make-up lesson for one class." docs/spec/06-timetable.md,
-- Changes after publishing, "No extra lessons"; docs/spec/edge-cases/
-- time-dates-calendar.md, a working Saturday: "Lessons come from that
-- weekday's pattern". The plan approved on pull request #124: decision 4.
--
-- This removes the extra lesson of 0058 (`lesson_blocks.kind = 'extra'`, a
-- block and lessons with no version, pattern block, load row or pattern
-- entry). Nothing is deleted: the application never wrote an extra block, and
-- while one exists `set not null` refuses this migration.

alter table lesson_blocks
  alter column version_id set not null,
  alter column pattern_block_id set not null;

-- Its check and lesson_blocks_source_check go with the column.
alter table lesson_blocks drop column kind;

alter table lessons
  drop constraint lessons_source_check,
  alter column load_row_id set not null,
  alter column pattern_entry_id set not null;

-- As 0058, without the block kind: a lesson always names its load row and
-- pattern entry, which must belong to its block's version and pattern block.
create or replace function lessons_check() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  block lesson_blocks%rowtype;
  unit_year uuid;
  group_subject uuid;
  row_version uuid;
  row_class uuid;
  row_group uuid;
  entry_block uuid;
  entry_row uuid;
begin
  select * into block from lesson_blocks b
    where b.id = new.block_id and b.branch_id = new.branch_id;
  if not found then
    -- The foreign key answers it.
    return new;
  end if;

  if new.class_id is not null then
    select c.academic_year_id into unit_year from classes c
      where c.id = new.class_id and c.branch_id = new.branch_id;
  elsif new.group_id is not null then
    select g.academic_year_id, g.subject_id into unit_year, group_subject from groups g
      where g.id = new.group_id and g.branch_id = new.branch_id;
  end if;
  if unit_year is not null and unit_year <> block.academic_year_id then
    raise exception 'lesson_unit_year'
      using errcode = 'check_violation', constraint = 'lesson_unit_year';
  end if;
  if new.group_id is not null and group_subject is distinct from new.subject_id then
    raise exception 'lesson_group_subject'
      using errcode = 'check_violation', constraint = 'lesson_group_subject';
  end if;

  -- A null load row or pattern entry is answered by `not null`.
  if new.load_row_id is not null then
    select r.version_id, r.class_id, r.group_id into row_version, row_class, row_group
      from teaching_load_rows r where r.id = new.load_row_id;
    if row_version is distinct from block.version_id
      or row_class is distinct from new.class_id
      or row_group is distinct from new.group_id then
      raise exception 'lesson_load_row'
        using errcode = 'check_violation', constraint = 'lesson_load_row';
    end if;
  end if;
  if new.pattern_entry_id is not null then
    select e.block_id, e.load_row_id into entry_block, entry_row
      from pattern_entries e where e.id = new.pattern_entry_id;
    if entry_block is distinct from block.pattern_block_id
      or entry_row is distinct from new.load_row_id then
      raise exception 'lesson_pattern_entry'
        using errcode = 'check_violation', constraint = 'lesson_pattern_entry';
    end if;
  end if;
  return new;
end;
$$;
