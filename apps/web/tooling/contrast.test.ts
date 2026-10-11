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
 * Every pair the components draw, with the alpha its class list gives it.
 * Read the class lists, not only the tokens: `button.tsx` draws the default
 * button hovered as `bg-primary/90`, the secondary one hovered as its colour
 * mixed with 5% of the foreground, the ghost and outline ones hovered as
 * `bg-muted text-foreground`, the link one as `text-primary`, and the
 * destructive one as `bg-destructive/10 text-destructive` with the hover `/20`
 * in the light theme and, in the dark theme, the tint kept at `/10` and a
 * border `border-destructive/60` on hover; every variant's focus border is
 * the base `focus-visible:border-ring`. `app-menu.tsx` draws a menu link hovered or current as `bg-muted` with the
 * normal text. `alert.tsx` draws the destructive
 * alert's text in `text-destructive`; `input.tsx` and `textarea.tsx` fill a
 * field with `dark:bg-input/30` and write the placeholder in
 * `text-muted-foreground`.
 * `border` is not here: dividers and card edges are decorative, and a button is
 * identified by its text. Nor is the 50% halo of `ring-ring/50`: the solid
 * `focus-visible:border-ring` is the focus indicator.
 */
function pairsOf(theme: ':root' | '.dark'): Pair[] {
  const dark = theme === '.dark';
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
  const destructive = token('destructive');
  const input = token('input');
  // A field: the page behind it in the light theme, a faint fill in the dark one.
  const fieldFill = dark ? over(input, background, input.alpha * 0.3) : background;
  const buttonTint = 0.1;
  const hoverTint = dark ? 0.1 : 0.2;
  const percent = (alpha: number): string => `${String(Math.round(alpha * 100))}%`;

  return [
    { name: 'foreground on background', fg: token('foreground'), bg: background, min: TEXT },
    {
      name: 'muted-foreground on background',
      fg: token('muted-foreground'),
      bg: background,
      min: TEXT,
    },
    {
      name: 'muted-foreground on muted',
      fg: token('muted-foreground'),
      bg: over(token('muted'), background),
      min: TEXT,
    },
    { name: 'muted-foreground on card', fg: token('muted-foreground'), bg: card, min: TEXT },
    { name: 'card-foreground on card', fg: token('card-foreground'), bg: card, min: TEXT },
    {
      name: 'popover-foreground on popover',
      fg: token('popover-foreground'),
      bg: over(token('popover'), background),
      min: TEXT,
    },
    {
      name: 'primary-foreground on primary',
      fg: token('primary-foreground'),
      bg: over(token('primary'), background),
      min: TEXT,
    },
    {
      name: 'default button hovered: primary-foreground on primary at 90% over background',
      fg: token('primary-foreground'),
      bg: over(token('primary'), background, 0.9),
      min: TEXT,
    },
    {
      name: 'secondary button hovered: secondary-foreground on secondary mixed with 5% foreground',
      fg: token('secondary-foreground'),
      bg: over(token('foreground'), over(token('secondary'), background), 0.05),
      min: TEXT,
    },
    {
      name: 'ghost and outline buttons hovered: foreground on muted',
      fg: token('foreground'),
      bg: over(token('muted'), background),
      min: TEXT,
    },
    {
      name: 'menu links hovered and current: foreground on muted',
      fg: token('foreground'),
      bg: over(token('muted'), background),
      min: TEXT,
    },
    { name: 'link button: primary on background', fg: token('primary'), bg: background, min: TEXT },
    {
      name: 'secondary-foreground on secondary',
      fg: token('secondary-foreground'),
      bg: over(token('secondary'), background),
      min: TEXT,
    },
    {
      name: 'accent-foreground on accent',
      fg: token('accent-foreground'),
      bg: over(token('accent'), background),
      min: TEXT,
    },
    {
      name: 'sidebar-foreground on sidebar',
      fg: token('sidebar-foreground'),
      bg: over(token('sidebar'), background),
      min: TEXT,
    },
    {
      name: 'sidebar-primary-foreground on sidebar-primary',
      fg: token('sidebar-primary-foreground'),
      bg: over(token('sidebar-primary'), background),
      min: TEXT,
    },
    {
      name: 'destructive text on background (field messages)',
      fg: destructive,
      bg: background,
      min: TEXT,
    },
    {
      name: 'destructive text on card (field messages in a dialog, the destructive alert)',
      fg: destructive,
      bg: card,
      min: TEXT,
    },
    {
      name: `destructive button: text on its tint of ${percent(buttonTint)} over background`,
      fg: destructive,
      bg: over(destructive, background, buttonTint),
      min: TEXT,
    },
    {
      name: `destructive button: text on its tint of ${percent(buttonTint)} over card`,
      fg: destructive,
      bg: over(destructive, card, buttonTint),
      min: TEXT,
    },
    {
      name: `destructive button hovered: text on its tint of ${percent(hoverTint)} over background`,
      fg: destructive,
      bg: over(destructive, background, hoverTint),
      min: TEXT,
    },
    ...(dark
      ? [
          {
            name: 'destructive button hovered: its border at 60% on background',
            fg: over(destructive, background, 0.6),
            bg: background,
            min: CONTROL,
          },
        ]
      : []),
    {
      name: 'placeholder (muted-foreground) on the fill of a field',
      fg: token('muted-foreground'),
      bg: fieldFill,
      min: TEXT,
    },
    {
      name: 'foreground on the fill of a field',
      fg: token('foreground'),
      bg: fieldFill,
      min: TEXT,
    },
    {
      name: 'input border on background',
      fg: over(input, background),
      bg: background,
      min: CONTROL,
    },
    {
      name: 'ring (focus border) on background',
      fg: over(token('ring'), background),
      bg: background,
      min: CONTROL,
    },
    {
      name: 'sidebar-ring (focus border of the menu) on sidebar',
      fg: over(token('sidebar-ring'), over(token('sidebar'), background)),
      bg: over(token('sidebar'), background),
      min: CONTROL,
    },
    // The 12 subject colours (task 2.1, answer 7; `subject-colour.tsx`): the
    // swatch is a graphic that tells subjects apart, 3:1 on the background
    // (1.4.11); the chip writes the name in the normal text on a 15% tint.
    ...SUBJECT_COLOURS.flatMap((colour): Pair[] => [
      {
        name: `subject ${colour}: swatch on background`,
        fg: token(`subject-${colour}`),
        bg: background,
        min: CONTROL,
      },
      {
        name: `subject ${colour}: foreground on its 15% tint over background`,
        fg: token('foreground'),
        bg: over(token(`subject-${colour}`), background, SUBJECT_TINT),
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

  it('are checked by the same pairs in both themes, plus the hover border of the dark one', () => {
    const light = pairsOf(':root').map((pair) => pair.name);
    const darkOnes = pairsOf('.dark').map((pair) => pair.name);
    // The hover tint differs by theme, so its name does; every other name is shared.
    expect(darkOnes.filter((name) => light.includes(name))).toHaveLength(light.length - 1);
    expect(darkOnes).toHaveLength(light.length + 1);
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
