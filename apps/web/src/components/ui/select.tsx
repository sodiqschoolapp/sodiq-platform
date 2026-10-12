import type { ComponentProps } from 'react';
import { cn } from 'cn';
import { ExpandMoreIcon } from '@/components/icons';
import { FIELD } from './control';

/**
 * A native select drawn as a field, with the filled "expand more" icon on the
 * right and never a text caret (docs/design-system.md, Fields and switches).
 * `className` sizes the box around it; the select fills the box.
 */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <span className={cn('relative inline-flex w-full', className)}>
      <select className={cn(FIELD, 'appearance-none pr-9')} {...props} />
      <ExpandMoreIcon className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
