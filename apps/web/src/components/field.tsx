import { useId, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface FieldTexts {
  label: string;
  /** What to fix, in plain words; shown under the field and read with it. */
  error?: string | undefined;
  /** A lasting hint under the field. */
  note?: string | undefined;
}

interface Described {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

/** The ids of the messages of a control and what `aria-describedby` says. */
function described(id: string, note: string | undefined, error: string | undefined) {
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const describedBy = [note === undefined ? null : noteId, error === undefined ? null : errorId]
    .filter((part) => part !== null)
    .join(' ');
  return { noteId, errorId, describedBy: describedBy === '' ? undefined : describedBy };
}

/** The messages under a control: a lasting note and what to fix. */
function Messages({
  noteId,
  errorId,
  note,
  error,
}: {
  noteId: string;
  errorId: string;
  note: string | undefined;
  error: string | undefined;
}) {
  return (
    <>
      {note !== undefined && (
        <p id={noteId} className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
      {/* Always there, so a message that arrives while typing is read out;
          empty, it takes no room (the gap of the grid is taken back). */}
      <div aria-live="polite" className="empty:-mt-1.5">
        {error !== undefined && (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

/** The label above a control and its messages below, tied to it for a screen reader. */
function Labelled({
  label,
  error,
  note,
  children,
}: FieldTexts & { children: (control: Described) => ReactNode }) {
  const id = useId();
  const { noteId, errorId, describedBy } = described(id, note, error);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error !== undefined,
        'aria-describedby': describedBy,
      })}
      <Messages noteId={noteId} errorId={errorId} note={note} error={error} />
    </div>
  );
}

type FieldProps = FieldTexts & Omit<ComponentProps<'input'>, 'id'>;

/**
 * A labelled text field with its message (docs/spec/12-ux-standards.md, No
 * lost work: forms check each field as it is typed and say what to fix). In a
 * record form it takes `form.bind(name)` of `useRecordForm`.
 */
export function Field({ label, error, note, ...input }: FieldProps) {
  return (
    <Labelled label={label} error={error} note={note}>
      {(control) => <Input {...control} {...input} />}
    </Labelled>
  );
}

/**
 * A field for a school date (task 1.3). The browser's own date input: its value
 * is `YYYY-MM-DD` whatever the language, as the shared schemas take it; how it
 * shows the date follows the browser's language, a known limit (decision 10 of
 * pull request #44: no date-picker library).
 */
export function DateField(props: Omit<FieldProps, 'type'>) {
  return <Field {...props} type="date" />;
}

/**
 * A field for a whole number. A text field on purpose: a number field of the
 * browser changes its value with the mouse wheel and hides what was typed when
 * it is not a number, so the form could not say what to fix. The form reads it
 * with `wholeNumber`.
 */
export function NumberField(props: Omit<FieldProps, 'type' | 'inputMode'>) {
  return <Field {...props} type="text" inputMode="numeric" autoComplete="off" />;
}

const SELECT =
  'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

type SelectFieldProps = FieldTexts &
  Omit<ComponentProps<'select'>, 'id' | 'children'> & {
    options: readonly { value: string; label: string }[];
  };

/** A choice among a few values: a plain select, as the filters of a list. */
export function SelectField({ label, error, note, options, ...select }: SelectFieldProps) {
  return (
    <Labelled label={label} error={error} note={note}>
      {(control) => (
        <select className={SELECT} {...control} {...select}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Labelled>
  );
}

type TextAreaFieldProps = FieldTexts & Omit<ComponentProps<'textarea'>, 'id'>;

/** A labelled field for several lines of text, with its message; as `Field` otherwise. */
export function TextAreaField({ label, error, note, ...textarea }: TextAreaFieldProps) {
  return (
    <Labelled label={label} error={error} note={note}>
      {(control) => <Textarea {...control} {...textarea} />}
    </Labelled>
  );
}

/** What a ticked `CheckboxField` holds; empty when it is not ticked. */
export const CHECKED = 'on';

const CHECKBOX = 'size-4 accent-primary';

interface Bound {
  name: string;
  /** As every field of a record form: a text. */
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  disabled?: boolean | undefined;
}

/**
 * One switch of a record form, for example "shared". It holds `CHECKED` when
 * ticked and nothing when not, so that `form.bind(name)` fits it like a text
 * field; the form reads it with `typed.shared === CHECKED`.
 */
export function CheckboxField({
  label,
  error,
  note,
  name,
  value,
  onChange,
  disabled,
}: FieldTexts & Bound) {
  const id = useId();
  const { noteId, errorId, describedBy } = described(id, note, error);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <input
          id={id}
          name={name}
          type="checkbox"
          className={CHECKBOX}
          checked={value === CHECKED}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange({ target: { value: event.target.checked ? CHECKED : '' } });
          }}
        />
        <Label htmlFor={id}>{label}</Label>
      </div>
      <Messages noteId={noteId} errorId={errorId} note={note} error={error} />
    </div>
  );
}

const LIST_SEPARATOR = ',';

/** The value of a `CheckboxGroupField` for these ticked values. */
export const listValue = (values: readonly string[]): string => values.join(LIST_SEPARATOR);

/** The ticked values of a `CheckboxGroupField`, from what the form holds. */
export const listValues = (value: string): string[] =>
  value === '' ? [] : value.split(LIST_SEPARATOR);

type CheckboxGroupFieldProps = FieldTexts &
  Bound & { options: readonly { value: string; label: string }[] };

/**
 * A set of switches that make one field, for example the working weekdays.
 * The field holds the ticked values joined by commas, in the order of the
 * options; the form reads them with `listValues`.
 */
export function CheckboxGroupField({
  label,
  error,
  note,
  name,
  value,
  onChange,
  disabled,
  options,
}: CheckboxGroupFieldProps) {
  const id = useId();
  const { noteId, errorId, describedBy } = described(id, note, error);
  const ticked = new Set(listValues(value));
  return (
    <fieldset
      className="grid gap-1.5"
      aria-invalid={error !== undefined}
      aria-describedby={describedBy}
      disabled={disabled}
    >
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              className={CHECKBOX}
              checked={ticked.has(option.value)}
              onChange={(event) => {
                const next = new Set(ticked);
                if (event.target.checked) {
                  next.add(option.value);
                } else {
                  next.delete(option.value);
                }
                onChange({
                  target: {
                    value: listValue(
                      options.map((one) => one.value).filter((one) => next.has(one)),
                    ),
                  },
                });
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
      <Messages noteId={noteId} errorId={errorId} note={note} error={error} />
    </fieldset>
  );
}
