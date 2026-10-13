-- 0035 Student photos (task 2.4b-2, pull request #70).
--
-- docs/spec/04-people.md, Student record: "Personal | Photo, name, ...";
-- the student list: "checkbox, number, photo, UID, ...". The owner's answer
-- 2 (docs/decisions.md, "Decided ahead for tasks 2.1 to 2.6"): photos of
-- staff and students are stored in the R2 bucket, JPEG or PNG. The shape of
-- 0026 (staff photos): the bytes live in the photo store under
-- `students/<student id>/<photo_id>`, the record keeps the id of its
-- current photo and its type; a new id per upload, and a replaced photo's
-- object stays in the bucket with its audit entry naming it.

alter table students
  add column photo_id uuid,
  add column photo_type text constraint students_photo_type_check check (
    photo_type in ('image/jpeg', 'image/png')
  ),
  add constraint students_photo_check check ((photo_id is null) = (photo_type is null));

-- Set and removed by the photo routes; never at create.
grant update (photo_id, photo_type) on students to sodiq_app;
