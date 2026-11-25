/** Task 11.19: the descriptions of the map of the platform, audit. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/audit/audit-page.tsx#button:audit.clear':
    'Removes the filter to one record and shows all matching entries again.',
  'features/audit/audit-page.tsx#column:audit.about': 'The person the entry is about.',
  'features/audit/audit-page.tsx#column:audit.action':
    'What happened, such as a record created, changed or archived, a sign-in or an export.',
  'features/audit/audit-page.tsx#column:audit.branch': 'The branch of the entry, or school-wide.',
  'features/audit/audit-page.tsx#column:audit.record': 'The record that was changed.',
  'features/audit/audit-page.tsx#column:audit.when': 'When the change or event happened.',
  'features/audit/audit-page.tsx#column:audit.who':
    'Who made the change, or the system; a change made through an integration key or the assistant says so.',
  'features/audit/audit-page.tsx#field:audit.from': 'The first day of the entries searched.',
  'features/audit/audit-page.tsx#field:audit.group':
    'Shows only one kind of entry, such as sign-in, people, timetable or journal.',
  'features/audit/audit-page.tsx#field:audit.person':
    'Shows only the entries about the chosen person.',
  'features/audit/audit-page.tsx#field:audit.personKind':
    'Chooses whether the entries are about a staff member, a student or a relative.',
  'features/audit/audit-page.tsx#field:audit.scope':
    'Searches this branch, all branches, or school-wide entries only.',
  'features/audit/audit-page.tsx#field:audit.to': 'The last day of the entries searched.',
  'features/audit/entry-panel.tsx#button:audit.show':
    'Shows the hidden values of the entry, such as personal details; the showing is itself recorded in the log.',
  'features/audit/entry-panel.tsx#panel':
    'The side panel of one audit entry: who, when, the reason and the values before and after.',
  'features/audit/forced-deletes-page.tsx#button:forcedDeletes.restore':
    'Restores the deleted record; a lesson whose time or room is now taken is refused with the reason.',
  'features/audit/forced-deletes-page.tsx#column:forcedDeletes.about':
    'The class, group or place the deleted record belonged to.',
  'features/audit/forced-deletes-page.tsx#column:forcedDeletes.deleted': 'Who deleted it and when.',
  'features/audit/forced-deletes-page.tsx#column:forcedDeletes.reason':
    'The reason typed when it was deleted.',
  'features/audit/forced-deletes-page.tsx#column:forcedDeletes.record':
    'The kind and name of the record deleted for good.',
  'features/audit/forced-deletes-page.tsx#column:forcedDeletes.state':
    'Whether it can still be restored, and until when, or was restored.',
};
