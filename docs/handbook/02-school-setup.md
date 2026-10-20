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
