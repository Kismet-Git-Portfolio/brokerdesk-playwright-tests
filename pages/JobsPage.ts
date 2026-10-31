import { Page } from '@playwright/test';
export class JobsPage {
  constructor(private page: Page) {}
  loading = () => this.page.getByTestId('loading');
  table = () => this.page.getByTestId('jobs-table');
  rows = () => this.page.getByTestId('job-row');
  row = (id: string) => this.page.locator(`[data-testid="job-row"][data-id="${id}"]`);
  async goto() { await this.page.goto('/jobs'); }
}
