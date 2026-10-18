-- 0077 Out-of-date drafts: the causes of the mark (task 5.5a-3b-1, pull
-- request #146).
--
-- docs/spec/06-timetable.md, How surprises are prevented: "Out-of-date draft.
-- If the live timetable changed after a draft was started, the draft must be
-- brought up to date before publishing; the differences are shown."
-- docs/spec/edge-cases/timetable.md, Versions and drafts: "Any publish, or any
-- change to templates, calendar, availability or rooms, marks the other drafts
-- out of date."
--
-- The plan approved on pull request #146: decision 7 (Look first, a column
-- and a trigger column removed because the requirement changed: the mark now
-- says what marked the draft) and decision 6. No constraint or index is
-- removed; `timetable_versions_mark_draft` keeps guarding the edit lock.

-- One row per change that marked a draft. A draft is out of date while it has
-- a cause; bringing it up to date deletes the causes it showed. Readers count
-- the causes of drafts only (decision 7): a cause written at the moment its
-- version was published is ignored, so no trigger refuses it.
create table timetable_version_out_of_date_causes (
  id uuid primary key default uuidv7(),
  branch_id uuid not null references branches (id),
  version_id uuid not null,
  -- The audit action of the change; the kind of cause is read from it.
  action text not null constraint timetable_version_out_of_date_causes_action_check check (
    action in (
      'timetable_version.publish',
      'calendar_entry.create',
      'calendar_entry.edit',
      'calendar_entry.archive',
      'calendar_entry.restore',
      'slot_type.length_change',
      'day_template.version_create',
      'day_template_assignment.set',
      'day_template_assignment.end',
      'staff.availability_set',
      'staff.availability_end',
      'room.edit'
    )
  ),
  -- The record changed: a calendar entry, slot type, day template, template
  -- assignment, staff member, room or published version. Empty only for the
  -- publishes that marked a draft before this migration (decision 6).
  record_id uuid,
  -- The moment of the change's transaction (`app.now`).
  caused_at timestamptz not null,
  -- Bookkeeping only; no rule reads it.
  created_at timestamptz not null default now(),
  constraint timetable_version_out_of_date_causes_version_fkey foreign key (version_id, branch_id)
    references timetable_versions (id, branch_id),
  constraint timetable_version_out_of_date_causes_record_check check (
    record_id is not null or action = 'timetable_version.publish'
  )
);

create index timetable_version_out_of_date_causes_version_idx
  on timetable_version_out_of_date_causes (version_id);

alter table timetable_version_out_of_date_causes enable row level security;
create policy branch_filter on timetable_version_out_of_date_causes for all to sodiq_app
  using (branch_id = any ((select app_branch_ids())::uuid[]))
  with check (branch_id = any ((select app_branch_ids())::uuid[]));

grant select, delete on timetable_version_out_of_date_causes to sodiq_app;
grant insert (branch_id, version_id, action, record_id, caused_at)
  on timetable_version_out_of_date_causes to sodiq_app;

-- Decision 6: a draft marked before this migration was marked by a publish
-- that no row names.
insert into timetable_version_out_of_date_causes (branch_id, version_id, action, record_id, caused_at)
select branch_id, id, 'timetable_version.publish', null, out_of_date_at
from timetable_versions
where out_of_date_at is not null and status = 'draft';

-- Decision 7: the causes are the mark.
drop trigger timetable_versions_mark_draft on timetable_versions;
alter table timetable_versions drop column out_of_date_at;
create trigger timetable_versions_mark_draft
  before update of edit_holder_id, edit_seen_at on timetable_versions
  for each row execute function timetable_versions_draft();
