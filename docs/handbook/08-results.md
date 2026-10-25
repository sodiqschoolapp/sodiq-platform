# Results

This page holds the parts that task 9.1 added. Ratings, the results table, subject mastery and the closing of a quarter are not built yet (tasks 9.2a to 9.4).

## A student's results and attendance

<!-- Sources: spec 08 (Student results), spec 04 (Profile tabs), spec 07 (Calculation rules, Effect on totals, Transfers), edge/calculation, edge/academic-year (start quarter), edge/00-definitions (Result states, Held lesson); task 9.1, decisions 1, 4, 6, 8, 9 and 10 -->

**What it is.** A student's profile has a **Results** (**Natijalar**) tab and an **Attendance** (**Davomat**) tab. Results shows, for each subject and quarter, the attendance average, the classwork average, the homework average, the rating exam, the quarter result and the grade. Attendance shows the attendance average of each subject with the count of each mark. Every figure is the journal's own: nothing is typed twice.

**Who can use it.**

| Role | Results | Attendance | Which students and subjects |
| --- | --- | --- | --- |
| Super Admin, Principal, Academic Vice Principal | Yes | Yes | Every student and subject of the branch |
| Head Teacher, Senior Head Teacher | Yes | Yes | The students whose profile they open, own subjects only |
| Tutor | Yes | Yes | Own class, every subject (a group subject too, for the students of own class) |
| Teacher | Yes | Yes | The students taught, the subjects of own journals only |
| Head Tutor, Vice Principal for Spiritual and Moral Education | No | Yes | Every student of the branch |

A subject the person may not read is not shown at all. A tab with nothing the person may read is not offered.

**How it works.**

1. People → Students, open a student, choose **Results** or **Attendance**.
2. Choose the quarter. With more than one academic year, choose the year too.
3. Click any figure: a window lists the lessons behind it, with the date, the class or group, the mark and what it counts, and each classwork and homework with its number, its total and its percent. The result shows every part, and the rating exam entry.

**Rules.**

- The figures follow the student across classes and groups: a student who moved in week 6 sees the lessons of both, each named with its class or group.
- A result shows its state: a number, "Exempt", "Not assessed" or "No result" (nothing was entered). Only a number has a grade.
- "provisional" is shown while a part with a weight has no data yet; "left out" names the parts that had none.
- "based on 8 of 40 lessons" is shown on a result with fewer than one third of the lessons, and on a result at leaving.
- The flags the Academic Vice Principal decides at closing (few lessons, attendance alone, left the subject) are shown on the result until then.
- In the quarter the branch started using the platform, the result says "from" and the date. A quarter that ended before that date says "Not in the system".
- The year result is shown once the academic year is closed: the mean of the quarter results as shown, rounded once more, "based on 3 of 4 quarters" when a quarter has no number. A quarter "Not in the system" is left out.
- A subject that is attendance only in a quarter is in Attendance for that quarter, not in Results.

**What happens if…**

| Case | What happens |
| --- | --- |
| The subject has no held lesson yet in the quarter | The subject is not listed for that quarter. |
| A Teacher opens a student taught in two subjects, one of them by another teacher | Only the Teacher's own subject is listed. |
| A Tutor opens a student of another class | The profile is refused, as any record of another class. |
| The student left the school | The results up to the last day are shown, labelled "result at leaving". |

## Changing weights or the late and skipped values

<!-- Sources: edge/calculation ("Quarterly weights are changed in week 7", "The value of 'late' is changed from 50 to 75"), spec 05 (weights); task 9.1, decisions 2, 3, 5 and 11 -->

**What it is.** A change of a quarter's weights, of the copy of quarter 1 to the other quarters, or of a quarter's late and skipped values first shows how many grades change in each journal and asks for a reason.

**Who can use it.** The people who may already change these values: weights in Setup → Subjects, late and skipped values in Setup → Settings.

**How it works.**

1. Change the values and press **Save**.
2. When the change alters values already stored, a window "This change alters results" lists each journal whose grades change, with the number of grades, and asks for the **Reason** (**Sabab**).
3. **Save the change** saves it with the reason; **Back** keeps what was typed and saves nothing.

**Rules.**

- Setting a quarter's weights for the first time, and a save that changes nothing, ask no reason.
- A quarter that has not started lists no journal, but a change of stored values still asks its reason.
- The teachers of the subject's journals in the quarter are told of a weights change, with the reason. A change of late and skipped values tells nobody.
- The journal legend shows "changed on" with the date of the last weights change.

**What the person sees.** Without a reason: "This change alters stored results. Give a reason for it."
