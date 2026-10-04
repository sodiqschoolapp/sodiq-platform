import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The default wait of 1 s is too short when every package is tested at once.
configure({ asyncUtilTimeout: 5_000 });

// The tests of tooling/ run in Node, without a page.
const inPage = typeof window !== 'undefined';

if (inPage) {
  // jsdom has no scrolling; the router scrolls to the top of each page it opens.
  window.scrollTo = () => undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (inPage) {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});
