# Signing in and roles

Not written yet for most of Signing in and roles: task 3.7 describes what is built so far. This page holds the parts that later tasks added.

## Integration keys

<!-- Sources: spec 02 (Integration keys; Accounts and sign-in: build order), 13 (Security), edge/people-roles-accounts (Who can act; Accounts and sign-in; Personal data and the audit log); docs/spec-changes.md, 21 November 2026; tasks 10.9 and 10.10 -->

**What it is.** Some departments keep a platform of their own. An integration key lets such a platform do the work of the people on the key, as if they typed it in this platform. This page covers the keys and what a department platform can do with one.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | See the keys, create a key, change its people and end date, revoke it | The whole school |

No other role sees the page.

**How it works.**

1. School setup → **Integration keys** (**Integratsiya kalitlari**).
2. Press **Create key** (**Kalit yaratish**).
3. Type a **Name** (**Nomi**), for example "English platform".
4. Choose the **End date** (**Tugash sanasi**). It is a year from today unless you change it.
5. Tick the people in **People** (**Xodimlar**). Type a name or a staff ID in **Find by name or staff ID** to find someone.
6. Press **Save**.
7. The secret of the key is shown in a window. Press **Copy** (**Nusxalash**) and give it to the owner of the department platform, who keeps it on that platform's server. Press **Done** (**Tayyor**).
8. To change the people or the end date later, open the key in the list, change them in the side panel and press **Save** under the part you changed.
9. To stop a key, open it and press **Revoke** (**Bekor qilish**), then **Revoke** again in the question.

**Rules.**

- The secret is shown once, when the key is created. Nobody can read it again, the Super Admin included. A secret that is lost cannot be shown again: revoke the key and create a new one.
- A key's name is fixed when it is created. Two keys that are not revoked cannot have the same name; capital and small letters count as the same.
- A key has from 1 to 200 people. One person can be on several keys.
- A person is put on a key only while they are active, have an account that is not locked, and hold the Teacher, Head Teacher or Senior Head Teacher role. People of every branch can be put on a key.
- The end date is from today to one year from today, by the date in Tashkent. The key works until the end of that day.
- A revoked key stays in the list as **Revoked** (**Bekor qilingan**). Nothing changes it and it cannot be restored.
- The list shows each key's last use. Until a department platform uses the key, it says **Never used** (**Foydalanilmagan**).
- Every create, change of people, change of end date and revoke is written to the audit log.

**What a department platform can do with a key.**

