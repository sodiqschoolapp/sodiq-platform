-- 0026 Staff photos (task 2.2c-2, pull request #59).
--
-- docs/spec/04-people.md, Teacher and staff record: "Personal | Category ...,
-- photo, full name, ..."; Vacancy: "... and nothing personal".
-- The owner's answer 2 (docs/decisions.md, "Decided ahead for tasks 2.1 to
-- 2.6"): photos are stored in the R2 bucket, JPEG or PNG. The bytes live in
-- the photo store under `staff/<staff row id>/<photo_id>`; the record keeps
-- the id of its current photo and its type. A new id per upload, so an
-- answer never names a stale photo; a replaced photo's object stays in the
-- bucket and its audit entry names it (decision 8).

alter table staff
  add column photo_id uuid,
  add column photo_type text constraint staff_photo_type_check check (
    photo_type in ('image/jpeg', 'image/png')
  ),
  add constraint staff_photo_check check ((photo_id is null) = (photo_type is null));

-- A vacancy holds nothing personal, a photo neither (2.2b, correction 2 of
-- pull request #57; decision 13 of #59): the check of 0024 with one condition
-- added, `photo_id is null`. Tightened, not weakened; `staff` is small and
-- the migration runs in one transaction.
alter table staff drop constraint staff_vacancy_check;
alter table staff add constraint staff_vacancy_check check (
  kind <> 'vacancy' or (
    staff_id is null and account_id is null and first_name is null and last_name is null
    and father_name is null and sex is null and birth_date is null
    and education_level is null and phone is null and email is null and jshshir is null
    and admission_date is null and contract_type is null and contract_date is null
    and vacancy_name is not null and photo_id is null
  )
);

-- Set and removed by the photo routes; never at create.
grant update (photo_id, photo_type) on staff to sodiq_app;
