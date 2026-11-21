# Sodiq School platform: API for department platforms

For the developers of a department platform (for example the English or the Mathematics department's own platform) that fills the Sodiq School platform through an **integration key**.

- **Address:** `https://app.sodiqschool.uz`. Every path below starts with `/api`, for example `https://app.sodiqschool.uz/api/journal/journals`.
- **Format:** JSON over HTTPS. Dates are `YYYY-MM-DD` (school dates, Tashkent). Moments are ISO 8601 with time zone. Ids are UUIDs.
- **What this file holds:** the rules of a key, worked examples, and every operation a key may call (95), with its parameters, request body and answer.

The platform is the school's single place for journals, plans and results. A department platform may do, through the API, exactly what its teachers may do in the platform, as if they typed it there. It sends what a person types. The platform calculates every percent, average, result and grade itself.

## Contents

1. The key
2. Every request
3. Who is on the key
4. What a key may and may not do
5. Reading and writing safely
6. The limit
7. The audit log
8. Errors
9. Worked examples
10. The operations open to keys

## 1. The key

The school's Super Admin creates a key, puts people on it, and gives it to the owner of the department platform. The secret starts with `sodiq_ik_`. It is shown once and the school keeps only its hash, so a lost secret cannot be shown again: ask the Super Admin to revoke the key and create a new one.

- Keep the secret on the platform's **server** only, as you would a password. Never put it in a web page, a browser, a phone app, a repository or a log. A request made from a user's device would carry the secret to that device.
- Send requests over **HTTPS** only. A request that reaches the server over plain HTTP is refused (`400 integration_key_https_required`), but by then the secret has crossed the network in plain text: treat a key ever sent over HTTP as leaked and ask for a new one.
- A key works until the end of its end date (Tashkent time). After that it is refused until the Super Admin sets a new end date.

## 2. Every request

| Header | Value |
| --- | --- |
| `X-Integration-Key` | The secret of the key. |
| `X-Acting-Staff-Id` | The staff ID (`S-YYNNNN`) of the person the request acts for. Leave it out only on `GET /api/integration/people`. |
| `X-Branch-Id` | The id of the branch the request is about. Every operation except `GET /api/integration/people` and the three of notifications needs it. Take it from the person's `branches` (section 3). |
| `Content-Type: application/json` | On every request with a JSON body. |
| `Idempotency-Key` | A new random UUID on each call of an operation marked "Takes `Idempotency-Key`" in section 10 (saving attendance, saving numbers). A repeat with the same key and the same person does nothing twice. |

Do not send a cookie. A request with a key never reads one: it acts only for the person you name.

**The person.** A request acts for exactly one person on the key, with exactly what that person's **Teacher**, **Head Teacher** and **Senior Head Teacher** roles allow in the platform. The same branch, subjects, own classes and own lessons apply, and so do the same edit periods (7 days after a lesson by default), locks, cell versions and checks. The person's other roles (Tutor, Academic Vice Principal, Principal and the rest) do not count through a key. Tutor work (Ma'naviyat soati, the Homework slot) is refused: `403 integration_key_tutor_lesson`.

The server checks everything again on each request: the key is not revoked or ended, the person is still on the key, active, not locked, and holds one of the three roles. A change made by the Super Admin counts from the next request.

## 3. Who is on the key

`GET /api/integration/people`, with the key and without `X-Acting-Staff-Id` or `X-Branch-Id`, answers:

```json
{
  "key": "English platform",
  "people": [
    {
      "staffId": "S-260042",
      "firstName": "Malika",
      "lastName": "Karimova",
      "usable": true,
      "branches": [{ "id": "0193a6f2-7c1e-7d40-9a51-2b8f4c6e1d07", "name": "Labzak" }],
      "allBranches": false
    }
  ]
}
```

- `usable` is false while the platform cannot act for the person: inactive, left, locked, or holding none of the three roles.
- `branches` are the branches of the person's Teacher and Head Teacher roles. Send one of them as `X-Branch-Id`.
- `allBranches` is true for a Senior Head Teacher, who works in every branch.

Match your own users to the school's people by staff ID once, and keep the mapping.

## 4. What a key may and may not do

Only the operations in section 10 accept a key. Every other operation answers `403 integration_key_route_closed`. In short, a key may use:

- **the journal:** the list of journals, a journal's grid, a lesson's card, the history of a cell, attendance, "all present", copying attendance, works and their totals, numbers, "not graded", "not held", topics, the homework given, comments, and the rating exam's date, entries and "not held";
- **unlock requests:** sending and withdrawing them (Teacher), and deciding them (Head Teacher, Senior Head Teacher);
- **lesson plans:** plans, their items and files, plan edit requests, the plan windows and minimums, master plans, and the "not covered" outcomes;
- **reading:** timetable views, the rating, the early-warning list, and the reports a Head Teacher sees (plan reports, journal discipline, results table, subject mastery);
- **the person's notifications:** the list, "mark as read" and "mark all as read", with only the notices sent to the person as a Teacher, Head Teacher or Senior Head Teacher. Their other notices (as a Tutor, for example, or stored before notices named the role they were sent for) are not listed or counted, answer 404 to "mark as read", and stay unread.

A key may **never** use: exports, a student's record (profile, diagnostic score, history), the class, group and student lists, moving students between groups, the person's own account (password, second step, sessions, trusted devices, language, notification settings, photo), and the live connection. An operation added to the platform later stays closed to keys until the school opens it.

## 5. Reading and writing safely

- **Read before you write.** Read the journal grid (`GET /api/journal/journals/{journalId}`) for the lessons, their works and the **version** of every cell.
- **How the grid is laid out.** `lessons` lists the dated lessons of the quarter. Each student's `cells` are in the order of `lessons`. Within a cell, `works` are in the order of that lesson's `works`. A cell's `version` is `null` while the cell was never saved.
- **Send the version you read.** Every cell save carries the version as you read it (`null` for a cell never saved). When someone else saved the cell since you read it, in the platform or through another key, the whole save is refused with `409 cell_stale` and nothing changes. The error's `details` name each outdated cell and the value now stored (example 9.5). Show the person both values, and save again with the new version only if the person still wants their value. Never retry with the new version without asking: that overwrites a change nobody saw.
- **Locks.** A lesson can be edited for the edit period after it (7 days by default). After that the save is refused with `409 journal_locked`; the Teacher sends an unlock request (`POST /api/journal/lessons/{lessonId}/unlocks`), and the Head Teacher decides it.
- **Retrying.** Saving attendance and saving numbers take an `Idempotency-Key`: a retry with the same key returns the first answer. Any other change that got no answer: read again before you retry, or you may create the same thing twice.
- **Send what a person types, never results.** Attendance marks, works and their totals, the numbers typed, topics, comments and plans. Percents, averages, results and grades are calculated only by the platform. You can read them in the grid; you cannot send them.

**Attendance marks** (`mark`):

| Mark | Meaning |
| --- | --- |
| `1` | Present |
| `0` | Absent from school |
| `2` | Late |
| `3` | At school but did not come to the lesson |

Marks 4 (temporarily exempt) and 5 (fully exempt) are set by the platform from exemptions and cannot be sent. In the grid such a cell has `exempt` set and `closed: true`.

## 6. The limit

Each key may make **300 requests a minute**, counted across all its people. Every request with a valid key counts, including refused ones. Over the limit the answer is `429 integration_key_rate_limited`, with a `Retry-After` header giving the seconds to wait. Spread a large sync over several minutes.

## 7. The audit log

Every change made through a key is recorded as the person's own change, with the key named. The platform's audit log and a cell's history show "Malika Karimova via English platform". Reads are not logged one by one.

## 8. Errors

Every error has this shape:

```json
{
  "error": {
    "code": "cell_stale",
    "message": "…",
    "requestId": "…",
    "details": [ { "path": "saves.0", "code": "cell_stale", "message": "…" } ]
  }
}
```

`details` is present when the refusal is about parts of the input. Quote `requestId` when you report a problem to the school.

| Status and code | Meaning |
| --- | --- |
| `400 integration_key_https_required` | The request did not come over HTTPS. |
| `401 integration_key_invalid` | The secret is not a key of the school (mistyped, empty, or sent twice). |
| `401 integration_key_revoked` | The key was revoked. Ask the Super Admin for a new key. |
| `401 integration_key_ended` | The key is past its end date. |
| `429 integration_key_rate_limited` | Over the limit. Wait `Retry-After` seconds. |
| `403 integration_key_route_closed` | This operation is not open to keys. |
| `400 validation_failed` | The input does not match the operation; `details` name each field. With path `X-Acting-Staff-Id`: the staff ID is missing or malformed. |
| `403 integration_key_person_refused` | The person is not on the key, or is not active, is locked, has left, or holds none of the three roles. |
| `403 integration_key_tutor_lesson` | Tutor work is done in the platform. |
| `403 permission_denied` and the scope codes of each operation | The person may not do this, exactly as in the platform (another teacher's lesson, another subject, another branch). |
| `404 not_found` | The record does not exist, or belongs to another branch. |
| `409 score_above_total` | A number is above the work's total. |
| `409 cell_stale` | A cell changed since you read it (section 5). |
| `409 journal_locked` | The lesson is past its edit period. The Teacher sends an unlock request. |

## 9. Worked examples

The ids are invented. `$KEY` is the key's secret, kept on your server.

### 9.1 Who is on the key

```bash
curl https://app.sodiqschool.uz/api/integration/people \
  -H "X-Integration-Key: $KEY"
```

### 9.2 The current year and quarter of a branch

```bash
curl https://app.sodiqschool.uz/api/setup/current-period \
  -H "X-Integration-Key: $KEY" \
  -H "X-Acting-Staff-Id: S-260042" \
  -H "X-Branch-Id: 0193a6f2-7c1e-7d40-9a51-2b8f4c6e1d07"
```

### 9.3 A teacher's journals, then one journal for the quarter

```bash
curl https://app.sodiqschool.uz/api/journal/journals \
  -H "X-Integration-Key: $KEY" \
  -H "X-Acting-Staff-Id: S-260042" \
  -H "X-Branch-Id: 0193a6f2-7c1e-7d40-9a51-2b8f4c6e1d07"

curl "https://app.sodiqschool.uz/api/journal/journals/0193a7b0-1111-7aaa-8bbb-000000000001?quarterId=0193a6f3-2222-7ccc-9ddd-000000000002" \
  -H "X-Integration-Key: $KEY" \
  -H "X-Acting-Staff-Id: S-260042" \
  -H "X-Branch-Id: 0193a6f2-7c1e-7d40-9a51-2b8f4c6e1d07"
```

From the grid take, for the lesson you write to: its `id` in `lessons`, and for each student the attendance cell's `version` (`students[i].cells[j].version`, where `j` is the lesson's place in `lessons`).

### 9.4 Mark attendance

Aziz is present (cell never saved), Nilufar is late (cell saved once before, version 1):

```bash
curl -X POST https://app.sodiqschool.uz/api/journal/lessons/0193a7c4-3333-7eee-8fff-000000000003/attendance \
  -H "X-Integration-Key: $KEY" \
  -H "X-Acting-Staff-Id: S-260042" \
  -H "X-Branch-Id: 0193a6f2-7c1e-7d40-9a51-2b8f4c6e1d07" \
  -H "Idempotency-Key: 6f1c2a4e-5b7d-4e8f-9a0b-1c2d3e4f5a6b" \
  -H "Content-Type: application/json" \
  -d '{
    "saves": [
      { "studentId": "0193a5d0-aaaa-7000-8000-000000000010", "mark": 1, "version": null },
      { "studentId": "0193a5d0-aaaa-7000-8000-000000000011", "mark": 2, "version": 1 }
    ]
  }'
```

The answer gives each saved cell with its new `version`. Keep it for the next save of that cell.

### 9.5 When a cell changed in the meantime

Suppose the teacher changed Nilufar's mark in the platform after you read the grid. The save above is refused, and nothing is saved:

```json
{
  "error": {
    "code": "cell_stale",
    "message": "…",
    "requestId": "…",
    "details": [
      {
        "path": "saves.1",
        "code": "cell_stale",
        "message": "The cell was changed since it was read.",
        "recordId": "…",
        "storedCell": {
          "value": "…",
          "version": 2,
          "changedBy": "…",
          "changedByLogin": "m.karimova",
          "changedByName": "Malika Karimova",
          "changedAt": "2026-11-23T05:12:40.000Z"
        }
      }
    ]
  }
}
```

`path` points to the save that is outdated (`saves.1` is the second). Show the person the stored value and who saved it. If they still want theirs, send it again with `"version": 2`.

### 9.6 Add a classwork, set its total, enter the numbers

1. Add the work: `POST /api/journal/lessons/{lessonId}/works` with `{ "kind": "classwork", "title": "Unit 4 vocabulary" }`. The answer gives its `planWorkId`.
2. Read the grid again. The lesson's `works` now hold the new work: by `id` once it has one, otherwise by `planWorkId` with `sourceLessonId`.
3. Set its total: `PUT /api/journal/lessons/{lessonId}/works/total` with `{ "column": { "workId": "…" }, "total": 30, "version": null }`, or with `"column": { "planWorkId": "…", "sourceLessonId": "…" }` when the work has no `id` yet. `version` is the work's `version` as read.
4. Enter the numbers:

```bash
curl -X POST https://app.sodiqschool.uz/api/journal/lessons/0193a7c4-3333-7eee-8fff-000000000003/scores \
  -H "X-Integration-Key: $KEY" \
  -H "X-Acting-Staff-Id: S-260042" \
  -H "X-Branch-Id: 0193a6f2-7c1e-7d40-9a51-2b8f4c6e1d07" \
  -H "Idempotency-Key: 9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" \
  -H "Content-Type: application/json" \
  -d '{
    "saves": [
      { "studentId": "0193a5d0-aaaa-7000-8000-000000000010",
        "column": { "workId": "0193a7d1-4444-7aaa-9bbb-000000000020" },
        "score": 27, "version": null }
    ]
  }'
```

The answer gives each cell's number, the percent the platform calculated, and the new `version`. A number above the work's total is refused with `409 score_above_total`.

### 9.7 A locked lesson

A save on a lesson past its edit period answers `409 journal_locked`. The Teacher asks for an unlock:

```bash
curl -X POST https://app.sodiqschool.uz/api/journal/lessons/0193a7c4-3333-7eee-8fff-000000000003/unlocks \
  -H "X-Integration-Key: $KEY" \
  -H "X-Acting-Staff-Id: S-260042" \
  -H "X-Branch-Id: 0193a6f2-7c1e-7d40-9a51-2b8f4c6e1d07" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Numbers of the written test were not entered in time" }'
```

The Head Teacher of the subject decides it, in the platform or through a key acting for them (`POST /api/journal/unlocks/{unlockId}/decide`).

## 10. The operations open to keys

Each operation lists its parameters, its request body and its answer. The shapes are written as TypeScript types: `?` marks an optional field, `uuid`, `date` (`YYYY-MM-DD`) and `date-time` are strings, and `// …` gives the limits of a value. `X-Branch-Id` is a header; every operation except the first and those of notifications needs it. The headers of section 2 are not repeated.

<!-- generated by pnpm api:client: start -->

### Integration

#### 1. `GET /api/integration/people`

The people on the key now: the staff ID to send in `X-Acting-Staff-Id`, whether a request may act for them now (`usable`), and the branches to send in `X-Branch-Id`. Called with the key only, without `X-Acting-Staff-Id` and without `X-Branch-Id`.

No `X-Branch-Id`.

Answer `200`:

```ts
{
  key: string;
  people: {
    staffId: string;
    firstName: string;
    lastName: string;
    usable: boolean;
    branches: {
      id: uuid;
      name: string;
    }[];
    allBranches: boolean;
  }[];
}
```

### School year and timetable

#### 2. `GET /api/setup/current-period`

The current academic year and quarter of the branch. Use it to find the `yearId` and `quarterId` the other calls take.

Needs `X-Branch-Id`.

Answer `200`:

```ts
{
  today: date;
  year: {
    id: uuid;
    name: string;
    status: "planned" | "current" | "closed";
  } | null;
  state: "no_year" | "not_dated" | "before_first" | "in_quarter" | "vacation";
  quarter: {
    number: integer;  // min 1, max 4
    startDate: date | null;
    endDate: date | null;
  } | null;
  next: {
    number: integer;  // min 1, max 4
    startDate: date | null;
    endDate: date | null;
  } | null;
  demoNow: date-time | null;
  timeZone: string;
}
```

#### 3. `GET /api/timetable/views/choices`

What the person may open in the timetable views on a date: the classes, teachers and rooms to choose from.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `date` | query | no | `date` |

Answer `200`:

```ts
{
  today: date;
  branch: boolean;
  classes: {
    id: uuid;
    name: string;
  }[];
  teachers: {
    id: uuid;
    name: string;
    kind: "person" | "vacancy";
  }[];
  rooms: {
    id: uuid;
    name: string;
  }[];
  own: uuid | null;
}
```

#### 4. `GET /api/timetable/views/branch`

The timetable of the whole branch for a day or a week (`span`) from `date`.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `date` | query | yes | `date` |
| `span` | query | yes | `"day" \| "week"` |

Answer `200`:

```ts
{
  kind: "branch" | "class" | "teacher" | "room";
  span: "day" | "week";
  today: date;
  subject: {
    id: uuid;
    name: string;
  } | null;
  classes: {
    id: uuid;
    name: string;
  }[];
  days: {
    date: date;
    outsideYear: boolean;
    dayOff: string | null;
    version: {
      number: integer;  // min 1
      startsOn: date;
    } | null;
    fromPattern: boolean;
    axis: "slots" | "clock";
    slots: {
      lessonNumber: integer;  // min 1
      start: integer;  // min 0
      end: integer;  // min 1
    }[];
  }[];
  lessons: {
    id: uuid;
    date: date;
    start: integer;  // min 0
    end: integer;  // min 1
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
    };
    teacher: {
      id: uuid;
      kind: "person" | "vacancy";
      name: string;
    } | null;
    room: {
      id: uuid;
      name: string;
    } | null;
    cancelCause: "not_in_template" | "exam" | "exam_week" | "day_off" | "reason" | "kept_data";
    cancelReason: string | null;
    changed: boolean;
    state: "upcoming" | "needs_teacher" | "held" | "unresolved" | "cancelled";
    away: "left" | "inactive" | "locked" | "absence";
    roomOut: "closed" | "under_repair" | "closure";
    substitution: {
      id: uuid;
      replaced: {
        id: uuid;
        kind: "person" | "vacancy";
        name: string;
      } | null;
    } | null;
    classIds: uuid[];
    lessonNumber: integer | null;  // min 1
    replacedHere: boolean;
    journalId: uuid | null;
    status: "not_started" | "in_progress" | "complete" | "locked_incomplete";
  }[];
  exams: {
    id: uuid;
    date: date;
    title: string;
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
    } | null;
    start: integer;  // min 0
    end: integer;  // min 1
    rooms: {
      room: {
        id: uuid;
        name: string;
      };
      classIds: uuid[];
      units: string[];
      invigilators: string[];
    }[];
  }[];
  busy: {
    date: date;
    start: integer;  // min 0
    end: integer;  // min 1
    branch: {
      id: uuid;
      name: string;
    };
  }[];
}
```

#### 5. `GET /api/timetable/views/class`

The timetable of one class for a day or a week from `date`.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `date` | query | yes | `date` |
| `span` | query | yes | `"day" \| "week"` |
| `classId` | query | yes | `uuid` |

Answer `200`: the same shape as the answer of #4.

#### 6. `GET /api/timetable/views/teacher`

The timetable of one teacher for a day or a week from `date`. A Teacher reads their own.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `date` | query | yes | `date` |
| `span` | query | yes | `"day" \| "week"` |
| `staffId` | query | yes | `uuid` |

Answer `200`: the same shape as the answer of #4.

#### 7. `GET /api/timetable/views/room`

The timetable of one room for a day or a week from `date`.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `date` | query | yes | `date` |
| `span` | query | yes | `"day" \| "week"` |
| `roomId` | query | yes | `uuid` |

Answer `200`: the same shape as the answer of #4.

### Journal: journals and lessons

#### 8. `GET /api/journal/lessons/{lessonId}/card`

The lesson card: the lesson, its plan item, its works and homework.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Answer `200`:

```ts
{
  lessonId: uuid;
  journalId: uuid;
  number: integer | null;  // min 1
  date: date;
  start: integer;  // min 0
  end: integer;  // min 1
  slot: integer | null;  // min 1
  held: boolean;
  planItem: boolean;
  topic: string | null;
  whole: boolean;
  classworks: {
    id: uuid;
    title: string;
    description: string;
  }[];
  objectives: string | null;
  links: string[];
  files: {
    id: uuid;
    name: string;
    type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
    bytes: integer;  // min 1
    workId: uuid | null;
  }[];
  addedInJournal: uuid[];
  givenToday: {
    planWorkId: uuid | null;
    title: string | null;
    description: string | null;
    notGiven: boolean;
    checkAt: {
      lessonId: uuid;
      date: date;
      slot: integer | null;  // min 1
    } | null;
    checkedSameDay: boolean;
    ungraded: "year_end" | "group_closed";
  }[];
  checkedToday: {
    title: string | null;
    givenOn: date | null;
  }[];
  delivery: {
    notDelivered: boolean;
    version: integer | null;  // min 1
  };
  canMark: boolean;
  editedAfterLesson: boolean;
  movedFrom: date | null;
  plan: {
    quarterId: uuid;
    position: integer | null;  // min 1
    edit: "open" | "request" | "none";
    item: {
      id: uuid;
      position: integer;  // min 1
      topic: string;
      objectives: string;
      links: string[];
      classworks: {
        id: uuid;
        title: string;
        description: string;
      }[];
      homeworks: {
        id: uuid;
        title: string;
        description: string;
      }[];
      files: {
        id: uuid;
        name: string;
        type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
        bytes: integer;  // min 1
        workId: uuid | null;
      }[];
      addedInJournal: uuid[];
      movedFrom: date | null;
      copiedFrom: {
        journalId: uuid;
        quarterId: uuid;
      } | null;
      editedAfterLesson: boolean;
      notDeliveredFrom: date | null;
    } | null;
  };
}
```

#### 9. `PUT /api/journal/lessons/{lessonId}/delivery`

Set or undo "topic not delivered" on a lesson.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  notDelivered: boolean;
  version: integer | null;  // min 1
}
```

Answer `200`:

```ts
{
  notDelivered: boolean;
  version: integer;  // min 1
  copyItemId: uuid | null;
}
```

#### 10. `PUT /api/journal/lessons/{lessonId}/homework-given`

Mark some or all of the lesson's homeworks "not given", or undo it.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  planWorkIds: uuid[];  // items ≥ 1, items ≤ 10
  notGiven: boolean;
}
```

Answer `200`:

```ts
{
  notGiven: uuid[];
}
```

#### 11. `GET /api/journal/journals`

The journals the person may open in the year: one per class or group and subject.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `yearId` | query | no | `uuid` |

Answer `200`:

```ts
{
  years: {
    id: uuid;
    startDate: date;
    endDate: date;
    closed: boolean;
  }[];
  yearId: uuid | null;
  journals: {
    id: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
  }[];
}
```

#### 12. `GET /api/journal/journals/{journalId}`

One journal for a quarter: its students, its dated lessons, the works of each lesson, every cell with its value and **version**, and the results calculated by the platform. Read it before every write.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | no | `uuid` |
| `journalId` | path | yes | `uuid` |

Answer `200`:

```ts
{
  journal: {
    id: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    year: {
      id: uuid;
      startDate: date;
      endDate: date;
      closed: boolean;
    };
    attendanceOnly: boolean;
    ratingExam: boolean;
  };
  rating: {
    journalId: uuid;
    quarterId: uuid;
    date: date | null;
    fromExam: boolean;
    notHeld: boolean;
    version: integer | null;  // min 1
    canSetDate: boolean;
    canSetNotHeld: boolean;
    canEnter: boolean;
    canExempt: boolean;
    lock: {
      locksAt: date-time | null;
      window: "open" | "unlocked" | "locked";
      unlockedUntil: date-time | null;
      unlockedBy: string | null;
      request: {
        id: uuid;
        version: integer;  // min 1
      } | null;
      canRequest: boolean;
      canCorrect: boolean;
    };
    entries: {
      studentId: uuid;
      entry: {
        kind: "score";
        score: integer;  // min 0, max 100
      } | {
        kind: "did_not_sit";
      } | {
        kind: "exempt";
      };
      version: integer;  // min 1
      changedBy: string | null;
      changedAt: date-time;
      marker: {
        kind: "late" | "correction";
        by: string | null;
      } | {
        kind: "optional";
        until: date-time;
      };
    }[];
    pending: uuid[];
  } | null;
  years: {
    id: uuid;
    startDate: date;
    endDate: date;
    closed: boolean;
  }[];
  others: {
    id: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
  }[];
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date | null;
    endDate: date | null;
  }[];
  quarter: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
  };
  today: date;
  referenceDate: date;
  teacher: {
    id: uuid;
    name: string;
  } | null;
  shape: "whole" | "attendance" | "lessons";
  months: string /* ^\d{4}-\d{2}$ */[];
  lessons: {
    id: uuid;
    date: date;
    start: integer;  // min 0
    end: integer;  // min 1
    slot: integer | null;  // min 1
    held: boolean;
    status: "not_started" | "in_progress" | "complete" | "locked_incomplete";
    cancelled: {
      cause: string;
      reason: string | null;
    } | null;
    month: string /* ^\d{4}-\d{2}$ */;
    works: {
      id: uuid | null;
      planWorkId: uuid | null;
      sourceLessonId: uuid | null;
      kind: "classwork" | "homework";
      position: integer;  // min 1
      title: string | null;
      unplanned: boolean;
      total: integer | null;  // min 1, max 1000
      notHeld: boolean;
      carriedFrom: uuid | null;
      version: integer | null;  // min 1
    }[];
    canEnter: boolean;
    canEnterWorks: boolean;
    lock: {
      locksAt: date-time | null;
      window: "open" | "unlocked" | "locked";
      unlockedUntil: date-time | null;
      unlockedBy: string | null;
      request: {
        id: uuid;
        version: integer;  // min 1
      } | null;
      canRequest: boolean;
      canCorrect: boolean;
    };
    copyFrom: uuid | null;
    planItem: boolean;
    number: integer | null;  // min 1
    topic: string | null;
    addedInJournal: uuid[];
    notDelivered: boolean;
    notHeldWorks: {
      id: uuid | null;
      planWorkId: uuid | null;
      sourceLessonId: uuid | null;
      kind: "classwork" | "homework";
      position: integer;  // min 1
      title: string | null;
      unplanned: boolean;
      total: integer | null;  // min 1, max 1000
      notHeld: boolean;
      carriedFrom: uuid | null;
      version: integer | null;  // min 1
    }[];
    given: {
      workId: uuid | null;
      planWorkId: uuid | null;
      title: string | null;
      checkAt: uuid | null;
      ungraded: "year_end" | "group_closed";
      notGiven: boolean;
    }[];
  }[];
  reminders: {
    kind: "no_attendance" | "numbers_missing" | "no_topic" | "about_to_lock";
    lesson: {
      id: uuid;
      journalId: uuid | null;
      date: date;
      start: integer;  // min 0
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      } | null;
      subject: {
        id: uuid;
        names: {
          uz: string;
          ru: string;
          en: string;
        };
        colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
      };
      status: "not_started" | "in_progress" | "complete" | "locked_incomplete";
    };
    count: integer;  // min 1
    locksAt: date-time | null;
  } | {
    kind: "rating_missing";
    journal: {
      id: uuid;
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      };
      subject: {
        id: uuid;
        names: {
          uz: string;
          ru: string;
          en: string;
        };
        colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
      };
    };
    quarterId: uuid;
    lastDay: date;
    count: integer;  // min 1
  }[];
  students: {
    id: uuid;
    number: integer;  // min 1
    firstName: string;
    lastName: string;
    paternalName: string | null;
    uid: string;
    photoId: uuid | null;
    folded: boolean;
    exemptions: {
      kind: "temporary" | "full";
      startDate: date;
      endDate: date;
      slots: {
        start: string;
        end: string;
      } | null;
      category: "illness" | "competition" | "family" | "school_event" | "other";
    }[];
    cells: {
      closed: boolean;
      exempt: "temporary" | "full";
      mark: integer | null;  // min 0, max 3
      version: integer | null;  // min 1
      typedBy: string | null;
      marker: {
        kind: "late" | "correction";
        by: string | null;
      } | {
        kind: "optional";
        until: date-time;
      };
      open: boolean;
      works: {
        score: integer | null;  // min 0
        percent: integer | null;  // min 0, max 100
        version: integer | null;  // min 1
        onAbsent: boolean;
        marker: {
          kind: "late" | "correction";
          by: string | null;
        } | {
          kind: "optional";
          until: date-time;
        };
        notGraded: boolean;
      }[];
      score: integer | null;  // min 0, max 100
    }[];
    quarter: {
      attendance: integer | null;  // min 0, max 100
      classwork: integer | null;  // min 0, max 100
      homework: integer | null;  // min 0, max 100
      ratingExam: integer | null;  // min 0, max 100
      result: {
        kind: "number";
        shown: integer;  // min 0, max 100
        grade: integer;  // min 2, max 5
        provisional: boolean;
        leftOut: ("attendance" | "classwork" | "homework" | "ratingExam")[];
        basedOn: {
          expected: integer;  // min 0
          held: integer;  // min 0
        } | null;
        kept: boolean;
      } | {
        kind: "exempt";
      } | {
        kind: "not_assessed";
      } | {
        kind: "no_result";
      };
    } | null;
    months: Record<string, {
      attendance: integer | null;  // min 0, max 100
      classwork: integer | null;  // min 0, max 100
      homework: integer | null;  // min 0, max 100
      ratingExam: integer | null;  // min 0, max 100
      result: {
        kind: "number";
        shown: integer;  // min 0, max 100
        grade: integer;  // min 2, max 5
        provisional: boolean;
        leftOut: ("attendance" | "classwork" | "homework" | "ratingExam")[];
        basedOn: {
          expected: integer;  // min 0
          held: integer;  // min 0
        } | null;
        kept: boolean;
      } | {
        kind: "exempt";
      } | {
        kind: "not_assessed";
      } | {
        kind: "no_result";
      };
    }> | null;
    comments: {
      id: uuid;
      target: "mark" | "work" | "note" | "rating";
      studentId: uuid;
      lessonId: uuid | null;
      workId: uuid | null;
      body: string | null;
      visibility: "staff" | "parents";
      version: integer;  // min 1
      changedBy: string | null;
      changedAt: date-time;
    }[];
    carriedIn: {
      journalId: uuid;
      unitName: string;
      from: date;
      until: date;
    }[];
    leftSubjectOn: date | null;
    atLeaving: date | null;
  }[];
  lastTotal: integer | null;  // min 1, max 1000
  bottom: {
    quarter: {
      attendance: integer | null;  // min 0, max 100
      classwork: integer | null;  // min 0, max 100
      homework: integer | null;  // min 0, max 100
      ratingExam: integer | null;  // min 0, max 100
      result: integer | null;  // min 0, max 100
    };
    months: Record<string, {
      attendance: integer | null;  // min 0, max 100
      classwork: integer | null;  // min 0, max 100
      homework: integer | null;  // min 0, max 100
      ratingExam: integer | null;  // min 0, max 100
      result: integer | null;  // min 0, max 100
    }>;
  } | null;
  absences: {
    studentId: uuid;
    date: date;
    category: "illness" | "family" | "school_permitted" | "unexcused" | "unknown";
  }[];
  legend: {
    lateValue: integer;
    skippedValue: integer;
    daily: {
      attendance: integer;
      classwork: integer;
      homework: integer;
    } | null;
    quarterly: {
      attendance: integer;
      classwork: integer;
      homework: integer;
      ratingExam: integer | null;
    } | null;
    weightsChangedOn: date | null;
    countsFrom: date | null;
  };
}
```

#### 13. `GET /api/journal/reminders`

The person's own reminders: lessons with no attendance, works with missing numbers, lessons with no topic, rating scores missing, lessons about to lock.

Needs `X-Branch-Id`.

Answer `200`:

```ts
{
  today: date;
  reminders: {
    kind: "no_attendance" | "numbers_missing" | "no_topic" | "about_to_lock";
    lesson: {
      id: uuid;
      journalId: uuid | null;
      date: date;
      start: integer;  // min 0
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      } | null;
      subject: {
        id: uuid;
        names: {
          uz: string;
          ru: string;
          en: string;
        };
        colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
      };
      status: "not_started" | "in_progress" | "complete" | "locked_incomplete";
    };
    count: integer;  // min 1
    locksAt: date-time | null;
  } | {
    kind: "rating_missing";
    journal: {
      id: uuid;
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      };
      subject: {
        id: uuid;
        names: {
          uz: string;
          ru: string;
          en: string;
        };
        colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
      };
    };
    quarterId: uuid;
    lastDay: date;
    count: integer;  // min 1
  }[];
}
```

#### 14. `GET /api/journal/lessons-today`

The lessons of today and their status.

Needs `X-Branch-Id`.

Answer `200`:

```ts
{
  date: date;
  ahead: integer;  // min 0
  held: integer;  // min 0
  notStarted: integer;  // min 0
  inProgress: integer;  // min 0
  complete: integer;  // min 0
  incomplete: {
    lesson: {
      id: uuid;
      journalId: uuid | null;
      date: date;
      start: integer;  // min 0
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      } | null;
      subject: {
        id: uuid;
        names: {
          uz: string;
          ru: string;
          en: string;
        };
        colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
      };
      status: "not_started" | "in_progress" | "complete" | "locked_incomplete";
    };
    teacher: {
      id: uuid;
      name: string;
    } | null;
  }[];
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
}
```

### Journal: attendance

#### 15. `POST /api/journal/lessons/{lessonId}/attendance`

Save attendance marks of a lesson, each with the version of the cell as read.

Needs `X-Branch-Id`. Takes `Idempotency-Key`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  saves: {
    studentId: uuid;
    mark: 0 | 1 | 2 | 3;
    version: integer | null;  // min 1
    numbers?: "keep" | "clear";
  }[];  // items ≥ 1, items ≤ 60
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  cells: {
    studentId: uuid;
    mark: 0 | 1 | 2 | 3;
    version: integer;  // min 1
  }[];
  cleared: {
    studentId: uuid;
    workId: uuid;
    version: integer;  // min 1
  }[];
  presentEarlier: uuid[];
}
```

#### 16. `POST /api/journal/lessons/{lessonId}/all-present`

Mark every expected student present in the lesson's empty attendance cells.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

No request body.

Answer `200`:

```ts
{
  filled: {
    studentId: uuid;
    version: integer;  // min 1
  }[];
  skipped: {
    studentId: uuid;
    mark: 0 | 1 | 2 | 3;
  }[];
}
```

#### 17. `POST /api/journal/lessons/{lessonId}/copy-attendance`

Copy attendance into the second lesson of a double lesson.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

No request body.

Answer `200`:

```ts
{
  filled: {
    studentId: uuid;
    version: integer;  // min 1
  }[];
  skipped: {
    studentId: uuid;
    mark: 0 | 1 | 2 | 3;
  }[];
}
```

#### 18. `GET /api/journal/lessons/{lessonId}/students/{studentId}/history`

The history of one student's cells in one lesson: who changed what and when, with "via <key name>" for changes made through a key.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |
| `studentId` | path | yes | `uuid` |

Answer `200`:

```ts
{
  lines: {
    work: {
      id: uuid;
      kind: "classwork" | "homework";
    } | null;
    version: integer;  // min 1
    before: integer | null;
    after: integer | null;
    changedBy: {
      accountId: uuid;
      login: string | null;
      name: string | null;
    };
    changedHow: "entry" | "late_entry" | "correction" | "exemption" | "transfer" | "cancellation" | "not_held" | "offline_entry" | "undo" | "restored" | "forced_delete" | "leaving";
    changedAt: date-time;
    viaKey: {
      name: string;
    } | null;
  }[];
  workLines: {
    id: uuid;
    workId: uuid;
    workKind: "classwork" | "homework";
    changedAt: date-time;
    lesson: {
      date: date;
      startsAt: date-time;
      subject: {
        uz: string;
        ru: string;
        en: string;
      };
      taughtTo: string;
      cancelled: boolean;
    } | null;
    totalBefore: integer | null;
    totalAfter: integer | null;
    notHeldBefore: boolean | null;
    notHeldAfter: boolean | null;
    titleBefore: string | null;
    titleAfter: string | null;
    changedHow: "entry" | "not_held" | "carry" | "move" | "takeover" | "separation" | "restored" | "deleted" | "forced_delete";
    changedBy: {
      accountId: uuid;
      login: string | null;
      name: string | null;
    } | null;
    viaKey: {
      name: string;
    } | null;
  }[];
}
```

### Journal: works, totals, numbers and topics

#### 19. `POST /api/journal/lessons/{lessonId}/works`

Add a classwork or homework to a lesson, with its kind and title.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  kind: "classwork" | "homework";
  title: string;  // length ≥ 1
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  planWorkId: uuid;
  itemId: uuid;
  kind: "classwork" | "homework";
  title: string;
}
```

