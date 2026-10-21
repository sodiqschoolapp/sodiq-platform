# School setup

Not written yet for most of School setup: task 3.7 describes what is built so far. This page holds the parts that later tasks added.

## Most lessons in a day for a class

<!-- Sources: spec 06 (Rules: "A class has more lessons in a day than the daily maximum in settings"), edge/timetable (Structure, "Rules refer to settings that no record has"); task 5.2, decision 2 -->

**What it is.** One number per branch: the most lessons a class should have in one day. The timetable marks a class that has more.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | See and change it | Every branch |
| Academic Vice Principal | See and change it | Own branch |
| Principal | See it | Own branch |

**How it works.**

1. School setup → Settings (**Sozlamalar**).
2. In **Lessons of a class per day** (**Sinfning kunlik darslari**), type a number in **Most lessons in a day** (**Bir kundagi eng koʻp darslar**), or empty the field to have no limit.
3. Press **Save**.

**Rules.**

- The number is a whole number from 1 to 12, or empty.
- Empty means no limit: no class is marked.
- One number holds for every class of the branch.
- A split lesson (two groups of one class at the same time) counts as one lesson of the class's day.
- Going over the number is a warning in the timetable, never a refusal.
- Every change is kept in the log with the value before and after.

**What happens if…**

| Case | What happens |
| --- | --- |
| A number below 1 or above 12, or with a fraction, is typed | The form does not save it. |
| The same number is saved again | Nothing changes and nothing is written to the log. |
| The Principal opens Settings | The Principal sees the number, or "Not set", and cannot change it. |
| The Academic Vice Principal of another branch tries to change it | The system refuses. |

**What the person sees.**

- Under the field: "1 to 12, or empty for no limit. A class with more lessons in a day is marked in the timetable."
- For a role that only views it, when empty: "Not set".

Not built yet: the mark on the timetable itself (task 5.4a).

## Changing a length or a day template after the timetable is published

<!-- Sources: spec edge/time-dates-calendar ("A slot type's length or a day template is changed mid-year", "A shortened day", the Friday row), 06 (What a change does to existing data, "Day template changed"; How surprises are prevented, Impact preview), edge/timetable (Versions and drafts; Exams); tasks 5.6b-4a and 5.6b-4b, decisions on pull requests #176 and #178 -->

**What it is.** A new length of a lesson or break, a new version of a day template, a template set for a level, or the end of such a setting, saved from a date while a published timetable already has lessons on the dates it changes. The lessons from that date take the new times.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | Make the change and see its preview | Every branch |
| Academic Vice Principal | Make the change and see its preview | Own branch |
| Principal | See the templates and where they apply | Own branch |

**How it works.**

1. School setup → **Slot types** (**Dars va tanaffus turlari**), **Day templates** (**Kun shablonlari**) or **Where templates apply** (**Shablonlar qayerda amal qiladi**).
2. Make the change with its date: a new length, **New slots or start time from a date** (**Sanadan boshlab yangi slotlar yoki boshlanish vaqti**), **Set a template from a date** (**Sanadan boshlab shablon belgilash**), or **End from a date**, and press **Save**.
3. The preview **The templates after this change** (**Bu oʻzgarishdan keyingi shablonlar**) opens. It shows the table of templates with the changed cells marked and, under it, what the change does to the published timetable:
   - the lessons removed, created and created cancelled, with the reason, and those that will need a teacher;
   - how many teachers are told;
   - the conflicts that stop the save, by date;
   - the lesson slots in use that the change removes or gives another lesson type;
   - the exams on the changed dates, and for a class whose lesson the change puts in a block shared with classes that do not sit, the choice to cancel the whole lesson or keep it for the other classes;
   - the shortened special dates, with the lessons each class keeps, which can be ticked;
   - the one-day changes and bulk cancels of those dates: kept, needs a decision, or dropped.
4. Choose for each item that needs a decision: **Drop the change** (**Oʻzgarishni bekor qilish**) or **Cancel the lesson that day** (**Darsni oʻsha kuni bekor qilish**).
5. Press **Save the change** (**Oʻzgarishni saqlash**), or **Do not save** (**Saqlamaslik**) to go back to the form with nothing changed.

**Rules.**

