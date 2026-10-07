# Open questions

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

Open: question 12. It has a proposed answer written into the spec until it is decided. The decided ones are kept as a record.

| No. | Question | Answer | Status |
| --- | --- | --- | --- |
| 1 | Is Ma'naviyat soati graded, or attendance only? | Attendance only. | Decided |
| 2 | What is a late arrival worth in the attendance average? And a skipped lesson (mark 3)? | Late 50, skipped 0. Both can be changed in settings. | Decided |
| 3 | Is an empty score left out of the average, or counted as 0? | Left out. The teacher types 0 for work not done. | Decided |
| 4 | What is the daily distribution across attendance, classwork and homework? | Set in the settings of each subject. No system default. | Decided |
| 5 | What are the quarterly weights? | Set and editable in the settings of each subject. A new subject starts with 10 · 30 · 20 · 40 (rating subject) or 10 · 50 · 40. | Decided |
| 6 | How is the year result calculated? | The mean of the four quarter results. | Decided |
| 7 | Does "qarzdorlik" mean homework debt, payment debtors, or both? | Both are removed. | Decided |
| 8 | How many days may a teacher edit a lesson after it? | 7 days, then unlock by the Head Teacher or Academic Vice Principal. | Decided |
| 9 | Can a student be transferred on any date? | Any date. | Decided |
| 10 | What are the stipend rules? | The Super Admin sets the rule each year; the system only prepares the list. | Decided |
| 11 | What can the Head Tutor do? Can a Tutor record the reason for an absence? | The Head Tutor views all classes, their tutors and attendance. Since 7 October 2026 also the school timetable and the timetable of every class, the student list of the branch and a student's profile (Overview, Attendance, Timetable and Relatives), view only (roles table). A Tutor records reasons. | Decided |
| 12 | Are the ID formats right: seven-digit UIDs from the unified UID system for students, SI-001 for staff? | Decided for students: seven digits, the set of the grade plus a number (2607001), typed by hand in Release 1 and taken from the grade's set by the system in Release 2. To confirm: whether the letters "SI" in the main file are part of the UID, and that a set moves up with its grade each year. Still open for staff: proposed is one school-wide counter with at least four digits (SI-0001). | Open |
| 13 | Do students and parents need to sign in from the first release? | No. Release 2. | Decided |
| 14 | What should be moved from myss.uz? | Nothing now. Import is done later, on request. | Decided |
| 15 | Which SMS provider does the school use? Is a Telegram bot wanted? | To be given by the school before Release 2. | Decided |
| 16 | Can one class or group have two teachers in the same lesson? | No. One teacher per lesson. Splits into groups cover the cases in the sample timetable. | Decided |
| 17 | Is the homework score entered on the day the homework is checked, or on the day it is given? | On the day it is checked. | Decided |
| 18 | Can the number typed for a work have a decimal? | No. Whole numbers only. | Decided |
| 19 | Do branches and grades use different day templates? | Each branch has its own slot types and templates. Inside a branch, a range of grades can have its own template. | Decided |
| 20 | Which preferences should the timetable generator follow? | The eight listed under Auto-generation, with weights set by the Academic Vice Principal. | Decided |
| 21 | How early can a permanent timetable change start? | Tomorrow at the earliest; next Monday is offered by default. A change for today is a one-day change with a reason. | Decided |
| 22 | What happens when an exemption leaves a student with few lessons in a quarter? | Under one third of the quarter's lessons, the result is flagged and the Academic Vice Principal keeps the number or sets "Exempt". With no lessons the result is "Exempt". | Decided |
| 23 | What does the student status "inactive" mean? | Inactive and archived are the same: the student left the school, data is kept, and the student can be brought back. An exempt student is active. | Decided |
| 24 | Can an exemption cover only some lesson slots of one day, and can a Tutor request one? | Chosen lesson slots of one day are allowed. Exemptions are entered by the Academic Vice Principal, and by the Super Admin, who can do everything. There are no requests from Tutors. | Decided |
| 25 | How long does a lesson plan stay open after an approved edit request? | The approver sets the number of days when approving. Nothing opens without an approved request. | Decided |
| 26 | Is a lesson plan required for every subject? | No plan for the Homework slot and Ma'naviyat soati. Required for all other subjects. | Decided |
| 27 | What happens to plan items pushed past the end of the quarter? | They go to a "not covered" list, and the teacher deals with them through an approved edit request. | Decided |
| 28 | Do any teachers or other staff work in two branches? | Yes. A teacher can teach in several branches: one account, availability per branch, clash checks across branches, and travel time between branches. See Timetable, Teachers who work in several branches. | Decided |
| 29 | Does the school use alternating (odd and even) weeks? | No. Alternating weeks are not built: every week follows the same timetable. | Decided |
| 30 | When the Academic Vice Principal is away, who grants exemptions, opens the plan window and closes the quarter? | The Super Admin, who can do everything the Academic Vice Principal does. For a longer absence he can give the Academic Vice Principal role to the stand-in's own account. No separate "acting" role is built. | Decided |
| 31 | Two parents share one phone. How is the second recorded? | As a relative with no phone of their own: no sign-in, no notices. | Decided |
| 32 | Is the year result the mean of the exact quarter results, or of the rounded ones shown? | Exact. Quarters of 49.5, 49.5, 49.4 and 49.5 give 49, grade 2, although three of them show as 50. | Decided |
| 33 | Should a result that rests on attendance alone, or on few lessons for any reason, be flagged for a decision? | Yes, with the outcomes "keep", "Exempt" or "Not assessed". | Decided |
| 34 | A student moves between branches mid-quarter. Do the old branch's lessons count in the new branch's result? | No. The old branch keeps a "result at leaving"; the new one calculates from its own lessons. | Decided |
| 35 | Can a day off or a special day apply to some grades only? | Yes. Every calendar entry applies to the whole branch or to a range of grades. | Decided |
| 36 | Can a lesson have more than one graded classwork? | No. One classwork and one homework per lesson. | Decided |
| 37 | Are the 7 edit days calendar days, counting through vacations? | Yes. | Decided |
| 38 | How many years after a student leaves is identifying personal data erased? | Never. Data is always kept. | Decided |
| 39 | When does the school go live: on the first day of a quarter, or on any day? | On any school day, also in the middle of a quarter. The quarter that contains the start date is calculated from that date and labelled. See Edge cases, "The school goes live in the middle of the year". | Decided |
| 40 | Can Head Teachers assign substitutes from the Free now board? | No. They see it read only; the Academic Vice Principal acts. | Decided |
| 41 | Are these limits right: idle sessions end after 30 minutes (15 for the Super Admin and Academic Vice Principal); plan files of at most 20 MB, 10 per item? | The limits as stated. A "Trust this device" switch keeps a browser signed in for 7 days, and within those days the password is not asked again for any action except changing one's own password. The sign-in that starts the trust still asks for the second step. Every session ends 7 days after sign-in at the latest, trusted or not. | Decided |
| 42 | Smaller defaults still marked "proposed" in the text: are they right? | A relative's workplace and email are optional. Each student has one main contact. The generator stops after 5 minutes. The last total a teacher used is offered for the next work. The whole branch closes a quarter in one step. Early-warning thresholds: result below 50, a drop of 15 points, attendance below 80 percent, three absences in a row, five graded works before judging. Starting from a master plan is optional. | Decided |
| 43 | Which divisions does the school have, besides Academic? | Eight divisions: Academic, Management, Student Services, Admissions and Marketing, Finance, HR, IT, Operations. Vice Principals are in Management. There is no separate Spiritual and Moral Education division. See School setup, Divisions. | Decided |
