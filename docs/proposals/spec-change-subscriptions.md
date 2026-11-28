# Spec change proposal: the school's subscriptions

Requested by the owner, 28 November 2026, in chat. Status: **approved by the owner in full on 28 November 2026 and applied** (`docs/spec-changes.md`, 28 November 2026, the school's subscriptions). The edge cases of section 3 are in `03`, Subscriptions. The task that builds it is 11.28 in `docs/build-plan.md`.

## 1. The request

One simple page in the admin panel to keep track of the subscriptions the school has bought: software, online services, hosting, licences. The owner's answers in chat:

- Only the Super Admin sees and uses the page. The Principal does not see it.
- Prices are in UZS or USD.
- Renewal reminders come later, not in the first version.

The spec has no such page today. `11`, "Not planned", lists "Payments, finance, payroll". This list is not that: the platform pays nothing, and nothing else reads the list.

## 2. Wording for `/spec-change`

### 2.1 `03-school-setup.md`

A row in the table at the top, after "Grade bands":

> | Subscription | What the school pays for regularly: software, online services, hosting, licences. See Subscriptions below. | Super Admin |

A new section at the end of the file:

> ## Subscriptions
>
> The Super Admin keeps one list of what the school pays for regularly. It is a record only: the platform pays nothing, contacts no provider, and no other screen reads the list. No other role sees it.
>
> | Field | Rules |
> | --- | --- |
> | Name | Required, at most 100 characters. |
> | Provider | Optional. |
> | Website | Optional, a web address. |
> | Purpose | Optional, what it is used for. |
> | Branch | One branch, or the whole school (the default). |
> | Plan and seats | Optional: the plan's name, and a whole number of seats of at least 1. |
> | Price and currency | Required. The price per billing period, 0 or more, in UZS (whole so'm) or USD (at most two decimal places). |
> | Billing | Monthly, yearly or one-time. |
> | Start date | Required. |
> | Next renewal | Required for monthly and yearly, after the start date. A one-time purchase has none. |
> | Auto-renews | Yes or no. |
> | Responsible person | Optional, an active staff member. |
> | Account email | Optional: the email the account is signed in with. A password, key or card number is never stored here. |
> | Notes | Optional, at most 1,000 characters. |
>
> The list shows the name, provider, branch, plan and seats, the price per period, the next renewal with the days left, auto-renews, the responsible person and the state. It opens on the active subscriptions, sorted by the next renewal, one-time purchases last. A renewal in the next 30 days is marked as due soon, and a past one as overdue. It can be filtered by branch and searched by name or provider. Above the list, the yearly cost of the active subscriptions, one total per currency: a monthly price counts 12 times, a yearly price once, a one-time purchase not at all. The two currencies are never added together.
>
> "Renewed" moves the next renewal forward by one billing period. "Cancel" archives the subscription with an end date; it can be restored. Every change is in the audit log. Reminders before a renewal are for later.

### 2.2 `02-roles-and-access.md`

In the Super Admin row, after "switches codes on or off for a subject (`09`, Codes)":

> , keeps the list of the school's subscriptions (`03`, Subscriptions)

### 2.3 `11-later-modules.md`

In "Not planned", at the end of the reason of the row "Payments, finance, payroll":

> The list of the school's own subscriptions (`03`, Subscriptions) is a record, not finance: it pays nothing and nothing else reads it.

## 3. Edge cases

| Case | What happens |
| --- | --- |
| A monthly subscription with the next renewal on or before the start date | Refused. |
| A one-time purchase sent with a next renewal date | Refused. |
| Changed from monthly to one-time | The next renewal is cleared in the same save. |
| A USD price with three decimal places, or a UZS price with any decimal places | Refused. |
| "Renewed" on a monthly subscription renewing on 31 January | The next renewal moves to the last day of February: when the day does not exist in the next month, its last day is taken. |
| "Renewed" pressed twice, from two tabs | The second one is refused as outdated (record version), so the date moves only once. |
| The responsible person leaves the school | The subscription keeps them, shown with a mark that they left; a new choice offers active staff only. |
| A branch is archived | Its subscriptions keep the branch, shown with the archived mark. |
| A cancelled subscription | It drops out of the yearly total and the renewal marks, and shows under the cancelled switch with its end date. |
| Any role other than the Super Admin, through a screen, the API, an integration key or the assistant | Refused. |
