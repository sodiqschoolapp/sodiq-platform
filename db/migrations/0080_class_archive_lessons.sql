-- 0080 A class is not archived while it has future lessons (task 5.5b-1,
-- pull request #152, code review round 2, finding 1).
--
-- docs/spec/edge-cases/timetable.md, After publishing, "A class is renamed,
-- merged or dissolved mid-year": "A class cannot be archived while it has
-- future lessons or members." The members half is `classes_members_guard`
-- (0045). From 5.5b-1 a published class has dated lessons up to the end of
-- the year, so the lessons half is kept here, as the members half is: under
-- the lock of the update, a lesson of the class dated after the day of the
-- archive in the branch's time zone refuses it. Dissolving a class is a
-- version without it from a date (the same row), whose publish removes its
-- future lessons; lessons dated today or earlier never block. Runs as the
-- invoker.
create function classes_lessons_guard() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from lessons l
    where l.class_id = new.id
      and l.lesson_date > (new.archived_at at time zone (
        select b.time_zone from branches b where b.id = new.branch_id
      ))::date
  ) then
    raise exception 'classes_has_lessons'
      using errcode = 'check_violation', constraint = 'classes_has_lessons';
  end if;
  return new;
end;
$$;

create trigger classes_lessons_guard
  before update of archived_at on classes
  for each row execute function classes_lessons_guard();
