// Edge cases, "Trust this device": trust never begins with a first or reset
// password. The tab remembers that the switch was on at sign-in, so the app can
// say "sign in again to trust this device" once the session is complete.

const KEY = 'sodiq.trustAsked';

export function rememberTrustAsked(asked: boolean): void {
  try {
    if (asked) {
      window.sessionStorage.setItem(KEY, '1');
    } else {
      window.sessionStorage.removeItem(KEY);
    }
  } catch {
    // Storage is refused: the note is not shown.
  }
}

export function trustWasAsked(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
