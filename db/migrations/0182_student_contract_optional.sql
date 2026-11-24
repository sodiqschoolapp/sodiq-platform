-- 0182 A student's contract is optional, and its number may repeat (the
-- owner, 24 November 2026, in chat; the spec change of that day).
--
-- 04, Student record, Contract: "Optional: a contract number and a contract
-- date. A contract entered has its date; its number may be left empty. Two
-- students may have the same contract number."
--
-- Every student keeps at least one row of `student_contracts`, as before (the
-- newest row is the student's contract, edited in place; a return adds one;
-- the delete guards of 0033 and 0054 count them). "No contract" is a row with
-- no number and no date, so the edit, the return, the merge and the delete
-- guard keep their shape. A number never stands without its date.
--
-- Constraints only: no existing row changes (stop-list item 3). Every stored
-- row has a number and a date, so the new check holds for all of them; the
-- table holds one or two rows per student, so the check is validated at once.
-- The unique index of answer 22 goes: the number is no longer unique, in a
-- branch or across the school.

drop index student_contracts_number_idx;

alter table student_contracts alter column number drop not null;
alter table student_contracts alter column signed_on drop not null;

alter table student_contracts
  add constraint student_contracts_number_dated check (number is null or signed_on is not null);
