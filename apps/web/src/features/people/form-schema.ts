import { type FormIssue, type FormSchema } from '@/components/form/form-messages';

/**
 * A shared schema as a form reads it, with the path of each issue turned into
 * the field that shows it (task 2.2a; the availability and vacancy forms of
 * task 2.2b). `fieldOf` also gets what was checked, for a field named after
 * a value (the grades of one subject, task 2.7b-2).
 */
export const asFormSchema = <Values>(
  schema: {
    safeParse: (input: unknown) => {
      success: boolean;
      data?: Values;
      error?: { issues: FormIssue[] };
    };
  },
  fieldOf: (path: readonly PropertyKey[], input: unknown) => PropertyKey[],
): FormSchema<Values> => ({
  safeParse: (input) => {
    const result = schema.safeParse(input);
    if (result.success) {
      return { success: true, data: result.data as Values };
    }
    return {
      success: false,
      error: {
        issues: (result.error?.issues ?? []).map((issue) => ({
          ...issue,
          path: fieldOf(issue.path, input),
        })),
      },
    };
  },
});

/**
 * The field of an issue of a teaching record (`subjects` with the grades of
 * each): an issue of the grades of one subject is shown by that subject's
 * grade group, `grades.<subjectId>`, named from what was checked; any other
 * issue of the subjects by the subject group (issue #39, hand test of 13
 * October 2026, finding 21).
 */
export function subjectsFieldOf(path: readonly PropertyKey[], input: unknown): PropertyKey[] {
  const [first, index, inner] = path;
  if (first !== 'subjects') {
    return [...path];
  }
  if (typeof index === 'number' && inner === 'grades') {
    const subjects: unknown =
      typeof input === 'object' && input !== null && 'subjects' in input
        ? input.subjects
        : undefined;
    const row: unknown = Array.isArray(subjects) ? subjects[index] : undefined;
    if (typeof row === 'object' && row !== null && 'subjectId' in row) {
      const { subjectId } = row;
      if (typeof subjectId === 'string') {
        return [`grades.${subjectId}`];
      }
    }
  }
  return ['subjects'];
}

/** Whether a field is the grade group of one subject (`subjectsFieldOf`). */
export const isGradesField = (field: string): boolean => field.startsWith('grades.');
