import { test, expect } from '../../fixtures/test';
import { applicant } from '../../fixtures/data';

test('job listing shows seeded jobs', async ({ loggedIn, jobsPage }) => {
  void loggedIn;
  await jobsPage.goto();
  await expect(jobsPage.rows()).toHaveCount(2);
  await expect(jobsPage.row('job-1').getByTestId('job-title')).toHaveText('Warehouse Picker');
});

test('apply to a job, and a second apply with the same email is blocked', async ({ loggedIn, jobsPage, jobDetail, page }) => {
  void loggedIn;
  const a = applicant();
  await jobsPage.goto();
  await jobsPage.row('job-2').getByTestId('job-open').click();
  await expect(page).toHaveURL(/\/jobs\/job-2$/);
  await jobDetail.apply(a.name, a.email);
  await expect(jobDetail.status()).toHaveText('Application sent');
  await expect(jobDetail.count()).toHaveText('1');
  await jobDetail.apply(a.name, a.email);
  await expect(jobDetail.status()).toHaveText('Already applied');
  await expect(jobDetail.count()).toHaveText('1');
});

test('batch: 10 applicants created via API all show in the UI', async ({ loggedIn, api, jobDetail }) => {
  void loggedIn;
  const people = Array.from({ length: 10 }, (_, i) => applicant(i));
  for (const p of people) {
    const r = await api.post('/api/jobs/job-1/apply', { data: p });
    expect(r.status()).toBe(201);
  }
  await jobDetail.goto('job-1');
  await expect(jobDetail.count()).toHaveText('10');
  await expect(jobDetail.applicants()).toHaveCount(10);
  for (const p of people) await expect(jobDetail.applicants().filter({ hasText: p.email })).toHaveCount(1);
});

test('slow network: loading state shows until jobs arrive', async ({ loggedIn, jobsPage, page }) => {
  void loggedIn;
  await page.route('**/api/jobs', async (route) => {
    await new Promise((r) => setTimeout(r, 2000)); // simulate a slow connection
    await route.continue();
  });
  await jobsPage.goto();
  await expect(jobsPage.loading()).toBeVisible();
  await expect(jobsPage.table()).toBeHidden();
  // Auto-waiting: no fixed sleep, just wait for the real result.
  await expect(jobsPage.rows()).toHaveCount(2, { timeout: 10_000 });
  await expect(jobsPage.loading()).toHaveCount(0);
});
