import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { ProgressActivityIcon } from '@/components/icons';
import { FOCUS_RING, QUICK } from './control';

/**
 * docs/design-system.md, Buttons: three sizes, four kinds and the filled danger
 * button of a confirmation, one shape. Every button is a fill with no border; no
 * `xs` size and no `outline` or `link` kind (tooling/design-parts.test.ts). At
 * phone width every size is at least 44 high (pull request #60, decision 3), and
 * its icon 24 px.
 */
const buttonVariants = cva(
  `group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap select-none ${QUICK} ${FOCUS_RING} disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 max-sm:[&_svg:not([class*='size-'])]:size-6`,
  {
    variants: {
      variant: {
        // Navy on orange 7.75 : 1, on the darker orange of the hover 5.68 : 1.
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover aria-expanded:bg-primary-hover',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary-hover',
        // Quiet: no fill until hover.
        ghost: 'text-foreground hover:bg-accent aria-expanded:bg-accent',
        // Danger: no fill until hover, then its tint.
        destructive: 'text-destructive hover:bg-destructive-bg aria-expanded:bg-destructive-bg',
        // Danger, filled: only the confirming button of a dialog about an action that cannot be
        // undone (owner, 17 November 2026). White on red 7.50 : 1; navy on the light red of the
        // dark theme 8.25 : 1.
        'destructive-fill':
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover aria-expanded:bg-destructive-hover',
      },
      size: {
        default: 'h-10 px-4 text-sm max-sm:h-11',
        sm: 'h-8 px-3 text-[0.8125rem] max-sm:h-11 max-sm:text-sm',
        lg: 'h-12 px-5 text-base',
        icon: 'size-10 max-sm:size-11',
        'icon-sm': 'size-8 max-sm:size-11',
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface PendingProps {
  /**
   * Waiting for the answer to what the button sent (docs/design-system.md, Buttons, Pending):
   * the button keeps its size and kind, is disabled, shows the turning icon before its word,
   * and says `pendingText` ("Saving…") in place of its word. A second click does nothing.
   */
  pending?: boolean;
  /** The action in progress, written as the word of the button while it waits. */
  pendingText?: string;
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  pending = false,
  pendingText,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & PendingProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      // The kind, read by the browser check of one primary per area (task 2.7c-2b-1).
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={pending || disabled}
      // Base UI keeps a disabled button in the Tab order, so the focus stays on it while it waits.
      focusableWhenDisabled={pending ? true : undefined}
      aria-busy={pending ? true : undefined}
      data-pending={pending ? 'true' : undefined}
      {...props}
    >
      {pending ? (
        <>
          {/* Turns while it waits; under reduced motion it stands still and the word says it. */}
          <ProgressActivityIcon className="motion-safe:animate-spin" />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
