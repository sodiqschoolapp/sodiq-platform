// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SUBJECT_COLOURS } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  over,
  parseHex,
  parseOklch,
  tokensOf,
  type Rgb,
} from '../src/theme/contrast';

// The tokens as written, not as a browser computes them: this test needs no page.
// In tooling/, like the other tests that read files: src/ has no Node types.
const css = readFileSync(path.join(import.meta.dirname, '../src/index.css'), 'utf8');

/** Text needs 4.5:1 (success criterion 1.4.3), a control's boundary or focus 3:1 (1.4.11). */
const TEXT = 4.5;
const CONTROL = 3;

/** The tint of a subject chip, as `subject-colour.tsx` draws it (`/15`). */
const SUBJECT_TINT = 0.15;

interface Pair {
  name: string;
  fg: Rgb;
  bg: Rgb;
  min: number;
}

/**
 * Every pair the components draw, with the alpha its class list gives it, in
 * the classes of docs/design-system.md (task 2.2d-1, pull request #60):
 * `button.tsx` draws the primary button as `bg-primary` hovered
 * `bg-primary-hover`, the secondary as `bg-secondary` hovered
 * `bg-secondary-hover`, the quiet one hovered `bg-accent`, and the danger
 * one as `text-destructive` with no fill until `hover:bg-destructive-bg`;
 * `control.ts` draws fields and selects on `bg-card` with a `border-input`,
 * placeholders in `text-muted-foreground`, checkboxes in `accent-checkbox`
 * and the focus outline in `outline-ring`; `alert.tsx` draws the state
 * colours on their tints and a notice in the normal text on `bg-info-bg`;
 * `segmented.tsx` draws the chosen item `bg-card text-foreground` and the
 * others `text-muted-foreground` on `bg-accent`; `list-page.tsx` draws the
 * selection bar and `data-table.tsx` the open row on `bg-today`, the table
 * header and hovered rows on `bg-muted` inside a `bg-card` panel;
 * `page-header.tsx` writes breadcrumbs in `text-link`; `app-menu.tsx`
 * (task 2.2d-2) draws the navy menu and the tab bar: items in
 * `text-sidebar-foreground`, hovered on `bg-sidebar-accent`, the current
 * one `text-sidebar-primary-foreground` on `bg-sidebar-primary`, the login
 * and the avatar's initials in `text-sidebar-accent-foreground` (on the
 * navy and on `bg-sidebar-avatar`), focus in `outline-sidebar-ring` 2 px out
 * over the navy; the top bar takes `--top-bar` with the search field's
 * `border-input`; `auth-page.tsx` writes the slogan in `text-primary` on
 * the navy panel; `hexagons.tsx` draws the empty page's outlines in the
 * text colour on the panel (pull request #61, decision 14). The sign-in
 * panel's orange hexagons on white are decoration, not a control. `border` is not here:
 * dividers and panel edges are decorative, and a button is identified by its
 * text. Every name is checked in both themes.
 */
