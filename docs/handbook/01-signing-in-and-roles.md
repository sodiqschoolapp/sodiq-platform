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

<!-- Sources: spec 02 (Assistant; Accounts and sign-in: build order), 13 (Security; Running cost), edge/people-roles-accounts (The assistant; Personal data and the audit log); docs/spec-changes.md, 21 November 2026; task 11.12 -->

**What it is.** The assistant lets a person ask in plain words, in Uzbek, Russian or English, and answers from what the platform holds: "which classes have no Tutor", "what does 5A have on Tuesday", "who is on the early-warning list". In this first part it only reads and answers; it changes nothing. It uses Google's Gemini language model.

**Who can use it.**

| Role | What the role may do | Where |
| --- | --- | --- |
| Super Admin | Ask the assistant, in the Super Admin role chosen in the role switcher; switch it on or off and set its limits; read every conversation and restore an archived one | The whole school |

No other role sees the assistant yet. The Academic Vice Principal and the Teacher get it later.

**How it works.**

1. School setup → **Settings** (**Sozlamalar**) → **Assistant** (**Yordamchi**). Tick **Assistant on for the school** (**Yordamchi maktab uchun yoqilgan**) and **On for the role Super Admin**, set **Questions per person per day** and **Monthly spending cap, US dollars**, and press **Save**. The assistant is off until this is done.
2. The chat button (**Assistant**, **Yordamchi**) appears in the top bar. Press it: the panel opens beside the page. On a phone it fills the screen.
3. Type the question and press **Send** (**Yuborish**), or Enter. The answer comes in the panel. Under the question the panel shows what was read, for example "Read: Classes and groups".
4. When the answer needs a step the assistant does not take, it links the page where the person takes it.
5. **New conversation** (**Yangi suhbat**) starts a new one; the panel lists the person's earlier conversations.
6. School setup → **Assistant conversations** (**Yordamchi suhbatlari**) lists every conversation of the school, with the person, the role, the branch and the last activity. Open one to read it; an archived one has **Restore** (**Tiklash**).

**Rules.**

- The assistant has no rights of its own. It reads through the same pages and checks as the person, in the role chosen in the role switcher and in the branch of the tab. What the person cannot open, the assistant cannot read.
- It reads only. It never enters journal data, grants exemptions, closes a quarter, publishes a timetable, starts or closes a year, deletes, changes accounts, passwords, roles or permissions, or exports. For these it links the page.
- Phone numbers, addresses, passport, birth certificate and JSHSHIR numbers, email addresses, dates of birth, contracts, scholarships, the diagnostic score, medical data, passwords and secrets never go to the language model. They are taken out of what the assistant reads, and out of the person's own words, before the model sees them.
- Percents, averages, results and grades come from the platform. The assistant quotes them and never works out a result of its own.
- What the assistant reads (comments, names, titles) is treated as data, never as an instruction.
- A person may ask a set number of questions per day (30 at the start), counted in Tashkent time and in every branch together.
- The school has a monthly spending cap (300 US dollars at the start), counted per calendar month in Tashkent time. When it is reached the assistant stops until the next month or until the Super Admin raises it.
- A conversation is never deleted. 90 days after its last question or its last restore it is archived: it leaves the person's list, and the Super Admin reads it and can restore it, for another 90 days.
- Every change of the assistant's settings and every restore is written to the audit log.

**What happens if…**

| Case | What happens |
| --- | --- |
| The assistant is switched off for the school or for the role | The button is not in the top bar. Every page works as before. |
| The daily limit or the monthly cap is reached | The panel says so; the typed question stays in the field. Every page works as before. |
| The language model cannot be reached, or the server has none set up | The panel says so. The question is kept in the conversation. |
| The question asks for another branch's class | The assistant gets the same refusal a page would, and says the data is not open. |
| A question is unclear, such as "cancel Friday" | The assistant asks which classes or slots are meant. |
| A conversation was started in another branch or role | It opens read only; a new question starts a new conversation in this branch and role. |
| A person who also teaches chooses the Teacher role | The assistant is not there: the Teacher gets it in a later part. |

**What the person sees.**

- "The assistant is switched off for the school or for this role. The Super Admin switches it on in School setup, Settings."
- "You have asked as many questions today as the daily limit allows. Ask again tomorrow; every page works as usual."
- "The school’s monthly spending cap of the assistant is reached. Every page works as usual; the Super Admin can raise the cap."
- "The assistant cannot reach its language model now. Try again later; every page works as usual."
