/** Task 11.19: the descriptions of the map of the platform, portal. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/portal/digest-log-page.tsx#button:digest.log.earlier':
    'Shows the previous page of digests.',
  'features/portal/digest-log-page.tsx#button:digest.log.later': 'Shows the next page of digests.',
  'features/portal/digest-log-page.tsx#column:digest.log.attempts':
    'How many times sending was tried.',
  'features/portal/digest-log-page.tsx#column:digest.log.children':
    "The parent's children the digest covers.",
  'features/portal/digest-log-page.tsx#column:digest.log.date': 'The day the digest is for.',
  'features/portal/digest-log-page.tsx#column:digest.log.login': "The parent's portal login.",
  'features/portal/digest-log-page.tsx#column:digest.log.parent': 'The parent the digest goes to.',
  'features/portal/digest-log-page.tsx#column:digest.log.sentAt': 'When the digest was sent.',
  'features/portal/digest-log-page.tsx#column:digest.log.status':
    'Whether the digest is waiting, delivered, not delivered, had nothing new, or had no linked or a blocked chat.',
  'features/portal/digest-log-page.tsx#field:digest.log.chooseDate':
    'The day whose digests are listed.',
  'features/portal/digest-log-page.tsx#field:digest.log.status':
    'Shows only the digests of one status, or all.',
};
