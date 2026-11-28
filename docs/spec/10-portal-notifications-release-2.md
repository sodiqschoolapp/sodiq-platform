# Student and parent portal, notifications (Release 2)

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

## What parents see

The first version of the portal is for parents only (owner, 6 November 2026). It is a Telegram mini app inside the school's bot: the platform's own pages at app.sodiqschool.uz, opened from the bot. The same pages also open in any phone or computer browser. It is phone first and read only.

| Page | What a parent sees for each child |
| --- | --- |
| Today | The child's lessons of the day with the mark of each one marked, or the next school day of the week when the day has none; the latest scores saved in the platform (see Grades; never past marks). Each part links to its page. It is the first page a parent opens (owner, 19 November 2026). |
| Timetable | The child's week, with rooms and teachers, and changes marked. |
| Homework | Tasks by the date of the lesson where they were given and by subject, with their titles and the files attached to each homework; never the plan item's materials, which are for staff. Past homework from before go-live is listed with the rest (Past marks from before go-live). |
| Grades | Each score with the work's name and the lesson date (the Today page lists the scores saved last; the moment of saving orders that list and is not shown); past scores from before go-live stand in the same list (Past marks from before go-live) and are in no average or result; the averages and quarter results of each subject as the staff pages show them, the current quarter marked "provisional" until it is closed; the comments marked "visible to parents". |
| Attendance | The child's marks by day and lesson, past marks from before go-live included. An exempt lesson shows as exempt, never as an absence. |

