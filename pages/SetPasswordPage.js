const { expect } = require('@playwright/test');

class SetPasswordPage {
  constructor(page) {
    this.page = page;

    this.newPasswordInput     = page.getByRole('textbox', { name: 'Enter new password' });
    this.confirmPasswordInput = page.getByRole('textbox', { name: 'Confirm your password' });
    this.continueButton       = page.getByRole('button', { name: 'Continue' });
  }

  async setPassword(password) {
    await this.newPasswordInput.click();
    await this.newPasswordInput.fill(password);
    await this.confirmPasswordInput.click();
    await this.confirmPasswordInput.fill(password);
    await this.continueButton.click();
  }
}

module.exports = SetPasswordPage;
