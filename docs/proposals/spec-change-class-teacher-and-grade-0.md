# Spec change: the Class teacher (Sinf rahbari) of grades 0–4, and grade 0

Proposal for the owner, 1 November 2026. Nothing in `docs/spec/` is changed yet. When the owner approves, apply it with `/spec-change` (one commit), and log it in `docs/spec-changes.md`. Where a sentence is quoted as "old", replace it word for word.

## What the owner said (1 November 2026, in chat)

- Primary classes have a Class teacher (Sinf rahbari), who is not a Tutor (Tyutor). She is linked to one class, for example 1 London. She teaches several subjects to that class and is responsible for the whole class. She also follows everything that happens in that class's other subjects, just as a Tutor does.
- The Class teacher replaces the Tutor: a primary class has no Tutor.
- Primary is always grades 0–4. The school also has grade 0.
- The Class teacher holds Ma'naviyat soati and the Homework slot of her class.
- The Head Tutor oversees the Class teachers, as the Head Tutor oversees the Tutors.
- Primary grades usually have no rating exams. The school does not want two records for one subject (no "Mathematics 0–4"). Instead, a switch for the Super Admin turns rating exams in primary grades on and off. Primary is graded the same way across grades 0–4.

## The idea in one paragraph

A new role, **Class teacher** (uz *Sinf rahbari*, ru *Классный руководитель*), takes the Tutor's place in every class of grades 0–4. A Tutor is given only to classes of grades 5–11. A Class teacher has every right and duty the Tutor has for own class, and also works as a Teacher. One definition in `edge-cases/00-definitions.md` says this once. That way about forty existing lines that say "the Tutor of a class" stay correct, and none of them needs rewriting. Two more rules change. First, subjects taught only in grades 0–4 may come from any department, which removes the block found on 1 November. Second, grades run 0–11.

## Readings to confirm (not said by the owner)

1. **A new role, not the Tutor role under another name.** The owner said the Class teacher is not a Tutor. A role of her own shows "Sinf rahbari" in the role switcher, the category and the lists. Its rights for own class are the Tutor's, plus the Teacher's. The alternative is to keep the Tutor role and only show it as "Sinf rahbari" in grades 0–4. That is less code, but the role switcher and category would then say "Tyutor".
2. **One class at a time.** A Class teacher has one own class at a time, as the owner described ("linked to one class"). While acting for another class's Class teacher for a period, she has a second class. A Tutor may still have several classes.
3. **The department exception is by grade, not by role.** A subject on a staff record whose grades taught are all within 0–4 may come from any department. Tying the exception to the Class teacher assignment would make a profile valid or invalid as the assignment's dates come and go. The cost: a grade-1 teacher who is not a Class teacher may also take primary subjects from several departments. That does no harm, because the teaching load still checks subject, grades and language.
4. **Other teachers still teach in primary classes.** A Class teacher is not required on every row of her class. English or physical education in 1 London can be taught by a subject teacher, as today.
5. **Rollover from grade 4 to grade 5.** The Class teacher is not copied to 5 London, which needs a Tutor. The class is listed in the rollover plan as needing a Tutor. From grade 0 to grade 1, and up to grade 4, the Class teacher is copied as a draft like the Tutor today.
6. **Grade 0 is shown as "0 London"**, in the same form as every other grade.
7. **One switch for the whole school, not one per subject.** "Rating exams in grades 0–4" is a single school setting kept by the Super Admin, off by default. When it is on, every rating subject has its rating exam in grades 0–4 as well. A switch per subject would be finer, but the owner said primary usually has no rating exams and asked for one switch.
8. **A second quarterly distribution, typed, not worked out.** A rating subject taught in grades 0–4 has, for each quarter, the usual distribution with the rating exam and also one without it (attendance, classwork, homework, total 100), used in grades 0–4 while the switch is off. Scaling 10 · 30 · 20 up to 100 would give fractions such as 16.7, so the school types it. Example: Mathematics, quarter 1, A 10 · CW 30 · HW 20 · RE 40 in grades 5–11 and A 10 · CW 50 · HW 40 in grades 0–4.
9. **Changing the switch mid-year.** It acts on open quarters only; closed quarters keep their results. A change is logged with a reason, shows how many grades change in each journal and recalculates at once, like a weights change. Turning it off is refused while a journal of grades 0–4 in an open quarter holds a rating exam entry (a score, "did not sit" or "exempt"), and the journals are listed.
10. **A group of grades 4 and 5 together in a rating subject** is refused while the switch is off, because half the group would have a rating exam and half not. Turning the switch off is refused while such a group exists in an open quarter. This should be rare.

---

## 1. `docs/spec/edge-cases/00-definitions.md`, table of terms

Add this row after the row "Result states":

