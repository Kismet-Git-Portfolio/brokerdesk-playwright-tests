import { test, expect } from '../../fixtures/test';
import { creds } from '../../fixtures/env';

test.describe('Auth', () => {
  test('valid login lands on jobs', async ({ api, loginPage, page }) => {
    void api;
    await loginPage.goto();
    await loginPage.login(creds.user, creds.password);
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(page.getByRole('heading', { name: 'Jobs and shifts' })).toBeVisible();
  });

  test('invalid password shows an error and stays on login', async ({ loginPage, page }) => {
    await loginPage.goto();
    await loginPage.login(creds.user, 'wrong-password');
    await expect(loginPage.error()).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logout ends the session', async ({ loggedIn, loginPage, page }) => {
    void loggedIn;
    await loginPage.logout();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/jobs');
    await expect(page).toHaveURL(/\/login$/); // protected page redirects
  });
});
