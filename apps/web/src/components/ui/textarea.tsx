import * as React from 'react';
import { cn } from 'cn';
import { FIELD } from './control';

// The shadcn `textarea` component (base-nova style), written by hand because
// the registry could not be reached from the cloud environment (task 0.8b-3).
// The border, fill, focus and error of every field (`FIELD`), grown with its text.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        FIELD,
        'flex field-sizing-content h-auto min-h-20 py-2 max-sm:h-auto',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
