# Integration guide for department platforms

This guide is for the developers of a department platform (for example the English or the Mathematics department's own platform) that works with the Sodiq School platform through an integration key. It describes what is built in task 10.10. The rules come from `docs/spec/02-roles-and-access.md`, Integration keys.

## What a key is

The Super Admin creates a key, puts people on it, and gives it to the owner of the department platform. The secret starts with `sodiq_ik_`. It is shown once and the school keeps only its hash, so a lost secret cannot be shown again. Ask the Super Admin to revoke the key and create a new one.

- Keep the secret on the platform's **server** only, as you would a password. Never put it in a web page, a browser, a phone app, a repository or a log. A request made from a user's device would carry the secret to that device.
- Send requests over **HTTPS** only. A request that reaches the server over plain HTTP is refused: `400 integration_key_https_required`.
- A key works until the end of its end date (Tashkent time). After that it is refused until the Super Admin sets a new end date.

## Every request

Send these headers:

| Header | Value |
| --- | --- |
| `X-Integration-Key` | The secret of the key. |
| `X-Acting-Staff-Id` | The staff ID (`S-YYNNNN`) of the person the request acts for. Leave it out only on `GET /api/integration/people`. |
| `X-Branch-Id` | The branch the request is about, as on every route of the API. |
| `Content-Type: application/json` | On every request with a body. |
| `Idempotency-Key` | A new random UUID for each change that takes one (the routes say so in the OpenAPI document). A repeat with the same key and the same person does nothing twice. |

Do not send a cookie. A request with a key never reads one: it acts only for the person you name, whatever cookie it carries.

**The person.** A request acts for exactly one person on the key, with exactly what that person's **Teacher**, **Head Teacher** and **Senior Head Teacher** roles allow in this platform. The same branch, subjects, own classes and own lessons apply, and so do the same edit periods, locks, cell versions and checks. The person's other roles (Tutor, Academic Vice Principal, Principal and the rest) do not count through a key. Tutor work (Ma'naviyat soati, the Homework slot) is refused: `403 integration_key_tutor_lesson`.

The server checks everything again on each request: the key is not revoked or ended, the person is still on the key, active, not locked, and holds one of the three roles. A change made by the Super Admin counts from the next request.

## Who is on the key

`GET /api/integration/people`, with the key and without `X-Acting-Staff-Id`, answers:

```json
{
  "key": "English platform",
  "people": [
    {
      "staffId": "S-260042",
      "firstName": "Malika",
      "lastName": "Rahimova",
      "usable": true,
      "branches": [{ "id": "…", "name": "Labzak" }],
      "allBranches": false
    }
  ]
}
```

`usable` is false while the platform cannot act for the person: inactive, left, locked, or holding none of the three roles. `branches` are the branches of the person's Teacher and Head Teacher roles, for `X-Branch-Id`. `allBranches` is true for a Senior Head Teacher, who works in every branch. A session of this platform never gets this answer.

## The routes open to keys

Only a fixed list of routes accepts a key. Every other route answers `403 integration_key_route_closed`. In the OpenAPI document (`apps/api/openapi.generated.json`) each open operation carries `"x-open-to-integration-keys": true`. The list is also in `docs/security/permission-checklist.md`, "Routes open to integration keys". In short:

- the journal: the list of journals, a journal's grid, a lesson's card, the history of a cell, attendance, "all present", copying attendance, works and their totals, numbers, "not graded", topics, the homework given, comments, and the rating exam's date, entries and "not held";
- unlock requests: sending and withdrawing them (Teacher), and deciding them (Head Teacher, Senior Head Teacher);
- lesson plans, their files and plan requests, the plan windows and minimums, master plans;
- timetable views, the rating, the early-warning list, and the reports these roles view;
- `GET /api/integration/people`.

These are **never** open to a key: exports, a student's record (profile, diagnostic score, history), moving students between groups, the person's own account (password, second step, sessions, trusted devices, language, notification settings, photo), notifications, and the live connection. A route added to the platform later stays closed to keys until a task opens it.

## Reading and writing safely

- **Read before you write.** Read the journal grid (`GET /api/journal/journals/{journalId}`) for the lesson's columns, the work ids and the version of every cell.
- **Send the version you read.** Every cell save carries the version of the cell as you read it (`null` for a cell that is still empty). When someone else saved the cell since you read it, in this platform or through another key, the save is refused with `409 cell_stale` and nothing changes. Read the cell again, show the person both values, and save again only if the person still wants their value. Never retry with the new version without asking: that overwrites a change nobody saw.
- **Retrying a create.** When a create (a new work, an unlock request) got no answer, read again before you retry. A request with the same `Idempotency-Key` returns the first answer instead of creating twice, but a new key creates a second record.
- **Send what a person types, never results.** Attendance marks, works and their totals, the numbers typed, topics, comments and plans. Percents, averages, results and grades are calculated only by this platform. You can read them, but you cannot send them.

## The limit

Each key may make **300 requests a minute**, counted across all its people. Every request with a valid key counts, including refused ones. Over the limit the answer is `429 integration_key_rate_limited`, with a `Retry-After` header giving the seconds to wait. Wait that long, then go on. Spread a large sync over several minutes.

## The audit log

Every change made through a key is recorded as the person's own change, with the key named. The Audit log page and a cell's history show "Malika Rahimova via English platform". Reads are not logged one by one, just as ordinary page views are not.

## Refusals of a key request

Every error has the shape `{ "error": { "code": "…", "message": "…", "requestId": "…" } }`.

| Status and code | Meaning |
| --- | --- |
| `400 integration_key_https_required` | The request did not come over HTTPS. |
| `401 integration_key_invalid` | The secret is not a key of the school (mistyped, empty, or sent twice). |
| `401 integration_key_revoked` | The key was revoked. Ask the Super Admin for a new key. |
| `401 integration_key_ended` | The key is past its end date. |
| `429 integration_key_rate_limited` | Over the limit. Wait `Retry-After` seconds. |
| `403 integration_key_route_closed` | This route is not open to keys. |
| `400 validation_failed` (path `X-Acting-Staff-Id`) | The staff ID is missing or malformed. |
| `403 integration_key_person_refused` | The person is not on the key, or is not active, is locked, has left, or holds none of the three roles. |
| `403 integration_key_tutor_lesson` | Tutor work is done in this platform. |
| `403 permission_denied` and the scope codes of each route | The person may not do this, exactly as in this platform. |
| `409 cell_stale` | The cell changed since you read it (above). |
| `409 journal_locked` | The lesson is past its edit period. The Teacher sends an unlock request. |
