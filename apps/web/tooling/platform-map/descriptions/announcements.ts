/** Task 11.19: the descriptions of the map of the platform, announcements. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/announcements/announcement-form.tsx#field:announcements.form.audience':
    'Who the new entry is for: the whole school, this branch, chosen grades or chosen classes of the branch. It cannot be changed later.',
  'features/announcements/announcement-form.tsx#field:announcements.form.body':
    'The text of the announcement or event.',
  'features/announcements/announcement-form.tsx#field:announcements.form.classes':
    'The classes of the branch the entry is for.',
  'features/announcements/announcement-form.tsx#field:announcements.form.endsAt':
    'The time the event ends.',
  'features/announcements/announcement-form.tsx#field:announcements.form.firstDate':
    'The first day of the event.',
  'features/announcements/announcement-form.tsx#field:announcements.form.forParents':
    'Shows the entry to the parents of the audience; parents with the school bot also get it as a message, outside the quiet hours.',
  'features/announcements/announcement-form.tsx#field:announcements.form.forStaff':
    'Shows the entry to the staff of the audience.',
  'features/announcements/announcement-form.tsx#field:announcements.form.grades':
    'The grades of the branch the entry is for.',
  'features/announcements/announcement-form.tsx#field:announcements.form.kind':
    'Whether the new entry is an announcement (news) or an event with dates, times and a place.',
  'features/announcements/announcement-form.tsx#field:announcements.form.lastDate':
    'The last day of the event.',
  'features/announcements/announcement-form.tsx#field:announcements.form.place':
    'Where the event takes place.',
  'features/announcements/announcement-form.tsx#field:announcements.form.startsAt':
    'The time the event starts.',
  'features/announcements/announcement-form.tsx#field:announcements.form.title':
    'The title of the announcement or event.',
  'features/announcements/announcement-month.tsx#button:announcements.nextMonth':
    'Shows the next month.',
  'features/announcements/announcement-month.tsx#button:announcements.previousMonth':
    'Shows the previous month.',
  'features/announcements/announcement-month.tsx#tab:announcements.view':
    'Shows the month as a list or on a calendar.',
  'features/announcements/announcements-manage-page.tsx#button:announcements.manage.add':
    'Opens the form for a new announcement or event.',
  'features/announcements/announcements-manage-page.tsx#button:announcements.manage.archive':
    'Archives the announcement after a confirmation: it leaves the pages of staff and parents, and messages not sent yet are not sent.',
  'features/announcements/announcements-manage-page.tsx#button:announcements.manage.restore':
    'Restores the archived announcement after a confirmation; it is shown again and no message is sent again.',
  'features/announcements/announcements-manage-page.tsx#button:form.edit':
    'Opens the form to change the text, dates, times or place of the announcement.',
  'features/announcements/announcements-manage-page.tsx#column:announcements.form.audience':
    'Where it is published and for whom: staff, parents or both.',
  'features/announcements/announcements-manage-page.tsx#column:announcements.form.kind':
    'Whether it is an announcement or an event.',
  'features/announcements/announcements-manage-page.tsx#column:announcements.manage.messages':
    'How many messages to parents were delivered, are waiting or were not delivered, or that it is for staff only.',
  'features/announcements/announcements-manage-page.tsx#column:announcements.manage.published':
    'When it was published.',
  'features/announcements/announcements-manage-page.tsx#column:announcements.manage.status':
    'Whether it is active or archived.',
  'features/announcements/announcements-manage-page.tsx#column:announcements.manage.titleColumn':
    'The title of the announcement or event.',
};
