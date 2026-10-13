import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formMessage, type FormIssue, type FormSchema } from './form-messages';
import { SaveCancelled } from './save-cancelled';

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
  /**
   * Fields that say what is wrong only after a Save pressed while they were
   * drawn, never as they are ticked: the checkbox groups that must hold one
   * choice (issue #39, hand test of 13 October 2026, finding 21; task 2.7b-2,
   * decision 2). A group drawn after Save was pressed waits for the next Save.
   */
  checkedOnSave?: readonly NoInfer<Field>[];
  /**
   * The form stays when what it shows changes, instead of being keyed by it:
   * a new `initial` is taken as typed and saved while nothing is typed and no
   * save is on its way, so a change from elsewhere shows, and the form's own
   * save keeps its "Saved." (finding 18; task 2.7b-2, decision 7). What is
   * typed is never overwritten.
   */
  followInitial?: boolean;
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
  /** Over when no save is on its way: at once, or with the answer of the one that is. */
  settled: () => Promise<void>;
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
  checkedOnSave = [],
  followInitial = false,
}: RecordFormOptions<Field, Values>): RecordFormState<Field> {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState(initial);
  const [typed, setTyped] = useState(initial);
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set());
  const [pressed, setPressed] = useState(false);
  // The fields drawn when Save was last pressed (`checkedOnSave`).
  const [pressedDrawn, setPressedDrawn] = useState<ReadonlySet<Field>>(new Set());
  const [status, setStatus] = useState<FormStatus>('idle');
  const [failure, setFailure] = useState<unknown>(null);

  const checked = useMemo(
    () => schema.safeParse(read === undefined ? typed : read(typed)),
    [schema, read, typed],
  );

  const errorOf = (field: Field): string | undefined => {
    const shows = checkedOnSave.includes(field)
      ? pressedDrawn.has(field)
      : pressed || touched.has(field);
    if (checked.success || !shows) {
      return undefined;
    }
    const issue = checked.error.issues.find((one) => one.path[0] === field);
    if (issue === undefined) {
      return undefined;
    }
    return message?.(field, issue) ?? formMessage(t, i18n.language, issue, typed[field]);
  };

  const fields = Object.keys(initial) as Field[];
  const same = (one: Record<Field, string>, other: Record<Field, string>): boolean =>
    fields.every((field) => one[field] === other[field]);

  // The newest of each for the answer of a save, which arrives renders later:
  // what is typed and saved now, the save on its way, and how often the form
  // was reset.
  const typedNow = useRef(initial);
  const savedNow = useRef(initial);
  const flight = useRef<Promise<void> | null>(null);
  const resets = useRef(0);

  // `followInitial`: the same fields with other values are another `initial`.
  const initialText = JSON.stringify(fields.map((field) => [field, initial[field]]));
  useEffect(() => {
    if (!followInitial || flight.current !== null) {
      return;
    }
    const next = Object.fromEntries(JSON.parse(initialText) as [Field, string][]) as Record<
      Field,
      string
    >;
    // Every field of either: a follower may gain or lose fields (the grades of a subject).
    const unchanged = (one: Record<Field, string>, other: Record<Field, string>): boolean =>
      [...new Set([...Object.keys(one), ...Object.keys(other)])].every(
        (key) => one[key as Field] === other[key as Field],
      );
    // Typed and not saved: the person's text stays (`12`, No lost work).
    if (!unchanged(typedNow.current, savedNow.current) || unchanged(next, savedNow.current)) {
      return;
    }
    typedNow.current = next;
    savedNow.current = next;
    setTyped(next);
    setSaved(next);
    setTouched(new Set());
    setPressed(false);
    setPressedDrawn(new Set());
    // Read again once a save is over (`status`): the answer may hold what was
    // sent in the server's own order.
  }, [followInitial, initialText, status]);

  // The fields bound in this render: what is drawn when Save is pressed.
  const drawn = new Set<Field>();

  return {
    bind: (field) => {
      drawn.add(field);
      return {
        name: field,
        value: typed[field],
        error: errorOf(field),
        onChange: (event) => {
          const next = { ...typedNow.current, [field]: event.target.value };
          typedNow.current = next;
          setTyped(next);
          setTouched((before) => new Set(before).add(field));
          const back = same(next, savedNow.current);
          // "Saved" is true of what was saved, not of what is typed now. A save
          // that failed is over once the fields change: what they hold now was
          // never sent, so the top bar says it is not saved, not that a save
          // failed (issue #39, hand test of 13 October 2026, finding 10).
          setStatus((before) => (before === 'saved' || before === 'failed' ? 'idle' : before));
          if (back) {
            setFailure(null);
          }
        },
      };
    },
    dirty: !same(typed, saved),
    status,
    failure,
    submit: async () => {
      if (flight.current !== null) {
        return true;
      }
      setPressed(true);
      setPressedDrawn(new Set(drawn));
      if (!checked.success) {
        return false;
      }
      const sent = typed;
      const values = checked.data;
      const resetsBefore = resets.current;
      setStatus('saving');
      setFailure(null);
      const run = (async () => {
        try {
          await save(values);
          savedNow.current = sent;
          setSaved(sent);
          if (resets.current !== resetsBefore) {
            // The form was reset while the save was on its way: the server has
            // what was sent, so the fields show that, not what was there before.
            typedNow.current = sent;
            setTyped(sent);
          }
          // Typed on while the save was on its way: that is not saved.
          setStatus(same(typedNow.current, sent) ? 'saved' : 'idle');
        } catch (error) {
          // What was typed stays in the fields: nothing is lost by a refusal.
          setFailure(error);
          // A save the person stopped before it was sent did not fail: what is
          // typed is not saved, and the top bar says so (finding 10).
          setStatus(error instanceof SaveCancelled ? 'idle' : 'failed');
        } finally {
          flight.current = null;
        }
      })();
      flight.current = run;
      await run;
      return true;
    },
    settled: () => flight.current ?? Promise.resolve(),
    reset: () => {
      resets.current += 1;
      typedNow.current = savedNow.current;
      setTyped(savedNow.current);
      setTouched(new Set());
      setPressed(false);
      setPressedDrawn(new Set());
      setStatus('idle');
      setFailure(null);
    },
  };
}
