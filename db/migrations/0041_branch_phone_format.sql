-- 0041 The format of a branch phone (task 2.7b-1, pull request #78).
--
-- docs/decisions.md, "Decided ahead for tasks 2.2d and 2.7", item 10: "The
-- branch phone (issue #39, item 3): '+998' and nine digits, stored as typed
-- digits and shown grouped as '+998 71 123 45 67'; any other text is refused
-- with a message that shows the format." The schema of packages/shared
-- (`branchPhoneSchema`) keeps the same rule.
--
-- Step 1. The phones stored before (free text of up to 40 characters) are
-- brought into the format, so that the constraint of step 2 can be valid: a
-- `not valid` one would still refuse every later update of a row it does not
-- match (the go-live date, the name), with an error no route maps (review of
-- the plan, decision 5).
--   * A phone that is "+998" and nine digits once spaces, brackets and hyphens
--     are removed is stored as those digits.
--   * Any other phone is cleared: the phone is optional (`03`, Branch,
--     contacts), and the old text is kept in the audit entry.
-- Every change is audited in the same transaction (CLAUDE.md). Each changed
-- branch gets one entry of `audit_log`, as the edit of a branch writes it:
--   * branch_id, record_type 'branch' and record_id: the branch;
--   * actor_id empty: the system (0003: "empty for the system");
--   * action 'branch.edit', old_value and new_value with only the phone;
--   * reason 'Branch phone format (task 2.7b-1)';
--   * occurred_at the time of the transaction: a migration is not business
--     code and has no injected clock; the default partition of 0003 takes any
--     moment.
-- A branch whose phone is already in the format, or has none, is not touched
-- and gets no entry.
with phones as (
  select
    id,
    phone as old_phone,
    case
      when regexp_replace(phone, '[[:space:]()-]', '', 'g') ~ '^\+998[0-9]{9}$'
        then regexp_replace(phone, '[[:space:]()-]', '', 'g')
    end as new_phone
  from branches
  where phone is not null
),
changed as (
  update branches
  set phone = phones.new_phone
  from phones
  where branches.id = phones.id
    and phones.new_phone is distinct from phones.old_phone
  returning branches.id, phones.old_phone, phones.new_phone
)
insert into audit_log (
  occurred_at, branch_id, actor_id, action, record_type, record_id, old_value, new_value, reason
)
select
  now(),
  id,
  null,
  'branch.edit',
  'branch',
  id,
  jsonb_build_object('phone', old_phone),
  jsonb_build_object('phone', new_phone),
  'Branch phone format (task 2.7b-1)'
from changed;

-- Step 2. Every write from now on is "+998" and nine digits, or no phone.
-- `branches_phone_check` (length 1 to 40) and the grant of 0014 stay as they are.
alter table branches
  add constraint branches_phone_format check (phone is null or phone ~ '^\+998[0-9]{9}$');
