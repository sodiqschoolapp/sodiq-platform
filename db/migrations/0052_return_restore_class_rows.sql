-- 0052 The class row of a return and of a graduate restore (task 3.3b, pull
-- request #96).
--
-- Decision 3: the causes of 0045 ("task 3.3 adds its causes") and of 0050
-- gain `return` and `restore`, the class row a return or a graduate restore
-- writes. Nothing is taken away. Every guard of 0045, 0049 and 0050 checks
-- the new row as it checks every insert: the branch, the class in service in
-- an open year, the year frame, the grade, the seats, the active time and,
-- at the commit, a group for every split or group subject of the class.

alter table class_memberships drop constraint class_memberships_cause_check;
alter table class_memberships add constraint class_memberships_cause_check check (
  cause in ('placement', 'create', 'cancel', 'undo', 'transfer', 'return', 'restore')
);
