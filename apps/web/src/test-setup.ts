import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, vi } from 'vitest';
import { drawnForms } from '@/components/form/use-record-form';

// The default wait of 1 s is too short when every package is tested at once.
configure({ asyncUtilTimeout: 5_000 });

// The tests of tooling/ run in Node, without a page.
const inPage = typeof window !== 'undefined';

if (inPage) {
  // jsdom has no scrolling; the router scrolls to the top of each page it opens.
  window.scrollTo = () => undefined;
}

// AG Grid (the journal) ends a scroll with a timer of 150 ms and sends its events through a
// timer of its own. One that fires after the file's last test ran into a page already taken
// down ("window is not defined") and failed CI's run of 30 October 2026 although every test
// passed. A file that drew a grid waits for such timers before its page is taken down.
const AG_GRID_TIMERS_MS = 300;
let gridDrawn = false;

// Task 11.18: emptying a field of a form makes its schema speak of a field the
// form draws, or that field's message and red asterisk could never show (a
// typed name that is not the schema's key). Checked for every form any test
// draws, as it stood when last drawn.
afterEach(() => {
  const forms = drawnForms.splice(0);
  const last = new Map<string, (typeof forms)[number]>();
  for (const form of forms) {
    last.set(form.fields.join(','), form);
  }
  const unshown = [...last.values()].flatMap((form) =>
    form.unshown().map((line) => `${line} (the form of ${form.fields.join(',')})`),
  );
  if (unshown.length > 0) {
    throw new Error(
      `A schema issue names no field of its form: ${[...new Set(unshown)].join('; ')}`,
    );
  }
});

afterEach(() => {
  if (inPage && document.querySelector('.ag-root-wrapper') !== null) {
    gridDrawn = true;
  }
  cleanup();
  vi.unstubAllGlobals();
  if (inPage) {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});

afterAll(async () => {
  if (gridDrawn) {
    // A file that faked the clock would never see this wait end.
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, AG_GRID_TIMERS_MS));
  }
});
