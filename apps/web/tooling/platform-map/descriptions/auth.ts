/** Task 11.19: the descriptions of the map of the platform, auth. */
export const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'features/auth/account/language-section.tsx#field:language.label':
    'The language of the app for this person, Uzbek, Russian or English; the choice is saved to the account.',
  'features/auth/account/photo-section.tsx#button:account.photoAdd':
    "Opens the file picker to add or replace the person's own photo (JPEG or PNG).",
  'features/auth/account/photo-section.tsx#button:account.photoRemove':
    "Removes the person's own photo after a confirmation; the initials are shown instead.",
  'features/auth/account/second-step-section.tsx#button:account.turnOff':
    'Opens the form to turn off the second step, which asks for a code from the app.',
  'features/auth/account/second-step-section.tsx#button:account.turnOff:2':
    'Turns off the second step with the code typed from the authenticator app.',
  'features/auth/account/second-step-section.tsx#button:account.turnOn':
    'Starts setting up the second step at sign-in with an authenticator app.',
  'features/auth/account/second-step-section.tsx#button:confirm.cancel':
    'Stops setting up or turning off the second step and leaves it as it was.',
  'features/auth/account/second-step-section.tsx#field:setUp.code':
    'The current code from the authenticator app, needed to turn off the second step.',
  'features/auth/account/sessions-section.tsx#button:account.signOutEverywhere':
    'Signs out every other session of the account after a confirmation; this device stays signed in.',
  'features/auth/account/sign-in-history-section.tsx#button:app.loading':
    "Loads older lines of the person's sign-in history.",
  'features/auth/account/trusted-devices-section.tsx#button:account.removeNamed':
    'Removes the trusted device after a confirmation, which signs it out at once.',
  'features/auth/auth-page.tsx#button:theme.toLight':
    'Switches the page between the light and the dark theme.',
  'features/auth/password-page.tsx#button:layout.signOut':
    'Signs out without choosing a new password.',
  'features/auth/password-page.tsx#button:password.submit':
    "Changes the password. The person's other sessions are signed out and this device is no longer trusted.",
  'features/auth/password-page.tsx#field:password.currentOneTime':
    'The password the person signed in with: the current password, or the one-time password given to them.',
  'features/auth/password-page.tsx#field:password.new':
    'The new password, at least the minimum length and different from the current one.',
  'features/auth/password-page.tsx#field:password.repeat':
    'The new password typed again, to check it was typed right.',
  'features/auth/second-step-set-up.tsx#button:setUp.confirm':
    'Checks the code from the app; when it is right, the second step is on and the recovery codes are shown once.',
  'features/auth/second-step-set-up.tsx#button:setUp.continue':
    'Finishes the set-up of the second step once the recovery codes are saved and ticked as saved.',
  'features/auth/second-step-set-up.tsx#button:setUp.start':
    'Starts the set-up of the second step and shows the QR code and key to add to the authenticator app.',
  'features/auth/second-step-set-up.tsx#field:setUp.code':
    'The code the authenticator app shows after the QR code is scanned.',
};
