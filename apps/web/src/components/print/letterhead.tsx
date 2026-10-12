import { Logo } from '@/components/brand/logo';

/**
 * The letterhead strip at the top of each printed page or slip
 * (docs/design-system.md, Brand moments, Printouts): a navy tab with the
 * on-dark one-line logo and a rounded top-right corner, followed by an orange
 * band. The colours are printed as drawn (`data-print="colours"`, index.css).
 * Its first documents are the first-password slips of task 2.3 ("This app",
 * Printouts); `/dev/patterns` shows it.
 */
export function Letterhead() {
  return (
    <div data-print="colours" data-letterhead="" className="grid w-full">
      <div className="flex h-14 w-fit items-center rounded-tr-xl bg-sidebar px-6">
        <Logo variant="horizontal-on-dark" className="h-7" />
      </div>
      <div data-band="" className="h-2 w-full bg-primary" />
    </div>
  );
}