function pairsOf(theme: ':root' | '.dark'): Pair[] {
  const tokens = tokensOf(css, theme);
  const token = (name: string): Rgb => {
    const value = tokens[name];
    if (value === undefined) {
      throw new Error(`${theme} has no token --${name}.`);
    }
    return parseOklch(value);
  };
  const background = over(token('background'), token('background'));
  const card = over(token('card'), background);
  const fill = (name: string): Rgb => over(token(name), card);
  const text = (fg: string, bg: string, on: Rgb): Pair => ({
    name: `${fg} on ${bg}`,
    fg: token(fg),
    bg: on,
    min: TEXT,
  });
  const control = (fg: string, bg: string, on: Rgb): Pair => ({
    name: `${fg} (a control's boundary or focus) on ${bg}`,
    fg: token(fg),
    bg: on,
    min: CONTROL,
  });
  const sidebar = over(token('sidebar'), background);

  return [
    // The text of the page, of panels and of their quiet fills.
    text('foreground', 'background', background),
    text('foreground', 'card', card),
    text('foreground', 'muted (table header, hovered row)', fill('muted')),
    text('foreground', 'today (selection bar, open row)', fill('today')),
    text('foreground', 'top-bar', fill('top-bar')),
    text('foreground', 'info-bg (a notice)', fill('info-bg')),
    text('card-foreground', 'card', card),
    text('popover-foreground', 'popover', fill('popover')),
    text('muted-foreground', 'background', background),
    text('muted-foreground', 'card (second lines, placeholders)', card),
    text('muted-foreground', 'muted', fill('muted')),
    text('muted-foreground', 'accent (segmented control, other items)', fill('accent')),
    text('muted-foreground', 'today', fill('today')),
    text('muted-foreground', 'top-bar', fill('top-bar')),
    text('today-muted-foreground', 'today', fill('today')),
    text('link', 'card', card),
    text('link', 'background', background),
    // Buttons.
    text('primary-foreground', 'primary', fill('primary')),
    text('primary-foreground', 'primary-hover', fill('primary-hover')),
    text('secondary-foreground', 'secondary', fill('secondary')),
    text('secondary-foreground', 'secondary-hover', fill('secondary-hover')),
    text('accent-foreground', 'accent (quiet button hovered)', fill('accent')),
    text('destructive', 'card', card),
    text('destructive', 'background', background),
    // The warning icon of a failed save on the secondary button of unsent-changes.tsx.
    text('destructive', 'secondary', fill('secondary')),
    text(
      'destructive',
      'destructive-bg (danger button hovered, danger alert)',
      fill('destructive-bg'),
    ),
    // Status in plain words, on the page and on their tints.
    ...(['success', 'warning', 'info'] as const).flatMap((state) => [
      text(state, 'card', card),
      text(state, 'background', background),
      text(state, `${state}-bg`, fill(`${state}-bg`)),
    ]),
    // The menu, navy in both themes.
    text('sidebar-foreground', 'sidebar', sidebar),
    text('sidebar-foreground', 'sidebar-accent', over(token('sidebar-accent'), sidebar)),
    text('sidebar-accent-foreground', 'sidebar-accent', over(token('sidebar-accent'), sidebar)),
    text('sidebar-primary-foreground', 'sidebar-primary', over(token('sidebar-primary'), sidebar)),
    text('sidebar-accent-foreground', 'sidebar (the login at the foot of the menu)', sidebar),
    text(
      'sidebar-accent-foreground',
      'sidebar-avatar (the initials)',
      over(token('sidebar-avatar'), sidebar),
    ),
    // The sign-in slogan, the one orange text (pull request #61, decision 16).
    text('primary', 'sidebar (the sign-in slogan)', sidebar),
    // The brand drawing of an empty page and a full-page error (decision 14).
    control('foreground', 'card (the hexagon outlines of an empty page)', card),
    // Controls: the border of a field, the checkbox, the focus outline.
    control('input', 'card', card),
    control('input', 'background', background),
    control('input', 'top-bar (the search field)', fill('top-bar')),
    control('checkbox', 'card', card),
    control('checkbox', 'background', background),
    control('ring', 'card', card),
    control('ring', 'background', background),
    control('ring', 'muted', fill('muted')),
    control('ring', 'today', fill('today')),
    control('ring', 'secondary', fill('secondary')),
    control('ring', 'top-bar', fill('top-bar')),
    // Focus 2 px outside a segment lands on the track; outside an alert's
    // action, on the alert's tint.
    control('ring', 'accent', fill('accent')),
    control('ring', 'info-bg', fill('info-bg')),
    control('ring', 'success-bg', fill('success-bg')),
    control('ring', 'warning-bg', fill('warning-bg')),
    control('ring', 'destructive-bg', fill('destructive-bg')),
    control('sidebar-ring', 'sidebar', sidebar),
    // The 12 subject colours (task 2.1, answer 7; `subject-colour.tsx`): the
    // swatch is a graphic that tells subjects apart, 3:1 on the background
    // and on a panel (1.4.11); the chip writes the name in the normal text on
    // a 15% tint.
    ...SUBJECT_COLOURS.flatMap((colour): Pair[] => [
      control(`subject-${colour}`, 'background', background),
      control(`subject-${colour}`, 'card', card),
      {
        name: `subject ${colour}: foreground on its 15% tint over background`,
        fg: token('foreground'),
        bg: over(token(`subject-${colour}`), background, SUBJECT_TINT),
        min: TEXT,
      },
      {
        name: `subject ${colour}: foreground on its 15% tint over card`,
        fg: token('foreground'),
        bg: over(token(`subject-${colour}`), card, SUBJECT_TINT),
        min: TEXT,
      },
    ]),
  ];
}

