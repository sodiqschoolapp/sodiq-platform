# User experience standards

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

These rules apply to every page and every role.

## One pattern everywhere

- **Home page.** Each role opens on "what do I need to do today", with one click to the place where it is done.
- **Lists.** Every list (students, teachers, classes, groups, subjects, rooms) works the same way: search, filters, column chooser, sorting, checkboxes with bulk actions, export, and a side panel that opens a record without leaving the list.
- **Search.** Ctrl+K opens a search across students, staff, relatives (by phone, for the readers named in the edge cases), classes, groups and pages.
- **Context.** The branch, academic year and quarter in use are always shown in the top bar. Past years open read only with a clear label.
- **Navigation.** A left menu that shows only what the role can use, with no more than about ten items. Breadcrumbs on inner pages. Every page has its own address, so links and the browser Back button work.

## No lost work

- Entries save automatically, with a visible saved sign.
- The last action can be undone.
- Records are archived, never deleted, wherever history depends on them. Actions that cannot be undone ask for confirmation and name what will be affected.
- Forms check each field as it is typed and say in plain words what to fix.

## Language

- Uzbek, Russian and English are complete: every label, message, email, SMS and export. A missing translation fails the build.
- Each person chooses a language; the choice is remembered. Names of people, subjects and classes are stored as entered.
- Dates, numbers and weekdays follow the chosen language. The week starts on Monday.

## Devices

| Device | Target |
| --- | --- |
| Laptop and desktop | Full function. The journal and the timetable builder are designed for this size first. |
| Tablet | Full function, with touch. |
| Phone | Timetable, lesson mode for the journal, attendance, reminders, the portal. The timetable builder is view only. |

## Look and feel

- One design system: one set of colours, type sizes, spacing, buttons and tables. Subject colours are used the same way in the timetable, journal and reports.
- Light and dark themes.
- Readable for everyone: sufficient contrast, full keyboard use, visible focus, text that can be enlarged, and no information shown by colour alone.
- Empty pages say what the page is for and offer the first action. Error messages say what happened and what to do next.
- Loading shows the page outline at once, then the data. The page never jumps as it loads.

## Speed targets

| Action | Target |
| --- | --- |
| Open any page | Under 1 second on school Wi-Fi, under 2 seconds on mobile data |
| Open a journal for a quarter | Under 1 second |
| Save a journal cell | Shown at once, confirmed by the server in under 0.3 seconds |
| Check a timetable move for conflicts | Under 0.2 seconds |
| Open a report | Under 2 seconds |
| Search | Results while typing, under 0.2 seconds |
| Load | 1,000 people working at once with the same response times |

These targets are tested automatically before each release.
