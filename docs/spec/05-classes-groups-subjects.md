# Classes, groups and subjects

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

A class is where a student belongs; a group is where a student studies one leveled subject. Subjects carry the grading weights that the journal uses.

| Object | Fields | Rules |
| --- | --- | --- |
| Class | Grade (1–11), name (Oxford, Princeton), language of instruction (Uzbek or Russian), tutor, main classroom, maximum size, academic year. A class is shown as grade and name: 7 Oxford. | A student is in exactly one class at a time. There are no class codes such as 7-A. The name is unique within a branch, grade and year. |
| Group | Subject, grade, name (7-M-1), language, teacher, maximum size. | Two kinds. A group across classes takes students from several classes of one grade (7-M-1, or a third English group made from 1 Oxford and 1 Princeton). A split divides one class into parts for one subject (boys and girls for physical education, group 1 and group 2). Whether a class is split for a subject is set in the teaching load; the subject's group switch is only the default. Every student of the classes involved must be in exactly one group for that subject; the screen lists students not yet placed. |
| Subject | Name in three languages, colour, department, grades, rating exam switch, group subject switch, active switch, journal type (graded or attendance only), daily distribution, quarterly distribution, language rule switch (on by default). | Inactive subjects do not appear in pickers. Subjects with data are archived, not deleted. |
| Teaching load | Class or group, subject, one teacher, lessons per week, the room or room type if a special one is needed, whether double lessons are allowed. | The journal for that class or group and subject is created when the timetable version containing the row is published. Only teachers whose profile has the subject and grade, and the language of the class or group where the language rule applies, can be chosen. |

- Class cards show grade, name, language, number of students, tutor, main classroom, and the current quarter's average and attendance. Group cards show grade, name, number of students, language, teacher, and the same two figures. Both have Edit and Archive.
- A bulk screen places students into classes, and into groups for one grade and subject at a time, without opening each profile.

## Language of instruction

- **Classes.** Every class is an Uzbek class or a Russian class. The Academic Vice Principal sets this when the class is created. It is shown on the class card and is a filter wherever classes are listed.
- **Teachers.** A teacher's profile lists the languages they can teach in: Uzbek, Russian, or both. It is required for anyone who has subjects.
- **The rule.** In the teaching load a teacher can be given a class or group only if they can teach in its language. This is blocked, not a warning. The same holds when a Tutor is given a class.
- **Subjects outside the rule.** Each subject has a "language rule" switch, on by default. It is switched off for subjects taught in another language whatever the class, for example English, IELTS and SAT. With the switch off, any teacher of the subject can take any class.
- **Groups.** A group takes its language from its classes when they share one. A group that mixes Uzbek and Russian classes is possible; the Academic Vice Principal then chooses the group's language and confirms a warning. For subjects outside the rule there is no warning.
- **Substitution.** For a lesson where the rule applies, teachers who cannot teach in its language are listed last and marked. Choosing one needs a confirmation.
- **Lesson plans.** A shared plan can join only classes with the same language. A master plan is kept per subject, grade and language.
- **Students.** Moving a student between an Uzbek class and a Russian class asks for confirmation.
- **Reports.** Language is a filter in class lists, results, rating and analytics.
- **The list.** The languages are Uzbek and Russian. The Super Admin can add another later.

## Grading weights on a subject

| Distribution | Parts | Used for | Example from the school's notes |
| --- | --- | --- | --- |
| Daily | Attendance, classwork, homework | The score of one lesson for one student | Set in the subject's settings by the Academic Vice Principal. Required for graded subjects; there is no system default. |
| Quarterly, rating subject | Attendance, classwork, homework, rating exam | The quarter result | A 10 · CW 30 · HW 20 · RE 40 |
| Quarterly, other subject | Attendance, classwork, homework | The quarter result | A 10 · CW 50 · HW 40 |

- Each distribution must total 100. The form will not save otherwise.
- The quarterly distribution is set for each quarter separately, so quarter 1 can differ from quarter 2.
- A subject without a rating exam has no rating part, and its journal has no rating exam column.
- Weights of a quarter can change until the quarter is closed. Each change is logged and results are recalculated at once.
- "Attendance only" subjects have a journal with attendance and comments but no marks. Ma'naviyat soati and the Homework slot are attendance only.
