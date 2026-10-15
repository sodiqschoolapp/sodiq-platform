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
