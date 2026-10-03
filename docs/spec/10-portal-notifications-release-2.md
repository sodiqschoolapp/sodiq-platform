# Student and parent portal, notifications (Release 2)

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

## What students and parents see

| Page | Student | Parent |
| --- | --- | --- |
| Timetable | Own week, with rooms and teachers, and changes marked. | The same for each child. |
| Homework | Tasks by date and subject, with files. | The same. |
| Results | Scores by lesson, averages and quarter results for each subject. | The same, plus comments marked "visible to parents". |
| Attendance | Own marks by day and lesson. | The same, with a notice on the day of an absence. |
| Rating | Own place and the class average. | The same. |
| Announcements | School and class news. | The same. |
| Stipend and scholarship | Own history. | The same. |

A parent sees every linked student whose link has portal access switched on, and switches between them at the top of the page. Students and parents cannot change any data.

## Signing in

- Students sign in with their own phone number and a code sent by SMS. A student without a phone gets a UID and password from the school, changed at first sign-in.
- Parents sign in with the main phone of their close-relative record and a code sent by SMS. No password to forget.
- Staff sign in with a login and password. Two-step sign-in is required for the Super Admin and Academic Vice Principal and optional for others.

## Notifications

| Event | Sent to | Channel |
| --- | --- | --- |
| Timetable change for today or tomorrow | Teachers, students and parents affected | In the app, SMS for same-day changes |
| Substitution assigned | The substitute teacher | In the app, SMS |
| Student absent or skipped a lesson | Parent, Tutor | In the app, SMS once per day |
| Lesson about to lock with data missing | Teacher | In the app |
| Lesson unlock requested or granted | Head Teacher, teacher | In the app |
| Lesson plan window opened or about to end; edit request approved or refused; plan moved because a lesson was cancelled | Teacher | In the app |
| Quarter closed, results final | Students, parents | In the app |
| Announcement | Chosen audience | In the app, optional SMS |

- Messages are written from templates in Uzbek, Russian and English and sent in the language each person chose.
- Sending goes through a queue with retries, so a failing SMS provider never slows a page.
- No SMS at night; the hours are set by the Super Admin. Each person can turn off channels for events that are not required.
- A Telegram bot can be added as a cheaper channel than SMS.

Staff notifications in the app (timetable changes, substitutions, locks, plan windows) are part of Release 1. SMS and the portal come in Release 2.
