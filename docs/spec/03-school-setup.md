# School setup

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

Setup is done once per branch and then drives every other screen. Super Admin owns the structure; the Academic Vice Principal owns the calendar and lesson times.

| Item | Fields and rules | Owner |
| --- | --- | --- |
| Branch | Name, address, working weekdays, contacts. Every record belongs to one branch. | Super Admin |
| Building, floor, room | Rooms are added floor by floor. Room: name or number, floor, type (classroom, laboratory, sports hall, hall, other), capacity, status (in use, under repair, closed). | Super Admin |
| Division | One list for the whole school; see Divisions below. Every staff record has a main division and can have further divisions. Academic is built in. | Super Admin |
| Department (kafedra) | Inside Academic: STEAM, Foreign languages, National, Natural sciences, General, Tutors. A department groups subjects and teachers. It has no head, except Tutors, whose head is the Head Tutor; Head Teachers are appointed to subjects (see Roles and access). Other divisions may have departments too; there they are only groupings. | Super Admin |
| Academic year | Start and end date. Status: planned, current, closed. Exactly one current year per branch. | Super Admin |
| Quarters | Four per year, each with start and end. No overlaps, no gaps inside teaching time. Months are derived from dates. | Academic Vice Principal |
| Academic calendar | Days off (holidays, vacations) and special days: shortened day, exam week, open-doors day, a working Saturday. Each date resolves to "no lessons" or to one day template. | Academic Vice Principal |
| Slot types and day templates | Slot types and day templates belong to a branch and are set by that branch's Academic Vice Principal, so branches can differ: one may use 45-minute lessons and another 40. A slot type has a name, a kind (lesson or break) and a length in minutes: for example Lesson 45, Break 15, Long break 20, Lunch 40. A day template is a start time and an ordered list of slots chosen from these types. The Academic Vice Principal adds, removes and reorders slots; every start and end time is calculated from the order and the lengths. Times are never typed by hand, so a lesson can only fill a whole lesson slot. There are no shifts. A branch has a default template; another template can be set for a range of grades inside the branch, for a weekday, for a weekday and a range of grades together, and for a special date in the calendar. For a class on a date, the first of these that applies wins: a special date for its grade range, then a special date for the branch, then weekday with grade range, then weekday, then grade range, then the default. Grade ranges set at one level may not overlap. A template set at any level takes effect from a chosen date, tomorrow at the earliest, and its history is kept; the rule for a change mid-year in the calendar edge cases applies to each. School setup shows the template that results for every weekday and grade in one table; saving a template at any level shows that table with the changes marked, as the preview of the change. | Academic Vice Principal |
| Grade bands | 100-point scale for all grades: 0–49 is 2, 50–66 is 3, 67–83 is 4, 84–100 is 5. | Fixed for the whole school |

## Divisions

A division is the top-level unit a staff member is employed in. The school has eight (decided). The list covers every employee, including those who never sign in; kitchen, security and transport staff are employed by the school. A division is not a reporting line: the psychologist is in Student Services and reports to the Vice Principal for Spiritual and Moral Education. The platform does not record reporting lines.

| Division | Uzbek name | Who belongs | Departments |
| --- | --- | --- | --- |
| Academic | O'quv bo'limi | Teachers, Head Teachers, Senior Head Teachers, Tutors, the Head Tutor, teaching and laboratory assistants | STEAM, Foreign languages, National, Natural sciences, General, Tutors |
| Management | Rahbariyat | Principals, the Academic Vice Principals, the Vice Principals for Spiritual and Moral Education, Super Admins, office assistants | None |
| Student Services | O'quvchilarga xizmat ko'rsatish bo'limi | Nurses and doctors, psychologists, librarians, club leaders, event organisers, the youth leader | Medical, Psychology, Library, Clubs and events |
| Admissions and Marketing | Qabul va marketing bo'limi | Admissions managers, call centre, marketing | None |
| Finance | Moliya bo'limi | Accountants, cashiers | None |
| HR | Kadrlar bo'limi | HR managers | None |
| IT | Axborot texnologiyalari bo'limi | Developers, system administrators, technicians | None |
| Operations | Xo'jalik bo'limi | Cleaners, maintenance, kitchen staff, guards, drivers | Facilities, Catering, Security, Transport |

- **One list.** Divisions are the same in every branch. A staff record has one main division and can have further divisions when the person works in more than one, each with its own department if needed. In lists and reports by division the person appears under each of them and is counted once, under the main division.
- **No rights.** A division gives no access. Access comes only from roles, so a Principal is in Management because of where he works, and can view the branch because of his role.
- **Academic is built in.** It cannot be renamed or archived, because departments, subjects and the teaching load depend on it.
- **Other divisions are data.** The Super Admin adds, renames and archives them. A division can be archived only when no active staff member is in it; it stays on old records.
- **Teaching from another division.** Rare, but possible: a person whose main division is not Academic can teach. They get Academic as a further division with a department, and hold the Teacher role next to their other role. Nobody approves their own request.
- **Names.** Each division and department has a name in three languages.
- **Use.** In Release 1 the division is a column and a filter in the staff list. From Release 3 the HR module reports by division.

* The current academic year and quarter are always shown in the top bar. No page silently opens on another year.
* Lunch is a slot in the day template, not a subject as in myss.uz.
* Changing the calendar or lesson times after the timetable is published regenerates only future lessons that have no data, and lists any lesson that already has attendance or marks.