// docs/spec/12-ux-standards.md, Look and feel: "sufficient contrast". Decided by
// the owner (task 0.8b-3): WCAG 2.1 AA, in both themes.
describe('the colour tokens of index.css', () => {
  it.each([':root', '.dark'] as const)('meet WCAG 2.1 AA in the theme %s', (theme) => {
    const failing = pairsOf(theme)
      .map((pair) => ({ ...pair, ratio: contrastRatio(pair.fg, pair.bg) }))
      .filter((pair) => pair.ratio < pair.min)
      .map((pair) => `${pair.name}: ${pair.ratio.toFixed(2)}:1, needs ${String(pair.min)}:1`);

    expect(failing).toEqual([]);
  });

  // Native controls and scrollbars follow the theme (apps/web/src/theme/theme.ts).
  it('tell the browser which scheme each theme is', () => {
    expect(/:root \{[^}]*color-scheme: light;/.test(css)).toBe(true);
    expect(/\.dark \{[^}]*color-scheme: dark;/.test(css)).toBe(true);
  });

  // Since task 2.2d-1 every token exists in both themes and the class lists
  // are the same, so every pair is checked in both (pull request #60, decision 5).
  it('are checked by the same pairs in both themes', () => {
    expect(pairsOf('.dark').map((pair) => pair.name)).toEqual(
      pairsOf(':root').map((pair) => pair.name),
    );
  });

  // docs/design-system.md: the menu does not change between themes.
  it('keep the menu the same in both themes', () => {
    const light = tokensOf(css, ':root');
    const dark = tokensOf(css, '.dark');
    for (const name of Object.keys(light).filter((key) => key.startsWith('sidebar'))) {
      expect(dark[name], name).toBe(light[name]);
    }
  });
});

// The arithmetic, against values known from the WCAG examples.
describe('the contrast arithmetic', () => {
  it('gives 21:1 for black on white and 1:1 for a colour on itself', () => {
    const white = parseHex('#ffffff');
    const black = parseHex('#000000');
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('gives 4.54:1 for #767676 on white, the smallest grey that passes for text', () => {
    expect(contrastRatio(parseHex('#767676'), parseHex('#ffffff'))).toBeCloseTo(4.54, 2);
  });

  it('reads oklch: white, black and a grey', () => {
    expect(parseOklch('oklch(1 0 0)')).toMatchObject({ r: 1, g: 1, b: 1, alpha: 1 });
    expect(parseOklch('oklch(0 0 0)')).toMatchObject({ r: 0, g: 0, b: 0, alpha: 1 });
    // oklch(0.556 0 0) is about #737373.
    const grey = parseOklch('oklch(0.556 0 0)');
    const expected = parseHex('#737373');
    expect(grey.r).toBeCloseTo(expected.r, 2);
    expect(grey.g).toBeCloseTo(expected.g, 2);
    expect(parseOklch('oklch(1 0 0 / 15%)').alpha).toBe(0.15);
  });

  it('lays a colour over another by its alpha', () => {
    const half = over(parseHex('#000000'), parseHex('#ffffff'), 0.5);
    expect(half.r).toBeCloseTo(0.5, 5);
    expect(half.alpha).toBe(1);
    // A token with its own alpha, tinted again: the two multiply.
    const faint = over(parseOklch('oklch(1 0 0 / 15%)'), parseHex('#000000'), 0.15 * 0.3);
    expect(faint.r).toBeCloseTo(0.045, 5);
  });

  it('reads the tokens of a block, and not what a comment says about one', () => {
    const tokens = tokensOf(
      ':root {\n  --a: oklch(1 0 0);\n  --b-c: oklch(0 0 0 / 10%);\n}\n.dark {\n  --a: oklch(0 0 0);\n  /* Like --a: 4.5:1 on --b-c; see the test. */\n}',
      '.dark',
    );
    expect(tokens).toEqual({ a: 'oklch(0 0 0)' });
  });
});
