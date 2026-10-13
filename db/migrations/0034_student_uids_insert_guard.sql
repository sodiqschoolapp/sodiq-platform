-- 0034 A UID is reserved with its student (task 2.4b-1, pull request #68).
--
-- Found by the spec review of the build: 0032 grants `sodiq_app` insert on
-- `student_uids`, and that grant covers `released_at` and an empty
-- `student_id` added in 0033. A UID is released only by the delete of its
-- student (decision 3), with the moment of that transaction: a row is
-- inserted with its student and without a release, by every user.
create function student_uids_insert_guard() returns trigger
language plpgsql
as $$
begin
  if new.student_id is null or new.released_at is not null then
    raise exception 'student_uids_insert_held'
      using errcode = 'check_violation', constraint = 'student_uids_insert_held';
  end if;
  return new;
end
$$;

create trigger student_uids_insert_guard
  before insert on student_uids
  for each row execute function student_uids_insert_guard();
