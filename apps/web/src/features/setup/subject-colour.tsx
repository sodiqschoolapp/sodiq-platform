import type { SubjectColour } from '@sodiq/shared';
import { cn } from '@/lib/utils';

/**
 * The classes of each subject colour, written out so that Tailwind finds them:
 * the swatch in the colour, the chip on its 15% tint (the tokens of
 * `index.css`; `tooling/contrast.test.ts` checks both in both themes).
 */
const SWATCH: Record<SubjectColour, string> = {
  red: 'bg-subject-red',
  orange: 'bg-subject-orange',
  amber: 'bg-subject-amber',
  lime: 'bg-subject-lime',
  green: 'bg-subject-green',
  teal: 'bg-subject-teal',
  cyan: 'bg-subject-cyan',
  blue: 'bg-subject-blue',
  indigo: 'bg-subject-indigo',
  violet: 'bg-subject-violet',
  pink: 'bg-subject-pink',
  brown: 'bg-subject-brown',
};

const TINT: Record<SubjectColour, string> = {
  red: 'bg-subject-red/15',
  orange: 'bg-subject-orange/15',
  amber: 'bg-subject-amber/15',
  lime: 'bg-subject-lime/15',
  green: 'bg-subject-green/15',
  teal: 'bg-subject-teal/15',
  cyan: 'bg-subject-cyan/15',
  blue: 'bg-subject-blue/15',
  indigo: 'bg-subject-indigo/15',
  violet: 'bg-subject-violet/15',
  pink: 'bg-subject-pink/15',
  brown: 'bg-subject-brown/15',
};

/** A dot of the colour; decorative, the name beside it says which subject it is. */
export function SubjectSwatch({
  colour,
  className,
}: {
  colour: SubjectColour;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      // A 10 px square of the full colour (docs/design-system.md, This app).
      className={cn('inline-block size-2.5 shrink-0', SWATCH[colour], className)}
    />
  );
}

/**
 * A subject as the lists show it: its name on a tint of its colour, with the
 * swatch (`12`: "Subject colours are used the same way in the timetable,
 * journal and reports"; "no information shown by colour alone": the name is
 * always written).
 */
export function SubjectChip({ colour, name }: { colour: SubjectColour; name: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5', TINT[colour])}>
      <SubjectSwatch colour={colour} />
      {name}
    </span>
  );
}
