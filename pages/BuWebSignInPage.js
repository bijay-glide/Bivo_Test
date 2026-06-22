const { getUiBaseUrl } = require('../utils/env.js');

class BuWebSignInPage {
  constructor(page) {
    this.page = page;
    this.emailInput = page.getByRole('textbox', { name: 'Enter your email' });
    this.nextButton = page.getByRole('button', { name: 'Next' });
    this.loginButton = page.getByRole('button', { name: 'Login' });
  }

  async goto() {
    await this.page.goto(`${getUiBaseUrl()}/bu-web/auth/signin`);
  }

  async enterEmail(email) {
    await this.emailInput.fill(email);
    await this.nextButton.click();
  }

  // Returning-user: fill existing password and advance to TOTP screen.
  async loginWithPassword(password) {
    await this.page.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 15000 });
    await this.page.locator('input[type="password"]').fill(password);
    await this.loginButton.click();
  }
}

module.exports = BuWebSignInPage;
