import { Page } from '@playwright/test';
export class BlotterPage {
  constructor(private page: Page) {}
  rows = () => this.page.getByTestId('trade-row');
  summary = () => this.page.getByTestId('blotter-summary');
  async goto() { await this.page.goto('/blotter'); }
  async assetClass(v: string) { await this.page.getByTestId('blotter-asset').selectOption(v); }
  async status(v: string) { await this.page.getByTestId('blotter-status').selectOption(v); }
}
