# Edge cases: journal

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

## Entering

| Case | Rule |
| --- | --- |
| A student is absent (0) or skipped the lesson (3), and the lesson has a classwork. | The cells stay open, empty by default, and the lesson does not wait for them. A number typed there is accepted, counted and marked "score on an absent student". The system never writes a 0 itself. |
| An attendance mark is changed after numbers were typed. | A mark change never deletes numbers. Changing present to absent with numbers asks "keep or clear", keeping by default; cleared values stay in history. Changing absent to present makes the empty cells waited for, and the lesson status can go back to "in progress". |
| Numbers are typed while attendance is still empty. | They are saved and counted. The lesson stays "in progress" until attendance is marked. |
| A work is marked "not held" after 18 numbers were typed. | A confirmation names the count. The numbers leave the averages and stay in history. Undoing it inside the edit period restores the column, the total and the numbers. |
| Homework given on Monday is not checked on Wednesday but on Friday. | At the check lesson the teacher chooses "not checked" or "check at the next lesson" (once). Carried homework appears at the next lesson as its own column with its title, so a lesson can have two homework columns. |
| A student was exempt, or not yet in the group, when the homework was given. | That student's homework cell is optional: not waited for, no reminder. A number typed there counts. |
| The lesson where homework should be checked is cancelled. | The homework column moves to the next held lesson, as long as it has no numbers yet. |
| Homework on the last lesson of the year, or of a journal that is closing. | Allowed in the plan with the note "will not be graded". It creates no column. |
| A lesson is held with no plan item: the plan is missing or that row is still empty. | The header shows "No plan". The teacher may add one classwork and one "homework given" by hand. They count in averages and are listed as "unplanned" in the journal discipline report. When the plan item is written later, it takes over these titles. This keeps the promise that a missing plan never blocks grading. |
| A teacher wants two graded classworks in one lesson. | A lesson has at most one classwork and one homework given. |
| A total of 3000 is typed, or 30 is changed to 100 after numbers exist. | A total is from 1 to 1000. Changing the total of a work that has numbers shows the percents before and after and asks for confirmation. |
| The teacher types "1" then "2" for 12. | A number is saved when the teacher leaves the cell (Enter, Tab, arrow, click away), not per key. An attendance digit saves at once and moves down. Letters, decimals and numbers above the total are refused in the cell. |
| Mark 0, "absent from school", is typed for a student who was present earlier that day. | A hint is shown and the day is listed for the Tutor. Nothing changes by itself. |
| Two students in the list have the same surname and name. | The paternal name is added; if they are still equal, the UID tells them apart. The UID is always shown in pickers and search. |
| Uzbek names: Oʻktam, Gʻulomov, Shodiyev, and names typed in Cyrillic. | One fixed order (... z, oʻ, gʻ, sh, ch, ng) is used everywhere: grid, exports, prints, in all three languages. Search ignores which apostrophe was typed and matches Cyrillic with Latin. |

## Saving and working together

| Case | Rule |
| --- | --- |
| Two people, or one person on two devices, change the same cell. | Each cell has a version. A save based on an old version is refused, the stored value is kept, and both values are shown for the user to choose. Nothing is overwritten silently. |
| "All present" is pressed a second after someone typed a 0. | "All present" and "not graded" fill only the cells that are empty at that moment and report the ones they skipped. They are one action, not thirty separate saves. |
| Undo. | It covers the user's own last action on the page: one cell or one bulk action. It applies only to cells nobody changed since and only while the lesson is editable. It is recorded in history. |
| Entries typed with no connection arrive two days later. | They are judged at the moment the server receives them, each one like a live save. Valid ones are saved. The others stay on the device in a "not saved" list with the reason and are never dropped. An entry refused because of a lock can be attached to an unlock request. |
| Another teacher signs in on the same computer while entries are unsent. | The unsent list belongs to the account. It survives a reload and a new sign-in and is never sent under another account. The same entry sent twice is counted once. |
| The session expires in the middle of a lesson. | Entries go to the unsent list, a sign-in box opens over the page, and they are sent after the same person signs in. Idle sessions end after 30 minutes, 15 for the Super Admin and Academic Vice Principal. On a trusted device there is no idle sign-out; see "Trust this device" under People, roles and accounts. |
| A laptop wakes up showing data from 40 minutes ago. | The page fetches the changes before it accepts input, and shows "not live" while the connection is down. |

