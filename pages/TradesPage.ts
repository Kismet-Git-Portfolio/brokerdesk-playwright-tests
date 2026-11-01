import { Page } from '@playwright/test';
export type Trade = { instrument: string; side: 'buy' | 'sell'; price: string; quantity: string; client?: string; counterparty?: string; venue?: 'Electronic' | 'Voice' };
/** Order ticket (RFQ) + today's orders blotter on /trades. */
export class TradesPage {
  constructor(private page: Page) {}
  rows = () => this.page.getByTestId('trade-row');
  row = (id: string) => this.page.locator(`[data-testid="trade-row"][data-id="${id}"]`);
  error = () => this.page.getByTestId('trade-error');
  submit = () => this.page.getByTestId('trade-submit');
  confirmation = () => this.page.getByTestId('order-confirmation');
  market = () => this.page.getByTestId('ticket-market');
  async goto() { await this.page.goto('/trades'); }
  /** Fills the ticket. Client/counterparty default to demo values; pass '' to leave them empty. */
  async fill(t: Trade) {
    await this.page.getByTestId('trade-instrument').fill(t.instrument);
    await this.page.getByTestId('trade-side').selectOption(t.side);
    await this.page.getByTestId('trade-price').fill(t.price);
    await this.page.getByTestId('trade-quantity').fill(t.quantity);
    await this.page.getByTestId('trade-client').selectOption(t.client ?? 'Alpha Capital');
    await this.page.getByTestId('trade-counterparty').selectOption(t.counterparty ?? 'NORTHBANK');
    if (t.venue) await this.page.getByTestId('trade-venue').selectOption(t.venue);
  }
  /** Waits for the confirmation panel and returns the booked trade ID. */
  async confirmedId() { const l = this.page.getByTestId('confirm-trade-id'); await l.waitFor(); return (await l.textContent())!.trim(); }
  async page_settle() { await this.page.waitForTimeout(500); }
  async filter(side: '' | 'buy' | 'sell') { await this.page.getByTestId('blotter-filter').selectOption(side); }
}