- The change works from its date, tomorrow at the earliest. Lessons of today and earlier keep their times.
- Lesson slots are matched by their number in the day: lesson 3 before the change is lesson 3 after it, at its new time.
- A lesson number the published timetable uses on a weekday cannot disappear from that weekday's day. The change is refused, with the grade, weekday, lesson number and dates.
- In a new version of the same template, a used lesson number cannot get another lesson type. The change is refused the same way.
- A setting that gives a grade another template is refused only for a used lesson number that template lacks.
- Everything else takes the new times: breaks, the start of the day, lengths, and lesson numbers no lesson uses.
- Every changed date is checked again with all the timetable rules. A teacher, room, class or student that would be in two places stops the save, listed by date.
- One-day changes follow their lessons: a cancelled lesson stays cancelled with its reason, a room change stays, and a moved lesson goes to the new time of its lesson number.
- A bulk cancel cancels the same lesson numbers at their new times, and its choice for a shared block stays.
- Exams follow their lesson slots to the new times and are checked again there.
- Save stays off until every item that needs a decision has a choice and nothing stops the save.
- Each teacher whose lessons change is told once, with the date of the change. The changed lessons carry the "changed" mark.
- The change, the lessons it changes and the one-day changes it moves are kept in the log with the times before and after.

**What happens if…**

| Case | What happens |
| --- | --- |
| A one-day move goes to a lesson number the change removes | The move needs a decision: drop the change, or cancel the lesson that day. |
| A room change meets another lesson in that room at the new time | The room change needs a decision. |
| A lesson moved from a date the change does not touch to a date it touches | The lesson stands at the new time of its lesson number on that date. |
| A lesson moved away from a date the change touches | The lesson stays where it was moved; nothing is added at its old place. |
| A two-grade group whose grades get different times | Its lesson is created cancelled with the reason "not in the day's template" and listed; a one-day change on it is dropped and listed. |
| A special date with fewer lesson slots | The lessons beyond its slots are created cancelled with the reason "not in the day's template"; the lessons each class keeps can be ticked. |
| The timetable changed between the preview and the save | The save is refused; open the preview again. |
| The change touches no date of a published timetable | Only the table of templates is shown, and the save goes on. |

**What the person sees.**

- Over a used lesson slot: "This change removes or reorders a lesson slot that the published timetable uses. Keep the slot, or first publish a timetable version that no longer uses it."
- In the preview, under the lesson slots in use: "The change cannot be saved: keep these lesson slots, or first publish a timetable version that no longer uses them."

## Changing quarter or year dates after the timetable is published

<!-- Sources: spec edge/time-dates-calendar ("Quarter dates are edited after lessons exist", "The academic year is extended or shortened", "Vacations between quarters", "A lesson is moved by a one-day change to a date in another quarter"), edge/00-definitions (Quarter of a lesson), 06 (How surprises are prevented, Impact preview); tasks 5.6b-5a and 5.6b-5b, decisions on pull requests #179 and #180 -->

**What it is.** New dates for the quarters of a year, or for the year itself, saved while a published timetable already has lessons in that year. The lessons follow the quarter dates.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | Change the year's dates; change the quarters and see their preview | Every branch |
| Academic Vice Principal | Change the quarters and see their preview | Own branch |
| Principal | See the year and its quarters | Own branch |

**How it works.**

1. School setup → **Academic years** (**Oʻquv yillari**), and open the year.
2. Press **Change quarters** (**Choraklarni oʻzgartirish**), type the new dates and press **Save**.
3. When the new dates change anything in the published timetable, the preview **What the new quarter dates change** (**Chorak sanalari nimani oʻzgartiradi**) opens. It shows:
   - what stops the save: lessons already held on dates that would change quarter, exams on dates that would leave every quarter, and lessons moved for one day whose two dates would lie in two quarters, each as a line, then "and N more";
   - the dates whose lessons go to another quarter, with the number of lesson times on each;
   - the lessons removed, created and created cancelled, with the reason, and those that will need a teacher;
   - how many teachers are told;
   - the conflicts that stop the save, by date;
   - the exams on the changed dates, and for a shared block the choice to cancel the whole lesson or keep it for the other classes;
   - the shortened special dates, with the lessons each class keeps, which can be ticked;
   - the one-day changes and bulk cancels of those dates: kept, needs a decision, or dropped.
4. Choose for each item that needs a decision, then press **Save the quarters** (**Choraklarni saqlash**), or **Cancel** (**Bekor qilish**) to go back to the form with nothing changed.
5. When the new dates change nothing in the published timetable, no preview opens and the quarters are saved.
6. The year's own dates are changed with **Edit** on the year (Super Admin). That change adds or removes no lesson.

**Rules.**

