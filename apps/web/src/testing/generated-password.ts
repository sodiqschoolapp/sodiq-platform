/**
 * The passwords `GeneratedPassword` draws inside a part, as copying them gives them: the
 * text of each, its groups joined with nothing between them (owner, 28 November 2026).
 */
export function generatedPasswordsIn(root: ParentNode): string[] {
  return Array.from(
    root.querySelectorAll('[data-generated-password]'),
    (element) => element.textContent ?? '',
  );
}
