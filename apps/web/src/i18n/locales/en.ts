import type { ErrorCode } from '@sodiq/shared';

/**
 * The English texts. Their keys are the shape that the Uzbek and the Russian
 * file must match (`Texts` in shape.ts): a key that is missing in one language
 * fails the type-check, the build and the test in locales.test.ts.
 *
 * A text that depends on a number has one key per plural form of the language
 * (`_one`, `_other`; Russian also `_few` and `_many`).
 */
export const en = {
  app: {
    name: 'Sodiq School',
    loading: 'Loading…',
  },
  language: {
    label: 'Language',
  },
  problems: {
    noAnswer: 'The server did not answer. Check the internet connection and try again.',
    unexpected:
      'Something went wrong in the app. Reload the page. If it happens again, tell an administrator.',
    title: 'The page could not be opened',
    retry: 'Try again',
    notFoundTitle: 'Page not found',
    notFoundText: 'There is no page at this address. Check the address or go to the home page.',
    toHome: 'To the home page',
    wait_one: 'Too many failed attempts. Try again in {{count}} second.',
    wait_other: 'Too many failed attempts. Try again in {{count}} seconds.',
  },
  // What a person sees for each refusal of the server: what happened and what to do next.
  errors: {
    validation_failed: 'Some of the entered data is not valid. Check the fields and try again.',
    malformed_request: 'The request could not be read. Reload the page and try again.',
    not_found: 'Not found. It may have been removed, or the address is wrong.',
    payload_too_large: 'Too much data was sent at once. Send less and try again.',
    unsupported_media_type:
      'The request was sent in a form the server does not read. Reload the page and try again.',
    not_signed_in: 'You are not signed in. Sign in again.',
    sign_in_failed: 'The login or the password is wrong. Check both and try again.',
    too_many_attempts: 'Too many failed attempts. Wait a little and try again.',
    password_expired:
      'This one-time password is no longer valid. Ask an administrator for a new one.',
    account_locked: 'This account is locked. Ask an administrator.',
    password_change_required: 'Change your password before you continue.',
    current_password_wrong: 'The current password is wrong.',
    password_unchanged: 'The new password is the same as the current one. Choose another one.',
    second_step_required: 'Enter the code of the second step before you continue.',
    second_step_set_up_required: 'Set up the second step before you continue.',
    second_step_code_wrong:
      'The code is wrong or was already used. Wait for the next code in the app and try again.',
    second_step_already_on: 'The second step is already set up.',
    second_step_not_on: 'No set-up of the second step is in progress. Start again.',
    second_step_cannot_turn_off: 'Your role requires the second step. It cannot be turned off.',
    permission_denied: 'You do not have permission for this action.',
    own_request: 'You cannot decide your own request. It goes to another approver.',
    cross_site_request:
      'The request was refused because it came from another site. Open the platform directly and try again.',
    request_key_reused:
      'This action was already sent with other data. Reload the page and try again.',
    request_refused: 'The request was refused. Try again or ask an administrator.',
    internal_error:
      'Something went wrong on the server. Try again in a moment. If it happens again, tell an administrator.',
  } satisfies Record<ErrorCode, string>,
  signIn: {
    title: 'Sign in',
    login: 'Login',
    password: 'Password',
    submit: 'Sign in',
    trust: 'Trust this device',
    trustNote: 'You stay signed in here for 7 days. Do not use on a shared computer.',
    loginMissing: 'Enter your login.',
    passwordMissing: 'Enter your password.',
    sessionEnded: 'Your session has ended. Sign in again.',
  },
  code: {
    title: 'Second step',
    text: 'Enter the 6-digit code from your authenticator app, or one of your recovery codes.',
    label: 'Code',
    missing: 'Enter the code.',
    submit: 'Continue',
  },
  password: {
    titleForced: 'Choose a new password',
    titleOwn: 'Change password',
    textForced: 'You signed in with a one-time password. Choose your own before you continue.',
    resetBy: 'Your password was reset by {{login}}.',
    current: 'Current password',
    currentOneTime: 'One-time password',
    new: 'New password',
    repeat: 'New password again',
    currentMissing: 'Enter the password you signed in with.',
    tooShort: 'The password needs at least {{min}} characters.',
    tooLong: 'The password can have at most {{max}} characters.',
    same: 'The new password must differ from the current one.',
    mismatch: 'The two new passwords are not the same.',
    othersEnd: 'Your other sessions will be signed out, and this device will no longer be trusted.',
    submit: 'Change password',
    changed: 'The password is changed.',
    back: 'Back',
  },
  setUp: {
    title: 'Set up the second step',
    intro:
      'Your role requires a second step at sign-in: a code from an authenticator app on your phone, for example Google Authenticator. Install the app, then start.',
    start: 'Start',
    scan: 'Scan this picture with the app, or type the key by hand. Then enter the code the app shows.',
    qr: 'QR code for the authenticator app',
    key: 'Key',
    code: 'Code from the app',
    codeMissing: 'Enter the code from the app.',
    confirm: 'Confirm',
    codesTitle: 'Recovery codes',
    codesText:
      'Each code works once in place of the code from the app, for example when the phone is lost. They are shown only now. Write them down or print them and keep them in a safe place.',
    saved: 'I have saved the codes',
    continue: 'Continue',
  },
  layout: {
    breadcrumbs: 'You are here',
    menu: 'Main menu',
    account: 'Account',
    changePassword: 'Change password',
    signOut: 'Sign out',
    notTrusted:
      'This device is not trusted: a one-time password was in use at sign-in. To trust it, sign out and sign in again with "Trust this device" on.',
    dismiss: 'Close',
  },
  list: {
    search: 'Search',
    all: 'All',
    columns: 'Columns',
    export: 'Export',
    selectAll: 'Select every row that matches the search and filters',
    selectRow: 'Select {{name}}',
    bulkActions: 'Actions for the selected rows',
    selected_one: '{{n}} row selected.',
    selected_other: '{{n}} rows selected.',
    selectedNotShown_one: '{{n}} of them is not shown by the current search and filters.',
    selectedNotShown_other: '{{n}} of them are not shown by the current search and filters.',
    clearSelection: 'Clear selection',
    count: 'Shown: {{shown}} of {{matching}}. In the list: {{total}}.',
    showMore: 'Show more',
    noMatch: 'Nothing matches the search and filters. Change them or clear them.',
    clearSearch: 'Clear search and filters',
    closePanel: 'Close',
    recordGoneTitle: 'Record not in the list',
    recordGone:
      'This record is not in the list. It may have been archived or moved. Close this panel and look for it in the list.',
  },
  form: {
    save: 'Save',
    saved: 'Saved.',
    required: 'Fill in this field.',
    tooShort_one: 'Enter at least {{n}} character.',
    tooShort_other: 'Enter at least {{n}} characters.',
    tooLong_one: 'Enter at most {{n}} character.',
    tooLong_other: 'Enter at most {{n}} characters.',
    tooSmall: 'Enter a number that is {{min}} or more.',
    tooBig: 'Enter a number that is {{max}} or less.',
    wholeNumber: 'Enter a whole number, in digits only.',
    invalid: 'This value is not accepted. Check it and enter it again.',
  },
  confirm: {
    cancel: 'Cancel',
    more: 'and {{n}} more',
  },
  unsent: {
    typed: 'Changes not saved',
    failed: 'Save failed',
    leaveTitle: 'Leave without saving?',
    leaveText: 'What you typed is not saved and will be lost:',
    leave: 'Leave without saving',
    stay: 'Stay',
  },
  sample: {
    title: 'Patterns',
    intro:
      'A list and a form built only from the shared pieces. For development; not a part of the platform.',
    grade: 'Grade',
    className: 'Class name',
    scoreNote: 'From 0 to 100. Leave empty when there is no score.',
    archiveTitle_one: 'Archive {{n}} sample student?',
    archiveTitle_other: 'Archive {{n}} sample students?',
    archiveText: 'They stay in the list with the status "Archived".',
    caption: 'Sample students',
    name: 'Name',
    class: 'Class',
    language: 'Language',
    status: 'Status',
    score: 'Score',
    active: 'Active',
    archived: 'Archived',
    uzbek: 'Uzbek',
    russian: 'Russian',
    archive: 'Archive',
    exported_one: 'An export of {{n}} row was asked for.',
    exported_other: 'An export of {{n}} rows was asked for.',
    empty: 'Sample students are listed here. This list has none yet.',
    showRows: 'Show the sample rows',
  },
  home: {
    title: 'Home',
    empty:
      'This page will show what you need to do today. Your menu and your tasks appear here as the sections of the platform are opened.',
  },
};