#### 20. `PUT /api/journal/lessons/{lessonId}/topic`

Save the lesson's topic (written into the lesson's plan item).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  topic: string;  // length ≤ 300
  baseTopic: string;
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  itemId: uuid;
  topic: string;
}
```

#### 21. `PUT /api/journal/lessons/{lessonId}/plan-works/{planWorkId}/title`

Rename a work of the lesson's plan item.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |
| `planWorkId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  title: string;  // length ≥ 1
  baseTitle: string;
}
```

Answer `200`:

```ts
{
  planWorkId: uuid;
  itemId: uuid;
  kind: "classwork" | "homework";
  title: string;
}
```

#### 22. `DELETE /api/journal/lessons/{lessonId}/plan-works/{planWorkId}`

Remove an empty work added in the journal while its plan item has no topic.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |
| `planWorkId` | path | yes | `uuid` |

Answer `204`, no body.

#### 23. `PUT /api/journal/lessons/{lessonId}/works/{workId}/title`

Rename a work added by hand while the lesson can still be edited.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |
| `workId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  title: string;  // length ≥ 1
  version: integer;  // min 1
}
```

Answer `200`:

```ts
{
  id: uuid;
  kind: "classwork" | "homework";
  total: integer | null;  // min 1, max 1000
  notHeld: boolean;
  carriedFrom: uuid | null;
  title: string | null;
  version: integer;  // min 1
}
```

#### 24. `DELETE /api/journal/lessons/{lessonId}/works/{workId}`

Remove a work from a lesson.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |
| `workId` | path | yes | `uuid` |

Answer `204`, no body.

#### 25. `PUT /api/journal/lessons/{lessonId}/works/total`

Change the total of a work. Refused when a number already typed is above the new total; the answer lists those students.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  column: {
    workId: uuid;
  } | {
    planWorkId: uuid;
    sourceLessonId: uuid;
  };
  total: integer;  // min 1, max 1000
  version: integer | null;  // min 1
  confirm?: boolean;
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  id: uuid;
  kind: "classwork" | "homework";
  total: integer | null;  // min 1, max 1000
  notHeld: boolean;
  carriedFrom: uuid | null;
  title: string | null;
  version: integer;  // min 1
}
```

