import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { OnModuleDestroy } from '@nestjs/common';
import type { AppConfig } from '../config/config.js';
import { ApiException } from './api-exception.js';

/** The media type of a PDF. */
export const PDF_MEDIA_TYPE = 'application/pdf';

/**
 * The answer of a route that sends a PDF (task 5.9c-1): the file and its
 * names. `@ReturnsFile()` sends it with its headers, as an `XlsxFile`.
 */
export class PdfFile {
  constructor(
    /** The file name in the language of the file, for `filename*`. */
    readonly fileName: string,
    /** The same name in ASCII letters, for a browser that ignores `filename*`. */
    readonly asciiName: string,
    readonly content: Buffer,
  ) {}
}

/** Makes a PDF of a whole HTML document. */
export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
}

/** Injection token of the `PdfRenderer`; the tests give a fake one. */
export const PDF_RENDERER = Symbol('PDF_RENDERER');

/** The part of a Playwright page the renderer uses. */
export interface RenderPage {
  setContent(html: string, options: { waitUntil: 'load'; timeout: number }): Promise<void>;
  pdf(options: {
    preferCSSPageSize: true;
    printBackground: true;
    timeout?: number;
  }): Promise<Buffer>;
}

/** The part of a Playwright browser the renderer uses. */
export interface RenderBrowser {
  newContext(options: { javaScriptEnabled: false; offline: true }): Promise<{
    route(
      pattern: string,
      handler: (route: { abort(): Promise<void> }) => Promise<void>,
    ): Promise<unknown>;
    newPage(): Promise<RenderPage>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}

export type LaunchBrowser = (executablePath: string | undefined) => Promise<RenderBrowser>;

/** At most this many renders wait behind the one running in this process (decision 6). */
export const PDF_WAITING_MAX = 8;

/** A render that takes longer is given up (decision 6). */
export const PDF_RENDER_TIMEOUT_MS = 30_000;

const unavailable = () => new ApiException('pdf_unavailable', 503);

const require = createRequire(import.meta.url);

/** Chromium through playwright-core (`13`, Exports: "PDF by headless Chromium (Playwright) on the server"). */
export const launchChromium: LaunchBrowser = async (executablePath) => {
  const { chromium } = require('playwright-core') as typeof import('playwright-core');
  return chromium.launch(executablePath === undefined ? {} : { executablePath });
};

/**
 * The PDFs made on the server (task 5.9c-1; `edge/system-behaviour`: "PDFs
 * are made on the server with fonts that cover Uzbek Latin and Cyrillic").
 *
 * - One headless Chromium for the process, started at the first PDF and
 *   started again when it died; each render has a context of its own, closed
 *   afterwards.
 * - The page runs no script and fetches nothing: JavaScript is off, the
 *   context is offline and every request is aborted (spec review should-fix
 *   2), so a name typed as markup cannot make the server fetch anything. The
 *   fonts and the logo are inside the document.
 * - One render at a time, at most `PDF_WAITING_MAX` waiting and
 *   `PDF_RENDER_TIMEOUT_MS` each (decision 6). A Chromium that cannot be
 *   started, a full queue or a render that fails answers 503
 *   `pdf_unavailable`; nothing else of the API depends on it
 *   (`edge/system-behaviour`: "Only that function fails").
 */
export class ChromiumPdfRenderer implements PdfRenderer, OnModuleDestroy {
  private browser: Promise<RenderBrowser> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(
    private readonly config: Pick<AppConfig, 'chromiumPath'>,
    private readonly launch: LaunchBrowser = launchChromium,
    /** The whole render, start of the page to the last byte (decision 6); a test gives a shorter one. */
    private readonly limitMs: number = PDF_RENDER_TIMEOUT_MS,
  ) {}

  render(html: string): Promise<Buffer> {
    if (this.waiting >= PDF_WAITING_MAX + 1) {
      return Promise.reject(unavailable());
    }
    this.waiting += 1;
    const run = this.queue.then(() => this.renderNow(html));
    this.queue = run.catch(() => undefined);
    return run.finally(() => {
      this.waiting -= 1;
    });
  }

