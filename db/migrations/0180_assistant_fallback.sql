-- 0180 The assistant's worldwide fallback: the switch, and where each call of
-- the model was processed (task 11.15, pull request #379; the owner's spec
-- change of 24 November 2026).
--
-- 02, Assistant, Where the model runs: "Each request goes first to the model
-- in Frankfurt ... Only when it still does not answer does the same request go
-- once through Google's worldwide endpoint ... The Super Admin can switch this
-- fallback off; it is on until switched off ... Each answer records whether it
-- was processed in Frankfurt or through the worldwide endpoint, and the
-- Settings show how many questions of the month used the fallback."
--
-- One column with its default on the one settings row (the build plan: "a new
-- column with its default") and one nullable column on the calls. No existing
-- row changes (stop-list item 3): the calls stored before this task keep a
-- null place, and the check is added not valid, so it holds every new row only.

alter table assistant_settings
  add column fallback_on boolean not null default true;

grant update (fallback_on) on assistant_settings to sodiq_app;

-- The Google location the call was sent to: the configured region
-- (europe-west3), or global for the worldwide endpoint (plan decision 4).
alter table assistant_model_calls add column processed_in text;

alter table assistant_model_calls
  add constraint assistant_model_calls_processed_in_check check (
    processed_in is not null
    and (processed_in = 'global' or processed_in ~ '^[a-z]+-[a-z]+[0-9]+$')
  ) not valid;

-- The number of questions of the whole school between two moments with at
-- least one call through the worldwide endpoint: the Settings count every
-- branch while a request sees none or one. A count only, no row.
create function assistant_fallback_questions_between(from_moment timestamptz, until_moment timestamptz)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(distinct c.message_id)
  from public.assistant_model_calls c
  where c.processed_in = 'global'
    and c.created_at >= assistant_fallback_questions_between.from_moment
    and c.created_at < assistant_fallback_questions_between.until_moment
$$;

revoke execute on function assistant_fallback_questions_between(timestamptz, timestamptz) from public;
grant execute on function assistant_fallback_questions_between(timestamptz, timestamptz) to sodiq_app;
