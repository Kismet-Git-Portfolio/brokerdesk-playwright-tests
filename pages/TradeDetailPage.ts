import { Page } from '@playwright/test';
export type Action = 'confirm' | 'settle' | 'fail' | 'cancel';
export class TradeDetailPage {
  constructor(private page: Page) {}
  status = () => this.page.getByTestId('trade-status');
  action = (a: Action) => this.page.getByTestId(`action-${a}`);
  error = () => this.page.getByTestId('action-error');
  auditActions = () => this.page.getByTestId('audit-action');
  fixMessages = () => this.page.getByTestId('trade-fix-msg');
  async goto(id: string) { await this.page.goto(`/trades/${id}`); await this.page.getByTestId('audit-row').first().waitFor(); }
  async amend(qty: string, price: string) {
    await this.page.getByTestId('amend-qty').fill(qty);
    await this.page.getByTestId('amend-price').fill(price);
    await this.page.getByTestId('action-amend').click();
  }
}
