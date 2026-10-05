import { useId, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

/** The label above a control and its messages below, tied to it for a screen reader. */
function Labelled({
  label,
  error,
  note,
  children,
}: FieldTexts & { children: (control: Described) => ReactNode }) {
  const id = useId();
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const describedBy = [note === undefined ? null : noteId, error === undefined ? null : errorId]
    .filter((part) => part !== null)
    .join(' ');

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        'aria-invalid': error !== undefined,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })}
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
