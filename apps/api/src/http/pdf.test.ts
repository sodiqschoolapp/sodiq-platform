import { describe, expect, it } from 'vitest';
import { ApiException } from './api-exception.js';
import {
  ChromiumPdfRenderer,
  PDF_WAITING_MAX,
  pdfFontFaces,
  type LaunchBrowser,
  type RenderBrowser,
  type RenderPage,
} from './pdf.js';

/** A fake Chromium: records what each render asked of it and holds a render until released. */
function fakeChromium(options: { failLaunch?: number; failRender?: boolean } = {}) {
  const asked = {
    launches: 0,
    contexts: [] as unknown[],
    routes: [] as string[],
    aborted: 0,
    contents: [] as string[],
    closedContexts: 0,
    closedBrowsers: 0,
    running: 0,
    mostAtOnce: 0,
  };
  const holds: (() => void)[] = [];
  let launchFailures = options.failLaunch ?? 0;
  const launch: LaunchBrowser = (path) => {
    asked.launches += 1;
    if (launchFailures > 0) {
      launchFailures -= 1;
      return Promise.reject(new Error(`No Chromium at ${String(path)}.`));
    }
    const browser: RenderBrowser = {
      newContext: (contextOptions) => {
        asked.contexts.push(contextOptions);
        const page: RenderPage = {
          setContent: (html) => {
            asked.contents.push(html);
            return Promise.resolve();
          },
          pdf: async () => {
            asked.running += 1;
            asked.mostAtOnce = Math.max(asked.mostAtOnce, asked.running);
            await new Promise<void>((resolve) => holds.push(resolve));
            asked.running -= 1;
            if (options.failRender === true) throw new Error('Chromium crashed.');
            return Buffer.from('%PDF-1.7');
          },
        };
        return Promise.resolve({
          route: async (pattern, handler) => {
            asked.routes.push(pattern);
            await handler({
              abort: () => {
                asked.aborted += 1;
                return Promise.resolve();
              },
            });
          },
          newPage: () => Promise.resolve(page),
          close: () => {
            asked.closedContexts += 1;
            return Promise.resolve();
          },
        });
      },
      close: () => {
        asked.closedBrowsers += 1;
        return Promise.resolve();
      },
    };
    return Promise.resolve(browser);
  };
  /** Lets the renders waiting in `pdf()` finish, one after the other. */
  const release = async () => {
    for (let round = 0; round < 50; round += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      holds.shift()?.();
    }
  };
  return { asked, launch, release };
}

const code = (error: unknown) => (error instanceof ApiException ? error.code : String(error));

// Task 5.9c-1, pull request #199: the PDFs made on the server (13, Exports;
// edge/system-behaviour: "Only that function fails").
describe('the PDF renderer', () => {
  it('renders with JavaScript off, offline, every request aborted, and closes its context', async () => {
    const chromium = fakeChromium();
    const renderer = new ChromiumPdfRenderer({ chromiumPath: '/opt/chromium' }, chromium.launch);
    const made = renderer.render('<p>Oʻzbek</p>');
    await chromium.release();
    expect((await made).toString()).toBe('%PDF-1.7');
    expect(chromium.asked.contexts).toEqual([{ javaScriptEnabled: false, offline: true }]);
    expect(chromium.asked.routes).toEqual(['**/*']);
    expect(chromium.asked.aborted).toBe(1);
    expect(chromium.asked.contents).toEqual(['<p>Oʻzbek</p>']);
    expect(chromium.asked.closedContexts).toBe(1);
  });

  it('starts one Chromium for the process and renders one PDF at a time (decision 6)', async () => {
    const chromium = fakeChromium();
    const renderer = new ChromiumPdfRenderer({ chromiumPath: undefined }, chromium.launch);
    const made = [renderer.render('a'), renderer.render('b'), renderer.render('c')];
    await chromium.release();
    await Promise.all(made);
    expect(chromium.asked.launches).toBe(1);
    expect(chromium.asked.mostAtOnce).toBe(1);
    expect(chromium.asked.contents).toEqual(['a', 'b', 'c']);
  });

  it(`refuses a render beyond the one running and ${String(PDF_WAITING_MAX)} waiting`, async () => {
    const chromium = fakeChromium();
    const renderer = new ChromiumPdfRenderer({ chromiumPath: undefined }, chromium.launch);
    const made = Array.from({ length: PDF_WAITING_MAX + 1 }, (_, index) =>
      renderer.render(String(index)),
    );
    await expect(renderer.render('one too many')).rejects.toSatisfy(
      (error) => code(error) === 'pdf_unavailable',
    );
    await chromium.release();
    await Promise.all(made);
    // Once they are done, a new one is taken again.
    const again = renderer.render('again');
    await chromium.release();
    expect((await again).toString()).toBe('%PDF-1.7');
  });

  it('answers 503 pdf_unavailable when Chromium cannot start, and tries again next time', async () => {
    const chromium = fakeChromium({ failLaunch: 1 });
    const renderer = new ChromiumPdfRenderer({ chromiumPath: '/none' }, chromium.launch);
    const error: unknown = await renderer.render('a').catch((caught: unknown) => caught);
    expect(code(error)).toBe('pdf_unavailable');
    expect(error instanceof ApiException ? error.getStatus() : 0).toBe(503);
    const made = renderer.render('b');
    await chromium.release();
    expect((await made).toString()).toBe('%PDF-1.7');
    expect(chromium.asked.launches).toBe(2);
  });

  it('answers 503 for a render that fails, closes that Chromium and starts a new one', async () => {
    const chromium = fakeChromium({ failRender: true });
    const renderer = new ChromiumPdfRenderer({ chromiumPath: undefined }, chromium.launch);
    const first = renderer.render('a').catch((caught: unknown) => caught);
    await chromium.release();
    expect(code(await first)).toBe('pdf_unavailable');
    expect(chromium.asked.closedBrowsers).toBe(1);
    expect(chromium.asked.closedContexts).toBe(1);
    const second = renderer.render('b').catch((caught: unknown) => caught);
    await chromium.release();
    await second;
    expect(chromium.asked.launches).toBe(2);
  });
});

describe('the fonts of the PDFs', () => {
  it('embeds the four Golos Text files with their ranges and Bitter for U+02BB alone (decision 16)', () => {
    const css = pdfFontFaces();
    expect(css.match(/font-family: 'Golos Text Variable'/g)).toHaveLength(4);
    expect(css.match(/url\(data:font\/woff2;base64,/g)).toHaveLength(5);
    expect(css).not.toMatch(/url\(\.\//);
    expect(css).toMatch(/font-family: 'Sodiq Uzbek mark';[^}]*unicode-range: U\+02BB;/s);
  });
});
