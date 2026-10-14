import { cn } from 'cn';
import { ArrowDownwardIcon, ArrowUpwardIcon, CloseIcon } from '@/components/icons';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CHECKBOX, CHECKBOX_TARGET } from '@/components/ui/control';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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

type FieldProps = FieldTexts &
  Omit<ComponentProps<'input'>, 'id'> & {
    /** 48 high, on the sign-in page only (docs/design-system.md, Fields and switches). */
    large?: boolean;
  };

/**
 * A labelled text field with its message (docs/spec/12-ux-standards.md, No
 * lost work: forms check each field as it is typed and say what to fix). In a
 * record form it takes `form.bind(name)` of `useRecordForm`.
 */
export function Field({ label, error, note, large = false, className, ...input }: FieldProps) {
  return (
    <Labelled label={label} error={error} note={note}>
      {(control) => (
        <Input {...control} {...input} className={cn(large && 'h-12 max-sm:h-12', className)} />
      )}
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

type SelectFieldProps = FieldTexts &
  Omit<ComponentProps<'select'>, 'id' | 'children'> & {
    /** `disabled`: shown, with its reason in its label, and not chosen (the Tutors of a class, task 3.1a). */
    options: readonly { value: string; label: string; disabled?: boolean }[];
  };

/** A choice among a few values: a plain select, as the filters of a list. */
export function SelectField({ label, error, note, options, ...select }: SelectFieldProps) {
  return (
    <Labelled label={label} error={error} note={note}>
      {(control) => (
        <Select {...control} {...select}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
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
      <label
        htmlFor={id}
        className={`${CHECKBOX_TARGET} text-sm leading-none font-medium select-none has-disabled:cursor-not-allowed has-disabled:opacity-50`}
      >
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
            if (disabled === true) {
              return;
            }
            onChange({ target: { value: event.target.checked ? CHECKED : '' } });
          }}
        />
        {label}
      </label>
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
          <label
            key={option.value}
            htmlFor={`${id}-${option.value}`}
            className={`${CHECKBOX_TARGET} text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50`}
          >
            <input
              id={`${id}-${option.value}`}
              type="checkbox"
              name={name}
              value={option.value}
              className={CHECKBOX}
              disabled={disabled}
              checked={ticked.has(option.value)}
              onChange={(event) => {
                // A switched-off group never changes the form, whatever event
                // reaches it (issue #39, hand test of 13 October 2026, finding 2).
                if (disabled === true) {
                  return;
                }
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

type OrderedListFieldProps = FieldTexts &
  Bound & {
    /** Every value the field may hold, by value and name; a value may stand more than once. */
    options: readonly { value: string; label: string }[];
    /** The values that can be added; every option when left out. Others are only named. */
    addable?: readonly string[];
    /** More about the item at a place, for example the times of a slot. */
    detail?: (value: string, index: number) => ReactNode;
  };

/**
 * An ordered list of chosen values that make one field, for example the slots
 * of a day template (task 1.5; owner's answer 10: "reordering by up and down
 * buttons"). Each item can be moved up or down or removed, and a value is
 * added at the end. The field holds the values joined by commas in their
 * order; the form reads them with `listValues`.
 */
export function OrderedListField({
  label,
  error,
  note,
  name,
  value,
  onChange,
  disabled,
  options,
  addable,
  detail,
}: OrderedListFieldProps) {
  const { t } = useTranslation();
  const id = useId();
  const { noteId, errorId, describedBy } = described(id, note, error);
  const items = listValues(value);
  const offered =
    addable === undefined ? options : options.filter((option) => addable.includes(option.value));
  const [picked, setPicked] = useState(offered[0]?.value ?? '');
  // The options can change after the first draw (they arrive, or one is
  // archived): the choice follows them, so the select shows what Add adds.
  const chosen = offered.some((option) => option.value === picked)
    ? picked
    : (offered[0]?.value ?? '');
  const labelOf = (item: string) => options.find((option) => option.value === item)?.label ?? item;
  const set = (next: readonly string[]) => {
    onChange({ target: { value: listValue(next) } });
  };
  const move = (index: number, by: number) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (item !== undefined) {
      next.splice(index + by, 0, item);
      set(next);
    }
  };
  return (
    <fieldset
      className="grid gap-1.5"
      aria-invalid={error !== undefined}
      aria-describedby={describedBy}
      disabled={disabled}
    >
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <ol className="grid gap-1">
        {items.map((item, index) => (
          // The place is the identity: the same value can stand twice.
          <li
            key={index}
            className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-sm"
          >
            <span className="w-6 text-right text-muted-foreground">{index + 1}</span>
            <span className="min-w-32 flex-1">
              {labelOf(item)}
              {detail !== undefined && (
                <span className="ml-2 text-muted-foreground">{detail(item, index)}</span>
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === 0}
              aria-label={t('form.moveUp', { name: labelOf(item), place: index + 1 })}
              onClick={() => {
                move(index, -1);
              }}
            >
              <ArrowUpwardIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === items.length - 1}
              aria-label={t('form.moveDown', { name: labelOf(item), place: index + 1 })}
              onClick={() => {
                move(index, 1);
              }}
            >
              <ArrowDownwardIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('form.remove', { name: labelOf(item), place: index + 1 })}
              onClick={() => {
                set(items.filter((_, place) => place !== index));
              }}
            >
              <CloseIcon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          className="max-w-xs"
          aria-label={t('form.addChoice', { label })}
          value={chosen}
          onChange={(event) => {
            setPicked(event.target.value);
          }}
          name={`${name}-choice`}
        >
          {offered.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="secondary"
          disabled={chosen === '' || offered.length === 0}
          onClick={() => {
            set([...items, chosen]);
          }}
        >
          {t('form.add')}
        </Button>
      </div>
      <Messages noteId={noteId} errorId={errorId} note={note} error={error} />
    </fieldset>
  );
}
