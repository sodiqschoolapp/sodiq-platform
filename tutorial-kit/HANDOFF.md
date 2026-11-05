# Tutorial videos: handoff

Read this first in a new chat. It holds every decision and fact from the chat of 3–4 November 2026 in which the tutorial material was made. Nothing here is product code; it is the material for recording tutorial videos of the platform.

## Where we are (5 November 2026, morning): read this first

- **The owner is rehearsing** (guide Session 1: Sessions 2–4 done off camera) and is at **guide step 4.6 "Changes for Week 1"** of Session 4. The teaching load (4.1), the board (4.2) and the publish blockers were done with the console scripts below; the owner reported being at 4.6, so 4.3–4.5 are done. On the test site it is the break between quarter 1 (ended 31 October) and quarter 2 (starts Monday 9 November); the draft starts on 9 November. "Week 1" in the guide is the week of 9 November.
- **The guide** is the **Tutorial Recording Guide** (https://claude.ai/artifact/UZkxFkrEm7sygksVN9fNte). Every one of its 72 steps has numbered clicks with the app's exact English labels, written from the code and the e2e tests (not clicked through), with a green "You should see" line and a fold-out "Check during the rehearsal" list. Source: `kit/guide-src.mjs` (sessions), `kit/clicks/*.json` (the clicks per step id), `kit/guide.css`, `kit/guide.js`, `kit/guide-steps.json`. To change a step: edit its entry in `kit/clicks/<session>.json`, run `node kit/guide-src.mjs` (it also checks every deck slide is covered), then publish `kit/guide.html` to the same URL (Artifact publish with `url`). One Chrome profile per person (SA, AVP, Teacher, Tutor, Class teacher, Head Teacher, Senior HT, Principal, Spiritual VP, Head Tutor, Yunusobod AVP, Spare 1, Spare 2). The same demo students run through all sessions (leaver IS26063 Valiyev Elbek, class move IS26037, group move IS26055, PE-exempt girl IS26034 Valiyeva Kamila, relative prop on IS26057).
- **When the owner sends a screenshot** of a mismatch: read the code (`apps/web/src/i18n/locales/en.ts`, the feature, the e2e spec), explain, and fix the step in `kit/clicks`.
- **Console scripts** (generated into `kit/out/`, pasted into Chrome's console in the AVP window on the test site; each skips what already exists and checks every name before saving):
  - `add-teaching-load.js` from `kit/load-script.mjs`: the 112 rows of sheet 7.
  - `place-lessons.js` from `kit/board-script.mjs`: every lesson of the T <class> sheets, matched to slots by start time from the grid's `facts.days`; a group places its whole block.
  - `fill-weights.js` from `kit/weights-script.mjs`: missing daily (20/40/40) and quarter distributions (20/40/40, or 20/30/30 + exam 20) of the load's graded subjects, quarters not yet ended; the grades 0–4 split when needed.
  - Lessons learned: the AVP may not GET /api/setup/branches (403), so scripts read the branch from GET /api/auth/session (`branches`); headers `X-Branch-Id` and `X-App-Version: 1`; names are compared ignoring case, apostrophes and hyphens (the site has "Jismoniy 5D-6D Bolalar"); a vacancy is taken when it is the only one offered (the site calls it "AP Econ oʻqituvchisi").
- **Demo clock (task 10.5)**: built, merged ([sodiqschoolapp/sodiq-platform#280](https://github.com/sodiqschoolapp/sodiq-platform/pull/280)), deployed to the test site on 5 November 04:19 UTC. The Render Blueprint `sodiq-test` has **Sync paused**; its manual sync (create `DEMO_CLOCK=1` and `WEB_ORIGIN=https://app-test.sodiqschool.uz` on sodiq-test-api and sodiq-test-worker) was waiting for the owner's **Approve** at handoff. After it: Super Admin, School setup → Demo time. Forward only; the only way back is the demo data workflow (wipes the test database). Sign-in stays on real time. Jumps move time for the whole test site.
- **#281** (merged): the e2e server leaves the daily tick unscheduled (it stalled the page walk).
- **Flaky browser tests on main** that can skip `deploy-test` again: `student-import.spec.ts` (two "Import from Excel" links on the Students page, header and empty state) and `pages.spec.ts:204` (the Students heading not seen in 5 s). A re-run passed on 5 Nov. The owner has not yet answered whether to open a small fix PR (non-task PRs are merged by the owner; the review routine reviews them).
- **The loop**: after 10.5 the start routine starts the first unticked task, 5.10 Solver service; the owner was told and did not ask to pause it.
- **Academic Director test account**: recommended the shared Mathematics teacher of Demo Yunusobod and Demo Chilonzor (the login listed twice in the demo run Summary); the Super Admin resets the password and hands over the one-time slip (not the shared demo password). Quarter 2 plan window in the seed is open until 7 November; no lessons until 9 November unless the clock is moved. Do not touch Demo Yunusobod's quarter-1 closing (Session 7 films it).
- **Email password reset** only writes to the log (LogMailer, Phase 10 decision 16); the owner said no change is needed.
- **Differences found between the old plan and the app** (already in the clicks): no time-zone field on a new branch; drafts cannot be deleted (the practice draft stays); no "Double" button (tick **Double lesson**); a branch move is accepted only from its first day (release from today); acting Tutor "Until" is the first day without the class; Moliya exemptions one class at a time; the seeded unlock request exists only on some reset dates; Demo Yunusobod has a seeded Principal, Spiritual VP and Head Tutor.

## The goal (owner's words, summarised)

Tutorial videos for each role (Super Admin, Academic Vice Principal, Principal, Spiritual VP, Head Tutor, Tutor, Class teacher, Senior Head Teacher, Head Teacher, Teacher) that show **literally every feature** of each role. Videos will be clipped later per feature. Recorded on the **test site** (never production) in a new demo branch, with several browsers signed in as different people. Features that need days to pass must be shown without really waiting.

## What exists

### Published artifacts (private to the owner; links in claude.ai)

| Artifact | URL | Slides |
| --- | --- | --- |
| Recording plan (start here) | https://claude.ai/artifact/QKMf388eTYYyjQdvwLg7Qb | 25 |
| Super Admin deck | https://claude.ai/artifact/V8fBAkvnhG8Hkep8nx1bSP | 35 |
| Academic Vice Principal deck (3 video parts) | https://claude.ai/artifact/N5db8jb2oU3AEW9F4o91A2 | 52 |
| Teacher deck | https://claude.ai/artifact/3wwKm5Zqh8dypgpLCn4QPJ | 25 |
| Tutor deck | https://claude.ai/artifact/WB6TWkLz8j2Wm26Vx9ETAV | 18 |
| Class teacher deck | https://claude.ai/artifact/Vim8fuNim8d1QyKGr9WGsL | 19 |
| Head Teacher deck | https://claude.ai/artifact/E1iTC3DoPPPMcANJ5vZDAD | 21 |
| Senior Head Teacher deck | https://claude.ai/artifact/Neo8vLLMWCB4TpVGTXFkBK | 21 |
| Principal deck | https://claude.ai/artifact/LpSgFnxs1Ejj7y1sfsqZn2 | 17 |
| Spiritual and Moral VP deck | https://claude.ai/artifact/XF5fQSz32SPRt8sYbc3qN8 | 13 |
| Head Tutor deck | https://claude.ai/artifact/Jh7xkBKqhxWENAX9eCW5VH | 13 |
| **Tutorial Recording Guide** (the one page the owner follows: sessions 0–9, each step names the deck slides to film) | https://claude.ai/artifact/UZkxFkrEm7sygksVN9fNte | page |

Each feature slide: what it does, exact clicks (English screen words), what to show on camera, time rules, speaker notes as draft narration.

### Files in this folder

- `decks/`: the generator of the decks. `node gen.mjs dXX-name.mjs out/dXX` writes `out/dXX/project/deck.json` and `project/slides/sNNN.html` (Slides artifact type format). `LOGO_DARK=/_blob/<id>` sets the cover logo; the blob ids per deck: d00 `82bc48c35ce9ac366405b1d4d83fd7a1`, d01 `fe5143723edbc4605464cdccf05a63d9`, d02 `c272dd45c5eaeb8944831ca43b56b5fb`, d03 `4e1c57ac17ab0a059ed798b2c47b2991`, d04 `99abf6f3fc1110a4434d58fadf20e4cd`, d05 `003396fd72ffbe4799faae1e182a31b3`, d06 `406e1f124c8451369f4266be5f94db4c`, d07 `0cb1b625deabf8bb5df34be2cfe36b16`, d08 `913cfaaf8db2d3ef63c18176f06f3a3a`, d09 `e2a9286cd6c7c9ea6929a85933c81fd3`, d10 `8244ac68934320fc91a2981402482481`. To update a deck: edit the `.mjs`, regenerate, and publish the changed slide files to the deck's URL with `root` = `out/dXX` (a new session must `read` the artifact first). `check.cjs` finds overflow; `shot.cjs` screenshots slides. Brand: navy #06113C, orange #FF8A32, Golos Text and Bitter.
- `kit/out/`: the five kit files (also sent to the owner in chat):
  1. `1 Xodimlar importi - xatolar bilan.xlsx`: 52 staff, 3 planted mistakes (rows Alimov Bobur role "Super administrator"; Raximova Laylo + Sharipov Ilhom same phone; Haydarova Gulnoza subject "Matematka").
  2. `2 Xodimlar importi - toza.xlsx`: the same, clean.
  3. `3 Oʻquvchilar importi - xatolar bilan.xlsx`: 130 students, mistakes IS26020 (no contract number), IS26040 (class "Melborne"), IS26060/IS26061 (one phone, two names), plus the duplicate warning.
  4. `4 Oʻquvchilar importi - toza.xlsx`: clean, still with the duplicate warning (IS26901 = IS26039).
  5. `5 Demo filial maʼlumotlari.xlsx`: subjects, rooms, day templates, classes, groups, group members, teaching load (114 rows), one timetable sheet per class, working hours, planted props.
- `kit/kit-data.mjs`: all the data (invented people). `kit/lessons.json`: the 232 lessons of the eight classes with invented teachers. `kit/build.mjs`: rebuilds the five files from the platform's own Excel templates (`apps/api/dist/modules/people/*-import-template.js`; run `pnpm --filter @sodiq/api build` first if `dist` is missing) and reads them back through the platform's own import readers (`*-import-read.js`). Run `node build.mjs` in `kit/`.
- `kit/guide.html`: the Tutorial Recording Guide page, generated by `node kit/guide-src.mjs` from `guide-src.mjs` (sessions and steps), `guide.css`, `guide.js` and `guide-steps.json` (the build-step texts). The script also checks that every feature slide of every deck is filmed in some session. Since 4 Nov it replaces the older "Demo Branch Recording Kit" page at the same URL (owner found the kit page did not say which deck to open when).

The real timetables (PDFs the owner uploaded: Istirohat 13-variant grades 5–11, and primary grades 1–4 "Qumariq 3" dated 21.09.2026) carry real staff names, so they and their raw parse are **not** in the repository. The derived lessons with invented names are in `kit/lessons.json`.

## Decisions taken with the owner

- **Invented names everywhere** (test site holds invented data; `CLAUDE.md`). Structure (subjects, times, rooms, groups) copied one to one from the real sheets.
- **One demo branch "Istirohat demo"**; the primary sheets ("Qumariq 3") are treated as the **same branch** (owner, 4 Nov).
- **Eight classes** cover every timetable feature: 3 Genius (105), 3 Indigo (212, entered as a Russian-language class because its sheet has Oʻzbek tili), 5 Melbourne (208), 5 Tokyo (209), 5 London (204), 6 Imperial (207), 11 Princeton (407), 11 Yale (408).
- **Three bell schedules + Friday**: grades 5–8 lunch 12:40–13:20 (whole branch default); grades 1–4 lunch 11:45–12:25; grades 9–11 lunch 13:35–14:15; Friday grades 5–11 free 12:25–14:30 (template "Juma 5-11", "A weekday and a range of grades"). Slot types Lesson 40, Break 15, Lunch 40, Juma 125. All days end 16:05.
- **Groups (22)**: Matematika 5A/5B/5C and Ingliz 5A/5B/5C across 5 Melbourne, 5 Tokyo, 5 London (owner: maths and English are grouped; all of a grade's maths lessons sit at the same time); PE Boys/Girls 5AB, 5D6D (two grades: 5 London + 6 Imperial), grade 3, 11AB; Ingliz 3-1/3-2/3-3 (three groups from two classes, mixed Uzbek/Russian); Arab tili split inside 3 Genius and 3 Indigo (group 2 taught by a vacancy); Moliya 11AB (one group with every student of both classes).
- **Moliya**: both classes sit in one room because most students are exempt. Platform rule: every student of a grouped subject's classes must be in a group, or publish stops ("Students not placed", `load_group_gaps` blocks readiness and publish). So the group holds everyone and the 20 who don't take it get a **Full exemption** for Moliya (owner agreed). Room 407 capacity 30 < 32 gives only a warning.
- **Vacancies** (real ones from the sheets): "Arab tili" (grade 3 group 2), "AP Iqtisodiyot" (11 Princeton).
- **6 Imperial**: its real grade-6 maths/English blocks (with 6 Duke, 6 Johns Hopkins) are not built; entered as whole-class rows. Say so on camera.
- **Left out**: 11 UToronto "Ing tili (2 guruh)" with two teachers in one lesson (owner: ignore for now).
- **Class teacher** video uses Kamola Nurmatova, 3 Genius (no longer the seeded 0 London).
- Cross-branch features (teacher in two branches, travel time, Senior Head Teacher switching branches, branch moves), grade 0, two months of history: filmed in the seeded **Demo Yunusobod / Demo Chilonzor**. Mixed block: a practice draft never published.
- Office staff by hand (import gives only Teacher/Tutor): Principal Yoʻldoshev Rustam, AVP Fayzullayeva Nodira, Spiritual VP Valiyeva Shoira, Head Tutor Tojiboyev Ulugʻbek. Head Teacher Ergasheva Madina (Ingliz tili, Rus tili, Arab tili, Ona tili va adabiyot). Senior Head Teacher: the seeded one (Mathematics, Physics, Informatics).
- The owner confirmed teachers' multiple subjects will sit in one department; the one-department rule exempts a teacher's subjects taught only in grades 0–4 (checked per teacher's grades taught, `primary_grades_only` in migration 0152).

## Facts about the platform found in the code

- **Not built** (leave out of videos): automatic generation (5.10/5.11; builder step 6 says "Not yet available"), Free now board (5.7c), the "Requests" menu page, live journal updates (8.3b), offline entry (8.3c), close the year and rollover (9.5a–c), a screen to read feedback, own notification settings, the permission-matrix screen. PDF export answers "not available" on the test site (no Chromium): film Print and Excel.
- **Both timetables fit the platform** (checked: no teacher or room clashes; only the sport halls hold two groups at once). The only paper clash, "qoʻshimcha xona" on Tuesday 1–2, is two rooms (owner: qoʻshimcha xona 1 and 2).
- **Time rules**: lesson locks at 00:00 after lesson date + edit days (default 7, setting 1–30); "About to lock" notice 07:00 in the last 48 h; unlock 1–7 days; plan window reminders 3 days before and on the last day at 07:00; closing checklist opens 14 days before quarter end; close on the last day or later; reminder every 07:00 after; nightly check 02:00; forced-delete restore 30 days; export links 24 h; first password 7 days; admin reset 24 h; email reset link 1 h; idle sign-out 30 min (15 for SA/AVP); trusted device 7 days; publish and setup changes from tomorrow at the earliest; attendance entry only from the lesson's start time. Daily jobs: pg-boss `schedule.tick` every 15 min, each job once per branch date.
- **Builder step 3 needs working hours for every teacher with lessons** (Tutors too); the import cannot carry them.
- **Demo seed** (`apps/api/src/testing/demo/`): Demo Yunusobod (0 London, 5 Oxford, 5 Cambridge, 7 Oxford, 7 Princeton, 9 Yale) and Demo Chilonzor; year 2 Sep 2026–25 May 2027, Q1 2 Sep–31 Oct, Q2 9 Nov–26 Dec, Q3 11 Jan–20 Mar, Q4 30 Mar–25 May; history up to yesterday; deliberate forgotten day, an unlock request waiting, an ended PE exemption, Q2 plan window to 7 Nov; no rating exams; `DEMO_TODAY` env shifts its "today". 14 school-wide subjects (Matematika, Ona tili, Adabiyot, Rus tili, Ingliz tili, Tarix, Geografiya, Biologiya, Fizika, Kimyo, Informatika, Tasviriy san'at, Jismoniy tarbiya, Texnologiya); departments STEAM, Xorijiy tillar, Milliy fanlar, Tabiiy fanlar, Umumiy fanlar, Tyutorlar. Seed phones +998 99 0…; the kit uses +998 97 (staff) and +998 93/94 (parents).
- **Imports**: system template only (hidden key row 1, headings row 2, data from row 3); lists in any of the three languages; dates dd.mm.yyyy; staff import roles only Teacher or Tutor; students need uid, names, sex, birth date, grade, start date, contract number and date, a relative with relationship; a start date today or earlier needs a class; one relative phone under two names in one file is refused; same name + birth date is a warning to tick.

## Time: three options (in the Recording plan)

- **A. Seeded past**: film history-dependent scenes in Demo Yunusobod (works today; its Q1 is already over, so closing can be filmed now).
- **B. Compressed year**: demo branch with one-week quarters and edit days 1 (works today; try saving one-week quarters first).
- **C. Demo clock**: built as task 10.5 (see the top of this file).

## The recording order given to the owner (last answer)

1. Decide the demo clock. 2. Prepare (read the Recording plan; phone authenticator; browsers). 3. Rehearse kit steps A1 and 1–23 off camera; report mismatches. 4. Re-run the demo workflow (wipe). 5. Record the build on a Thursday/Friday: Super Admin video (kit steps 1–10), AVP part 1 (11–19), AVP part 2 (20–22), publish from next Monday. 6. Monday, during lessons: Teacher, Tutor, Class teacher videos, Head Teacher first half, AVP day changes, exams, absences, Moliya exemptions (kit 23). 7. Time-dependent scenes (locks, unlocks, plan window end, scheduled moves, exemption end, IS26902 on 01.12) via demo clock or real days. 8. AVP part 3 (closing) in Demo Yunusobod now. 9. Read-only roles (Principal, Spiritual VP, Head Tutor, Senior Head Teacher). 10. Clip per feature. Shortcut: Demo Yunusobod's today's lessons are empty on purpose, so Teacher/Tutor/Class teacher scenes can be filmed there any school day.

## Open questions

- 3 Indigo Arabic: the PDF shows three a week (Wednesday lesson 5, Thursday lessons 3 and 8); the owner asked whether it is only one. Kept as the paper until the owner says otherwise.
- English "(guruhlar)": the kit assumes ability groups across the grade's classes, one per teacher; the owner has not confirmed.
- 3 Indigo really Russian-language? (assumed from its Oʻzbek tili lessons).
