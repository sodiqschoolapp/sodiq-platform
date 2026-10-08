/**
 * A stored moment as a person reads it, in the language of the page (`12`,
 * Language: dates follow the chosen language) and in the time zone of the
 * device. The moments of sessions and devices belong to an account, which has
 * no branch; the branch time zone is a setting of a later task (decided at the
 * plan of task 0.8d).
 */
export function formatMoment(language: string, iso: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