  async onModuleDestroy(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser !== null) {
      await browser.then((one) => one.close()).catch(() => undefined);
    }
  }

  /**
   * One render within `limitMs` in all (spec review should-fix 2): past it
   * the Chromium is closed, which ends the render, and the answer is 503.
   */
  private async renderNow(html: string): Promise<Buffer> {
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(unavailable());
      }, this.limitMs);
    });
    try {
      return await Promise.race([this.renderInChromium(html), limit]);
    } catch (error) {
      await this.onModuleDestroy();
      throw error instanceof ApiException ? error : unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private async renderInChromium(html: string): Promise<Buffer> {
    let browser: RenderBrowser;
    try {
      browser = await this.browserOf();
    } catch {
      throw unavailable();
    }
    try {
      const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
      try {
        await context.route('**/*', (route) => route.abort());
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'load', timeout: this.limitMs });
        return await page.pdf({
          preferCSSPageSize: true,
          printBackground: true,
          timeout: this.limitMs,
        });
      } finally {
        await context.close().catch(() => undefined);
      }
    } catch {
      // A Chromium that died is closed by `renderNow` and started again at the next render.
      throw unavailable();
    }
  }

  private browserOf(): Promise<RenderBrowser> {
    if (this.browser === null) {
      const started = this.launch(this.config.chromiumPath);
      this.browser = started;
      started.catch(() => {
        if (this.browser === started) this.browser = null;
      });
    }
    return this.browser;
  }
}

const GOLOS_CSS = '@fontsource-variable/golos-text/index.css';

/** The face of the PDFs (decided ahead for 2.2d, approval 1: "the same Golos Text files"). */
export const PDF_FONT_FAMILY = 'Golos Text Variable';

/** The face that draws U+02BB alone, which the Golos Text files do not hold (decision 16). */
export const UZBEK_MARK_FAMILY = 'Sodiq Uzbek mark';

const fontFile = (path: string): string =>
  `url(data:font/woff2;base64,${readFileSync(path).toString('base64')})`;

let fontFaces: string | null = null;

/**
 * The `@font-face` rules of the PDFs with the font files inside them: the
 * four Golos Text subsets with the `unicode-range` of each copied from the
 * package's own CSS (spec review should-fix 4), and the Uzbek turned comma
 * U+02BB (oʻ, gʻ) from the latin file of Bitter, the brand's slab font: the
 * Golos Text files have no glyph for it, so without this face Chromium would
 * draw it with a font of the server, or nothing (decision 16, Look first).
 */
export function pdfFontFaces(): string {
  if (fontFaces === null) {
    const css = require.resolve(GOLOS_CSS);
    const golos = readFileSync(css, 'utf8').replace(
      /url\(\.\/files\/([\w.-]+)\)/g,
      (_whole, file: string) => fontFile(css.replace(/index\.css$/, `files/${file}`)),
    );
    const bitter =
      require.resolve('@fontsource-variable/bitter/files/bitter-latin-wght-normal.woff2');
    fontFaces = `${golos}
@font-face {
  font-family: '${UZBEK_MARK_FAMILY}';
  font-style: normal;
  font-weight: 100 900;
  src: ${fontFile(bitter)} format('woff2-variations');
  unicode-range: U+02BB;
}`;
  }
  return fontFaces;
}

let logo: string | null = null;

/**
 * The one-line logo for dark ground, the exact file of the brand book that
 * the web app shows (`docs/design-system.md`, Logo; review correction 4),
 * read from the web app's brand folder beside this one in the repository.
 */
export function letterheadLogo(): string {
  if (logo === null) {
    logo = readFileSync(
      new URL('../../../web/public/brand/sodiq-logo-horizontal-on-dark.svg', import.meta.url),
      'utf8',
    );
  }
  return logo;
}
