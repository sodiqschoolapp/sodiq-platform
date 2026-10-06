/**
 * The arithmetic of WCAG 2.1 contrast (success criteria 1.4.3 and 1.4.11) for
 * the colour tokens of `index.css`, which are written in oklch. Used by
 * `contrast.test.ts`, which checks every pair the components draw in both
 * themes; nothing of the app runs it.
 */

/** A colour in linear sRGB, each part from 0 to 1, with its alpha. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/** `oklch(L C h)` or `oklch(L C h / A%)`, as the tokens are written. */
export function parseOklch(text: string): Rgb {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/.exec(
    text.trim(),
  );
  if (match === null) {
    throw new Error(`Not an oklch colour: ${text}`);
  }
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const alpha =
    match[4] === undefined ? 1 : match[5] === '%' ? Number(match[4]) / 100 : Number(match[4]);
  // OKLCH to OKLab, OKLab to LMS (cube roots), LMS to linear sRGB.
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  };
}

/** The sRGB transfer function, from a part 0..1 as written to linear. */
const toLinear = (part: number): number =>
  part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;

/** `#rrggbb`, for the known values the test checks the arithmetic with. */
export function parseHex(text: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text.trim());
  if (match === null) {
    throw new Error(`Not a hex colour: ${text}`);
  }
  const part = (hex: string | undefined): number =>
    toLinear(Number.parseInt(hex ?? '00', 16) / 255);
  return { r: part(match[1]), g: part(match[2]), b: part(match[3]), alpha: 1 };
}

/**
 * `fg` laid over `bg` with the given alpha (its own when left out), as a
 * browser composes them. A Tailwind opacity modifier (`bg-destructive/10`)
 * multiplies the alpha of the token, as `color-mix` with transparent does.
 */
export function over(fg: Rgb, bg: Rgb, alpha: number = fg.alpha): Rgb {
  const a = clamp(alpha);
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    alpha: 1,
  };
}

/** WCAG relative luminance of an opaque colour in linear sRGB. */
export function luminance(colour: Rgb): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

/** WCAG contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(one: Rgb, other: Rgb): number {
  const first = luminance(one);
  const second = luminance(other);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The custom properties of one block of a stylesheet, for example `:root` or `.dark`. */
export function tokensOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`The stylesheet has no block ${selector}.`);
  }
  const end = css.indexOf('}', start);
  const tokens: Record<string, string> = {};
  for (const match of css.slice(start, end).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}
