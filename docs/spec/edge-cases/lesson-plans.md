# Edge cases: lesson plans

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

## How items stay attached

| Case | Rule |
| --- | --- |
| How is a plan held together when lessons move? | A plan has a fixed part, the items of lessons already held, and a queue of the remaining items in order. Whenever the timetable changes, the queue is attached again, first item to the first lesson not yet held, in the same step as the change. Extra and cancelled lessons are skipped. The impact preview shows, per plan, items that no longer fit and rows left empty. |
| A lesson is cancelled in a plan whose last five rows are still empty. | The shift stops at the first empty row, which absorbs it. "Not covered" is used only when no empty row is left. |
| On Thursday it is recorded that Monday's lesson did not happen; Tuesday and Wednesday were held. | Only the Academic Vice Principal, with a reason, in an open quarter. Monday's item goes in front of the first lesson not yet held, with a "moved from \[date\]" mark, and the system prepares a request for the teacher. |
| A day off is added by mistake and removed two days later. | The items move back by themselves, and items the system had sent to "not covered" return. Anything the teacher already changed under a request stays as edited. |
| A one-day change moves Tuesday's lesson to Friday, past Thursday's lesson. | Items go by position, so Thursday's lesson takes the item that was Tuesday's. |
| A Saturday lesson replaces a cancelled Tuesday lesson. | Marked "replaces the lesson of \[date\]", it is a normal row and takes that lesson's item. Unmarked, it is an extra lesson: a row with no number, outside the plan's completeness, where the teacher types the topic and may add a classwork and a homework by hand. |
| Lesson numbers after a cancellation. | The number is the position among lessons that are not cancelled and not extra. It is worked out for display. History and requests refer to dates. |
| Two classes share a plan; one has 22 lessons in the quarter and the other 20. | A shared plan is one list as long as the larger class. Attachment, "not covered" and completeness are per class. An edit applies to every class sharing it. Separating the plan changes no text and needs no request. Joining is allowed only inside the window. Groups of one subject and grade can share too. |
| A teacher who shares a plan between two classes loses one of them. | That class's plan is separated automatically and the new teacher owns it. The earlier teacher's open periods on it end, and a request is prepared for the new teacher. |
| Two groups standing at different items are merged. | The new group gets a copy of one source plan, chosen by the person making the change. Only its remaining items are attached. Homework never carries across journals: the closed journal's last homework is marked "not checked, group closed". |
| A double lesson. | Two rows. The second offers "same topic as the previous lesson". Homework on the first of two same-day lessons shows the warning "will be checked today in slot N". |

## The window and requests

