# People

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

Every student and staff member has one profile that keeps its full history. Records with data are archived, never deleted.

## Student record

| Block | Fields |
| --- | --- |
| System | UID from the school's unified UID system: seven digits, for example 2607001 (the main file writes it as SI2607001). The first four digits are the set of the student's grade; the last three are a number inside the set. See UID sets below. In Release 1 it is typed by hand when the student is created; the system checks that it is filled, has seven digits and is not already used. From Release 2 the system takes the next free number of the grade's set. Shown on the profile and in every list. |
| Personal | Photo, name, surname, paternal name, sex, date of birth, passport or ID with JSHSHIR or birth certificate number, phone, email, address (optional), region, previous school, diagnostic test score. |
| Close relatives (at least one, required) | Full name, relationship (father, mother, grandfather, grandmother, uncle, aunt, brother, sister, guardian, other), main phone, workplace, email. A relative is a separate record that can be linked to several students; see Close relatives below. |
| Contract | Contract number and contract date, both required. |
| Academic | Class, groups, tutor and main classroom (both come from the class), transfer history. |
| Payment | Scholarship type and amount. Stipend history (filled from Release 2). |
| Medical | Filled by the nurse module in Release 3. |
| Status | Active: studying at the school, including while exempt. Inactive (archived): left the school entirely; all data is kept and the student can be brought back. Graduated. |

- Student list columns, in this order: checkbox, number, photo, UID, name and surname, class (grade and name, for example 7 Oxford), groups, tutor, status. A last column shows the current quarter's attendance percent and average.
- Filters: grade, class, group, status, language. Search by name or UID. Phone numbers are not shown in the list.
- Bulk actions on ticked rows: put into a class, put into a group, archive, export.
- Excel import is not built for now. The school will give the import format for each feature that benefits from one, and each import is added then. Until then students are entered by hand, with the bulk screens for placing them. Export to Excel is available from the start.
- Profile tabs: Overview, Results, Attendance, Exemptions, Timetable, Relatives, Contract and scholarship, History, Comments.

## UID sets

The school has one UID system for all branches ("Yagona UID tizimi"). Each grade has a set for the academic year: four digits, followed by a number from 001 to 999.

| Grade in 2026–2027 | Set |
| --- | --- |
| 1 | 2601XXX |
| 2 | 2602XXX |
| 3 | 2603XXX |
| 4 | 2604XXX |
| 5 | 2605XXX |
| 6 | 2606XXX |
| 7 | 2607XXX |
| 8 | 2507XXX |
| 9 | 2407XXX |
| 10 | 2307XXX |
| 11 | 2308XXX |

- A new student receives a UID from the set of the grade they join.
- A UID stays with the student for good. It does not change when the student moves up a grade, changes class or branch, or leaves and returns, and it is never given to another student.
- A set belongs to the students who are in a grade together and moves up with them: the set 2607 will serve grade 8 in 2027–2028, and a new set is opened for the new grade 1 (my reading of the table; to confirm).
- **Release 1.** The UID is typed by hand. The system refuses an empty UID, one that is not seven digits, and one that is already used. If its first four digits are not the set of the student's grade, it warns and lets the person confirm, because a student who repeated a grade keeps a UID from another set.
- **Release 2.** The Super Admin keeps the table of sets for each academic year. When a student is created, the system offers the lowest free number in the set of the student's grade and reserves it in the same step as the save. At year rollover the sets move up with their grades and a set for the new grade 1 is proposed for confirmation. When a set is full, the system says so and the UID is typed by hand.

## Close relatives

A close relative is a person record of its own, not a set of fields inside the student. One relative can be linked to several students, and one student can have several relatives. In the platform a relative is a "Parent": the relative list, the relative's page and the relative's account are the Parent list, Parent page and Parent account, whatever the relationship. An elder brother added as a relative has a Parent account like a mother or father.

| Field | Rule |
| --- | --- |
| Full name | Required. |
| Main phone | Required, except for a relative recorded with "no phone of their own" (see Edge cases). Unique: no two relatives can have the same main phone. Stored in international format, +998 by default; other country codes are accepted. |
| Workplace | Optional. |
| Email | Optional. |
| Relationship | Required. Kept on the link between the relative and each student, so the same person can be father of one student and uncle of another. |

- **Always connected.** A student cannot be saved without at least one relative, and the last relative of a student cannot be removed. The same rule will apply to an import when one is added.
- **Adding a relative.** The phone is typed first. If a relative with that phone already exists, the system shows the person and links them to the student; a second record is not created. If not, a new relative is created.
- **Changing a phone.** If the new number already belongs to another relative, the change is refused and that relative is shown.
- **Main contact.** One relative of each student is marked as the main contact and receives notices first.
- **Relative's page.** Shows the relative's data and all linked students. Editing the phone or name here changes it for every linked student.
- **Finding relatives.** The Academic Vice Principal has a Relatives list with search by name and phone. The student's Relatives tab shows the linked relatives.
- **Removing a link.** Unlinking a relative from one student does not affect their other students. A relative with no linked students is archived.
- **Parent account.** In Release 2 the relative record becomes the parent account: the relative signs in with the main phone and sees every linked student whose link has portal access switched on. This is why the phone must be unique.

## Teacher and staff record

| Block | Fields |
| --- | --- |
| Personal | Category (Tutor, Teacher, Head Teacher, Senior Head Teacher), photo, full name, sex, date of birth, education level, phone, email. Staff ID generated automatically (example SI-001). |
| Academic | Branches: one main branch and any further branches where the person works. Division: one main division and any further divisions. Department: required in Academic, optional in other divisions; a teacher's subjects come from one department. Subjects, each with the grades taught (multiple). Languages of instruction: Uzbek, Russian or both. Classes taught, filled from the teaching load. Admission date. Contract type (full or part time) and date. |
| Availability | Days and hours the teacher is at school, entered for each branch where they work. Used by the timetable. |
| Status | Active, inactive, left. |

- Teacher list columns: checkbox, number, photo, name, ID, category, branches, department, subjects, grades (7-sinf, 8-sinf), languages of instruction, phone, status. A last column shows the quarter average of the teacher's students.
- Excel export as for students. An import is added later, in the format the school gives.
- In Release 1 the Super Admin creates staff accounts; the Academic Vice Principal sees the teacher list. HR takes this over in Release 3.

## Movements

- **Class transfer and group transfer.** One action with an effective date. The student's past attendance and marks stay where they were entered, and results follow the student (see Journal). The profile History tab shows each move with dates. Head Teachers move students between groups of their subjects; class transfers are done by the Academic Vice Principal.
- **Leaving the school.** Asks for confirmation, date and reason. The student becomes inactive (archived): taken out of classes and groups from that date, signed out everywhere, and kept in the Inactive list with all data (profile, relatives, results, attendance, history). **Coming back.** A returning student is restored from the Inactive list with the same UID and full history, and is placed in a class from the return date. Journals take the student from that date; everything earlier stays readable in the profile.
- **Graduation.** Grade 11 students are marked graduated when the year closes.
- **Year rollover.** A guided step at year end creates next year's classes (7 Oxford becomes 8 Oxford: the name stays and the grade goes up), moves students, and makes last year's journals read only.
- **Archive.** Students, staff, classes, groups and subjects have Archive instead of Delete once they hold any data.
