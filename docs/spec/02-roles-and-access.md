# Roles and access

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

There are 15 user types. One person has one account and can hold several roles (for example Teacher, Tutor and Head Teacher); a role switcher in the top bar changes the menu and home page.

| Role | Sees | Can do |
| --- | --- | --- |
| Super Admin | All branches | Everything every other role can do, including entering exemptions, closing quarters and every other action of the Academic Vice Principal. Only this role creates branches, buildings, floors and rooms, divisions, roles and permissions, academic years, and awards the quarterly stipend. Only this role can force-delete. At most 3 accounts. |
| Principal | Own branch, everything | Views everything in the branch: timetables, all journals, lists, analytics. Changes nothing. |
| Academic Vice Principal | Own branch | Full edit of students, classes, groups, subjects and their weights, academic calendar, slot types and day templates, timetable. Grants exemptions. Opens the lesson plan window and can approve any plan edit request. Sees the teacher list and all journals; can correct a journal with a recorded reason. Closes quarters. Analytics. Creates, edits, fills and closes vacancies (People, "Vacancy"); they are planning records, not accounts. |
| Vice Principal for Spiritual and Moral Education | Own branch | Views attendance for all classes and attendance analytics. Events in Release 2. |
| Head Tutor | Own branch | Views all classes, their tutors and attendance by class and by tutor. |
| Tutor | Own class or classes; student list of the branch | Views the full student list of the branch (view only) and the profiles of own class. Sees the school timetable and the timetable of own class, attendance per lesson and daily attendance in percent. Has own Ma'naviyat soati and Homework slot lessons. Records the reason for an absence, without changing the mark. |
| Senior Head Teacher | Own subjects in all branches | Everything a Head Teacher can do, for the subjects given to them, in every branch. Sees the Head Teachers of those subjects and the requests waiting for them. Can keep a master plan for all branches. Also works as a Teacher. |
| Head Teacher | Own subjects in own branch | Oversees the subjects given to them in a branch. Full student list across classes and groups. Views journals and lesson plans of those subjects, and the timetables of the teachers who teach them. Moves students between groups of those subjects. Approves unlock requests and requests to edit a lesson plan after the window, for those subjects. Keeps master plans. Also works as a Teacher. |
| Teacher | Own lessons | Own timetable. Journals of own classes and groups: attendance, marks, comments. Rating. Lesson plans. |
| Student | Self | Own timetable, attendance, marks, homework. Release 2. |
| Parent | Own children | The same for each child, plus notifications. Release 2. |
| HR, Nurse, Psychologist, Librarian | Own branch | Own module. Release 3. |

## Head Teachers and Senior Head Teachers

- **Subjects, not departments.** A Head Teacher oversees a list of subjects in one branch. The Super Admin makes the appointment and chooses the subjects: for example one Head Teacher for IELTS, General English and SAT, and another for Mathematics and AP Calculus. The subjects may come from different departments.
- **One per subject per branch.** A subject in a branch has at most one Head Teacher, so every request has one clear approver. A subject can have none.
- **Scope.** For own subjects in own branch: journals, lesson plans, groups, the early-warning list, and the timetables of the teachers who teach them. A teacher of Mathematics and Physics is seen by the Mathematics Head Teacher only in Mathematics.
- **Senior Head Teacher.** Appointed by the Super Admin with a list of subjects, which can be all subjects. A Senior Head Teacher sees and does everything a Head Teacher can for those subjects, in every branch, and chooses the branch with a filter.
- **Who approves.** A teacher's unlock or plan request goes to the Head Teacher of the subject in that branch. The Senior Head Teacher of the subject and the Academic Vice Principal of the branch see it too, and either can decide it. With no Head Teacher it goes to those two.
- **Own requests.** Nobody approves their own. A Head Teacher's own go to the Senior Head Teacher of the subject or to the Academic Vice Principal. A Senior Head Teacher's own go to the Academic Vice Principal of the branch where the lesson is. An Academic Vice Principal's own go to the Super Admin.
- **Departments stay.** A department groups subjects and teachers, and a teacher's subjects come from one department. It has no head, except Tutors, whose head is the Head Tutor.
- **Changes.** Appointments carry dates. When a subject passes to another Head Teacher, its open requests pass with it.

## Rules

- Every role is limited to a branch, and where it applies to subjects, a class or own lessons. Only the Super Admin and the Senior Head Teacher work across branches. The limit is enforced on the server, not only hidden in the menu.
- Permissions are a table: rows are roles, columns are actions (view, create, edit, archive, export) per area. At first the table is fixed in code for the 15 roles. A screen where the Super Admin edits it and adds new roles comes later; it changes where the table is kept, not how the checks work.
- Parents see only their own children. Medical and psychologist records are visible only to the roles that own them.
- Every sign-in, change, archive and export is written to an audit log that nobody can edit.
- There is no open sign-up. Every account is created by an administrator. Staff sign in with login and password and must change the password at first sign-in. Two-step verification is required for the Super Admin and Academic Vice Principal and optional for others. Parents and students sign in by phone number and SMS code from Release 2.
- Admissions manager and accountant, which appear in the older documents, are not created now.

## Accounts and sign-in: build order

Sign-in starts simple and grows. Permission checks do not: they are in place from the first piece of work, because every later screen depends on them.

| When | Sign-in | Permissions |
| --- | --- | --- |
| From the first piece of work | Accounts created by an administrator. Login and password. Password change at first sign-in. Password reset by an administrator. Sessions end after a period without use. | Every record carries its branch. Every request passes one permission check on the server. A short list of routes works without sign-in: the health check and sign-in (all its steps), and later password reset by email. Each is declared public in code, and a test holds the exact list. Tests for what each role can and cannot do. Roles and permissions fixed in code. |
| Before the school goes live | Two-step sign-in for the Super Admin and Academic Vice Principal. A limit on failed sign-in attempts. Password reset by email. | No change: roles and permissions stay fixed in code. The permission matrix screen is built after go-live. |
| Release 2 | Phone number and SMS code for parents and students. | Student and parent access switched on. |
