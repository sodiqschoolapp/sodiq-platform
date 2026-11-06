import type { Page } from '@playwright/test';

/**
 * What a page met while a test ran, for the message of a failure: the API calls refused or
 * failed, and the errors the page threw. The traces of a CI run cannot be read from a cloud
 * session, so a step that fails at random on CI says in its own message what the page showed
 * (the page walk's titles and the journal's Excel download, 5 and 6 November 2026).
 */
const seen = new WeakMap<Page, string[]>();

/** Starts keeping what the page meets; call once, right after the page is given to the test. */
export function watchPage(page: Page): void {
  const lines: string[] = [];
  seen.set(page, lines);
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      lines.push(
        `${response.request().method()} ${new URL(response.url()).pathname} ${String(response.status())}`,
      );
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/')) {
      lines.push(
        `${request.method()} ${new URL(request.url()).pathname} failed: ${request.failure()?.errorText ?? 'unknown'}`,
      );
    }
  });
  page.on('pageerror', (error) => {
    lines.push(`page error: ${error.message}`);
  });
}

/** Resolves to `fallback` when the page does not answer in time (a busy main thread). */
async function within<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, 5_000);
  });
  try {
    return await Promise.race([work.catch(() => fallback), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the page shows now, in one line: its address, headings, alerts and the calls it met. */
export async function whatPageShows(page: Page): Promise<string> {
  const silent = ['(the page did not answer within 5 s)'];
  const headings = await within(page.getByRole('heading').allInnerTexts(), silent);
  const alerts = await within(page.getByRole('alert').allInnerTexts(), silent);
  const calls = seen.get(page) ?? ['(not watched)'];
  return [
    `address ${page.url()}`,
    `headings ${JSON.stringify(headings.slice(0, 6))}`,
    `alerts ${JSON.stringify(alerts.slice(0, 3))}`,
    `API calls refused or failed, last 10 ${JSON.stringify(calls.slice(-10))}`,
  ].join('; ');
}
