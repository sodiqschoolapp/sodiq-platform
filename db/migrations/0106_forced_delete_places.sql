-- 0106 The forced delete of a building, floor or room (task 5.8c, pull
-- request #196).
--
-- docs/spec/03-school-setup.md, Building, floor, room: "The Super Admin's
-- forced delete (06) also removes a building, floor or room that no lesson,
-- timetable entry or other record references, with a reason, an audit entry
-- and 30 days to restore; a referenced one stays archive-only."
-- docs/spec/06-timetable.md, Protection: "Forced delete is for Super Admin
-- only, with a typed reason."
--
-- The plan approved on pull request #196 with corrections 1 to 3: the store
-- of 0105 takes the three kinds (decision 1); a place is referenced by every
-- foreign key to it and by the ids kept outside keys (decision 2), which
-- their writers hold until their commit (database point 4).

-- ---------------------------------------------------------------------------
-- The kinds of the store (decision 1, Look first: the list of 0105 widened).

alter table forced_deletes
  drop constraint forced_deletes_record_type_check,
  add constraint forced_deletes_record_type_check check (
    record_type in ('lesson', 'building', 'floor', 'room')
  );

-- ---------------------------------------------------------------------------
-- Whether a building, floor or room is referenced by what no foreign key
-- holds (decision 2); every key to it refuses the delete itself. Runs as the
-- invoker: every reference is a row of the place's own branch.
--
-- - the rooms of a floor, and of every floor of a building;
-- - the lesson history (`room_before`, `room_after`, 0105);
-- - a draft's left rows and left blocks (0055, 0104);
-- - a store row of another record, not restored and still restorable, that
--   holds the id anywhere (a deep match, for what a later kind nests); the
--   rows of this transaction's own forced delete are left out (a building's
--   row names its floors).

create function place_referenced(kind text, ref uuid) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  moment timestamptz := class_tutors_moment();
  wanted jsonb := jsonb_build_object('id', ref::text);
begin
  if kind = 'floor' and exists (select 1 from rooms r where r.floor_id = ref) then
    return true;
  end if;
  if kind = 'building' and exists (
    select 1 from rooms r join floors f on f.id = r.floor_id where f.building_id = ref
  ) then
    return true;
  end if;
  if kind = 'room' and (
    exists (select 1 from lesson_history h where h.room_before = ref or h.room_after = ref)
    or exists (
      select 1 from timetable_versions v
      where jsonb_path_exists(v.left_rows, '$.** ? (@ == $id)', wanted)
        or jsonb_path_exists(v.left_blocks, '$.** ? (@ == $id)', wanted)
    )
  ) then
    return true;
  end if;
  return exists (
    select 1 from forced_deletes f
    where f.restored_at is null
      and (moment is null or f.restore_until > moment)
      and f.created_xact <> pg_current_xact_id()
      and jsonb_path_exists(f.rows, '$.** ? (@ == $id)', wanted)
  );
end;
$$;

grant execute on function place_referenced(text, uuid) to sodiq_app;

-- Whether a forced delete (`created_xact`) or a restore (`restored_xact`) of
-- this transaction names the place: its own row, or for a floor the row of
-- its building (`rows -> 'floors'`, correction 1). Runs as the invoker.
create function forced_place_names(kind text, ref uuid, restoring boolean) returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from forced_deletes f
    where (
        case when restoring then f.restored_xact else f.created_xact end
      ) = pg_current_xact_id()
      and (
        (f.record_type = kind and f.record_id = ref)
        or (
          kind = 'floor' and f.record_type = 'building'
          and jsonb_path_exists(
            f.rows, '$.floors[*] ? (@.id == $id)', jsonb_build_object('id', ref::text)
          )
        )
      )
  );
$$;

grant execute on function forced_place_names(text, uuid, boolean) to sodiq_app;

-- ---------------------------------------------------------------------------
-- The delete: only by a forced delete of this transaction, and only of a
-- place nothing references.

grant delete on buildings, floors, rooms to sodiq_app;

create function places_delete_forced() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  kind text := case tg_table_name
    when 'buildings' then 'building' when 'floors' then 'floor' else 'room' end;
begin
  if not forced_place_names(kind, old.id, false) then
    raise exception 'place_delete_unforced'
      using errcode = 'check_violation', constraint = 'place_delete_unforced';
  end if;
  if place_referenced(kind, old.id) then
    raise exception 'place_referenced'
      using errcode = 'check_violation', constraint = 'place_referenced';
  end if;
  return old;
end;
$$;

create trigger buildings_delete_forced
  before delete on buildings
  for each row execute function places_delete_forced();

create trigger floors_delete_forced
  before delete on floors
  for each row execute function places_delete_forced();

create trigger rooms_delete_forced
  before delete on rooms
  for each row execute function places_delete_forced();

-- ---------------------------------------------------------------------------
-- The same ids back on a restore, and only then (as `lessons_restore_ids`,
-- 0105). The insert grants of 0014 hold every column, the id included.

create function places_restore_ids() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  kind text := case tg_table_name
    when 'buildings' then 'building' when 'floors' then 'floor' else 'room' end;
begin
  if exists (
    select 1 from forced_deletes f
    where (f.record_type = kind and f.record_id = new.id)
      or (
        kind = 'floor' and f.record_type = 'building'
        and jsonb_path_exists(
          f.rows, '$.floors[*] ? (@.id == $id)', jsonb_build_object('id', new.id::text)
        )
      )
  ) and not forced_place_names(kind, new.id, true) then
    raise exception 'forced_delete_id'
      using errcode = 'check_violation', constraint = 'forced_delete_id';
  end if;
  return new;
end;
$$;

create trigger buildings_restore_ids
  before insert on buildings
  for each row execute function places_restore_ids();

create trigger floors_restore_ids
  before insert on floors
  for each row execute function places_restore_ids();

create trigger rooms_restore_ids
  before insert on rooms
  for each row execute function places_restore_ids();

-- ---------------------------------------------------------------------------
-- The writers of a reference kept outside a key hold the room until their
-- commit (database point 4). A lesson that leaves its room (a change of room
-- or a delete) writes a history line naming it, and its key no longer holds
-- the room: the room is taken `for key share` here, so a forced delete of it
-- (`for update`) waits and then finds the line. The new room is held by the
-- lesson's own key.

create function lessons_hold_room() returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.room_id is not null
    and (tg_op = 'DELETE' or new.room_id is distinct from old.room_id) then
    perform 1 from rooms r where r.id = old.room_id for key share;
  end if;
  return null;
end;
$$;

create trigger lessons_hold_room
  after update of room_id or delete on lessons
  for each row execute function lessons_hold_room();
