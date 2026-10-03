import { expect, test } from '@playwright/test';

// docs/build-plan.md, task 0.1: `pnpm dev` works and the placeholder page calls the
// API health route.
test('the placeholder page shows that the API answers', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sodiq School platform' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API: reachable');
});
