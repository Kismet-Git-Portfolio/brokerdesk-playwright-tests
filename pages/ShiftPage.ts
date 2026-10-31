import { Page } from '@playwright/test';
export type Comp = { base: number; allowance: number; special: number };
export class ShiftPage {
  constructor(private page: Page) {}
  gross = () => this.page.getByTestId('shift-gross');
  toast = () => this.page.getByTestId('toast');
  error = () => this.page.getByTestId('shift-error');
  async goto() { await this.page.goto('/shifts/new'); }
  async fill(title: string, location: string, c: Comp) {
    await this.page.getByTestId('shift-title').fill(title);
    await this.page.getByTestId('shift-location').fill(location);
    await this.page.getByTestId('shift-base').fill(String(c.base));
    await this.page.getByTestId('shift-allowance').fill(String(c.allowance));
    await this.page.getByTestId('shift-special').fill(String(c.special));
  }
  async publish() { await this.page.getByTestId('shift-submit').click(); }
}
