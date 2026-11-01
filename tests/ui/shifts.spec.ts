import { test, expect } from '../../fixtures/test';
import { uniq } from '../../fixtures/data';

test('create shift shows the correct gross total and appears in the list', async ({ loggedIn, shiftPage, jobsPage, api }) => {
  void loggedIn;
  const title = uniq('Night Shift');
  await shiftPage.goto();
  await shiftPage.fill(title, 'Pasig', { base: 750, allowance: 120.5, special: 49.25 });
  await expect(shiftPage.gross()).toHaveText('919.75');
  await shiftPage.publish();
  await expect(shiftPage.toast()).toHaveText('Shift added');

  const { shifts } = await (await api.get('/api/jobs')).json();
  const saved = shifts.find((s: any) => s.title === title);
  expect(saved.gross).toBe(919.75); // backend agrees with the UI

  await jobsPage.goto();
  await expect(jobsPage.row(saved.id).getByTestId('job-gross')).toHaveText('919.75');
});

test('shift with negative compensation is rejected', async ({ loggedIn, shiftPage }) => {
  void loggedIn;
  await shiftPage.goto();
  await shiftPage.fill(uniq('Bad Shift'), 'Pasig', { base: -10, allowance: 0, special: 0 });
  await shiftPage.publish();
  await expect(shiftPage.error()).toHaveText('Compensation must be valid positive numbers');
});
