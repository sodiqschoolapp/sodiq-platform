-- 0156 The demo clock of the test environment (task 10.5, pull request #280; the owner,
-- 4 November 2026, in chat).
--
-- On the test environment only (`DEMO_CLOCK=1`, set in render.yaml alone; the API and the
-- worker refuse to start with it anywhere else), the platform's "now" is real time plus a
-- stored offset that only grows. The moment comes from this one row alone (correction 1 of the
-- plan review): demo now = real now + (`offset_ms` once real now >= `effective_at`, otherwise
-- `previous_offset_ms`). Every API instance and the worker read the row every 2 seconds, and a
-- jump takes effect 5 seconds after it is written, so every process changes time at the same
-- real instant.
--
-- School-wide (the owner, 4 November 2026: one test-environment setting, no branch). A missing
-- row means offset 0, real time. The only way back to real time is the demo data workflow,
-- which replaces the test database.
--
-- Nothing here changes or removes an existing row.

create table demo_clock (
  id boolean primary key default true constraint demo_clock_one_row check (id),
  -- What demo time is ahead of real time from `effective_at` on, in milliseconds.
  offset_ms bigint not null constraint demo_clock_offset_check check (offset_ms >= 0),
  -- What it was ahead before `effective_at`: the offset in force when the jump was written.
  previous_offset_ms bigint not null,
  -- The real moment the offset takes effect.
  effective_at timestamptz not null,
  -- The real moment of the jump and who made it.
  changed_at timestamptz not null,
  changed_by uuid not null references accounts (id),
  constraint demo_clock_previous_check
    check (previous_offset_ms >= 0 and previous_offset_ms <= offset_ms)
);

-- No delete: a missing row would put every process back on real time.
grant select, insert, update on demo_clock to sodiq_app;

-- Forward only (decision 5): rows written at a later demo moment would sit in the future of a
-- clock moved back. Holds for every user, the owner of the table too.
create function demo_clock_forward_only() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.offset_ms < old.offset_ms or new.previous_offset_ms < old.previous_offset_ms then
    raise exception 'The demo clock only moves forward.'
      using errcode = 'check_violation', constraint = 'demo_clock_forward_only';
  end if;
  return new;
end;
$$;

create trigger demo_clock_forward_only
  before update on demo_clock
  for each row execute function demo_clock_forward_only();