Later in Release 2, not in the first version: the rating (own place and the class average), announcements, the stipend and scholarship history, and the student portal (the same pages for the student's own data).

- A parent sees each linked student whose link has portal access switched on, and switches between children at the top of the page. A link with portal access off shows nothing of that child, in the portal or in the digest, from the next request. A student who left the school is not shown.
- A parent never sees staff-only comments, staff notes, the early-warning list or another student's data.
- Parents change no school data. In the portal a parent changes only their own password, language and digest frequency.

## Past marks from before go-live

A branch that went live in the middle of the year (`edge/academic-year`) can import the attendance, classwork and homework of its lessons before its go-live date, so that parents see them in the portal (owner, 25 November 2026). They are history for parents only: nothing is calculated from them and staff do not see them.

- **The file.** The system's Excel template, downloaded from the import page, with its column headings in Uzbek, Russian and English. One row is one student, one date, one subject: the UID; the student's name, checked against the UID; the date; the subject, by its name in any of the three languages; the lesson, the number of that subject's lesson on that day (1, 2, 3 and so on; empty means 1); the attendance mark (0, 1, 2 or 3, 4 or 5 for exempt, or empty); the classwork title, total and score; the homework title, total and score. A file holds at most 50,000 rows; a branch can import several files.
- **The rules of a row.** A work's three cells are filled together or left empty. The title is at most 60 characters, the total is from 1 to 1000 with at most two digits after the decimal point, and the score is from 0 to the total with at most two digits after the decimal point. A second work of one kind in the same lesson is a further row for the same student, date, subject and lesson, with the attendance empty. Homework stands on the date it was given. The date is before the branch's go-live date, in the current academic year, on a school day of the calendar. The student is a student of the branch of the import. An attendance-only subject takes attendance only.
- **The upload.** By the Super Admin, and by the Academic Vice Principal for their own branch. The upload first shows a preview of every row with its problems. Nothing is saved until every row is clean; confirming checks everything again and saves all rows or none, and the same file is not imported twice while its upload stands. A row that repeats one already imported (the same student, date, subject and lesson, with the same work title, or a second attendance mark) is a problem of the row. The import page lists the uploads: file name, who, when, the number of rows, and whether it stands or was withdrawn.
- **Withdrawal.** The same roles can withdraw an upload whole, with a reason; its rows are kept, hidden from parents, and a corrected file can be imported again. The upload and the withdrawal are each an entry in the audit log.
- **What parents see.** On the Grades, Attendance and Homework pages, the imported marks, scores and homework titles stand in the same lists and the same form as the platform's own, with no separate label. The percent of a score comes from `packages/calc`, as for any score. A past mark has no teacher, slot or time: it is shown by date, subject and the lesson's number that day.
- **Where they never appear.** Averages, quarter and year results (the start quarter stays labelled "from" its start date, and quarters before it stay "not in the system"), the rating, reports, the early-warning list, the Today page's latest scores, the parents' digest, and every staff screen and export. The one exception is the personal data report (`edge/people-roles-accounts`).

## Signing in

- **Parents** sign in with a login and password, like staff. The account is the relative's Parent account (`04`, Close relatives): one account for one person, whatever the number of children, classes or branches.
- **First password.** The Academic Vice Principal (own branch) and the Super Admin print first-password slips class by class, four slips to an A4 page, as for the staff import; the student takes the slip home, or it is handed out at a parents' meeting. The first password is random (ten lowercase letters and digits without look-alikes, printed in two groups of five), valid for 30 days, printed once and not stored, and changed at first sign-in. Details in `edge-cases/close-relatives.md`.
- **Forgotten password.** The Academic Vice Principal of a branch where one of the parent's children studies, or the Super Admin, resets it and prints a new slip.
- No two-step sign-in, no SMS and no sign-in code for parents. The attempt limit and the rules on passwords and sessions are the staff rules.
- **Telegram.** The parent opens the mini app from the school's bot and signs in once with login and password. This links that Telegram chat to the parent account. While the link holds, opening the mini app from that chat opens the parent's pages without the password; the server checks Telegram's signature every time it is opened. One account is linked to one chat, and one chat to one account. The link ends on sign-out in the mini app, a password change or reset, an administrator's "unlink Telegram", and when the account can no longer sign in.
- A parent session never carries staff rights. A staff member who is also a parent has two accounts, each with its own login.
- **Students** have no sign-in in the first version of Release 2. Student accounts stay switched off until the student portal is planned.
- **Staff** sign in with a login and password. Two-step sign-in is required for the Super Admin and Academic Vice Principal and optional for others.

## The parents' digest

Parents receive notices as messages from the school's bot, gathered in a digest, not as one message per event.

- **Frequency.** Each parent chooses in the portal: daily at 19:00; twice a week, Wednesday and Saturday at 19:00; or once a week, Saturday at 19:00; in the school's time zone (Tashkent). Until a parent chooses, twice a week. The Super Admin sets the time of day for the whole school.
- **What it holds.** One message per parent, with a part for each child whose link has both portal access and "receives notices" switched on (both are on by default for every link), covering what was saved since the parent's previous digest (the first digest covers what was saved since the chat was linked):
  - attendance: a summary line, always, for the lessons held in the period ("Attended all 20 lessons on time", or "Attended 18 of 20 lessons"), then each absence and each late arrival, with the subject and the lesson date (exempt lessons are never listed or counted as missed);
  - grades: each score entered or changed in that time, with the subject, the work's name, the lesson date and the score as it stands when the digest is sent;
  - comments marked "visible to parents", with the subject and the date.

  A score, mark or comment that was in an earlier digest and was changed or removed since appears again, marked "corrected" or "removed". The period is by the moment an entry was saved, not by the lesson date, so a mark entered late still reaches the parent once. A button opens the portal. Past marks from before go-live are never in a digest.
- **Nothing new:** no message is sent when no lesson was held and nothing was saved for any of the parent's children.
- **Who gets it.** Only a parent whose Telegram chat is linked. A parent without Telegram sees the same things in the portal in a browser.
- **Privacy.** Each message is checked again just before it is sent: a child whose link lost portal access or "receives notices", or who left the school, is taken out. The digest names a child by first name and class only and holds no phone, document or address.
- **Language.** The parent's language (Uzbek, Russian or English), chosen in the portal; Uzbek until chosen. Messages come from templates in the three languages.
- **Sending.** Through a queue with retries, so a failing Telegram never slows a page or a save. No message at night: the quiet hours are set by the Super Admin (21:00 to 08:00 by default), and a digest not delivered before they start is sent when they end. Every digest is kept in a send log (to whom, for which children, when, delivered or not) that the Super Admin can read.

## Notifications to staff

| Event | Sent to | Channel |
| --- | --- | --- |
| Timetable change for today or tomorrow | Teachers affected | In the app |
| Substitution assigned | The substitute teacher | In the app |
| Student absent or skipped a lesson | Tutor | In the app, once per day |
| Lesson about to lock with data missing | Teacher | In the app |
| Lesson unlock requested or granted | Head Teacher, teacher | In the app |
| Lesson plan window opened or about to end; edit request approved or refused; plan moved because a lesson was cancelled | Teacher | In the app |

- Messages are written from templates in Uzbek, Russian and English and shown in the language each person chose. Each staff member can turn off notices for events that are not required. Parents cannot turn off the digest or the announcements sent through the bot (owner, 7 November 2026): every parent whose link has portal access and "receives notices" on gets them. Only the school switches "receives notices" off for one link, for example for a relative listed only for emergencies (`edge/close-relatives`).
- Parents get no single message for school data: no instant message for an absence, a timetable change or quarter results, and no SMS (owner, 6 and 7 November 2026). Attendance, grades and comments reach parents only in the digest and the portal. Announcements to a chosen audience may reach parents through the bot (`11`, Announcements and events).

Staff notifications in the app (timetable changes, substitutions, locks, plan windows) are part of Release 1. The parent portal, the bot and the digest come in Release 2.
