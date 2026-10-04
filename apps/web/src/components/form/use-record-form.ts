import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formMessage, type FormIssue, type FormSchema } from './form-messages';

export type FormStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface RecordFormOptions<Field extends string, Values> {
  /** The schema of `packages/shared` the server checks the same record with. */
  schema: FormSchema<Values>;
  /**
   * What stands in each field when the form opens, as text. A form for another
   * record is another form: give it a `key`.
   */
  initial: Record<Field, string>;
  /** Turns what is typed into what the schema checks (`wholeNumber` for a number). */
  read?: (typed: Record<Field, string>) => unknown;
  /** Sends the checked values; a refusal is thrown (`answerOf` does). */
  save: (values: Values) => Promise<void>;
  /** A text of the feature's own for an issue of a field, in place of the shared one. */
  message?: (field: Field, issue: FormIssue) => string | undefined;
}

export interface FieldBinding {
  name: string;
  value: string;
  error: string | undefined;
  onChange: (event: { target: { value: string } }) => void;
}

export interface RecordFormState<Field extends string> {
  /** What a field component needs: `<Field label={...} {...form.bind('name')} />`. */
  bind: (field: Field) => FieldBinding;
  /** Something is typed that the last save does not hold. */
  dirty: boolean;
  status: FormStatus;
  /** Why the last save was refused, for `FailureAlert`. */
  failure: unknown;
  /**
   * Checks every field and saves. `false` when a field is wrong: nothing was
   * sent, and every field now says what to fix.
   */
  submit: () => Promise<boolean>;
  /** Back to what was saved last; what was typed since is dropped. */
  reset: () => void;
}

/**
 * The state of a record form (docs/spec/12-ux-standards.md, No lost work:
 * "Forms check each field as it is typed and say in plain words what to fix").
 * A field says what is wrong with it once something was typed into it, and
 * every field does after Save was pressed. Decided by the owner (task 0.8b):
 * a record form is saved with its Save button.
 */
export function useRecordForm<Field extends string, Values>({
  schema,
  initial,
  read,
  save,
  message,
}: RecordFormOptions<Field, Values>): RecordFormState<Field> {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState(initial);
  const [typed, setTyped] = useState(initial);
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set());
  const [pressed, setPressed] = useState(false);
  const [status, setStatus] = useState<FormStatus>('idle');
  const [failure, setFailure] = useState<unknown>(null);

  const checked = useMemo(
    () => schema.safeParse(read === undefined ? typed : read(typed)),
    [schema, read, typed],
  );

  const errorOf = (field: Field): string | undefined => {
    if (checked.success || !(pressed || touched.has(field))) {
      return undefined;
    }
    const issue = checked.error.issues.find((one) => one.path[0] === field);
    if (issue === undefined) {
      return undefined;
    }
    return message?.(field, issue) ?? formMessage(t, i18n.language, issue, typed[field]);
  };

  const fields = Object.keys(initial) as Field[];
  const dirty = fields.some((field) => typed[field] !== saved[field]);

  return {
    bind: (field) => ({
      name: field,
      value: typed[field],
      error: errorOf(field),
      onChange: (event) => {
        setTyped((before) => ({ ...before, [field]: event.target.value }));
        setTouched((before) => new Set(before).add(field));
        // "Saved" is true of what was saved, not of what is typed now.
        setStatus((before) => (before === 'saved' ? 'idle' : before));
      },
    }),
    dirty,
    status,
    failure,
    submit: async () => {
      if (status === 'saving') {
        return true;
      }
      setPressed(true);
      if (!checked.success) {
        return false;
      }
      const sent = typed;
      setStatus('saving');
      setFailure(null);
      try {
        await save(checked.data);
        setSaved(sent);
        setStatus('saved');
      } catch (error) {
        // What was typed stays in the fields: nothing is lost by a refusal.
        setFailure(error);
        setStatus('failed');
      }
      return true;
    },
    reset: () => {
      setTyped(saved);
      setTouched(new Set());
      setPressed(false);
      setStatus('idle');
      setFailure(null);
    },
  };
}
