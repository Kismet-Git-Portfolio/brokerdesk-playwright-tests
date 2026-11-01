import { Page } from '@playwright/test';
export class PriceBoardPage {
  constructor(private page: Page) {}
  row = (symbol: string) => this.page.locator(`[data-testid="price-row"][data-symbol="${symbol}"]`);
  rows = () => this.page.getByTestId('price-row');
  async page_wait(ms: number) { await this.page.waitForTimeout(ms); }
  async goto() { await this.page.goto('/prices'); }
  async quote(symbol: string) {
    const r = this.row(symbol);
    return { bid: Number(await r.getByTestId('price-bid').textContent()), ask: Number(await r.getByTestId('price-ask').textContent()),
      ts: await r.getByTestId('price-ts').getAttribute('data-ts') };
  }
}
