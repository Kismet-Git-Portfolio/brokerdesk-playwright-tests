import { test as base, expect, APIRequestContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { JobsPage } from '../pages/JobsPage';
import { ShiftPage } from '../pages/ShiftPage';
import { JobDetailPage } from '../pages/JobDetailPage';
import { PayoutsPage } from '../pages/PayoutsPage';
import { TradesPage } from '../pages/TradesPage';
import { creds } from './env';

type Fixtures = {
  loginPage: LoginPage; jobsPage: JobsPage; shiftPage: ShiftPage; jobDetail: JobDetailPage;
  payoutsPage: PayoutsPage; tradesPage: TradesPage;
  loggedIn: void;       // logs in through the UI before the test
  api: APIRequestContext; // fresh API client, store reset before each test
};

export const test = base.extend<Fixtures>({
  api: async ({ request }, use) => {
    await request.post('/api/reset');
    await use(request);
  },
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  jobsPage: async ({ page }, use) => use(new JobsPage(page)),
  shiftPage: async ({ page }, use) => use(new ShiftPage(page)),
  jobDetail: async ({ page }, use) => use(new JobDetailPage(page)),
  payoutsPage: async ({ page }, use) => use(new PayoutsPage(page)),
  tradesPage: async ({ page }, use) => use(new TradesPage(page)),
  loggedIn: async ({ api, loginPage, page }, use) => {
    void api; // ensures reset ran first
    await loginPage.goto();
    await loginPage.login(creds.user, creds.password);
    await expect(page).toHaveURL(/\/jobs$/);
    await use();
  },
});
export { expect };
