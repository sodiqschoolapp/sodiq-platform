-- Task 9.2b, the spec review of the code (pull request #230, should-fix 3).
--
-- `student_statuses_closed_quarter` of 0133 checked the days between the old
-- and the new end of a status with `least` and `greatest`, which skip a null:
-- an end set on a status with none (`valid_until` null: no end) checked the
-- new end day only, so a closed quarter after it passed. The days changed are
-- then every day from the new end on: the range has no end.

create or replace function student_statuses_closed_quarter() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform quarter_days_open_guard(new.branch_id, new.valid_from, new.valid_from);
  elsif new.valid_until is distinct from old.valid_until then
    perform quarter_days_open_guard(
      new.branch_id,
      least(old.valid_until, new.valid_until),
      case
        when old.valid_until is null or new.valid_until is null then null
        else greatest(old.valid_until, new.valid_until)
      end
    );
  end if;
  return new;
end
$$;
