import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('should display the home page', async ({ page }) => {
    await page.goto('/');
    
    // Check that the page loads
    await expect(page).toHaveTitle(/Munia|Our Power/i);
  });

  test('should show login options', async ({ page }) => {
    await page.goto('/');
    
    // Look for sign in / login button
    const loginButton = page.getByRole('button', { name: /sign in|log in/i });
    await expect(loginButton).toBeVisible();
  });
});

test.describe('Authentication', () => {
  test('should redirect unauthenticated users from protected routes', async ({ page }) => {
    // Try to access a protected route
    await page.goto('/profile');
    
    // Should redirect to login or show auth prompt
    await expect(page).toHaveURL(/\/(login|auth|api\/auth)/);
  });
});
