import { useState } from 'react';
import { codedName } from '@sodiq/shared';
import { cn } from '@/lib/utils';
import { FOCUS_RING } from '@/components/ui/control';

/**
 * A topic or a work with its code (task 11.27; `09`, Codes: "Where a code is filled it is shown
 * first, with the full name beside it … Where space is short (journal column headers, the lesson
 * header, lesson mode on a phone) the code is shown alone, with the full name on hover or on a
 * tap. Where the code is empty, the name is shown alone").
 *
 * - `full` (the default): the code first, then the name.
 * - `short`: the code alone; the full name on hover (`title`), and on a tap or keyboard focus a
 *   small line under it that a second tap closes (plan decision 9). The accessible name is the
 *   full name with its code.
 *
 * The server answers `null` for a code while the subject's codes are off, so nothing here checks
 * the switch.
 */
export function CodedName({
  code,
  name,
  short = false,
  className,
}: {
  code: string | null | undefined;
  name: string;
  short?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (code === null || code === undefined || code === '') {
    // The name alone, as it was drawn before codes (no element of its own without a class).
    return className === undefined ? <>{name}</> : <span className={className}>{name}</span>;
  }
  if (!short) {
    return (
      <span className={className} data-coded-name="">
        <span className="font-semibold" data-code="">
          {code}
        </span>{' '}
        <span>{name}</span>
      </span>
    );
  }
  return (
    <span className={cn('relative inline-flex min-w-0', className)} data-coded-name="short">
      <button
        type="button"
        title={name}
        aria-label={codedName(code, name)}
        aria-expanded={open}
        data-code=""
        className={cn('min-w-0 truncate rounded-sm font-semibold', FOCUS_RING)}
        onClick={(event) => {
          // A tap shows the name; a click on a header never sorts or opens anything else.
          event.stopPropagation();
          setOpen((now) => !now);
        }}
        onBlur={() => {
          setOpen(false);
        }}
      >
        {code}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-full left-0 z-20 mt-1 w-max max-w-64 rounded-md bg-popover px-2 py-1 text-xs font-normal whitespace-normal text-popover-foreground shadow-md"
        >
          {name}
        </span>
      )}
    </span>
  );
}
