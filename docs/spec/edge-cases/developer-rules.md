# Edge cases: rules for the developer

> Part of the Sodiq School platform spec, baseline of 3 October 2026 (document revision 88).
> Index and reading order: `docs/spec/00-index.md`. Where an edge-case file is more specific than a module file, the edge-case file applies.

These are the guarantees that must hold even if the application code has a fault. They are written for the person building the system.

| Rule | How |
| --- | --- |
| Lesson times | Every dated lesson stores its own start and end with time zone, copied when it is created. Ranges are half-open: a lesson ending at 09:45 does not overlap one starting at 09:45. |
| Teacher in one place | Exclusion constraint on (teacher, time range) over lessons that are not cancelled and have a teacher, across all branches. |
| Room in one use | The same for rooms that are not shared; the "shared" flag is copied onto the lesson row so the constraint can read it. Shared rooms are limited by a trigger that counts simultaneous lessons and students. |
| Class in one block | A table of (block, class, time range) with an exclusion constraint for blocks that are not cancelled. A constraint trigger checks that each student of a block's classes is in at most one of its lessons, using membership on the lesson date. |
| Membership | One class per student per date, and one group per student per subject per date, by date ranges that cannot overlap. |
| Pattern entries | The same teacher, room and class rules per version. |
| One current year | A partial unique index on (branch) where status is current. |
| One journal | Unique on (class or group, subject, academic year). |
| Identifiers | A student UID is typed in Release 1 and taken from a per-grade pool in Release 2; either way a unique constraint across the school guarantees it is never used twice. Staff IDs come from a sequence and are unique. A relative's phone is unique across the school among relatives who have one. |
| Cells | Unique on (lesson, student, work). Each cell has a version number used to refuse stale saves. |
| History and audit | Append-only: the application's database user cannot update or delete them. Partitioned by month. |
| Branch filter | Set per transaction, never on a pooled connection. Background jobs carry the branch. |
| Time-based state | Stored as moments (lock at, window end, exemption end) and compared with the server clock on every request. Business code never reads the clock directly; it is passed in, so tests can set it. |
| Repeat-safe actions | Publish, close and every offline entry carry a key that makes a repeat harmless. Jobs are written to an outbox table in the same transaction as the data. |
| Calculation | Exact fractions (integer numerator and denominator) from typed number and total to the result. Stored per final result: the inputs, the exact result, the rounded result, the grade, the settings used and the calculation module's version. |
