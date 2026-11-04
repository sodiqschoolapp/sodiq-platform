import { expect, test } from '@playwright/test';

// Task 10.5: the first step of every run and of every part of CI (playwright.config.ts, project
// `run`). It exists for its teardown, the demo clock test, which Playwright starts only after
// every spec that depends on this project has finished.
test('the API of the browser tests answers', async ({ request }) => {
  expect((await request.get('/api/health')).ok()).toBe(true);
});