- A quarter boundary moves only over dates that hold no lesson of today or earlier. A held lesson never changes quarter.
- A past date with no lesson may still change quarter, so a year can be set up before its lessons start.
- A future date that goes from one quarter to another keeps its lessons. They now count in the new quarter. Nobody is told, as nothing changes for a teacher.
- A future date that leaves every quarter (a longer vacation, an earlier end) loses its lessons.
- A future date that joins a quarter (a shorter vacation, a later end) gets lessons from the timetable in force, checked with all the timetable rules.
- A lesson moved for one day keeps its two dates in one quarter. New dates that would split them are refused.
- An exam on a date that would leave every quarter must be cancelled or moved first.
- A longer year gets its lessons through its last quarter: first the year's end moves later, then the last quarter's end. A shorter year is the other way round: first the last quarter's end moves earlier, then the year's end.
- The year's dates cannot leave out an exam of the year, a cancelled one included. The refusal lists the exams.
- Save stays off until every item that needs a decision has a choice and nothing stops the save.
- Each teacher whose week changes is told once, with the first and last date changed.

**What happens if…**

| Case | What happens |
| --- | --- |
| Quarter 1's end moved before a lesson already held | Refused, with the lessons listed by date, class and subject. |
| Quarter 2 starts a week earlier, all after today | The lessons of that week stay and count in quarter 2. |
| The last quarter's end moved earlier over future lessons | Those lessons are removed and listed in the preview. |
| A lesson was moved for one day inside quarter 1, and its old date would now be in quarter 2 | Refused, with the move listed. Take the move back first, or keep both dates in one quarter. |
| The year's end moved before an exam | Refused, with the exams listed; a cancelled exam is marked "(cancelled)". |
| The timetable changed between the preview and the save | The save is refused; save again to see the new preview. |
| Another person saves the quarters at the same moment | One save waits for the other and is checked against its dates. |

**What the person sees.**

- In the preview, under what stops the save: "The new dates cannot be saved: a held lesson keeps its quarter, an exam is cancelled or moved first, and a one-day move keeps its two dates in one quarter."
- Over held lessons in the way: "These quarter dates would move lessons of today or earlier to another quarter, or out of every quarter. Only future dates can change quarter: keep the dates of the lessons listed."
- Over exams outside the year: "An exam of this year would lie outside the new dates. Keep the year around the exam, or change the exam first."

## Deleting a building, floor or room for good

<!-- Sources: spec 03 (Building, floor, room: "The Super Admin's forced delete (06) also removes a building, floor or room that no lesson, timetable entry or other record references, with a reason, an audit entry and 30 days to restore; a referenced one stays archive-only."), 06 (Protection: "Forced delete is for Super Admin only, with a typed reason."); task 5.8c, pull request #196, decisions 1 to 11 and plan review corrections 1 to 3 -->

**What it is.** A building, floor or room added by mistake can be deleted for good when nothing uses it. It is kept for 30 days on the page **Deleted for good** (**Butunlay oʻchirilganlar**) and can be restored there, with the same name and values. Anything in use is archived instead (a building or a floor) or closed (a room).

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | Delete a building, floor or room for good; restore it | Every branch |
| Every other role | Nothing | |

**How it works.**

1. School setup → **Rooms** (**Xonalar**), open the room, press **Delete for good** (**Butunlay oʻchirish**), type the reason and press **Delete for good**.
2. For a building or a floor: School setup → **Buildings** (**Binolar**), open the building. **Delete for good** is at the bottom when no room is on any of its floors, and beside each floor that has no room. A building takes its floors with it.
3. To bring it back: School setup → **Deleted for good**, open the record and press **Restore** (**Tiklash**) while its 30 days last.

**Rules.**

- "In use" means a room on it, a lesson (today's, a past one or a future one), a timetable entry of any version, a class's home room, a room closure, an exam, a one-day room change, the history of a lesson, or a lesson deleted for good in the last 30 days. A room that ever held a lesson stays in its history and can only be closed.
- A building or floor cannot be deleted for good within 30 days of deleting one of its floors or rooms for good: the deleted floor or room still names it.
- A restore checks again what adding the record checks: the name is free, the building of a floor is in use when the floor comes back in use, and the floor of a room is in use. An archived building or floor comes back archived.
- Nobody is told: no lesson, teacher or class changes. The audit log records the delete with its reason, and the restore.

**What the person sees.**

- When the record is in use: "This is still in use (a room on it, a lesson, a timetable entry or the history of a lesson), so it cannot be deleted for good. Archive a building or floor, or close a room, instead."
- When the floor or building it belonged to was archived or deleted since: the restore is refused and says so.