#### 26. `PUT /api/journal/lessons/{lessonId}/works/not-held`

Mark a work "not held", or undo it. Its numbers leave the averages and stay in history.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  column: {
    workId: uuid;
  } | {
    planWorkId: uuid;
    sourceLessonId: uuid;
  };
  notHeld: boolean;
  version: integer | null;  // min 1
  confirm?: boolean;
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  id: uuid;
  kind: "classwork" | "homework";
  total: integer | null;  // min 1, max 1000
  notHeld: boolean;
  carriedFrom: uuid | null;
  title: string | null;
  version: integer;  // min 1
}
```

#### 27. `POST /api/journal/lessons/{lessonId}/works/carry`

At the check lesson, choose for a homework "not checked" or "check at the next lesson" (once).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  column: {
    workId: uuid;
  } | {
    planWorkId: uuid;
    sourceLessonId: uuid;
  };
  version: integer | null;  // min 1
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  id: uuid;
  kind: "classwork" | "homework";
  total: integer | null;  // min 1, max 1000
  notHeld: boolean;
  carriedFrom: uuid | null;
  title: string | null;
  version: integer;  // min 1
}
```

#### 28. `POST /api/journal/lessons/{lessonId}/scores`

Save the numbers typed for the works of a lesson, each with the version of the cell as read.

