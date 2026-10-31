import { Page } from '@playwright/test';
export type Trade = { instrument: string; side: 'buy' | 'sell'; price: string; quantity: string };
export class TradesPage {
  constructor(private page: Page) {}
  rows = () => this.page.getByTestId('trade-row');
  row = (id: string) => this.page.locator(`[data-testid="trade-row"][data-id="${id}"]`);
  error = () => this.page.getByTestId('trade-error');
  submit = () => this.page.getByTestId('trade-submit');
  async goto() { await this.page.goto('/trades'); }
  async fill(t: Trade) {
    await this.page.getByTestId('trade-instrument').fill(t.instrument);
    await this.page.getByTestId('trade-side').selectOption(t.side);
    await this.page.getByTestId('trade-price').fill(t.price);
    await this.page.getByTestId('trade-quantity').fill(t.quantity);
  }
  async filter(side: '' | 'buy' | 'sell') { await this.page.getByTestId('blotter-filter').selectOption(side); }
}
