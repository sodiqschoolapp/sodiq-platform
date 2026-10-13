import { cn } from 'cn';
import { useId } from 'react';
import { CheckIcon } from '@/components/icons';
import { QUICK } from './control';

interface SegmentedProps<Value extends string> {
  /** The name of the group, read with it. */
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  className?: string;
}

/**
 * docs/design-system.md, Fields and switches: a choice of two to four values
 * as a segmented control. An `--accent` track with 4 px padding; the chosen
 * item white (the card) with the normal text and a check mark, so the choice
 * is not shown by colour alone; the others in muted text; 32 high, 44 at
 * phone width; inner corners 6. Native radio buttons underneath, so the
 * arrows move the choice and a screen reader hears a radio group.
 */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<Value>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      // Wraps where its choices do not fit (the tabs of a record in a side
      // panel) rather than reaching past the panel (task 2.7c-1).
      className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-accent p-1', className)}
    >
      {options.map((option) => (
        <label key={option.value} className="relative">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            className="peer sr-only"
            onChange={() => {
              onChange(option.value);
            }}
          />
          <span
            className={cn(
              'flex h-8 cursor-pointer items-center gap-1 rounded-sm px-3 text-sm font-medium whitespace-nowrap text-muted-foreground max-sm:h-11',
              'peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground',
              'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
              QUICK,
            )}
          >
            {option.value === value && <CheckIcon className="size-4" />}
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}