Needs `X-Branch-Id`. Takes `Idempotency-Key`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  saves: {
    studentId: uuid;
    column: {
      workId: uuid;
    } | {
      planWorkId: uuid;
      sourceLessonId: uuid;
    };
    score: integer | null;  // min 0, max 1000
    notGraded?: true;
    version: integer | null;  // min 1
  }[];  // items ≥ 1, items ≤ 600
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  cells: {
    studentId: uuid;
    workId: uuid;
    score: integer | null;  // min 0
    percent: integer | null;  // min 0, max 100
    notGraded: boolean;
    version: integer;  // min 1
  }[];
  works: {
    id: uuid;
    kind: "classwork" | "homework";
    total: integer | null;  // min 1, max 1000
    notHeld: boolean;
    carriedFrom: uuid | null;
    title: string | null;
    version: integer;  // min 1
  }[];
}
```

#### 29. `POST /api/journal/lessons/{lessonId}/not-graded`

Set the lesson's empty cells to "not graded" in one call. This completes the lesson and leaves them out of the average.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  workIds?: uuid[];  // items ≥ 1, items ≤ 20
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  filled: {
    studentId: uuid;
    workId: uuid;
    version: integer;  // min 1
  }[];
  skipped: {
    studentId: uuid;
    workId: uuid;
  }[];
}
```

### Journal: rating exam

#### 30. `POST /api/journal/journals/{journalId}/rating/{quarterId}/unlocks`

A Teacher asks to unlock the rating exam entries of a quarter, with a reason.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `quarterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  reason: string;  // length ≥ 1, length ≤ 500
}
```

Answer `201`:

```ts
{
  id: uuid;
  target: "lesson" | "rating";
  lessonId: uuid | null;
  journalId: uuid | null;
  quarterId: uuid | null;
  date: date | null;
  unit: {
    kind: "class" | "group";
    id: uuid;
    name: string;
  };
  subject: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
    colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
  };
  person: string;
  reason: string;
  requestedAt: date-time;
  status: "sent" | "approved" | "refused" | "withdrawn" | "cancelled";
  days: integer | null;  // min 1, max 7
  openUntil: date-time | null;
  open: boolean;
  decidedBy: string | null;
  decidedAt: date-time | null;
  refuseReason: string | null;
  version: integer;  // min 1
  canDecide: boolean;
  canWithdraw: boolean;
}
```

#### 31. `PUT /api/journal/journals/{journalId}/rating/{quarterId}/date`

