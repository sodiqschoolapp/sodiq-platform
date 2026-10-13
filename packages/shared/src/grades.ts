/**
 * Grades as ranges (task 2.7b-1, finding 19; `04` Teacher list columns, read
 * as "grades, as ranges" by decision 2): "1–4, 7, 9–11" reads faster than
 * every grade one by one. Only digits, an en dash and commas, so the text is
 * the same in the three languages; a screen and its export use this one.
 */
export function gradeRanges(grades: Iterable<number>): string {
  const sorted = [...new Set(grades)].sort((a, b) => a - b);
  const runs: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    const from = sorted[index] ?? 0;
    let to = from;
    while (sorted[index + 1] === to + 1) {
      index += 1;
      to += 1;
    }
    runs.push(from === to ? String(from) : `${String(from)}–${String(to)}`);
    index += 1;
  }
  return runs.join(', ');
}
