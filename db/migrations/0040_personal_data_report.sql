-- 0040 The personal data report per person (task 2.6b).
--
-- docs/spec/edge-cases/people-roles-accounts.md, Personal data and the audit
-- log: "A parent asks for a copy of everything held about their child ... The
-- Super Admin can produce a personal data report per person."

-- Every relative ever linked to one student, live link or not, with the fields
-- of the record and the state of its Parent account (pull request #76,
-- decision 2, Look first). SECURITY DEFINER: `relative_membership` hides a
-- relative with no live link left (unlinked from every student, archived or
-- merged) from every transaction, and the student's report would show a link
-- with no person. The route calls it only for a student it has already found
-- in the branch of the request; it answers no other column of the record.
create function personal_data_relatives(student uuid)
returns table (
  id uuid,
  full_name text,
  phone text,
  extra_phones text[],
  workplace text,
  email text,
  phone_invalid_since timestamptz,
  archived_at timestamptz,
  merged_into uuid,
  account_created_at timestamptz,
  account_switched_on_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select r.id, r.full_name, r.phone, r.extra_phones, r.workplace, r.email,
    r.phone_invalid_since, r.archived_at, r.merged_into,
    a.created_at, a.switched_on_at
  from public.relatives r
  left join public.relative_accounts a on a.relative_id = r.id
  where r.id in (
    select l.relative_id from public.student_relatives l
    where l.student_id = personal_data_relatives.student
  )
  order by r.full_name, r.id
$$;

revoke execute on function personal_data_relatives(uuid) from public;
grant execute on function personal_data_relatives(uuid) to sodiq_app;