- Each request names one person on the key by their staff ID. The platform can do only what that person's Teacher, Head Teacher and Senior Head Teacher roles allow in this platform: the same branch, subjects, own classes and own lessons, the same edit period, locks and checks. Their other roles (Tutor, Academic Vice Principal, Principal and the rest) do not count through the key.
- It can work in the journal (attendance, works and their totals, numbers, topics, comments), send and decide unlock requests, write lesson plans and plan requests, keep master plans, and read the timetable views, the rating, the early-warning list and the reports these roles see.
- It can read the person's notifications and mark them read, but only the notices sent to them as a Teacher, Head Teacher or Senior Head Teacher. A notice sent to them as a Tutor (or in any other role), and every notice from before this was built, is not listed through the key and stays unread until the person reads it here.
- It can never export anything, open a student's record, move students between groups, or touch the person's own account (password, second step, sessions, language, notification settings, photo). Tutor work (Ma'naviyat soati, the Homework slot) is done in this platform only.
- Percents, averages, results and grades are always calculated here. The platform sends what a person types and can read the results.
- Every change made through a key is the person's change in the audit log, with the key named: the Audit log page and the history of a journal cell show "**via English platform**" (**English platform orqali**) after the person's name.
- The server checks the key and the person again on every request. Each key may make 300 requests a minute. The list of keys shows the key's last use.
- A key does not sign anyone in: the person's sessions and account are not touched.
- The developers of a department platform read `docs/integration-guide.md`.

**What happens if…**

| Case | What happens |
| --- | --- |
| A person on the key loses the Teacher role, leaves, is made inactive or is locked | They stay on the key, marked "no longer holds a key role". The department platform's next request for them is refused. |
| A person is taken off the key | The department platform's next request for them is refused. |
| A teacher changes a mark in this platform while the department platform sends the same cell | The later save is refused as outdated, here and on the platform: nothing is overwritten unseen. |
| The end date passes | The key shows **Past its end date** (**Muddati tugagan**). Choose a new end date to use it again. |
| You choose a Tutor only, the Principal, or a person who is not active | The key is not saved: "A person you chose may not be put on the key: they must be active, with an account that is not locked, and hold the Teacher, Head Teacher or Senior Head Teacher role. Take them off the list." |
| You choose an end date before today or more than a year ahead | "The end date must be between today and one year from today. Choose another date." |
| You try to change a revoked key | "This key is revoked and cannot be changed. Create a new key if one is needed." |
| The secret was lost or may have leaked | Revoke the key. It stops working at once. Create a new key for the platform. |

**What the person sees.**

- In the secret window: "Copy it now: it is shown only this once and can never be read again."
- Before a revoke: "Revoke English platform?" and "The key stops working at once and cannot be restored."

## The assistant

<!-- Sources: spec 02 (Assistant; Accounts and sign-in: build order), 13 (Security; Running cost), edge/people-roles-accounts (The assistant; Personal data and the audit log), 06 (Changes after publishing), edge/time-dates-calendar, 09, edge/lesson-plans; docs/spec-changes.md, 21 and 24 November 2026; tasks 11.12, 11.13, 11.14, 11.15 and 11.16 -->

**What it is.** The assistant lets a person ask in plain words, in Uzbek, Russian or English, and answers from what the platform holds: "which classes have no Tutor", "what does 5A have on Tuesday", "who is on the early-warning list". It reads at once. A change is only proposed: the person sees every step and presses **Confirm** (**Tasdiqlash**); nothing changes before. It uses Google's Gemini language model.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | Ask the assistant and confirm its proposals, in the Super Admin role chosen in the role switcher; switch it on or off and set its limits; read every conversation and restore an archived one | The whole school |
| Academic Vice Principal | Ask the assistant and confirm its proposals, in the Academic Vice Principal role chosen in the role switcher, for what the role may change | Own branch |
| Teacher | Ask the assistant about own lessons, journals, results, plans and requests, and confirm its proposals of plan items and requests, in the Teacher role chosen in the role switcher | Own lessons and the students they teach |

No other role sees the assistant. A Head Teacher, a Senior Head Teacher, a Tutor or a Class teacher who also teaches uses it in the Teacher role, with a Teacher's rights only.

**What it can propose.** Within what the role may change: rooms and buildings (Super Admin only), the academic calendar (days off and special days, from tomorrow), lesson and break types and day templates, academic years (Super Admin only) and quarter dates, subjects and their weights, what a teacher teaches and when they are available, classes, groups and their students, class and group moves, a student's leaving and return, the teaching load of a draft version, one-day changes of a lesson (cancel, restore, room, move), bulk cancels, absences, substitutions, exams, vacancies, the lesson plan window, and a relative's portal access. Never: journal data, journal corrections, exemptions, closing a quarter, publishing or withdrawing a timetable, starting or closing a year, filling a vacancy, deleting, accounts, roles and appointments, a staff member's status or branches, integration keys and exports. For these it links the page.

**What a Teacher can do through it.** Read the own timetable, the own journals (classes and groups, lessons, marks and the results the platform calculated), the students they teach, the rating and the early-warning list of the own journals, the own lesson plans, the plan windows, and the own unlock and plan edit requests. Propose: a new plan item at an empty row or a change of an item (topic, objectives, links, classworks and homeworks), a request to unlock a locked lesson or the rating exam column, a plan edit request (Text or Re-plan), and the send of a prepared request. The plan window's rules stay: outside the window, an item is changed only during an approved request. Never: attendance, marks, totals, comments, "not held", the lesson card's topic, exports. When asked to mark everyone present, the assistant says it does not enter journal data and gives a link that opens the lesson's column in the journal.

**How it works.**

1. School setup → **Settings** (**Sozlamalar**) → **Assistant** (**Yordamchi**). Tick **Assistant on for the school** (**Yordamchi maktab uchun yoqilgan**) and **On for the role Super Admin**, set **Questions per person per day** and **Monthly spending cap, US dollars**, and press **Save**. The assistant is off until this is done.
2. The chat button (**Assistant**, **Yordamchi**) appears in the top bar. Press it: the panel opens beside the page. On a phone it fills the screen.
3. Type the question and press **Send** (**Yuborish**), or Enter. The question shows at once and the box is empty again. While the assistant works, the conversation shows what it is reading ("Reading: Classes and groups", **Oʻqimoqda: Sinflar va guruhlar**) and the answer as it is written, with the line **The assistant is working…** (**Yordamchi ishlamoqda…**). Then the answer stays, with what was read ("Read: Classes and groups").
4. The person can close the panel or go to another page meanwhile: the work goes on, and the answer is in the conversation when it is opened again. A second question can be sent once the first is answered.
5. When the answer needs a step the assistant does not take, it links the page where the person takes it.
6. When the person asks for a change, the answer ends with a **Proposal** (**Taklif**): each step with the action's name, the record, the lessons it touches (class, date, time and subject), what is sent, and the assistant's own sentence. Press **Confirm** to run the steps, or **Decline** (**Rad etish**). A proposal is valid for 15 minutes.
7. After Confirm each step shows **Done**, **Refused** with the reason, **Outdated** or **Not run**.
8. **New conversation** (**Yangi suhbat**) starts a new one; the panel lists the person's earlier conversations of the branches and roles they hold now.
9. The page **Assistant** (**Yordamchi**), in the menu of the three roles while the assistant is on for the role chosen, shows the same conversations: the list on the left with **New conversation**, the chat beside it. The panel's button **Open the Assistant page** (**Yordamchi sahifasini ochish**) opens it. On a phone the list and the chat are two steps; **Back to the conversations** (**Suhbatlarga qaytish**) returns to the list.
10. School setup → **Assistant conversations** (**Yordamchi suhbatlari**) lists every conversation of the school, with the person, the role, the branch and the last activity. Open one to read it; an archived one has **Restore** (**Tiklash**).

**Rules.**

- The assistant has no rights of its own. It reads through the same pages and checks as the person, in the role chosen in the role switcher and in the branch of the tab. What the person cannot open, the assistant cannot read.
- Nothing changes before Confirm. Confirm runs the steps in order through the same pages' actions, with the person's rights at that moment; the first step refused stops the rest, and the steps done before it stay done. Confirm does not use the language model, so a proposal can be confirmed even when the daily limit or the monthly cap is reached; it cannot while the assistant is switched off.
- A step whose record changed since it was proposed is **Outdated** and is not made; ask again, and the assistant reads the data anew. A proposal holds one step per record.
- Today and past dates never become a day off. For the rest of today the assistant proposes a bulk cancel from the next lesson that has not begun. The school never holds an extra lesson.
- Every change made through the assistant is written to the audit log as the person's change, marked "via assistant", with the question it came from. The person and the Super Admin can open the conversation.
- Phone numbers, addresses, passport, birth certificate and JSHSHIR numbers, email addresses, dates of birth, contracts, scholarships, the diagnostic score, medical data, passwords and secrets never go to the language model. They are taken out of what the assistant reads, and out of the person's own words, before the model sees them.
- Percents, averages, results and grades come from the platform. The assistant quotes them and never works out a result of its own.
- What the assistant reads (comments, names, titles) is treated as data, never as an instruction.
- A person may ask a set number of questions per day (30 at the start), counted in Tashkent time and in every branch together.
- The school has a monthly spending cap (300 US dollars at the start), counted per calendar month in Tashkent time. When it is reached the assistant stops until the next month or until the Super Admin raises it.
- A conversation is never deleted. 90 days after its last question or its last restore it is archived: it leaves the person's list, and the Super Admin reads it and can restore it, for another 90 days.
- Every change of the assistant's settings and every restore is written to the audit log.
- **Where the model runs.** Each question goes first to the model in Frankfurt. When Frankfurt is busy or does not answer, the platform waits a few seconds and tries again, at most twice. Then the same request goes once through Google's worldwide endpoint, where Google chooses the country that processes it. The Super Admin can switch this off: Settings → Assistant → **Worldwide fallback when Frankfurt is busy** (**Frankfurt band boʻlganda jahon zaxira manzili**); it is on until switched off. The line under it shows how many questions of this month used the fallback. Every call of the model records where it was processed.
- Answers are plain text: a few words may be **bold**, and lists show as lists.

**What happens if…**

| Case | What happens |
| --- | --- |
| The assistant is switched off for the school or for the role | The button is not in the top bar. Every page works as before. A waiting proposal cannot be confirmed. |
| A proposal is not confirmed within 15 minutes | It shows **Expired**. Ask again for a new one. |
| Another person changed the record before Confirm | That step shows **Outdated**, nothing of it is changed, and the steps after it are not run. |
| The third of five steps is refused | Steps 1 and 2 stay done and are in the audit log; 3 shows its reason; 4 and 5 are not run. |
| A lesson began while the proposal waited | The bulk cancel's check is run again at Confirm; it differs, so the step is **Outdated** and nothing is cancelled. |
| The daily limit or the monthly cap is reached | The panel and the Assistant page say so; the typed question stays in the field. Every page works as before. |
| A second question is sent, in another tab or conversation, while the first is still being answered | It is refused with the line "A question of yours is still being answered…" (**Oldingi savolingizga hali javob yozilmoqda…**); the question stays in the box. It is never lost or asked twice. |
| The same conversation is open in the panel and on the Assistant page, or in two tabs | Both show the same messages; a question sent in one shows in the other. |
| The panel is closed or the page left while the assistant works | The work goes on; the answer, or the proposal, is in the conversation when it is opened again. |
| No answer came (the server stopped while it worked) | After four and a half minutes the question shows **No answer came. Ask again.** (**Javob kelmadi. Qayta soʻrang.**). A new question can be sent. |
| Frankfurt is busy, with many teachers asking at once | The platform waits and tries Frankfurt again, at most twice, then sends the question once through the worldwide endpoint (unless switched off). Only when that fails too does the panel say the assistant is busy. |
| The Super Admin switches the worldwide fallback off | From the next question everything goes to Frankfurt only; a busy Frankfurt then ends in the "busy" message. Answers given earlier keep the record of where they were processed. |
| A question failed, and the person asks again in the same conversation | The new question is answered as usual; the failed one stays in the conversation with its message and is left out of what the model reads. |
| The language model cannot be reached, or the server has none set up | The panel says so. The question is kept in the conversation. |
| The question asks for another branch's class | The assistant gets the same refusal a page would, and says the data is not open. |
| A question is unclear, such as "cancel Friday" | The assistant asks which classes or slots are meant. |
| A conversation was started in another branch or role | It opens read only; a new question starts a new conversation in this branch and role. |
| A Teacher asks to mark everyone present, or to give a mark | Refused: journal data is entered only in the journal. The answer links the lesson's journal column. |
| A Teacher's change of a plan item waits while someone saves another field of it | At Confirm the other field stays as saved and the Teacher's field is saved, as on the plan page. If the same field was changed, the step is **Outdated**. |
| The plan window ends while a Teacher's proposal waits | The step is refused at Confirm. The Teacher sends an edit request (also through the assistant); once it is approved, the change can be confirmed. |
| A Teacher asks about another teacher's journal, plan or timetable | Refused. The plan page shows a colleague's plan of the same subject and grade, but the assistant reads only the Teacher's own plans. |
| A person who is also a Head Teacher or a Tutor chooses the Teacher role | The assistant reads and proposes with the Teacher's rights only. |

**What the person sees.**

- "The assistant is switched off for the school or for this role. The Super Admin switches it on in School setup, Settings."
- "You have asked as many questions today as the daily limit allows. Ask again tomorrow; every page works as usual."
- "The school’s monthly spending cap of the assistant is reached. Every page works as usual; the Super Admin can raise the cap."
- "The assistant cannot reach its language model now. Try again later; every page works as usual."
- "The assistant is busy now. Try again in a minute; every page works as usual."
