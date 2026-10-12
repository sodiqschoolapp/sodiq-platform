import { useId } from 'react';
import { cn } from 'cn';

/**
 * The brand book's hexagons and line ornament (docs/design-system.md, Brand
 * moments), drawn here as inline SVG: they are drawings, not icons, and this
 * folder is the one place an `<svg>` is written by hand
 * (tooling/design-parts.test.ts). Decoration only: hidden from screen readers.
 */

/** The points of a hexagon with a point at the top, centred on (x, y). */
function hexagon(x: number, y: number, r: number): string {
  return Array.from({ length: 6 }, (_, corner) => {
    const angle = ((60 * corner - 90) * Math.PI) / 180;
    return `${(x + r * Math.cos(angle)).toFixed(2)},${(y + r * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

const R = 20;
const W = Math.sqrt(3) * R;

/** A small honeycomb: the cells, and which of them are filled orange. */
const CELLS: readonly { x: number; y: number; filled?: boolean }[] = [
  { x: W, y: R + 2 },
  { x: 2 * W, y: R + 2, filled: true },
  { x: W / 2, y: 2.5 * R + 2 },
  { x: 1.5 * W, y: 2.5 * R + 2 },
  { x: 2.5 * W, y: 2.5 * R + 2 },
  { x: W, y: 4 * R + 2, filled: true },
  { x: 2 * W, y: 4 * R + 2 },
];

/**
 * The drawing of an empty page and a full-page error: hexagon outlines with
 * two orange filled hexagons. The outlines take the text colour: navy on the
 * white panel, the light foreground on the dark card (pull request #61,
 * decision 14).
 */
export function HexagonDrawing({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox={`0 0 ${(3 * W + 2).toFixed(0)} ${(5 * R + 4).toFixed(0)}`}
      className={cn('h-36 w-auto shrink-0 text-foreground', className)}
    >
      {CELLS.map((cell) => (
        <polygon
          key={`${String(cell.x)}-${String(cell.y)}`}
          points={hexagon(cell.x + 1, cell.y, R - 2)}
          className={
            cell.filled === true
              ? 'fill-primary stroke-none'
              : 'fill-none stroke-current [stroke-width:2]'
          }
        />
      ))}
    </svg>
  );
}

/**
 * The column of orange hexagons on white at the edge of the sign-in panel, as
 * on the brand book's cover. The panel is navy in both themes, so the column
 * is white in both (`--sidebar-accent-foreground`).
 */
export function HexagonColumn({ className }: { className?: string }) {
  const id = useId();
  const r = 22;
  const w = Math.sqrt(3) * r;
  return (
    <svg
      aria-hidden
      focusable="false"
      className={cn('h-full w-20 shrink-0 bg-sidebar-accent-foreground', className)}
    >
      <defs>
        <pattern
          id={id}
          width={w.toFixed(2)}
          height={(3 * r).toFixed(2)}
          patternUnits="userSpaceOnUse"
          x="12"
        >
          <polygon points={hexagon(w / 2, r, r - 4)} className="fill-primary" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** The line ornament under the slogan: two orange lines and a small hexagon between them. */
export function LineOrnament({ className }: { className?: string }) {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 160 16" className={cn('h-4 w-40', className)}>
      <line x1="0" y1="8" x2="66" y2="8" className="stroke-primary [stroke-width:2]" />
      <polygon points={hexagon(80, 8, 7)} className="fill-primary" />
      <line x1="94" y1="8" x2="160" y2="8" className="stroke-primary [stroke-width:2]" />
    </svg>
  );
}
