# Real-size run (small)

Run by `apps/api/src/modules/timetable/real-size.database.test.ts` (`REAL_SIZE=small`), data and placer in `apps/api/src/testing/real-size.ts`. Clock: 2026-08-26T10:00:00+05:00; every version published from 2026-09-07. Machine: 4 CPUs (Intel(R) Xeon(R) Processor), Node v24.22.0, PostgreSQL 18.6 (Ubuntu 18.6-1.pgdg24.04+2); one API process and its database on one machine, no network.

## Size

| | Count |
| --- | --- |
| Branches | 2 |
| Classes | 4 |
| Students | 48 |
| Teachers | 34 (1 teach in two branches) |
| Groups (English across two classes, halves of splits) | 22 |
| Load rows | 62 |
| Rooms | 28 |
| Dated lessons written by the publishes | 4857 |

Built in 1 s; the whole run took 8 s.

## Placement (seed placer, until 5.11)

| Branch | Blocks | Lessons | Not placed | Time |
| --- | --- | --- | --- | --- |
| Real size branch 1 | 57 | 71 | none | 0.2 s |
| Real size branch 2 | 57 | 71 | none | 0.2 s |

## Rule engine

| Board | When | Blocked | Warnings by rule |
| --- | --- | --- | --- |
| Real size branch 1 | draft | none | none |
| Real size branch 2 | draft | none | none |
| Real size branch 1 | published, all branches | none | none |
| Real size branch 2 | published, all branches | none | none |

| Publish check | Refusals | Blocked | Warnings |
| --- | --- | --- | --- |
| Real size branch 1 | 0 | 0 | 0 |
| Real size branch 2 | 0 | 0 | 0 |

Shared teachers on a day in two branches: 5 teacher-days; the least gap between their lessons in two branches is 75 minutes (travel time 30).

## Times

Each read timed 2 times after one warm-up; a write once.

| Measure | Target (`12`) | Median | Slowest |
| --- | --- | --- | --- |
| Real size branch 1: open the board of the draft | under 1 s | 24 ms | 25 ms |
| Real size branch 1: check a move (one slot) | under 0.2 s | 0.9 ms | 1.1 ms |
| Real size branch 1: check a move at every slot of the week (34 slots, as a drag starts) | reported | 28 ms | 35 ms |
| Real size branch 1: a saved move (route, write) | under 1 s | 40 ms | 47 ms |
| Real size branch 1: publish check | under 1 s | 139 ms | 143 ms |
| Real size branch 1: publish (2428 dated lessons written) | reported | 1971 ms | 1971 ms |
| Real size branch 2: open the board of the draft | under 1 s | 21 ms | 30 ms |
| Real size branch 2: check a move (one slot) | under 0.2 s | 0.7 ms | 0.9 ms |
| Real size branch 2: check a move at every slot of the week (34 slots, as a drag starts) | reported | 28 ms | 29 ms |
| Real size branch 2: a saved move (route, write) | under 1 s | 33 ms | 42 ms |
| Real size branch 2: publish check | under 1 s | 122 ms | 123 ms |
| Real size branch 2: publish (2429 dated lessons written) | reported | 2076 ms | 2076 ms |
| Real size branch 1: open the board of the published version | under 1 s | 20 ms | 33 ms |
| Real size branch 1: the published week of a class | under 1 s | 56 ms | 61 ms |
| Real size branch 1: the published week of a teacher | under 1 s | 38 ms | 39 ms |
| Real size branch 2: open the board of the published version | under 1 s | 19 ms | 21 ms |
| Real size branch 2: the published week of a class | under 1 s | 45 ms | 50 ms |
| Real size branch 2: the published week of a teacher | under 1 s | 35 ms | 45 ms |

## Left out

- A journal page: the journal does not exist yet (task 6.2 times it on this data; decision 1).
- The generate step and the solver's time (task 5.11).
- 1,000 simultaneous users (task 10.1, Speed tests; decision 3).
