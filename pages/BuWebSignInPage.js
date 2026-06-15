const { getUiBaseUrl } = require('../utils/env.js');

class BuWebSignInPage {
  constructor(page) {
    this.page = page;
    this.emailInput = page.getByRole('textbox', { name: 'Enter your email' });
    this.nextButton = page.getByRole('button', { name: 'Next' });
  }

  async goto() {
    await this.page.goto(`${getUiBaseUrl()}/bu-web/auth/signin`);
  }

  async enterEmail(email) {
    await this.emailInput.fill(email);
    await this.nextButton.click();
  }
}

module.exports = BuWebSignInPage;