| Case | Rule |
| --- | --- |
| The quarter 1 timetable is published two days before lessons start, and the window runs two weeks into the quarter. | There is one window per quarter and branch. It ends no later than the quarter's last day. If it ends after the quarter's first lesson, the system shows how many lessons will be held without a plan and asks for confirmation. |
| The window is never opened. | If none exists 14 days before a quarter starts, the Academic Vice Principal is reminded daily. Such plans show "window not opened", not "overdue". |
| The window's end date is changed after it opened; a save arrives at 00:03. | The end can move to any date from today on. A window ends at 23:59 of its last day, branch time. A save arriving later is refused and kept on the device as a draft to attach to a request. |
| "Extend the window for one teacher" against "nothing opens without a request". | Before the window ends, an extension is simply a later end date for that teacher. After it, it is recorded as a request approved by the Academic Vice Principal. |
| A teacher is hired in week 5, or a subject is added mid-quarter. | A plan record exists for every journal and quarter that needs one, from the moment the journal exists. The system prepares a request covering the lessons not yet held. The plan counts as overdue only after that approved period ends. |
| A teacher never sends the prepared request. | When the window ends, a request is prepared for every incomplete plan. The approver can approve it without waiting. The teacher is reminded on days 1, 3 and 7, then weekly, and the list is on the Head Teacher's and Academic Vice Principal's home pages. |
| A request for two lessons turns into merging topics, which moves every later item. | There are two kinds of request. "Text" changes the wording of the listed lessons and moves nothing. "Re-plan" runs from a chosen lesson not yet held to the end of the quarter and allows insert, delete, merge and reorder. Requests prepared by the system are Re-plan. Lessons already held take only Text. |
| The Head Teacher is ill, leaves the post, or is the one asking. | A request goes to whoever holds the role when it is decided, so a new Head Teacher inherits it. The Senior Head Teacher of the subject and the Academic Vice Principal see every request from the start; one unanswered for 2 school days is highlighted for them. Nobody approves their own; a Head Teacher's own go to the Senior Head Teacher or the Academic Vice Principal, and the Academic Vice Principal's own go to the Super Admin. |
| The approver wants to allow only four of six lessons, for three days. | The days are school days, from 1 to 10. The approver can untick lessons, giving a reason. A refusal changes nothing and the teacher may ask again. If two approved periods overlap, the later end date applies. The teacher can press "finished" to lock early. |
| The quarter is closed while plan periods are open or requests are waiting. | Open plan periods on that quarter's lessons block closing; the Academic Vice Principal can end them all from the checklist. Waiting requests become void. |
| A new day off shifts 300 plans. | One notice per teacher per event, listing their plans, and one per Head Teacher with counts. A plan has at most one prepared request; a later event adds to it. Approval can be given by event and by subject. |

## Plans and the journal

| Case | Rule |
| --- | --- |
| An approved edit removes a classwork that already has numbers, or adds homework to a lesson held 12 days ago. | For a lesson already held: the topic and titles can change, with the "edited after the lesson" mark. A work that has numbers cannot be removed, only marked "not held". Removing a homework is refused if the next lesson holds numbers for it. Adding a work is allowed, and the approval also opens that journal column for the same days. Nothing is possible in a closed quarter. |
| A substitute supervises the class, does not teach the planned topic and gives no homework. | On the lesson card the substitute or the teacher sets "topic not delivered" and "homework not given" inside the edit period. This is not a plan edit. A copy of the item goes to "not covered", a request is prepared, and the next lesson gets no homework column. |
| Items are still "not covered" at the end of the quarter. | Each item gets one outcome: merged into a lesson, carried, or dropped with a reason; only the approver can drop. Carried items wait in a "carried in" tray on the next quarter's plan. Items unresolved at closing are carried automatically. In quarter 4 only merge or drop exist. |
| A plan has 40 topics and not one graded work; another teacher marks most planned works "not held". | Each subject can have a minimum number of classworks and homeworks per quarter, set by the Academic Vice Principal. Falling below it is a warning at the end of the window and on the closing checklist. The progress report shows each teacher's share of "not held". |
| The master plan is changed after six teachers copied it. | Items are matched by identity, not by position. Taking the changes touches only rows of lessons not yet held. A subject and grade can have several named masters, for levels or languages. |
| Copying last year's plan of 38 lessons into a quarter of 35. | Only the content is copied, in order. Items that do not fit go to "not covered"; a shortage leaves empty rows. |
| Who may read a plan? | The owner; teachers with the same subject and grade in their profile; the subject's Head Teacher and Senior Head Teacher; the Academic Vice Principal, Principal and Super Admin; a substitute, for that lesson's item. A Tutor sees topic and homework of the class through the journal. Only the owner edits. |
| A plan is open in two tabs while a cancellation shifts it. | A save is addressed to the item, not to the row. A save made on an older state of the same field is refused and both values are shown. |
| A teacher attaches a 300 MB video to every item. | Limits: 20 MB per file, 10 files per item, a fixed list of file types. Classwork and homework have a short title of at most 60 characters, used as the column title, plus an optional description. |
| A wrongly copied plan must be removed; an inspector asks for a printout. | A plan is never deleted. "Clear" empties only rows of lessons not yet held, inside the window or an approved Re-plan. History is kept from creation. Plans export to PDF and Excel with their marks. |
