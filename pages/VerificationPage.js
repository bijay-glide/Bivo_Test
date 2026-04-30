class VerificationPage {
  constructor(page) {
    this.page = page;

    // OTP digit 1: accessible name may be “Please enter verification…” only (BCR) or include “…Digit 1” (user-web) — substring matches both.
    this.digit1Input = page.getByRole('textbox', { name: 'Please enter verification' });
    this.digit2Input = page.getByRole('textbox', { name: 'Digit 2' });
    this.digit3Input = page.getByRole('textbox', { name: 'Digit 3' });
    this.digit4Input = page.getByRole('textbox', { name: 'Digit 4' });
    this.digit5Input = page.getByRole('textbox', { name: 'Digit 5' });
    this.digit6Input = page.getByRole('textbox', { name: 'Digit 6' });

    // Route buttons — shown after OTP entry
    //this.newUserButton      = page.getByRole('button', { name: 'New User' });
    this.newUserButton      = page.getByRole('button', { name: 'Next' });
    this.existingUserButton = page.getByRole('button', { name: 'Existing User' });
  }

  async enterVerificationCode(code) {
    const digits = code.split('');
    await this.digit1Input.click();
    await this.digit1Input.fill(digits[0]);
    await this.digit2Input.fill(digits[1]);
    await this.digit3Input.fill(digits[2]);
    await this.digit4Input.fill(digits[3]);
    await this.digit5Input.fill(digits[4]);
    await this.digit6Input.fill(digits[5]);
  }

  async clickNewUser() {
    await this.newUserButton.click();
  }

  async clickExistingUser() {
    await this.existingUserButton.click();
  }

  // Used by signup flow
  async verifyAndProceedAsNewUser(verificationCode) {
    await this.enterVerificationCode(verificationCode);
    await this.clickNewUser();
  }

  // Used by first-login flow (existing user setting password for the first time)
  async verifyAndProceedAsExistingUser(verificationCode) {
    await this.enterVerificationCode(verificationCode);
    await this.clickExistingUser();
  }

  /**
   * Standalone user-web: after OTP, some builds show only “Next”; BCR pay flow shows
   * “Existing User” / “New User”. Prefer Existing User when present, otherwise Next.
   */
  async verifyOtpForUserWebFirstLogin(verificationCode) {
    await this.enterVerificationCode(verificationCode);
    if (await this.existingUserButton.isVisible().catch(() => false)) {
      await this.existingUserButton.click();
    } else {
      await this.newUserButton.click();
    }
  }

  /**
   * Returns true if the OTP verification screen is currently visible
   * (i.e. the Existing User button is present in the DOM and visible).
   * Used after password submission to decide whether OTP is required.
   *
   * @returns {Promise<boolean>}
   */
  async isOtpScreenVisible() {
    return this.existingUserButton.isVisible().catch(() => false);
  }

  /**
   * Returns true when OTP digit inputs are visible.
   * Useful for user-web builds where route buttons differ ("Next" only).
   *
   * @returns {Promise<boolean>}
   */
  async isOtpInputVisible() {
    return this.digit1Input.isVisible().catch(() => false);
  }
}

module.exports = VerificationPage;
