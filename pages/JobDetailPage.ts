import { Page } from '@playwright/test';
export class JobDetailPage {
  constructor(private page: Page) {}
  status = () => this.page.getByTestId('apply-status');
  count = () => this.page.getByTestId('applicant-count');
  applicants = () => this.page.getByTestId('applicant');
  async goto(id: string) { await this.page.goto(`/jobs/${id}`); }
  async apply(name: string, email: string) {
    await this.page.getByTestId('apply-name').fill(name);
    await this.page.getByTestId('apply-email').fill(email);
    await this.page.getByTestId('apply-submit').click();
  }
}
