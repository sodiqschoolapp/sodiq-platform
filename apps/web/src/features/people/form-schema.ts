import { type FormIssue, type FormSchema } from '@/components/form/form-messages';

/**
 * A shared schema as a form reads it, with the path of each issue turned into
 * the field that shows it (task 2.2a; the availability and vacancy forms of
 * task 2.2b).
 */
export const asFormSchema = <Values,>(
  schema: {
    safeParse: (input: unknown) => {
      success: boolean;
      data?: Values;
      error?: { issues: FormIssue[] };
    };
  },
  fieldOf: (path: readonly PropertyKey[]) => PropertyKey[],
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
          path: fieldOf(issue.path),
        })),
      },
    };
  },
});