| Tutor of a class | A class of grades 5–11 has a Tutor. A class of grades 0–4 has a Class teacher (Sinf rahbari) in the Tutor's place, and no Tutor. Every rule that names the Tutor of a class, a class's own Tutor, the class Tutor, an acting Tutor, own class of a Tutor, or the Tutor lessons (Ma'naviyat soati and the Homework slot) applies in the same way to the Class teacher of a class of grades 0–4. Rules that name the Tutor role itself (who is given it, who imports it) do not. |

## 2. `docs/spec/02-roles-and-access.md`

**Introduction.** Old: "There are 15 user types. One person has one account and can hold several roles (for example Teacher, Tutor and Head Teacher);"
New: "There are 16 user types. One person has one account and can hold several roles (for example Teacher, Tutor and Head Teacher);"

**Roles table, Head Tutor row.** Old: "Views all classes, their tutors and attendance by class and by tutor."
New: "Views all classes, their Tutors and Class teachers, and attendance by class and by Tutor or Class teacher."

**Roles table.** Add this row after the Tutor row:

| Class teacher (Sinf rahbari) | Own class (one class of grades 0–4); student list of the branch | Takes the Tutor's place in a class of grades 0–4: everything the Tutor sees and does for own class, the Ma'naviyat soati and Homework slot lessons included. Has one own class at a time; an acting Class teacher of another class has that class too for the period. Also works as a Teacher: teaches subjects of own class (and of other classes) through the teaching load like any teacher, and keeps their journals. Overseen by the Head Tutor. |

**Head Teachers and Senior Head Teachers, "Departments stay".** Old: "A department groups subjects and teachers, and a teacher's subjects come from one department. It has no head, except Tutors, whose head is the Head Tutor."
New: "A department groups subjects and teachers, and a teacher's subjects come from one department, except subjects taught only in grades 0–4, which may come from any department (a Class teacher teaches mathematics, native language and reading to one class). It has no head, except Tutors, whose head is the Head Tutor; the Head Tutor also oversees the Class teachers."

**Rules.** Old: "At first the table is fixed in code for the 15 roles."
New: "At first the table is fixed in code for the 16 roles."

## 3. `docs/spec/01-overview.md`

**Row "Roles".** Old: "15 user types: the 14 of the main file and the Senior Head Teacher."
New: "16 user types: the 14 of the main file, the Senior Head Teacher and the Class teacher (Sinf rahbari) of grades 0–4."

**Releases table, Release 1, roles that go live.** Old: "Head Tutor, Tutor, Senior Head Teacher, Head Teacher, Teacher"
New: "Head Tutor, Tutor, Class teacher, Senior Head Teacher, Head Teacher, Teacher"

## 4. `docs/spec/00-index.md`

Old: "The 15 roles, Head Teachers by subject"
New: "The 16 roles, Head Teachers by subject"

## 5. `docs/spec/03-school-setup.md`

**Divisions table, Academic row.** Old: "Teachers, Head Teachers, Senior Head Teachers, Tutors, the Head Tutor, teaching and laboratory assistants"
New: "Teachers, Head Teachers, Senior Head Teachers, Tutors, Class teachers, the Head Tutor, teaching and laboratory assistants"

**Department row.** Old: "It has no head, except Tutors, whose head is the Head Tutor;"
New: "It has no head, except Tutors, whose head is the Head Tutor, who also oversees the Class teachers;"

## 6. `docs/spec/04-people.md`

**Teacher and staff record, Personal, Category.** Old: "(Super Admin, Principal, Academic Vice Principal, Vice Principal for Spiritual and Moral Education, Head Tutor, Tutor, Senior Head Teacher, Head Teacher, Teacher)"
New: "(Super Admin, Principal, Academic Vice Principal, Vice Principal for Spiritual and Moral Education, Head Tutor, Tutor, Class teacher, Senior Head Teacher, Head Teacher, Teacher)"

**Academic.** Old: "Department: required in Academic, optional in other divisions; a teacher's subjects come from one department."
New: "Department: required in Academic, optional in other divisions; a teacher's subjects come from one department, except subjects taught only in grades 0–4, which may come from any department."

**Vacancy.** Old: "it cannot be a Tutor, a Head Teacher or hold any assignment."
New: "it cannot be a Tutor, a Class teacher, a Head Teacher or hold any assignment."

**UID sets** (Release 2 wording; the table of sets gets a grade 0 row when Release 2 decides the sets). Old: "and a new set is opened for the new grade 1 (a reading of the table, decided with Release 2)."
New: "and a new set is opened for the new grade 0 (a reading of the table, decided with Release 2)."
Old: "a set for the new grade 1 is proposed for confirmation."
New: "a set for the new grade 0 is proposed for confirmation."

## 7. `docs/spec/05-classes-groups-subjects.md`

**Class row.** Old: "Grade (1–11), name (Oxford, Princeton), language of instruction (Uzbek or Russian), tutor, main classroom,"
New: "Grade (0–11), name (Oxford, Princeton), language of instruction (Uzbek or Russian), tutor (grades 5–11) or Class teacher (grades 0–4), main classroom,"
Old: "A class is shown as grade and name: 7 Oxford."
New: "A class is shown as grade and name: 7 Oxford, 0 London."

**Language of instruction, The rule.** Old: "The same holds when a Tutor is given a class."
New: "The same holds when a Tutor or a Class teacher is given a class."

## 8. `docs/spec/edge-cases/people-roles-accounts.md`

**Row "The staff record allows one department, but a mathematics teacher is also a Tutor with Ma'naviyat soati."** Old: "A staff member has one teaching department, which governs their subjects. Tutor subjects come with the Tutor assignment of a class and are outside that rule."
New: "A staff member has one teaching department, which governs their subjects, except subjects whose grades taught are all within 0–4: those may come from any department, so a Class teacher can teach mathematics, native language and reading to own class. Tutor subjects come with the Tutor or Class teacher assignment of a class and are outside that rule."

**Row "A teacher moves to another department, or a subject is moved, mid-year."** Old: "They are refused while a teaching load would have a teacher outside the subject's department;"
New: "They are refused while a teaching load would have a teacher outside the subject's department, except a row of a class or group of grades 0–4;"

**Add a row** after the row "One person is Teacher, Tutor and Head Teacher.":

| A class of grade 2 is given a Tutor, or a class of grade 6 a Class teacher. | Refused, not a warning: a class of grades 0–4 takes a Class teacher and a class of grades 5–11 a Tutor. The person must hold the role in the branch. A Class teacher has one own class at a time; giving a second is refused, except as acting Class teacher for a period. |

## 9. `docs/spec/edge-cases/students-classes-groups.md`

**Row "The Tutor of a class changes in January, is ill, or the class has none."** No change: the definition (section 1) makes it cover the Class teacher, warning included.

## 10. `docs/spec/edge-cases/academic-year.md`

**Row "What does rollover copy?"** Old: "Copied as drafts to confirm: Tutor and room of each class,"
New: "Copied as drafts to confirm: Tutor or Class teacher and room of each class (a class moving from grade 4 to grade 5 keeps its room, not its Class teacher, and is listed as needing a Tutor),"

**Row "Rollover is started in June…"** Old: "For each class: promote, merge, split or discontinue; grade 11 graduates."
New: "For each class: promote (grade 0 to grade 1, and so on), merge, split or discontinue; grade 11 graduates."

---

## 11. Rating exams in grades 0–4

### `docs/spec/edge-cases/00-definitions.md`, table of terms

Add this row after the row "Tutor of a class":

| Rating journal | A journal of a rating subject (one whose rating exam switch is on), except a journal of grades 0–4 while the school setting "Rating exams in grades 0–4" is off for its quarter: that journal has no rating exam column and uses the subject's distribution without the rating exam. Every rule that names a rating subject, a rating journal or the rating exam of a journal means a rating journal. |

### `docs/spec/05-classes-groups-subjects.md`, Grading weights on a subject

**Table.** Add this row after the row "Quarterly, rating subject":

| Quarterly, rating subject in grades 0–4 without the rating exam | Attendance, classwork, homework | The quarter result in grades 0–4 while "Rating exams in grades 0–4" is off | A 10 · CW 50 · HW 40 |

**Bullets.** Old: "A subject without a rating exam has no rating part, and its journal has no rating exam column."
New: "A subject without a rating exam has no rating part, and its journal has no rating exam column. **Grades 0–4.** A school setting, "Rating exams in grades 0–4", kept by the Super Admin and off by default, decides whether rating subjects have their rating exam in grades 0–4. While it is off, a journal of grades 0–4 of a rating subject has no rating exam column, and the subject needs, for each quarter, the distribution without the rating exam beside its usual one. Changing the setting acts on open quarters only, is logged with a reason, shows how many grades will change in each journal and recalculates at once. Turning it off is refused while a journal of grades 0–4 in an open quarter holds a rating exam entry, or while a group of grades 4 and 5 of a rating subject exists in an open quarter; the journals and groups are listed."

### `docs/spec/05-classes-groups-subjects.md`, Group row

Old: "or of two grades (physical education for 9 Edinburgh and 10 Brown together)."
New: "or of two grades (physical education for 9 Edinburgh and 10 Brown together); a group of grades 4 and 5 in a rating subject is refused while \"Rating exams in grades 0–4\" is off."

### `docs/spec/07-journal.md`

**Rating exam.** Old: "One score from 0 to 100 per student per quarter, only in rating subjects."
New: "One score from 0 to 100 per student per quarter, only in rating journals (in grades 0–4 only while \"Rating exams in grades 0–4\" is on)."

Rule 8 and the closing checklist read "rating subject" and stay as written: the definition makes them mean a rating journal.

### `docs/spec/edge-cases/academic-year.md`

**Row "The timetable is published on 1 September while a subject has no weights."** Old: "its daily distribution and its quarterly distribution for each quarter the version touches."
New: "its daily distribution and its quarterly distribution for each quarter the version touches, and, for a rating subject in a class or group of grades 0–4 while \"Rating exams in grades 0–4\" is off, its distribution without the rating exam for those quarters."

The spec has no table of school settings; the setting is defined once, in `05` (above).

## Side effects: what could go wrong

- **Permissions (a stop item since the pilot, 28 October).** A new role adds a row to the permission table, copied from the Tutor's class-scoped rights and the Teacher's own-lesson rights. A copy that misses one area fails closed (the Class teacher is refused). A copy that is too wide gives a Teacher-level person a Tutor's reading of contact fields, which is the Tutor's right today for own class only. Every route needs allow and refuse tests for the new role. The task that builds this waits for the owner (CLAUDE.md, stop item 5).
- **Grade 0 everywhere.** Grades 1–11 are checked in the database in at least `classes`, `students`, `lesson_plan_masters`, day-template and calendar grade ranges, weekly days of a version and the subject and staff grade arrays (`subject_grades_valid`). A missed check refuses grade 0 with a 500 or a wrong message. Pickers, filters and the "7-sinf" labels in the web app need grade 0 too. Widening a check changes no existing row (not stop item 3), but every check is a new migration; merged ones are never edited.
- **The department rule is guarded in the database** (`staff_subject_department` in 0024 and the department move check in 0057). The change narrows what they refuse. It is a **Look first** item: a constraint weakened because a requirement changed, with this spec change as the reason.
- **Tutor lessons follow the Class teacher.** Ma'naviyat soati and the Homework slot of 1 London go to its Class teacher through the same machinery (0067). A Class teacher with about 20 lessons a week in her own class plus the Tutor lessons must still fit her availability. The solver and the clash rules are unchanged.
- **Head Tutor reports.** "Attendance by tutor" and the journal discipline of Tutors must include Class teachers, or the Head Tutor loses sight of grades 0–4.
- **Rollover 4 → 5.** Without the rule in section 10, 5 London would carry a Class teacher into grade 5, which the new check refuses.
- **Rating exams in grades 0–4 touch the journal and results path.** Which weights a journal uses, whether it has a rating exam column, the quarter close check and the results all depend on the new setting. `packages/calc` takes the weights and the parts as inputs and may need no change. If it does need one, that is a stop item since the pilot (CLAUDE.md, item 4). Either way, it is a **Look first** reading of a journal calculation rule. Results of closed quarters must not move: a test turns the setting on and off and checks a closed quarter's results.
- **Lesson plans.** Readers are "teachers with the same subject and grade in their profile". A Class teacher with Mathematics for grade 1 in her profile reads grade-1 mathematics plans. That is wanted, and needs no change.

## Code and tests that must change (all built; a new task in `docs/build-plan.md`)

- `packages/shared/src/roles.ts`, `permissions.ts` and their tests; `docs/security/permission-checklist.md` regenerated (`pnpm security:checklist`).
- Assignments and Tutors of a class (0042 to 0044, `apps/api/src/modules/classes`). The Class teacher role is given only to classes of grades 0–4 and the Tutor only to grades 5–11, with one own class for a Class teacher. The class scope of the guard (3.1c) covers the new role.
- Teaching load trigger (0055) and Tutor lessons (0067): the Tutor subject exception and "the Tutor in force" read the Class teacher too.
- `staff_profile_check` (0024) and `department_move_loads` (0057): the exception for subjects of grades 0–4 only.
- Grade 0 in every `between 1 and 11` check and in `subject_grades_valid`, in `packages/shared/src/classes.ts` and the other grade schemas, and in the web pickers.
- Rollover (`edge/academic-year`): 4 → 5 drops the Class teacher and lists the class.
- Head Tutor views and reports, the category column and filter, the teacher list.
- i18n in three languages: uz "Sinf rahbari", ru "Классный руководитель", en "Class teacher", and the refusal texts.
- Demo seed (`apps/api/src/testing/demo`): a grade 0 and Class teachers for grades 0–4.
- Rating exams in grades 0–4: the school setting (Super Admin, audited) and its refusals. The second quarterly distribution in `subject_quarter_weights` (0020) and the subject settings screen. The choice of weights and of the rating exam column per journal (`apps/api/src/modules/journal`, `results`). The quarter close checklist, the publish check, the refusal of a grade 4–5 group, and recalculation of the prepared totals (9.3b) when the setting changes.
