import { Page } from '@playwright/test';
export class LoginPage {
  constructor(private page: Page) {}
  email = () => this.page.getByTestId('login-email');
  password = () => this.page.getByTestId('login-password');
  error = () => this.page.getByTestId('login-error');
  async goto() { await this.page.goto('/login'); }
  async login(user: string, pass: string) {
    await this.email().fill(user);
    await this.password().fill(pass);
    await this.page.getByTestId('login-submit').click();
  }
  async logout() { await this.page.getByTestId('logout').click(); }
}