Set the date of the quarter's rating exam for a journal.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `quarterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  date: date | null;
  version: integer | null;  // min 1
}
```

Answer `200`:

```ts
{
  journalId: uuid;
  quarterId: uuid;
  date: date | null;
  fromExam: boolean;
  notHeld: boolean;
  version: integer | null;  // min 1
  canSetDate: boolean;
  canSetNotHeld: boolean;
  canEnter: boolean;
  canExempt: boolean;
  lock: {
    locksAt: date-time | null;
    window: "open" | "unlocked" | "locked";
    unlockedUntil: date-time | null;
    unlockedBy: string | null;
    request: {
      id: uuid;
      version: integer;  // min 1
    } | null;
    canRequest: boolean;
    canCorrect: boolean;
  };
  entries: {
    studentId: uuid;
    entry: {
      kind: "score";
      score: integer;  // min 0, max 100
    } | {
      kind: "did_not_sit";
    } | {
      kind: "exempt";
    };
    version: integer;  // min 1
    changedBy: string | null;
    changedAt: date-time;
    marker: {
      kind: "late" | "correction";
      by: string | null;
    } | {
      kind: "optional";
      until: date-time;
    };
  }[];
  pending: uuid[];
}
```

#### 32. `PUT /api/journal/journals/{journalId}/rating/{quarterId}/not-held`

Mark the quarter's rating exam "not held" for a journal, or undo it.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `quarterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  notHeld: boolean;
  version: integer | null;  // min 1
  confirm?: boolean;
}
```

Answer `200`: the same shape as the answer of #31.

#### 33. `POST /api/journal/journals/{journalId}/rating/{quarterId}/entries`

Save a student's rating exam entry: a score, "did not sit" or "exempt".

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `quarterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  studentId: uuid;
  entry: {
    kind: "score";
    score: integer;  // min 0, max 100
  } | {
    kind: "did_not_sit";
  } | {
    kind: "exempt";
  };
  reason: string | null;  // length ≥ 1, length ≤ 500
  version: integer | null;  // min 1
  correction?: boolean;
}
```

Answer `200`: the same shape as the answer of #31.

#### 34. `GET /api/journal/journals/{journalId}/rating/{quarterId}/students/{studentId}/history`

The history of one student's rating exam entry.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `quarterId` | path | yes | `uuid` |
| `studentId` | path | yes | `uuid` |

Answer `200`:

```ts
{
  lines: {
    version: integer;  // min 1
    kind: "entry" | "exam";
    before: {
      kind: "score";
      score: integer;  // min 0, max 100
    } | {
      kind: "did_not_sit";
    } | {
      kind: "exempt";
    };
    after: {
      kind: "score";
      score: integer;  // min 0, max 100
    } | {
      kind: "did_not_sit";
    } | {
      kind: "exempt";
    };
    dateBefore: date | null;
    dateAfter: date | null;
    notHeldBefore: boolean | null;
    notHeldAfter: boolean | null;
    reason: string | null;
    changedBy: string | null;
    changedAt: date-time;
    viaKey: {
      name: string;
    } | null;
  }[];
}
```

### Journal: comments

#### 35. `PUT /api/journal/comments`

Save a comment on a student's cell, lesson or journal.

Needs `X-Branch-Id`.

Request body (`application/json`):

```ts
{
  on: {
    target: "mark";
    lessonId: uuid;
    studentId: uuid;
  } | {
    target: "note";
    lessonId: uuid;
    studentId: uuid;
  } | {
    target: "work";
    lessonId: uuid;
    workId: uuid;
    studentId: uuid;
  } | {
    target: "rating";
    journalId: uuid;
    quarterId: uuid;
    studentId: uuid;
  };
  body: string | null;  // length ≥ 1, length ≤ 1000
  visibility: "staff" | "parents";
  version: integer | null;  // min 1
  correction?: {
    reason: string;  // length ≥ 1, length ≤ 500
  };
}
```

Answer `200`:

```ts
{
  id: uuid;
  target: "mark" | "work" | "note" | "rating";
  studentId: uuid;
  lessonId: uuid | null;
  workId: uuid | null;
  body: string | null;
  visibility: "staff" | "parents";
  version: integer;  // min 1
  changedBy: string | null;
  changedAt: date-time;
}
```

#### 36. `GET /api/journal/comments/history`

The history of a comment.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `target` | query | yes | `"mark" \| "work" \| "note" \| "rating"` |
| `studentId` | query | yes | `uuid` |
| `lessonId` | query | no | `uuid` |
| `workId` | query | no | `uuid` |
| `journalId` | query | no | `uuid` |
| `quarterId` | query | no | `uuid` |

Answer `200`:

```ts
{
  lines: {
    version: integer;  // min 1
    bodyBefore: string | null;
    bodyAfter: string | null;
    visibilityBefore: "staff" | "parents";
    visibilityAfter: "staff" | "parents";
    changedBy: string | null;
    changedHow: "entry" | "restored" | "forced_delete";
    changedAt: date-time;
    viaKey: {
      name: string;
    } | null;
  }[];
}
```

### Journal: unlock requests

#### 37. `GET /api/journal/unlocks`

Unlock requests: the person's own, or those waiting for their decision (`view`).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `view` | query | yes | `"deciding" \| "own" \| "branch"` |

Answer `200`:

```ts
{
  requests: {
    id: uuid;
    target: "lesson" | "rating";
    lessonId: uuid | null;
    journalId: uuid | null;
    quarterId: uuid | null;
    date: date | null;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    person: string;
    reason: string;
    requestedAt: date-time;
    status: "sent" | "approved" | "refused" | "withdrawn" | "cancelled";
    days: integer | null;  // min 1, max 7
    openUntil: date-time | null;
    open: boolean;
    decidedBy: string | null;
    decidedAt: date-time | null;
    refuseReason: string | null;
    version: integer;  // min 1
    canDecide: boolean;
    canWithdraw: boolean;
  }[];
}
```

#### 38. `POST /api/journal/lessons/{lessonId}/unlocks`

A Teacher asks to unlock a locked lesson, with a reason.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  reason: string;  // length ≥ 1, length ≤ 500
}
```

Answer `201`: the same shape as the answer of #30.

#### 39. `POST /api/journal/unlocks/{unlockId}/decide`

A Head Teacher or Senior Head Teacher approves or refuses an unlock request.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `unlockId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  decision: "approve";
  days: integer;  // min 1, max 7
  version: integer;  // min 1
} | {
  decision: "refuse";
  reason: string | null;  // length ≥ 1, length ≤ 500
  version: integer;  // min 1
}
```

Answer `200`: the same shape as the answer of #30.

#### 40. `POST /api/journal/unlocks/{unlockId}/withdraw`

A Teacher withdraws their own unlock request.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `unlockId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  version: integer;  // min 1
}
```

Answer `200`: the same shape as the answer of #30.

### Journal: discipline report

#### 41. `GET /api/journal/discipline`

Journal discipline report (Head Teacher, Senior Head Teacher): counts per teacher of their subjects between two dates.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `from` | query | yes | `date` |
| `to` | query | yes | `date` |
| `departmentId` | query | no | `uuid` |

Answer `200`:

```ts
{
  from: date;
  to: date;
  departments: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
  }[];
  teachers: {
    teacher: {
      id: uuid;
      name: string;
    };
    held: integer;  // min 0
    notStarted: integer;  // min 0
    inProgress: integer;  // min 0
    complete: integer;  // min 0
    lockedIncomplete: integer;  // min 0
    noAttendance: integer;  // min 0
    noTopic: integer;  // min 0
    worksMissing: integer;  // min 0
    unplanned: integer;  // min 0
    lateEntries: integer;  // min 0
  }[];
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
}
```

#### 42. `GET /api/journal/discipline/items`

The lessons behind one count of one teacher in the discipline report.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `from` | query | yes | `date` |
| `to` | query | yes | `date` |
| `departmentId` | query | no | `uuid` |
| `teacherId` | query | yes | `uuid` |
| `column` | query | yes | `"held" \| "notStarted" \| "inProgress" \| "complete" \| "lockedIncomplete" \| "noAttendance" \| "noTopic" \| "worksMissing" \| "unplanned" \| "lateEntries"` |

Answer `200`:

```ts
{
  teacher: {
    id: uuid;
    name: string;
  };
  column: "held" | "notStarted" | "inProgress" | "complete" | "lockedIncomplete" | "noAttendance" | "noTopic" | "worksMissing" | "unplanned" | "lateEntries";
  items: {
    kind: "lesson" | "works" | "entries" | "exam_entries";
    lessonId: uuid | null;
    journalId: uuid | null;
    date: date;
    start: integer | null;  // min 0
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    } | null;
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    count: integer;  // min 1
  }[];
}
```

### Lesson plans

#### 43. `POST /api/plans/journals/{journalId}/not-covered/{itemId}/merge`

A "not covered" item at the end of a quarter is merged into a lesson of the plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `itemId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  position: integer;  // min 1
  lessonId: uuid;
  base: {
    topic: string;
    objectives: string;
    links: string[];
  } | null;
}
```

Answer `200`:

```ts
{
  journalId: uuid;
  unit: {
    kind: "class" | "group";
    id: uuid;
    name: string;
  };
  subject: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
    colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
  };
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
  }[];
  quarterId: uuid;
  owner: string | null;
  ownerStaffId: uuid | null;
  canEdit: boolean;
  closed: boolean;
  rows: {
    number: integer;  // min 1
    lessonId: uuid;
    date: date;
    start: integer;  // min 0
    end: integer;  // min 1
    slot: integer | null;  // min 1
    held: boolean;
    notDelivered: boolean;
    notGiven: uuid[];
    started: boolean;
    open: "none" | "text" | "all";
    item: {
      id: uuid;
      position: integer;  // min 1
      topic: string;
      objectives: string;
      links: string[];
      classworks: {
        id: uuid;
        title: string;
        description: string;
      }[];
      homeworks: {
        id: uuid;
        title: string;
        description: string;
      }[];
      files: {
        id: uuid;
        name: string;
        type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
        bytes: integer;  // min 1
        workId: uuid | null;
      }[];
      addedInJournal: uuid[];
      movedFrom: date | null;
      copiedFrom: {
        journalId: uuid;
        quarterId: uuid;
      } | null;
      editedAfterLesson: boolean;
      notDeliveredFrom: date | null;
    } | null;
  }[];
  notCovered: {
    id: uuid;
    position: integer;  // min 1
    topic: string;
    objectives: string;
    links: string[];
    classworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    homeworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    files: {
      id: uuid;
      name: string;
      type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
      bytes: integer;  // min 1
      workId: uuid | null;
    }[];
    addedInJournal: uuid[];
    movedFrom: date | null;
    copiedFrom: {
      journalId: uuid;
      quarterId: uuid;
    } | null;
    editedAfterLesson: boolean;
    notDeliveredFrom: date | null;
  }[];
  carriedIn: {
    id: uuid;
    topic: string;
    objectives: string;
    links: string[];
    classworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    homeworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    files: {
      id: uuid;
      name: string;
      type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
      bytes: integer;  // min 1
      workId: uuid | null;
    }[];
    addedInJournal: uuid[];
    movedFrom: date | null;
    copiedFrom: {
      journalId: uuid;
      quarterId: uuid;
    } | null;
    editedAfterLesson: boolean;
    notDeliveredFrom: date | null;
  }[];
  outcomes: {
    id: uuid;
    itemId: uuid;
    topic: string;
    kind: "merged" | "carried" | "dropped";
    targetDate: date | null;
    reason: string;
    automatic: boolean;
    decidedBy: string | null;
    decidedAt: date-time;
  }[];
  canDrop: boolean;
  carryClosed: boolean;
  request: {
    id: uuid | null;
    fromDate: date | null;
    lessons: {
      lessonId: uuid;
      date: date;
    }[];
    causes: {
      kind: "not_covered" | "rows_added" | "moved_back" | "owner_changed" | "journal_added" | "window_end";
      onDate: date;
      items: integer;  // min 0
    }[];
  } | null;
  window: {
    state: "not_opened" | "before" | "open" | "ended";
    startDate: date | null;
    endDate: date | null;
    off: boolean;
  };
  flag: "overdue" | "window_not_opened" | "vacancy";
  belowMinimum: {
    classworks: integer;  // min 0
    homeworks: integer;  // min 0
    minimumClassworks: integer;  // min 0
    minimumHomeworks: integer;  // min 0
  } | null;
  requests: {
    id: uuid;
    journalId: uuid;
    quarterId: uuid;
    quarter: integer;  // min 1, max 4
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    owner: string | null;
    kind: "text" | "replan" | "extension";
    status: "prepared" | "sent" | "approved" | "refused" | "void";
    fromDate: date | null;
    lessons: {
      lessonId: uuid;
      date: date;
      approved: boolean;
      untickReason: string;
    }[];
    reason: string;
    causes: {
      kind: "not_covered" | "rows_added" | "moved_back" | "owner_changed" | "journal_added" | "window_end";
      onDate: date;
      items: integer;  // min 0
      eventId: uuid;
    }[];
    sentAt: date-time | null;
    decidedBy: string | null;
    decidedAt: date-time | null;
    decisionReason: string;
    days: integer | null;  // min 1, max 10
    openUntil: date-time | null;
    open: boolean;
    finishedAt: date-time | null;
    waitingDays: integer;  // min 0
    late: boolean;
    canDecide: boolean;
  }[];
  sharedWith: {
    journalId: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    next: {
      number: integer;  // min 1
      date: date;
      topic: string | null;
    } | null;
    notCovered: integer;  // min 0
  }[];
  master: {
    id: uuid;
    name: string;
    scope: "branch" | "all";
    updated: boolean;
  } | null;
  shareCandidates: {
    journalId: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
  }[];
}
```

