// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/design-system.md (task 2.2d-1, pull request #60): the parts every
// screen is drawn with. Read from the sources, as contrast.test.ts reads the
// tokens: every file under src/, not a list, so a new file is checked too.
const web = path.join(import.meta.dirname, '..');
const src = path.join(web, 'src');

function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourcesOf(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const sources = sourcesOf(src).map((file) => ({
  file: path.relative(web, file),
  text: readFileSync(file, 'utf8'),
}));

/** The files whose text matches, as `file: line` for a readable failure. */
function matching(pattern: RegExp, files = sources): string[] {
  return files.flatMap(({ file, text }) =>
    text
      .split('\n')
      .flatMap((line, index) => (pattern.test(line) ? [`${file}:${String(index + 1)}`] : [])),
  );
}

/** Matches over the whole text (a value written over several lines), as `file: line`. */
function matchingText(pattern: RegExp, files = sources): string[] {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  );
  return files.flatMap(({ file, text }) =>
    [...text.matchAll(global)].map(
      (match) => `${file}:${String(text.slice(0, match.index).split('\n').length)}`,
    ),
  );
}

const read = (file: string): string => readFileSync(path.join(web, file), 'utf8');

describe('the parts of the design system', () => {
  // Icons: "one set only" (What we never do, 10); Type: Golos Text, not Geist.
  it('use no Lucide icon and no Geist font, in the sources or the package', () => {
    expect(matching(/lucide-react|@fontsource-variable\/geist/)).toEqual([]);
    expect(read('src/index.css')).not.toMatch(/geist/i);
    const manifest = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const packages = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(packages).not.toContain('lucide-react');
    expect(packages).not.toContain('@fontsource-variable/geist');
  });

  it('draw every icon through components/icons.tsx', () => {
    const others = sources.filter(
      ({ file }) => file !== path.join('src', 'components', 'icons.tsx'),
    );
    expect(matching(/@material-symbols|\.svg\?react/, others)).toEqual([]);
  });

  // Buttons: "There are no `xs` sizes and no `outline` or `link` variants."
  // Both ways of naming one: a JSX attribute, and a key or a default value in code.
  it('use no removed kind or size of button', () => {
    expect(matching(/variant\s*=\s*\{?\s*["'](outline|link)["']/)).toEqual([]);
    // A value chosen inside braces: `variant={archived ? 'secondary' : 'destructive'}`.
    expect(matching(/variant\s*=\s*\{[^}]*["'](outline|link)["']/)).toEqual([]);
    expect(matching(/size\s*=\s*\{[^}]*["'](xs|icon-xs)["']/)).toEqual([]);
    expect(matching(/variant\s*:\s*["'](outline|link)["']/)).toEqual([]);
    expect(matching(/size\s*=\s*\{?\s*["'](xs|icon-xs)["']/)).toEqual([]);
    expect(matching(/size\s*:\s*["'](xs|icon-xs)["']/)).toEqual([]);
  });

  it('offer exactly the three sizes and four kinds in button.tsx', () => {
    const button = read('src/components/ui/button.tsx');
    const keysOf = (block: string): string[] => {
      const start = button.indexOf(`${block}: {`);
      const end = button.indexOf('\n      },', start);
      return [...button.slice(start, end).matchAll(/^ {8}'?([\w-]+)'?:/gm)].map(
        (match) => match[1] ?? '',
      );
    };
    expect(keysOf('variant').sort()).toEqual(['default', 'destructive', 'ghost', 'secondary']);
    expect(keysOf('size').sort()).toEqual(['default', 'icon', 'icon-lg', 'icon-sm', 'lg', 'sm']);
  });

  // What we never do: 3, a coloured stripe on the left of a row; 4 and 12, a
  // pill or a dot for a count.
  it('draw no stripe on the left and no pill or dot for a count', () => {
    // The components, not the tests that look for these classes.
    const drawn = sources.filter(({ file }) => !/\.test\.tsx?$/.test(file));
    expect(matching(/shadow-\[inset_/, drawn)).toEqual([]);
    expect(matching(/rounded-full[^'"`]*bg-primary|bg-primary[^'"`]*rounded-full/, drawn)).toEqual(
      [],
    );
  });

  // docs/design-system.md, Type: "Bitter ... for brand moments only: the
  // sign-in title and slogan, the title of an empty page and of a full-page
  // error. Never in tables, forms, menus or page titles of working screens."
  // Task 2.2d-2: the sign-in frame and the brand moment of states.tsx (which
  // the full-page errors of app/pages.tsx draw); the font is named in
  // index.css only.
  it('draw the slab font in the brand moments only', () => {
    const drawn = sources.filter(({ file }) => !/\.test\.tsx?$/.test(file));
    const files = new Set(matching(/font-brand/, drawn).map((line) => line.split(':')[0] ?? ''));
    expect([...files].sort()).toEqual(
      [
        path.join('src', 'components', 'states.tsx'),
        path.join('src', 'features', 'auth', 'auth-page.tsx'),
      ].sort(),
    );
    // The family itself, by name in a string.
    expect(matching(/['"]Bitter/, drawn)).toEqual([]);
    expect(read('src/index.css')).toContain("@import '@fontsource-variable/bitter';");
  });

  // The hexagons and the line ornament are drawings, not icons (pull request
  // #61, decision 10): an <svg> is written by hand in components/brand/ only;
  // every icon comes from components/icons.tsx.
  it('write an svg by hand only in the brand drawings', () => {
    const drawn = sources.filter(
      ({ file }) =>
        !/\.test\.tsx?$/.test(file) && !file.startsWith(path.join('src', 'components', 'brand')),
    );
    expect(matching(/<svg[\s>]/, drawn)).toEqual([]);
  });

  // What we never do 9: "Orange text". The one orange text is the slogan on
  // the navy panel of the sign-in page (Brand moments; pull request #61,
  // decision 16).
  it('write orange text only in the slogan of the sign-in page', () => {
    const drawn = sources.filter(({ file }) => !/\.test\.tsx?$/.test(file));
    expect(matching(/\btext-primary(?!-)/, drawn)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^${path.join('src', 'features', 'auth', 'auth-page.tsx').replaceAll('/', '\\/')}:`,
        ),
      ),
    ]);
  });

  // .claude/rules/web.md: "The theme is useTheme() and ThemeSwitch; nothing
  // else reads or writes sodiq.theme"; the menu's shape the same way (pull
  // request #61, correction 1).
  it('keep the theme and the menu shape each in its one file', () => {
    const drawn = sources.filter(({ file }) => !/\.test\.tsx?$/.test(file));
    const filesOf = (pattern: RegExp): string[] => [
      ...new Set(matching(pattern, drawn).map((line) => line.split(':')[0] ?? '')),
    ];
    expect(filesOf(/sodiq\.theme/)).toEqual([path.join('src', 'theme', 'theme.ts')]);
    expect(filesOf(/sodiq\.menu/)).toEqual([
      path.join('src', 'features', 'access', 'menu-state.ts'),
    ]);
  });

  // docs/design-system.md, Logo: the browser and home-screen icons.
  it('name the browser-tab and app icons in index.html and the manifest', () => {
    const html = read('index.html');
    for (const icon of [
      '/brand/favicon.ico',
      '/brand/sodiq-mark.svg',
      '/brand/icon-32.png',
      '/brand/icon-48.png',
    ]) {
      expect(html).toContain(`href="${icon}"`);
    }
    expect(html).toContain('<link rel="apple-touch-icon" href="/brand/icon-180.png" />');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
      icons: { src: string }[];
    };
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      '/brand/icon-192.png',
      '/brand/icon-512.png',
    ]);
    for (const file of [
      'favicon.ico',
      'sodiq-mark.svg',
      'icon-32.png',
      'icon-48.png',
      'icon-180.png',
      'icon-192.png',
      'icon-512.png',
    ]) {
      expect(existsSync(path.join(web, 'public', 'brand', file)), file).toBe(true);
    }
  });
});

// Task 2.7c-1: the page sweep against docs/design-system.md.
describe('the pages of the design system', () => {
  const drawn = sources.filter(({ file }) => !/\.test\.tsx?$/.test(file));

  // What we never do 9 and Accessibility ("no information by colour alone"):
  // orange is the action, the active item and "now", never a marker. Every
  // way of drawing it as a line or a fill outside the brand drawings: a
  // border on any side (logical ones too), a divider, a ring, an outline, an
  // underline, a shadow, a checkbox accent, the fill and stroke of a drawing,
  // the menu's orange under its own name, an arbitrary value and the
  // variable itself in a style.
  it('draw no orange border, ring, outline or fill outside the brand drawings', () => {
    const marked = drawn.filter(
      ({ file }) => !file.startsWith(path.join('src', 'components', 'brand')),
    );
    expect(
      matching(
        /\b(border|divide|ring|outline|decoration|shadow|accent|fill|stroke)(-[trblxyse])?-(sidebar-)?primary(?!-)/,
        marked,
      ),
    ).toEqual([]);
    expect(matching(/var\(--(sidebar-)?primary\)/, marked)).toEqual([]);
  });

  // Type: "Section 17 / 24, 700: panel and section titles". Every heading
  // under the page title takes the one class; a sub-title inside a section
  // takes the Control style (pull request #80, decision 12). The page title
  // is PageHeader's, the brand titles are states.tsx's and the slip is a
  // printout with a size of its own (Brand moments, Printouts).
  it('give every section heading the Section style and every sub-title the Control style', () => {
    const excepted = [
      path.join('src', 'components', 'page-header.tsx'),
      path.join('src', 'components', 'states.tsx'),
      path.join('src', 'features', 'people', 'first-password-slip.tsx'),
    ];
    const wrong = drawn
      .filter(
        ({ file }) =>
          !excepted.includes(file) &&
          (file.startsWith(path.join('src', 'features')) ||
            file.startsWith(path.join('src', 'components'))),
      )
      .flatMap(({ file, text }) =>
        [...text.matchAll(/<h([234])\b([^>]*)>/g)].flatMap((match) => {
          const level = match[1] ?? '';
          const attributes = match[2] ?? '';
          const wanted = level === '4' ? /\bSUBSECTION_TITLE\b/ : /\bSECTION_TITLE\b/;
          // No size or weight of its own beside the class.
          const overridden =
            /\btext-(xs|sm|base|lg|\d?xl|\[)|\bfont-(thin|light|normal|medium|semibold|bold|extrabold|black)\b/;
          const line = text.slice(0, match.index).split('\n').length;
          return wanted.test(attributes) && !overridden.test(attributes)
            ? []
            : [`${file}:${String(line)} h${level}`];
        }),
      );
    expect(wrong).toEqual([]);
    // No deeper level and no heading drawn by a role: the Type table has two
    // levels under the page title.
    expect(matchingText(/<h[56]\b|role=["'{]*heading/, drawn)).toEqual([]);
  });

  // Buttons: "Large 48: sign-in, the main action of a phone screen"; Medium
  // everywhere else. Large is written only in the files of the sign-in frame;
  // the two files drawn on the frame and inside the layout take the size from
  // their caller (pull request #80, decision 13), so they never name it. Every
  // way of writing it: an attribute, a value inside braces, a key and a
  // default value.
  it('draw a large button only on the sign-in frame', () => {
    const frame = [
      'auth-page.tsx',
      'sign-in-page.tsx',
      'forgot-password-page.tsx',
      'reset-password-page.tsx',
      'code-page.tsx',
      'set-up-page.tsx',
    ].map((name) => path.join('src', 'features', 'auth', name));
    const working = drawn.filter(
      ({ file }) =>
        !frame.includes(file) && file !== path.join('src', 'components', 'ui', 'button.tsx'),
    );
    // PersonPhoto has a size of its own, `lg`, which is not a button.
    const buttons = working.map(({ file, text }) => ({
      file,
      text: text.replace(/<PersonPhoto\b[^>]*>/g, (tag) => tag.replaceAll(/\S/g, ' ')),
    }));
    // An attribute or a default value, a value chosen inside braces (also over
    // several lines, as Prettier writes a long one), and a key; any quote.
    expect(matchingText(/size\s*=\s*\{?\s*["'`](lg|icon-lg)["'`]/, buttons)).toEqual([]);
    expect(matchingText(/size\s*=\s*\{[^}]*["'`](lg|icon-lg)["'`]/, buttons)).toEqual([]);
    expect(matchingText(/size\s*:\s*["'`](lg|icon-lg)["'`]/, buttons)).toEqual([]);
    // The frame's size by its name, only where the frame decides it.
    const decides = [...frame, path.join('src', 'features', 'auth', 'password-page.tsx')];
    expect(
      matchingText(
        /\bFRAME_BUTTON_SIZE\b/,
        drawn.filter(({ file }) => !decides.includes(file)),
      ),
    ).toEqual([]);
  });
});
