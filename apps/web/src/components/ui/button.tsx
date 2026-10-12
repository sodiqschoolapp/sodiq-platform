import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { FOCUS_RING, QUICK } from './control';

/**
 * docs/design-system.md, Buttons: three sizes, four kinds, one shape. Every
 * button is a fill with no border; no `xs` size and no `outline` or `link`
 * kind (tooling/design-parts.test.ts). At phone width every size is at least
 * 44 high (pull request #60, decision 3), and its icon 24 px.
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

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
