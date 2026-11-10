# Edge cases: definitions used by every rule

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

This section lists what can happen outside the normal flow, each with the rule that settles it. It comes from six independent reviews of this spec, one per area, each hunting for gaps. Where a rule here is more specific than an earlier section, this section applies. Rules marked "proposed" need the school's confirmation and are listed again under Open questions.


These words are used throughout the spec. Each has one meaning, written once in the code and used by the timetable, the journal and the lesson plans alike.

| Term | Meaning |
| --- | --- |
| Branch time | Each branch has a time zone (Asia/Tashkent). Every date and time rule uses the branch's local time and the server's clock. The clock of a teacher's device is never used. |
| Held lesson | A lesson whose start time has passed, which is not cancelled, and which has a teacher recorded (not "needs a teacher" or "unresolved"). Whether anything was entered does not matter. |
| Data on a lesson | An attendance mark, a number, a total, a "not held" mark or a comment entered by a person. Exemption marks, plan items and one-day changes are not data. |
| Expected student | A student who is a member of the class or group on the lesson's date and is not exempt for that lesson. |
| Previous lesson | For homework: the nearest earlier held lesson of the same journal in the same academic year. Cancelled lessons are skipped; substituted lessons count. |
| Quarter of a lesson | The quarter that contains its date. It is stored on the lesson. |
| Lock moment | 23:59 branch time on the lesson's date plus the edit days (7). Calendar days are counted and vacations do not pause the count. It is fixed per lesson; changing the setting affects only lessons dated after the change. |
| Reference date | For class and group figures: the last day of the quarter, or today while the quarter is open. |
| Result states | A number; "Exempt" (an exemption explains it); "Not assessed" (too little to judge, decided by the Academic Vice Principal); "No result" (nothing was entered). Only a number is graded, averaged or ranked. |
| Tutor of a class | A class of grades 5–11 has a Tutor. A class of grades 0–4 has a Class teacher (Sinf rahbari) in the Tutor's place, and no Tutor. Every rule that names the Tutor of a class, a class's own Tutor, the class Tutor, an acting Tutor, own class of a Tutor, or the Tutor lessons (Ma'naviyat soati and the Homework slot) applies in the same way to the Class teacher of a class of grades 0–4. Rules that name the Tutor role itself (who is given it, who imports it) do not. |
| Rating journal | A journal of a rating subject (one whose rating exam switch is on) in grades 2–11. A journal of grades 0 and 1 of a rating subject has no rating exam column; its quarter result uses the subject's quarterly distribution with the rating exam left out, the other weights scaled up (rule 7). A closed quarter keeps the state it closed with. Every rule that names a rating subject, a rating journal or the rating exam of a journal means a rating journal. |
