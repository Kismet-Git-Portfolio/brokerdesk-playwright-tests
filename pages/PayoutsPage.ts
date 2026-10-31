import { Page } from '@playwright/test';
export class PayoutsPage {
  constructor(private page: Page) {}
  amountFor = (id: string) => this.page.locator(`[data-testid="payout-row"][data-id="${id}"] [data-testid="payout-amount"]`);
  async goto() { await this.page.goto('/payouts'); }
}