#### 44. `POST /api/plans/journals/{journalId}/not-covered/{itemId}/carry`

A "not covered" item is carried to the next quarter (not in quarter 4).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `itemId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
}
```

Answer `200`: the same shape as the answer of #43.

#### 45. `POST /api/plans/journals/{journalId}/not-covered/{itemId}/drop`

A "not covered" item is dropped with a reason. Only the approver can drop.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `itemId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  reason: string;  // length ≤ 500
}
```

Answer `200`: the same shape as the answer of #43.

#### 46. `POST /api/plans/journals/{journalId}/carried/{itemId}/place`

A carried-in item of the next quarter's plan is placed on a lesson.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |
| `itemId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  position: integer;  // min 1
  lessonId: uuid;
}
```

Answer `200`: the same shape as the answer of #43.

#### 47. `GET /api/plans`

The lesson plans the person may read in the year: a Teacher's own, a Head Teacher's subjects.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `yearId` | query | no | `uuid` |

Answer `200`:

```ts
{
  years: {
    id: uuid;
    startDate: date;
    endDate: date;
    closed: boolean;
  }[];
  yearId: uuid | null;
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
  }[];
  plans: {
    journalId: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    quarters: {
      quarterId: uuid;
      state: "not_started" | "incomplete" | "complete" | "no_lessons";
      rows: integer;  // min 0
      empty: integer;  // min 0
      flag: "overdue" | "window_not_opened" | "vacancy";
      masterUpdated: boolean;
      belowMinimum: {
        classworks: integer;  // min 0
        homeworks: integer;  // min 0
        minimumClassworks: integer;  // min 0
        minimumHomeworks: integer;  // min 0
      } | null;
    }[];
  }[];
}
```

#### 48. `GET /api/plans/journals/{journalId}`

One journal's plan for a quarter: its items, one per lesson, with their works and files.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | no | `uuid` |
| `journalId` | path | yes | `uuid` |

Answer `200`: the same shape as the answer of #43.

#### 49. `GET /api/plans/lessons/{lessonId}`

The plan item of one lesson.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `lessonId` | path | yes | `uuid` |

Answer `200`:

```ts
{
  lessonId: uuid;
  journalId: uuid;
  date: date;
  number: integer | null;  // min 1
  subject: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
    colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
  };
  unit: {
    kind: "class" | "group";
    id: uuid;
    name: string;
  };
  item: {
    id: uuid;
    position: integer;  // min 1
    topic: string;
    objectives: string;
    links: string[];
    classworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    homeworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    files: {
      id: uuid;
      name: string;
      type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
      bytes: integer;  // min 1
      workId: uuid | null;
    }[];
    addedInJournal: uuid[];
    movedFrom: date | null;
    copiedFrom: {
      journalId: uuid;
      quarterId: uuid;
    } | null;
    editedAfterLesson: boolean;
    notDeliveredFrom: date | null;
  } | null;
}
```

#### 50. `POST /api/plans/journals/{journalId}/items`

Add an item to a plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  position: integer;  // min 1
  lessonId: uuid;
  values: {
    topic: string;  // length ≤ 300
    objectives: string;  // length ≤ 2000
    links: string /* ^https?:\/\/[^\s]+$ */[];  // items ≤ 10
    classworks: {
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
    homeworks: {
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
  };
}
```

Answer `201`:

```ts
{
  id: uuid;
  position: integer;  // min 1
  topic: string;
  objectives: string;
  links: string[];
  classworks: {
    id: uuid;
    title: string;
    description: string;
  }[];
  homeworks: {
    id: uuid;
    title: string;
    description: string;
  }[];
  files: {
    id: uuid;
    name: string;
    type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
    bytes: integer;  // min 1
    workId: uuid | null;
  }[];
  addedInJournal: uuid[];
  movedFrom: date | null;
  copiedFrom: {
    journalId: uuid;
    quarterId: uuid;
  } | null;
  editedAfterLesson: boolean;
  notDeliveredFrom: date | null;
}
```

#### 51. `POST /api/plans/journals/{journalId}/share`

Another journal of the same teacher joins this journal's plan (inside the window).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  journalId: uuid;
}
```

Answer `200`: the same shape as the answer of #43.

#### 52. `POST /api/plans/journals/{journalId}/separate`

The journal leaves its shared plan, keeping a copy of the items.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
}
```

Answer `200`: the same shape as the answer of #43.

#### 53. `POST /api/plans/journals/{journalId}/copy`

The items of another plan are copied into this empty plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  source: {
    journalId: uuid;
    quarterId: uuid;
  };
  part: "all" | "remaining";
} | {
  quarterId: uuid;
  source: {
    masterId: uuid;
  };
}
```

Answer `200`: the same shape as the answer of #43.

#### 54. `PUT /api/plans/journals/{journalId}/queue`

Insert, delete, merge and reorder items of a plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  base: (uuid | null)[];  // items ≤ 400
  order: (uuid | null)[];  // items ≤ 400
}
```

Answer `200`: the same shape as the answer of #43.

#### 55. `PUT /api/plans/items/{itemId}`

Save a plan item: topic, objectives and links, materials, works.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `itemId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  base: {
    topic: string;
    objectives: string;
    links: string[];
    classworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    homeworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
  };
  values: {
    topic: string;  // length ≤ 300
    objectives: string;  // length ≤ 2000
    links: string /* ^https?:\/\/[^\s]+$ */[];  // items ≤ 10
    classworks: {
      id?: uuid;
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
    homeworks: {
      id?: uuid;
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
  };
}
```

Answer `200`: the same shape as the answer of #50.

#### 56. `POST /api/plans/items/{itemId}/clear`

Clear a plan item.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `itemId` | path | yes | `uuid` |

No request body.

Answer `204`, no body.

#### 57. `PUT /api/plans/items/{itemId}/files`

Attach a file to a plan item, or to one of its works (`workId`). The body is the file itself; `name` is its file name.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `name` | query | yes | `string` |
| `workId` | query | no | `uuid` |
| `itemId` | path | yes | `uuid` |

Request body: the file itself, as raw bytes, with `Content-Type` one of: `application/pdf`, `image/jpeg`, `image/png`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `audio/mpeg`, `video/mp4`.

Answer `200`:

```ts
{
  id: uuid;
  name: string;
  type: "application/pdf" | "image/jpeg" | "image/png" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/vnd.openxmlformats-officedocument.presentationml.presentation" | "audio/mpeg" | "video/mp4";
  bytes: integer;  // min 1
  workId: uuid | null;
}
```

#### 58. `GET /api/plans/files/{fileId}`

Download a file of a plan item.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `fileId` | path | yes | `uuid` |

Answer `200`: the file, with its own `Content-Type`.

#### 59. `DELETE /api/plans/files/{fileId}`

Remove a file of a plan item.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `fileId` | path | yes | `uuid` |

Answer `204`, no body.

### Lesson plans: windows, minimums and edit requests

#### 60. `GET /api/plans/minimums`

The minimum number of classworks and homeworks a plan must hold per quarter, by subject.

Needs `X-Branch-Id`.

Answer `200`:

```ts
{
  subjects: {
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    classworks: integer;  // min 0, max 100
    homeworks: integer;  // min 0, max 100
    version: integer | null;  // min 1
  }[];
  canEdit: boolean;
}
```

#### 61. `GET /api/plans/windows`

The plan windows of the year: when plans of each quarter can be written freely.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `yearId` | query | no | `uuid` |

Answer `200`:

```ts
{
  yearId: uuid | null;
  canEdit: boolean;
  off: boolean;
  quarters: {
    quarter: {
      id: uuid;
      number: integer;  // min 1, max 4
      startDate: date;
      endDate: date;
    };
    published: boolean;
    coveredFrom: date | null;
    window: {
      startDate: date;
      endDate: date;
      state: "not_opened" | "before" | "open" | "ended";
      extensions: {
        staffId: uuid;
        name: string;
        endDate: date;
      }[];
    } | null;
  }[];
}
```

#### 62. `GET /api/plans/requests`

Plan edit requests: the person's own, or those waiting for their decision (`view`).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `view` | query | yes | `"mine" \| "deciding"` |
| `yearId` | query | no | `uuid` |

Answer `200`:

```ts
{
  requests: {
    id: uuid;
    journalId: uuid;
    quarterId: uuid;
    quarter: integer;  // min 1, max 4
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    owner: string | null;
    kind: "text" | "replan" | "extension";
    status: "prepared" | "sent" | "approved" | "refused" | "void";
    fromDate: date | null;
    lessons: {
      lessonId: uuid;
      date: date;
      approved: boolean;
      untickReason: string;
    }[];
    reason: string;
    causes: {
      kind: "not_covered" | "rows_added" | "moved_back" | "owner_changed" | "journal_added" | "window_end";
      onDate: date;
      items: integer;  // min 0
      eventId: uuid;
    }[];
    sentAt: date-time | null;
    decidedBy: string | null;
    decidedAt: date-time | null;
    decisionReason: string;
    days: integer | null;  // min 1, max 10
    openUntil: date-time | null;
    open: boolean;
    finishedAt: date-time | null;
    waitingDays: integer;  // min 0
    late: boolean;
    canDecide: boolean;
  }[];
  events: {
    eventId: uuid;
    at: date-time;
    requests: integer;  // min 1
    subjects: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    }[];
  }[];
}
```

#### 63. `POST /api/plans/journals/{journalId}/requests`

A Teacher sends a request to edit their plan after the window: which lessons, and the reason.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  kind: "text";
  quarterId: uuid;
  lessonIds: uuid[];  // items ≥ 1, items ≤ 200
  reason: string;  // length ≤ 1000
} | {
  kind: "replan";
  quarterId: uuid;
  fromLessonId: uuid;
  reason: string;  // length ≤ 1000
}
```

Answer `201`:

```ts
{
  id: uuid;
  journalId: uuid;
  quarterId: uuid;
  quarter: integer;  // min 1, max 4
  unit: {
    kind: "class" | "group";
    id: uuid;
    name: string;
  };
  subject: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
    colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
  };
  owner: string | null;
  kind: "text" | "replan" | "extension";
  status: "prepared" | "sent" | "approved" | "refused" | "void";
  fromDate: date | null;
  lessons: {
    lessonId: uuid;
    date: date;
    approved: boolean;
    untickReason: string;
  }[];
  reason: string;
  causes: {
    kind: "not_covered" | "rows_added" | "moved_back" | "owner_changed" | "journal_added" | "window_end";
    onDate: date;
    items: integer;  // min 0
    eventId: uuid;
  }[];
  sentAt: date-time | null;
  decidedBy: string | null;
  decidedAt: date-time | null;
  decisionReason: string;
  days: integer | null;  // min 1, max 10
  openUntil: date-time | null;
  open: boolean;
  finishedAt: date-time | null;
  waitingDays: integer;  // min 0
  late: boolean;
  canDecide: boolean;
}
```

#### 64. `POST /api/plans/journals/{journalId}/requests/prepared`