## Locks, unlocks and corrections

| Case | Rule |
| --- | --- |
| A teacher needs to fix a lesson from 12 days ago. | The teacher sends an unlock request for that lesson with a reason. The subject's Head Teacher, its Senior Head Teacher or the Academic Vice Principal approves and sets 1 to 7 days. The unlock covers that lesson and that person only. Entries made under it are marked "entered after the edit period" with the approver's name. |
| A Head Teacher unlocks their own lesson. | Nobody approves their own request. The check is on the person, whatever role they are using. A Head Teacher's own lessons go to the Senior Head Teacher of the subject or to the Academic Vice Principal; a Senior Head Teacher's own go to the Academic Vice Principal of that branch; an Academic Vice Principal's own go to the Super Admin. |
| The Academic Vice Principal corrects a mark. | No unlock is needed. It works only in open quarters, needs a reason, shows a marker in the cell and notifies the teacher with the old and new value. It does not count against the teacher. |
| A teacher is replaced from Monday with four incomplete lessons last week. | The new teacher may edit any lesson that is not yet locked. The earlier teacher keeps their own lessons until they lock, while their account is active. |
| A teacher leaves the school with incomplete lessons. | They go to an "orphan lessons" list. The Academic Vice Principal assigns a teacher to complete them, with a reason. |
| An exemption is shortened and cells reopen in lessons that are already locked. | Those cells open for 3 days, for those cells only. They are optional: the lesson's status does not change. The teacher gets one notice, "reopened after exemption". |
| A Tutor's own Ma'naviyat soati lesson locks incomplete. | The Academic Vice Principal unlocks it. The Head Tutor sees the Tutors' journal discipline, read only. |
| A Tutor opens the journal of a group that mixes three classes. | The Tutor sees only the rows of their own class. The group's averages are hidden for them. |
| A Tutor records why a student was absent. | The reason is its own record per student and date: a category (illness, family, permitted by the school, unexcused, unknown), a text and an optional file. It never affects a calculation. The class Tutor and the Academic Vice Principal can edit it until the quarter closes. Teachers see the category only. |

## Closing and reopening

| Case | Rule |
| --- | --- |
| The quarter is closed on its last day while last week's lessons are still inside their 7 days. | The checklist shows "lessons still inside the edit period" and how many are incomplete. This blocks closing until they lock, unless the Academic Vice Principal chooses "lock now and close", which is logged and tells the teachers. |
| Close is pressed while saves are still arriving. | The quarter first becomes "closing" and refuses new entries from that instant. Final results are calculated from the raw entries. Only then is it "closed". If anything fails, it returns to open and nothing is stored. |
| A closed quarter must be reopened to fix one mark. | Reopening is for one journal or the whole branch, for a set number of days. Lessons stay locked; only corrections and explicit unlocks apply. The earlier final results are kept as a version. Closing again lists every result that changed. Quarters are closed in order. |
| The stipend list was already confirmed for a quarter that is reopened. | Awards are never changed automatically. Affected awards are flagged for the Super Admin, who is the only one who can reopen that quarter. |
| A mistake is found in a closed year. | A closed year is not reopened. The Academic Vice Principal files a correction with the cell, the new value, a reason and a document, and the Super Admin confirms it. A new version of the final results is stored beside the old one. |
| A results table is exported in week 6 and passed around as final. | Every export and print states "Provisional" with date and time, or "Final" with the closing date and version. |
| "My grade disappeared." | History records who changed a value and how (teacher, late entry, correction, exemption, transfer, cancellation, "not held", offline entry), and also what hid it. A support view for one student, journal and date shows every save, every refusal and every such event in order, with how the result was calculated. |

## Attendance figures

| Case | Rule |
| --- | --- |
| Daily attendance percent of a class. | Cells marked present or late, divided by all marked cells of non-exempt students that day, over class and group lessons. Unmarked cells are left out of both and shown as a separate count. |
| "Absent now" on the Tutor's page. | Students whose latest marked lesson today is 0 and who are not exempt now. |
| "Three absences in a row". | Three held lessons in a row of one journal marked 0 or 3. Exempt and cancelled lessons neither break nor extend the run. |
