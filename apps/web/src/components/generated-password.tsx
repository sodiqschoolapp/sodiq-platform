/** The length of one group of a generated password as it is shown. */
export const PASSWORD_GROUP_LENGTH = 5;

/** The groups of five a generated password is shown in: `abcde`, `fghjk`. */
export function passwordGroups(password: string): string[] {
  const groups: string[] = [];
  for (let start = 0; start < password.length; start += PASSWORD_GROUP_LENGTH) {
    groups.push(password.slice(start, start + PASSWORD_GROUP_LENGTH));
  }
  return groups;
}

/**
 * A generated sign-in password shown once, on a slip or a screen (owner, 28 November 2026:
 * "easier parent and staff passwords"): ten characters in two groups of five, so the eye
 * keeps its place when the password is copied by hand. The gap between the groups is a
 * margin, never a space in the text: selecting and copying it gives the password as it is
 * typed. Each group is an inline span (a flex or block item would add a line break to the
 * copied text and to `innerText`).
 */
export function GeneratedPassword({ password }: { password: string }) {
  return (
    <span data-generated-password="">
      {passwordGroups(password).map((group, index) => (
        <span key={String(index)} className={index === 0 ? undefined : 'ml-[0.6em]'}>
          {group}
        </span>
      ))}
    </span>
  );
}