A Teacher sends the request the system prepared at the window's end, stored on the plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  reason?: string;  // length ≤ 1000
}
```

Answer `200`: the same shape as the answer of #63.

#### 65. `POST /api/plans/journals/{journalId}/requests/prepared/decide`

An approver decides that same prepared request at once, without waiting for the Teacher to send it.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  decision: {
    decision: "approve";
    days: integer;  // min 1, max 10
    untick?: {
      lessonId: uuid;
      reason: string;  // length ≤ 1000
    }[];  // items ≤ 200
    later?: {
      fromLessonId: uuid;
      reason: string;  // length ≤ 1000
    };
  } | {
    decision: "refuse";
    reason: string;  // length ≤ 1000
  };
}
```

Answer `200`: the same shape as the answer of #63.

#### 66. `POST /api/plans/requests/{requestId}/send`

A Teacher sends a request the system prepared (after a cancelled lesson, a day off, a new teacher taking over).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `requestId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  reason?: string;  // length ≤ 1000
}
```

Answer `200`: the same shape as the answer of #63.

#### 67. `POST /api/plans/requests/{requestId}/decide`

An approver (Head Teacher, Senior Head Teacher) approves a request with a number of school days, or refuses it with a reason.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `requestId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  decision: "approve";
  days: integer;  // min 1, max 10
  untick?: {
    lessonId: uuid;
    reason: string;  // length ≤ 1000
  }[];  // items ≤ 200
  later?: {
    fromLessonId: uuid;
    reason: string;  // length ≤ 1000
  };
} | {
  decision: "refuse";
  reason: string;  // length ≤ 1000
}
```

Answer `200`: the same shape as the answer of #63.

#### 68. `POST /api/plans/requests/decide-event`

An approver decides together every waiting request of one event (for example one day off), by subject if chosen.

Needs `X-Branch-Id`.

Request body (`application/json`):

```ts
{
  eventId: uuid;
  subjectId?: uuid;
  days: integer;  // min 1, max 10
}
```

Answer `200`:

```ts
{
  approved: uuid[];
  skipped: uuid[];
  others: integer;  // min 0
}
```

#### 69. `POST /api/plans/requests/{requestId}/finish`

A Teacher presses "finished" on an approved request to lock the plan again early.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `requestId` | path | yes | `uuid` |

No request body.

Answer `200`: the same shape as the answer of #63.

### Lesson plans: master plans

#### 70. `GET /api/plans/masters`

Master plans the person may read, filtered by year, subject, grade or quarter.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `yearId` | query | no | `uuid` |
| `subjectId` | query | no | `uuid` |
| `grade` | query | no | `string /* ^(?:[0-9]\|1[01])$ */` |
| `quarter` | query | no | `string /* ^[1-4]$ */` |
| `journalId` | query | no | `uuid` |
| `quarterId` | query | no | `uuid` |

Answer `200`:

```ts
{
  years: {
    id: uuid;
    startDate: date;
    endDate: date;
  }[];
  yearId: uuid | null;
  masters: {
    id: uuid;
    scope: "branch" | "all";
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    grade: integer;  // min 0, max 11
    language: "uz" | "ru";
    startYear: integer;
    quarter: integer;  // min 1, max 4
    name: string;
    items: integer;  // min 0
    archived: boolean;
    canEdit: boolean;
  }[];
  keeps: {
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    grades: integer[];
    scopes: ("branch" | "all")[];
  }[];
}
```

#### 71. `POST /api/plans/masters`

A Head Teacher or Senior Head Teacher creates a master plan.

Needs `X-Branch-Id`.

Request body (`application/json`):

```ts
{
  yearId: uuid;
  quarter: integer;  // min 1, max 4
  subjectId: uuid;
  grade: integer;  // min 0, max 11
  language: "uz" | "ru";
  name: string;  // length ≤ 60
  scope: "branch" | "all";
}
```

Answer `200`:

```ts
{
  id: uuid;
  scope: "branch" | "all";
  subject: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
    colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
  };
  grade: integer;  // min 0, max 11
  language: "uz" | "ru";
  startYear: integer;
  quarter: integer;  // min 1, max 4
  name: string;
  items: integer;  // min 0
  archived: boolean;
  canEdit: boolean;
  revision: integer;  // min 0
  masterItems: {
    id: uuid;
    position: integer;  // min 1
    topic: string;
    objectives: string;
    links: string[];
    classworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
    homeworks: {
      id: uuid;
      title: string;
      description: string;
    }[];
  }[];
}
```

#### 72. `GET /api/plans/masters/{masterId}`

One master plan with its items.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |

Answer `200`: the same shape as the answer of #71.

#### 73. `PATCH /api/plans/masters/{masterId}`

Rename a master plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  revision: integer;  // min 0
  name: string;  // length ≤ 60
}
```

Answer `200`: the same shape as the answer of #71.

#### 74. `POST /api/plans/masters/{masterId}/archive`

Archive a master plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  revision: integer;  // min 0
}
```

Answer `200`: the same shape as the answer of #71.

#### 75. `POST /api/plans/masters/{masterId}/restore`

Restore an archived master plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  revision: integer;  // min 0
}
```

Answer `200`: the same shape as the answer of #71.

#### 76. `POST /api/plans/masters/{masterId}/items`

Add an item to a master plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  revision: integer;  // min 0
  position: integer;  // min 1
  values: {
    topic: string;  // length ≤ 300
    objectives: string;  // length ≤ 2000
    links: string /* ^https?:\/\/[^\s]+$ */[];  // items ≤ 10
    classworks: {
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
    homeworks: {
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
  };
}
```

Answer `200`: the same shape as the answer of #71.

#### 77. `PUT /api/plans/masters/{masterId}/items/{itemId}`

Save an item of a master plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |
| `itemId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  revision: integer;  // min 0
  values: {
    topic: string;  // length ≤ 300
    objectives: string;  // length ≤ 2000
    links: string /* ^https?:\/\/[^\s]+$ */[];  // items ≤ 10
    classworks: {
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
    homeworks: {
      title: string;  // length ≤ 60
      description: string;  // length ≤ 1000
    }[];  // items ≤ 10
  };
}
```

Answer `200`: the same shape as the answer of #71.

#### 78. `POST /api/plans/masters/{masterId}/items/{itemId}/remove`

Remove an item from a master plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |
| `itemId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  revision: integer;  // min 0
}
```

Answer `200`: the same shape as the answer of #71.

#### 79. `PUT /api/plans/masters/{masterId}/order`

Reorder the items of a master plan.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `masterId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  revision: integer;  // min 0
  order: uuid[];  // items ≤ 400
}
```

Answer `200`: the same shape as the answer of #71.

#### 80. `GET /api/plans/journals/{journalId}/master-compare`

The "master updated" comparison of a plan: what changed in its master since the plan took it.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | yes | `uuid` |
| `journalId` | path | yes | `uuid` |

Answer `200`:

```ts
{
  master: {
    id: uuid;
    name: string;
    scope: "branch" | "all";
    revision: integer;  // min 0
    archived: boolean;
  };
  rows: {
    change: "changed" | "added" | "removed";
    masterItemId: uuid;
    master: {
      topic: string;
      objectives: string;
      links: string[];
      classworks: {
        title: string;
        description: string;
      }[];
      homeworks: {
        title: string;
        description: string;
      }[];
    } | null;
    plan: {
      topic: string;
      objectives: string;
      links: string[];
      classworks: {
        title: string;
        description: string;
      }[];
      homeworks: {
        title: string;
        description: string;
      }[];
      itemId: uuid;
    } | null;
    held: boolean;
  }[];
}
```

#### 81. `POST /api/plans/journals/{journalId}/master-take`

The plan takes the master's changes.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  revision: integer;  // min 0
}
```

Answer `200`: the same shape as the answer of #43.

#### 82. `POST /api/plans/journals/{journalId}/master-keep`

The plan keeps its own text after a master change.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `journalId` | path | yes | `uuid` |

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  revision: integer;  // min 0
}
```

Answer `200`: the same shape as the answer of #43.

#### 83. `GET /api/plans/parallel`

The parallel classes of a grade in a subject and quarter (for sharing or comparing plans).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `subjectId` | query | yes | `uuid` |
| `grade` | query | yes | `string /* ^(?:[0-9]\|1[01])$ */` |
| `quarterId` | query | yes | `uuid` |

Answer `200`:

```ts
{
  units: {
    journalId: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    grades: integer[];
    rows: integer;  // min 0
    reached: {
      number: integer;  // min 1
      date: date;
      topic: string | null;
    } | null;
    next: {
      number: integer;  // min 1
      date: date;
      topic: string | null;
    } | null;
  }[];
}
```

### Lesson plans: reports

#### 84. `GET /api/plans/reports/completeness`

Plan completeness report (Head Teacher, Senior Head Teacher): how complete the plans of their subjects are.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | no | `uuid` |
| `departmentId` | query | no | `uuid` |
| `teacherId` | query | no | `uuid` |

Answer `200`:

```ts
{
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
  }[];
  quarterId: uuid | null;
  departments: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
  }[];
  plans: {
    journalId: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    teacher: {
      id: uuid;
      name: string;
    } | null;
    department: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
    } | null;
    state: "not_started" | "incomplete" | "complete" | "no_lessons";
    rows: integer;  // min 0
    empty: integer;  // min 0
    flag: "overdue" | "window_not_opened" | "vacancy";
    belowMinimum: {
      classworks: integer;  // min 0
      homeworks: integer;  // min 0
      minimumClassworks: integer;  // min 0
      minimumHomeworks: integer;  // min 0
    } | null;
  }[];
  teachers: {
    teacher: {
      id: uuid;
      name: string;
    } | null;
    counts: {
      plans: integer;  // min 0
      complete: integer;  // min 0
      incomplete: integer;  // min 0
      noTopic: integer;  // min 0
      notStarted: integer;  // min 0
      overdue: integer;  // min 0
      windowNotOpened: integer;  // min 0
      belowMinimum: integer;  // min 0
      percentComplete: integer | null;  // min 0, max 100
    };
  }[];
  byDepartment: {
    department: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
    } | null;
    counts: {
      plans: integer;  // min 0
      complete: integer;  // min 0
      incomplete: integer;  // min 0
      noTopic: integer;  // min 0
      notStarted: integer;  // min 0
      overdue: integer;  // min 0
      windowNotOpened: integer;  // min 0
      belowMinimum: integer;  // min 0
      percentComplete: integer | null;  // min 0, max 100
    };
  }[];
  branch: {
    plans: integer;  // min 0
    complete: integer;  // min 0
    incomplete: integer;  // min 0
    noTopic: integer;  // min 0
    notStarted: integer;  // min 0
    overdue: integer;  // min 0
    windowNotOpened: integer;  // min 0
    belowMinimum: integer;  // min 0
    percentComplete: integer | null;  // min 0, max 100
  };
  otherSubjects: integer;  // min 0
}
```

#### 85. `GET /api/plans/reports/progress`

Plan progress report (Head Teacher, Senior Head Teacher): how far the lessons held follow the plans.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | no | `uuid` |
| `departmentId` | query | no | `uuid` |
| `teacherId` | query | no | `uuid` |

Answer `200`:

