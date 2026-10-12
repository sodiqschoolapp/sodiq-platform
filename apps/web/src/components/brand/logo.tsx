import { useTranslation } from 'react-i18next';
import { cn } from 'cn';

/**
 * docs/design-system.md, Logo: the files of `public/brand/`, exact vectors of
 * the brand book. One line for sign-in (colour), the menu and the letterhead
 * (on dark); the shield alone for the collapsed menu and the phone top bar;
 * stacked for printouts. Never recoloured or stretched: an image of its own
 * file, its height set and its width following.
 */
const FILES = {
  horizontal: 'sodiq-logo-horizontal.svg',
  'horizontal-on-dark': 'sodiq-logo-horizontal-on-dark.svg',
  stacked: 'sodiq-logo.svg',
  'stacked-on-dark': 'sodiq-logo-on-dark.svg',
  mark: 'sodiq-mark.svg',
  'mark-on-dark': 'sodiq-mark-on-dark.svg',
} as const;

export type LogoVariant = keyof typeof FILES;

interface LogoProps {
  variant: LogoVariant;
  /** The height as a class; at least 24 px on screen (`h-6`), the shield alone below that. */
  className?: string;
}

export function Logo({ variant, className }: LogoProps) {
  const { t } = useTranslation();
  return (
    <img
      src={`/brand/${FILES[variant]}`}
      alt={t('app.name')}
      draggable={false}
      className={cn('block h-8 w-auto shrink-0 select-none', className)}
    />
  );
}
