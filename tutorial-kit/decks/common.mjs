// Shared slide builders and the slides every role deck repeats.
export const F = (title, o) => ({ kind: 'feature', title, ...o });
export const T = (title, head, rows, o = {}) => ({ kind: 'table', title, head, rows, ...o });
export const D = (num, title, sub, o = {}) => ({ kind: 'divider', num, title, sub, ...o });
export const K = (title, cards, o = {}) => ({ kind: 'cards', title, cards, ...o });
export const S = (title, sub, o = {}) => ({ kind: 'statement', title, sub, ...o });

export const BRANCH = 'Istirohat demo';

// Sign-in slides. strict = Super Admin / Academic Vice Principal (second step required, 15 min idle).
export function signIn(role, strict) {
  const out = [
    F('First sign-in with the slip', {
      what: 'Every account is created by the Super Admin. The person gets a printed slip with a login and a one-time password.',
      steps: [
        'Open the test site → **Sign in**: type **Login** and the **Password** from the slip',
        '**Choose a new password**: the one-time password, then the new one twice (10 to 128 characters)',
        'Top of the sign-in page: the language chooser (Oʻzbekcha, Русский, English)',
      ],
      show: [
        `Sign in as the ${role} with a fresh slip`,
        'Show the refusal for a wrong password: the same message for a wrong login, so nobody can guess logins',
      ],
      time: 'A first password works for **7 days**; after that "Accounts never used" shows "Ran out on…" and the Super Admin issues a new one.',
      notes: `Every staff member starts here. Nobody signs up alone: the Super Admin creates the account and prints the slip. At the first sign-in the platform forces a new password of your own.`,
    }),
  ];
  if (strict) {
    out.push(
      F('The second step (required for this role)', {
        what: 'The Super Admin and the Academic Vice Principal must use an authenticator app. It cannot be turned off for them.',
        steps: [
          '**Set up the second step** → **Start** → scan the QR picture with the phone',
          'Type the 6-digit **Code from the app** → **Confirm**',
          '**Recovery codes**: 10 single-use codes, shown once → tick **I have saved the codes** → **Continue**',
          'Next sign-ins: **Second step** → **Code** (a recovery code works too)',
        ],
        show: ['The QR set-up on camera, with the phone app beside it', 'Account → "Second step at sign-in": "Your role requires the second step. It cannot be turned off."'],
        time: 'Codes change every 30 seconds. The demo clock (recording plan) must leave these codes on real time.',
        notes: 'Because this role can change the timetable, the journal and accounts, the platform asks for a second proof at every sign-in: a code from an authenticator app on your phone.',
      }),
    );
  }
  out.push(
    F('Staying signed in, and being signed out', {
      what: 'Sessions end after a time without use. A trusted device stays signed in for 7 days.',
      steps: [
        'At sign-in, switch on **Trust this device** (never on a shared computer)',
        'Avatar → **Account** → **Trusted devices** → **Remove** ends that device at once',
        'Avatar → **Account** → **Sessions** → **Sign out everywhere**',
      ],
      show: [
        'The "Trust this device" switch and its note',
        'Sign out everywhere, then the other browser landing on "Your session has ended. Sign in again."',
      ],
      time: [
        `Idle sign-out after **${strict ? '15' : '30'} minutes** without use (trusted devices are exempt)`,
        'Every session ends **7 days** after sign-in at the latest',
        'A sign-in with a one-time password is never trusted: sign in once more after the password change',
      ],
      notes: 'The platform signs you out when you leave it alone, to protect pupils’ data on shared classroom computers. On your own laptop you can trust the device for a week.',
    }),
    F('Forgot the password', {
      what: 'A reset link by email, or a one-time password from an administrator.',
      steps: [
        'Sign-in page → **Forgot your password?** → **Login** → **Send link**',
        'Open the email → **Choose a new password** → **Save the new password**',
        'No email on record? Ask the administrator: People → Staff → you → **Sign-in access** → **Reset password**',
      ],
      show: ['The request page and its neutral answer (it never says whether the login exists)'],
      time: [
        'The email link works **1 hour**; a new one only after **5 minutes** and only when the old one no longer works',
        'An administrator’s one-time password works **24 hours**',
        'After 5 failed sign-ins each try waits 30 s, doubling up to 15 min',
      ],
      notes: 'Two ways back in. The email link needs an email address on your staff record and mail sending on the server, so check both before filming it on the test site.',
    }),
    F('Your account page', {
      what: 'Everything about your own sign-in in one place.',
      steps: [
        'Avatar at the foot of the menu → **Account**',
        '**Photo**: Add / Change / Remove (JPEG or PNG, up to 5 MB)',
        '**Language**, **Password** (→ **Change password**), **Sessions**, **Sign-in history**, **Trusted devices**, **Second step at sign-in**',
        'Avatar menu: **Theme** (Light / Dark / As the device)',
      ],
      show: ['Switch the language to Oʻzbekcha and back', 'The sign-in history with the events of today', 'Dark theme for two seconds'],
      notes: 'Your photo, your language, your password and every sign-in on your account are here. The language you choose is saved to your account and follows you to every device.',
    }),
  );
  return out;
}

export const shell = (role, menu, extra = []) =>
  F('Around the screen', {
    what: `The ${role}'s menu: ${menu}.`,
    steps: [
      'Top bar: year and quarter, **Ctrl+K** search, the **Notifications** bell, **Send feedback**',
      'Lists: **Search**, **Filters**, **Columns**; clicking a row opens a side panel with **Edit** / **Save**',
      ...extra,
    ],
    show: [
      'Ctrl+K: type two letters of a name',
      'The bell: open a notice, then **Mark all as read**',
      'Phone width: the tab bar with **More**',
    ],
    who: 'The menu only shows what the role may open. The server checks every action again, so a hidden button is never the only lock.',
    notes: 'This is the frame of every page: the menu on the left, search and notifications on top. Ctrl+K finds people, classes and pages from anywhere.',
  });

export const feedback = F('Send feedback', {
  what: 'A short message to the platform’s builder. The page you are on and your role are attached.',
  steps: ['Top bar → **Send feedback** (on a phone: **More**) → **Message** → **Send**'],
  show: ['Send one real remark about the tutorial screen you are on'],
  time: 'At most 20 reports in 24 hours.',
  notes: 'Found something odd or confusing? Tell us from the page itself; we see where you were.',
});