```ts
{
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
  }[];
  quarterId: uuid | null;
  departments: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
  }[];
  plans: {
    journalId: uuid;
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    teacher: {
      id: uuid;
      name: string;
    } | null;
    department: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
    } | null;
    rows: integer;  // min 0
    planned: integer;  // min 0
    held: integer;  // min 0
    delivered: integer;  // min 0
    notCovered: integer;  // min 0
    behind: boolean;
  }[];
  teachers: {
    teacher: {
      id: uuid;
      name: string;
    } | null;
    plannedWorks: integer;  // min 0
    notHeld: integer;  // min 0
    percentNotHeld: integer | null;  // min 0, max 100
  }[];
  otherSubjects: integer;  // min 0
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
}
```

#### 86. `GET /api/plans/reports/requests`

Plan edit requests report (Head Teacher, Senior Head Teacher).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | no | `uuid` |
| `departmentId` | query | no | `uuid` |
| `teacherId` | query | no | `uuid` |

Answer `200`:

```ts
{
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
  }[];
  quarterId: uuid | null;
  departments: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
  }[];
  teachers: {
    teacher: {
      id: uuid;
      name: string;
    } | null;
    total: integer;  // min 0
    requests: {
      id: uuid;
      journalId: uuid;
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      };
      subject: {
        id: uuid;
        names: {
          uz: string;
          ru: string;
          en: string;
        };
        colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
      };
      kind: "text" | "replan" | "extension";
      status: "prepared" | "sent" | "approved" | "refused" | "void";
      decidedBy: string | null;
      decidedOn: date | null;
      changes: {
        action: string;
        on: date;
        topicBefore: string | null;
        topicAfter: string | null;
      }[];
    }[];
  }[];
}
```

### Results: rating, early warning and reports

#### 87. `GET /api/results/rating/choices`

What the person may open in the rating: years, quarters, journals and classes.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `yearId` | query | no | `uuid` |

Answer `200`:

```ts
{
  year: {
    id: uuid;
    startDate: date;
    endDate: date;
    status: "planned" | "current" | "closed";
  } | null;
  years: {
    id: uuid;
    startDate: date;
    endDate: date;
    status: "planned" | "current" | "closed";
  }[];
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
    notOfficial: boolean;
  }[];
  journals: {
    id: uuid;
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    grades: integer[];
    language: "uz" | "ru";
  }[];
  classes: {
    id: uuid;
    name: string;
    grade: integer;  // min 0, max 11
    language: "uz" | "ru";
  }[];
  classesList: boolean;
}
```

#### 88. `GET /api/results/rating/subject`

The rating of one journal's students in a quarter.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | yes | `uuid` |
| `journalId` | query | yes | `uuid` |

Answer `200`:

```ts
{
  quarter: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
    notOfficial: boolean;
  };
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
  provisional: boolean;
  final: {
    closedAt: date-time;
    version: integer;  // min 1
  } | null;
  journal: {
    id: uuid;
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    unit: {
      kind: "class" | "group";
      id: uuid;
      name: string;
    };
    grades: integer[];
    language: "uz" | "ru";
  };
  rows: {
    student: {
      id: uuid;
      firstName: string;
      lastName: string;
      paternalName: string | null;
    };
    place: integer | null;  // min 1
    value: integer | null;  // min 0, max 1000
    state: "number" | "exempt" | "not_assessed" | "no_result";
    flags: ("few_lessons" | "attendance_only" | "left_subject")[];
    leftSubjectOn: date | null;
  }[];
}
```

#### 89. `GET /api/results/rating/class`

The rating of one class in a quarter.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | yes | `uuid` |
| `classId` | query | yes | `uuid` |

Answer `200`:

```ts
{
  quarter: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
    notOfficial: boolean;
  };
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
  provisional: boolean;
  final: {
    closedAt: date-time;
    version: integer;  // min 1
  } | null;
  class: {
    id: uuid;
    name: string;
    grade: integer;  // min 0, max 11
    language: "uz" | "ru";
  };
  rows: {
    student: {
      id: uuid;
      firstName: string;
      lastName: string;
      paternalName: string | null;
    };
    place: integer | null;  // min 1
    value: integer | null;  // min 0, max 1000
    subjects: integer;  // min 0
    fewerSubjects: boolean;
  }[];
}
```

#### 90. `GET /api/results/rating/classes`

The ratings of the classes of a grade in a quarter.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | yes | `uuid` |
| `grade` | query | no | `integer \| string /* ^(?:[0-9]\|1[01])$ */` |
| `language` | query | no | `"uz" \| "ru"` |

Answer `200`:

```ts
{
  quarter: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
    notOfficial: boolean;
  };
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
  provisional: boolean;
  final: {
    closedAt: date-time;
    version: integer;  // min 1
  } | null;
  grade: integer | null;  // min 0, max 11
  language: "uz" | "ru";
  rows: {
    class: {
      id: uuid;
      name: string;
      grade: integer;  // min 0, max 11
      language: "uz" | "ru";
    };
    place: integer | null;  // min 1
    value: integer | null;  // min 0, max 1000
    students: integer;  // min 0
  }[];
}
```

#### 91. `GET /api/results/early-warning`

The early-warning list: students whose results or attendance need attention, with the reasons.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | no | `uuid` |
| `for` | query | no | `"own_journals"` |
| `classId` | query | no | `uuid` |

Answer `200`:

```ts
{
  quarter: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
  } | null;
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
  }[];
  thresholds: {
    lowResult: integer;
    resultDrop: integer;
    attendancePercent: integer;
    absencesInRow: integer;
    gradedWorks: integer;
  };
  daysAgoDate: date | null;
  entries: {
    student: {
      id: uuid;
      firstName: string;
      lastName: string;
      paternalName: string | null;
    };
    subject: {
      id: uuid;
      names: {
        uz: string;
        ru: string;
        en: string;
      };
      colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
    };
    journal: {
      id: uuid;
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      };
    };
    attendanceOnly: boolean;
    figures: {
      result: integer | null;  // min 0, max 100
      currentWork: {
        now: integer | null;  // min 0, max 100
        daysAgo: integer | null;  // min 0, max 100
        previousQuarter: integer | null;  // min 0, max 100
      };
      attendance: integer | null;  // min 0, max 100
      absenceRun: integer;  // min 0
      gradedWorks: integer | null;  // min 0
    };
    reasons: {
      kind: "low_result" | "result_drop" | "low_attendance" | "absences_in_row";
      figure: integer;  // min 0, max 1000
      against: ("days_ago" | "previous_quarter")[];
      handledBefore: {
        note: string;
        handledAt: date-time;
        figure: integer;  // min 0, max 1000
        by: string;
      } | null;
    }[];  // items ≥ 1
    canHandle: boolean;
  }[];
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
}
```

#### 92. `POST /api/results/early-warning/handled`

Add a staff-only note and mark one reason of an entry "handled".

Needs `X-Branch-Id`.

Request body (`application/json`):

```ts
{
  quarterId: uuid;
  studentId: uuid;
  subjectId: uuid;
  reason: "low_result" | "result_drop" | "low_attendance" | "absences_in_row";
  note?: string;  // length ≤ 500
}
```

Answer `200`:

```ts
{
  handledAt: date-time;
}
```

#### 93. `GET /api/results/reports/choices`

What the person may open in the results reports.

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `yearId` | query | no | `uuid` |

Answer `200`:

```ts
{
  year: {
    id: uuid;
    startDate: date;
    endDate: date;
    status: "planned" | "current" | "closed";
  } | null;
  years: {
    id: uuid;
    startDate: date;
    endDate: date;
    status: "planned" | "current" | "closed";
  }[];
  quarters: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
    notOfficial: boolean;
  }[];
  classes: {
    id: uuid;
    name: string;
    grade: integer;  // min 0, max 11
    language: "uz" | "ru";
  }[];
  subjects: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
  }[];
}
```

#### 94. `GET /api/results/reports/results-table`

The results table of one class in a quarter (Head Teacher, Senior Head Teacher: their subjects).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | yes | `uuid` |
| `classId` | query | yes | `uuid` |

Answer `200`:

```ts
{
  quarter: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
    notOfficial: boolean;
  };
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
  provisional: boolean;
  final: {
    closedAt: date-time;
    version: integer;  // min 1
  } | null;
  class: {
    id: uuid;
    name: string;
    grade: integer;  // min 0, max 11
  };
  subjects: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
    colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
  }[];
  rows: {
    student: {
      id: uuid;
      firstName: string;
      lastName: string;
      paternalName: string | null;
    };
    results: {
      subjectId: uuid;
      state: "number" | "exempt" | "not_assessed" | "no_result";
      value: integer | null;  // min 0, max 100
      grade: integer | null;  // min 2, max 5
    }[];
  }[];
}
```

#### 95. `GET /api/results/reports/subject-mastery`

Subject mastery for a subject in a quarter (Head Teacher, Senior Head Teacher).

Needs `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `quarterId` | query | yes | `uuid` |
| `subjectId` | query | yes | `uuid` |
| `grade` | query | no | `integer \| string /* ^(?:[0-9]\|1[01])$ */` |
| `classId` | query | no | `uuid` |
| `teacherId` | query | no | `uuid` |

Answer `200`:

```ts
{
  quarter: {
    id: uuid;
    number: integer;  // min 1, max 4
    startDate: date;
    endDate: date;
    closed: boolean;
    notOfficial: boolean;
  };
  prepared: {
    updatedAt: date-time | null;
    updating: boolean;
  };
  provisional: boolean;
  final: {
    closedAt: date-time;
    version: integer;  // min 1
  } | null;
  subject: {
    id: uuid;
    names: {
      uz: string;
      ru: string;
      en: string;
    };
    colour: "red" | "orange" | "amber" | "lime" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "brown";
  };
  bands: {
    grade: integer;  // min 2, max 5
    from: integer;  // min 0, max 100
    to: integer;  // min 0, max 100
    students: integer;  // min 0
    percent: integer | null;  // min 0, max 100
  }[];
  counted: integer;  // min 0
  exempt: integer;  // min 0
  notAssessed: integer;  // min 0
  noResult: integer;  // min 0
  choices: {
    grades: integer[];
    classes: {
      id: uuid;
      name: string;
      grade: integer;  // min 0, max 11
    }[];
    teachers: {
      id: uuid;
      name: string;
    }[];
    journals: {
      id: uuid;
      unit: {
        kind: "class" | "group";
        id: uuid;
        name: string;
      };
    }[];
  };
}
```

### Notifications

#### 96. `GET /api/notifications`

The person’s latest notifications, newest first, and how many are unread: only those sent to them as a Teacher, Head Teacher or Senior Head Teacher. The notices of every branch.

No `X-Branch-Id`.

Answer `200`:

```ts
{
  unreadCount: integer;  // min 0
  items: {
    id: uuid;
    kind: string /* ^[a-z]+(\.[a-z_]+)+$ */;  // length ≤ 100
    data: Record<string, unknown>;
    branchId: uuid | null;
    branchName: string | null;
    createdAt: date-time;
    readAt: date-time | null;
  }[];  // items ≤ 50
}
```

#### 97. `POST /api/notifications/read-all`

Mark read every notification the list shows through the key; the others stay unread.

No `X-Branch-Id`.

No request body.

Answer `204`, no body.

#### 98. `POST /api/notifications/{id}/read`

Mark one notification read. A notification the list does not show through the key answers 404 and stays unread.

No `X-Branch-Id`.

| Parameter | In | Required | Type |
| --- | --- | --- | --- |
| `id` | path | yes | `uuid` |

No request body.

Answer `204`, no body.

<!-- generated by pnpm api:client: end -->
