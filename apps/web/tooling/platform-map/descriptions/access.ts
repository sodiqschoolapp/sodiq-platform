/** Task 11.19: the descriptions of the map of the platform, access. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/access/app-menu.tsx#button:account.title': "Opens the person's own account page.",
  'features/access/app-menu.tsx#button:layout.account':
    'Opens the person menu with Account, Change password, the theme and the language.',
  'features/access/app-menu.tsx#button:layout.changePassword':
    "Opens the page to change the person's own password.",
  'features/access/app-menu.tsx#button:layout.signOut':
    'Signs the person out of the platform on this device.',
  'features/access/app-menu.tsx#button:menu.close': 'Closes the More dialog.',
  'features/access/app-menu.tsx#button:menu.expand':
    'Widens the side menu to show the names of the sections, or narrows it back to icons.',
  'features/access/app-menu.tsx#button:menu.more':
    "Opens the More dialog with the other sections of the menu and the person's own entries.",
  'features/access/app-menu.tsx#panel:menu.more':
    'The More dialog of the phone tab bar: the other sections of the menu, the account, change password and sign out.',
  'features/access/attention-line.tsx#button:layout.attentionHide':
    'Shows or hides the alerts that need attention, folded into one line on a phone.',
  'features/access/integration-keys-page.tsx#button:integrationKeys.copied':
    'Copies the secret of the new key to the clipboard.',
  'features/access/integration-keys-page.tsx#button:integrationKeys.create':
    'Opens the form to create a new integration key with a name, an end date and its people.',
  'features/access/integration-keys-page.tsx#button:integrationKeys.done':
    'Closes the secret dialog; the secret is not shown again.',
  'features/access/integration-keys-page.tsx#button:integrationKeys.revoke':
    'Revokes the key after a confirmation: it stops working at once and cannot be restored.',
  'features/access/integration-keys-page.tsx#column:integrationKeys.endsOn':
    'The date after which the key stops working.',
  'features/access/integration-keys-page.tsx#column:integrationKeys.lastUsed':
    'When the key was last used, or that it was never used.',
  'features/access/integration-keys-page.tsx#column:integrationKeys.name':
    'The name of the integration key.',
  'features/access/integration-keys-page.tsx#column:integrationKeys.people':
    'The people the key lets the department platform work for.',
  'features/access/integration-keys-page.tsx#column:integrationKeys.state':
    'Whether the key is active, past its end date or revoked.',
  'features/access/integration-keys-page.tsx#field:integrationKeys.endsOn':
    'The end date of the new key, at most one year from today.',
  'features/access/integration-keys-page.tsx#field:integrationKeys.endsOn:2':
    "Changes the end date of an existing key, at most one year from today; saved with the key's people.",
  'features/access/integration-keys-page.tsx#field:integrationKeys.findPerson':
    'Narrows the list of people by name or staff ID.',
  'features/access/integration-keys-page.tsx#field:integrationKeys.name':
    'The name of the new key, to tell it apart in the list.',
  'features/access/integration-keys-page.tsx#field:integrationKeys.people':
    'The staff members the key works for; tick them in the list.',
  'features/access/integration-keys-page.tsx#panel:integrationKeys.secretTitle':
    'Shows the secret of the new key once, to copy it now; it can never be read again.',
  'features/access/switchers.tsx#button:switcher.roleButton':
    "Opens the role switcher, which changes the menu and home page to another of the person's roles. The rights stay those of all the person's roles.",
  'features/access/app-menu.tsx#tab:account.title':
    "Opens the person's own account page (/account): language, photo, password and the second step.",
  'features/access/app-menu.tsx#tab:layout.changePassword':
    "Opens the page to change the person's own password (/account/password).",
};
