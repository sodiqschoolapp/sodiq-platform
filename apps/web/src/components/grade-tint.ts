/**
 * The tint of a grade (docs/design-system.md, This app, Status labels: "Always the digit; colour
 * only helps. Grade 2 danger tint, 3 warning tint, 4 info tint, 5 success tint, each with its text
 * colour"). The journal and the parent portal draw the same labels; this file loads nothing else,
 * so the portal does not load the journal's grid with it.
 */
export const GRADE_TINT: Record<number, string> = {
  2: 'bg-destructive-bg text-destructive',
  3: 'bg-warning-bg text-warning',
  4: 'bg-info-bg text-info',
  5: 'bg-success-bg text-success',
};
