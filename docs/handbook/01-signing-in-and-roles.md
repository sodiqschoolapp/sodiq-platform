# Signing in and roles

Not written yet for most of Signing in and roles: task 3.7 describes what is built so far. This page holds the parts that later tasks added.

## Integration keys

<!-- Sources: spec 02 (Integration keys; Accounts and sign-in: build order), 13 (Security), edge/people-roles-accounts (Who can act; Accounts and sign-in; Personal data and the audit log); docs/spec-changes.md, 21 November 2026; task 10.9 -->

**What it is.** Some departments keep a platform of their own. An integration key lets such a platform do the work of the people on the key, as if they typed it in this platform. This page covers the keys themselves. What a department platform can do with a key is not built yet.

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

**What happens if…**

| Case | What happens |
| --- | --- |
| A person on the key loses the Teacher role, leaves, is made inactive or is locked | They stay on the key, marked "no longer holds a key role". The department platform cannot act for them. |
| The end date passes | The key shows **Past its end date** (**Muddati tugagan**). Choose a new end date to use it again. |
| You choose a Tutor only, the Principal, or a person who is not active | The key is not saved: "A person you chose may not be put on the key: they must be active, with an account that is not locked, and hold the Teacher, Head Teacher or Senior Head Teacher role. Take them off the list." |
| You choose an end date before today or more than a year ahead | "The end date must be between today and one year from today. Choose another date." |
| You try to change a revoked key | "This key is revoked and cannot be changed. Create a new key if one is needed." |
| The secret was lost or may have leaked | Revoke the key. It stops working at once. Create a new key for the platform. |

**What the person sees.**

- In the secret window: "Copy it now: it is shown only this once and can never be read again."
- Before a revoke: "Revoke English platform?" and "The key stops working at once and cannot be restored."
