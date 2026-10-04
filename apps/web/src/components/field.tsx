import { useId, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface FieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string;
  /** What to fix, in plain words; shown under the field and read with it. */
  error?: string | undefined;
  /** A lasting hint under the field. */
  note?: string | undefined;
}

/**
 * A labelled text field with its message (docs/spec/12-ux-standards.md, No
 * lost work: forms check each field as it is typed and say what to fix). The
 * full form pattern comes in task 0.8b.
 */
export function Field({ label, error, note, ...input }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const describedBy = [note === undefined ? null : noteId, error === undefined ? null : errorId]
    .filter((part) => part !== null)
    .join(' ');

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...input}
      />
      {note !== undefined && (
        <p id={noteId} className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
