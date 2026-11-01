import { Page } from '@playwright/test';
export class FixLogPage {
  constructor(private page: Page) {}
  rows = () => this.page.getByTestId('fix-row');
  rowsOfType = (type: string) => this.page.locator(`[data-testid="fix-row"][data-type="${type}"]`);
  tag = (tag: number | string) => this.page.locator(`[data-testid="fix-tag"][data-tag="${tag}"] [data-testid="fix-tag-value"]`);
  async goto(tradeId?: string) { await this.page.goto('/fix' + (tradeId ? `?trade=${tradeId}` : '')); }
  /** Parsed tag value without the human-readable suffix, e.g. "1" for 54=1 (Buy). */
  async value(tag: number | string) { return ((await this.tag(tag).textContent()) || '').replace(/\s*\(.*\)$/, '').trim(); }
}
