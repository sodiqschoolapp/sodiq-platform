/**
 * The class lists that controls share (docs/design-system.md, Buttons, Fields
 * and switches). tooling/contrast.test.ts checks the pairs they draw.
 */

/** Focus: a 2 px outline in `--ring`, 2 px away from the control. */
export const FOCUS_RING =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Colour changes on hover and press: 120 ms, ease-out. */
export const QUICK = 'transition-colors duration-120 ease-out';

/**
 * A field or a select: 40 high (44 at phone width), white fill, a 1 px
 * `--input` border, corner 8. An error is a 2 px `--destructive` border.
 */
export const FIELD = `h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-sm text-foreground ${QUICK} placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-destructive max-sm:h-11 ${FOCUS_RING}`;

/**
 * A checkbox: the navy accent colour (the foreground in the dark theme);
 * greyed like a field when it is switched off (issue #39, hand test of 13
 * October 2026, finding 2).
 */
export const CHECKBOX = `size-4 accent-checkbox disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

/**
 * A panel: white on the grey canvas, corner 12, padding 24 at every width
 * (only the page padding is 16 at phone width; pull request #80, decision 4),
 * no border and no shadow (docs/design-system.md, Spacing, corners,
 * elevation). Content of a page sits in one; a record form on a page takes it
 * by itself (`index.css`), one in a side panel does not.
 */
export const PANEL = 'rounded-xl bg-card p-6';

/**
 * A panel or section title: Section, 17 / 24, 700 (docs/design-system.md,
 * Type). Every h2 and h3 under the page title takes it
 * (tooling/design-parts.test.ts).
 */
export const SECTION_TITLE = 'text-[1.0625rem]/6 font-bold';

/**
 * A sub-title inside a section (an h4): the Control style, 14 / 20, 600, the
 * nearest weighted style of the Type table (pull request #80, decision 12).
 */
export const SUBSECTION_TITLE = 'text-sm font-semibold';
