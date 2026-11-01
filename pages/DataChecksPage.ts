import { Page } from '@playwright/test';
export class DataChecksPage {
  constructor(private page: Page) {}
  editor = () => this.page.getByTestId('sql-editor');
  error = () => this.page.getByTestId('sql-error');
  rows = () => this.page.getByTestId('sql-row');
  async goto() { await this.page.goto('/data-checks'); }
  async preset(key: 'missing' | 'dupes' | 'joins' | 'recon' | 'fix' | 'tolerance' | 'rejects' | 'paydupes') { await this.page.getByTestId(`preset-${key}`).click(); }
  async run(query: string) { await this.editor().fill(query); await this.page.getByTestId('sql-run').click(); }
  /** Results table as an array of row arrays (cell text). */
  async table() {
    await this.page.getByTestId('sql-meta').filter({ hasText: 'row(s)' }).waitFor();
    return this.rows().evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent || '')));
  }
}
