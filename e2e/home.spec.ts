import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should load a public page', async ({ page }) => {
    await page.goto('/terms');

    await expect(page.getByRole('heading', { name: /terms of service/i })).toBeVisible();
  });

  test('should show login link on public header', async ({ page }) => {
    await page.goto('/terms');

    const loginLink = page.getByRole('link', { name: /login/i });
    await expect(loginLink).toBeVisible();
  });
});

test.describe('Public assets', () => {
  test('should serve the embed widget script', async ({ request }) => {
    const response = await request.get('/embed/widget.js');
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).toContain('op-widget');
  });
});

test.describe('Authentication', () => {
  test('should redirect unauthenticated users from protected routes', async ({ page, baseURL }) => {
    test.skip(Boolean(baseURL && !baseURL.includes('localhost')), 'Skip on remote environments with SSO');

    await page.goto('/feed', { waitUntil: 'commit' });
    await page.waitForURL(/\/login/);
  });
});
