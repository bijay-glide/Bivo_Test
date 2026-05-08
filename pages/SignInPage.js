const { expect } = require('@playwright/test');

const PAY_USER_WEB_SIGNIN_PATH = '/pay/user-web/auth/signin';
const STANDALONE_USER_WEB_SIGNIN_PATH = '/user-web/auth/signin';

// Delays that exist to let the UI settle — not arbitrary, but tied to observable timing.
const PHONE_VALIDATION_DEBOUNCE_MS = 500;  // blur → validation → Next button enable
const NEXT_BUTTON_ENABLE_WAIT_MS   = 1000; // extra wait before asserting Next is enabled
const OTP_DISPATCH_WAIT_MS         = 6000; // phone submit → OTP SMS in flight

class SignInPage {
  constructor(page) {
    this.page = page;

    // Phone entry locators
    this.personalTab       = page.getByText('Personal');
    this.usePhoneButton    = page.getByRole('button', { name: 'Use Phone' });
    this.mobileHeading     = page.getByRole('heading', {
      name: 'Enter Your Mobile Number',
    });
    this.mobileNumberInput = page.getByRole('textbox', { name: 'Enter your mobile number' });
    this.nextButton        = page.getByRole('button', { name: 'Next' });
    this.outside           = page.getByText('Enter your mobile number').first();

    // Password screen locators
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.loginButton   = page.getByRole('button', { name: 'Login' });
  }

  // options.standaloneUserWeb: user-web signin URL vs pay-embedded (default).
  async goto(options = {}) {
    const path = options.standaloneUserWeb
      ? STANDALONE_USER_WEB_SIGNIN_PATH
      : PAY_USER_WEB_SIGNIN_PATH;
    await this.page.goto(path, {
      timeout: 200000,
    });
  }

  async selectPersonalTab() {
    //await this.personalTab.click();
  }

  async clickUsePhone() {
    // Pay-embedded flow often lands on phone already; standalone user-web shows email first — click when present.
    if (await this.usePhoneButton.isVisible().catch(() => false)) {
      await this.usePhoneButton.click();
    }
  }

  /**
   * @param {string} phoneNumber - US national number (10 digits; non-digits stripped).
   *   If the control already contains "+1" (common on user-web), `fill(phoneNumber)` alone
   *   would replace the entire value and strip that prefix — we then write `+1` + digits.
   *   Otherwise we only fill the national digits (e.g. BCR when the field has no prefix).
   */
  async enterMobileNumber(phoneNumber) {
    const digits = String(phoneNumber).replace(/\D/g, '').slice(-10);
    await this.mobileNumberInput.click();
    const current = await this.mobileNumberInput.inputValue();
    const valueToSet = current.trimStart().startsWith('+1') ? `+1${digits}` : digits;
    await this.mobileNumberInput.fill(valueToSet);
    // Blur the input so validation runs and the Next button can become enabled
    await this.outside.click();
    await this.page.waitForTimeout(PHONE_VALIDATION_DEBOUNCE_MS);
  }

  async clickNext() {
    await this.page.waitForTimeout(NEXT_BUTTON_ENABLE_WAIT_MS);
    // Wait for Next button to be enabled (e.g. after phone validation)
    await this.nextButton.waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.nextButton).toBeEnabled({ timeout: 10000 });
    await this.nextButton.scrollIntoViewIfNeeded();
    await this.nextButton.click({ force: true });
    await this.page.waitForTimeout(OTP_DISPATCH_WAIT_MS);
  }

  async signInWithPhone(phoneNumber) {
    await this.selectPersonalTab();
    await this.clickUsePhone();
    await this.enterMobileNumber(phoneNumber);
    await this.clickNext();
  }

  /**
   * Standalone `/user-web/` shell: email is shown first — use phone, assert the phone step, then submit number.
   * Pay-embedded flow should keep using signInWithPhone() (no heading assert; “Use Phone” may be absent).
   */
  async signInWithPhoneStandaloneUserWeb(phoneNumber) {
    await this.selectPersonalTab();
    await this.clickUsePhone();
    await this.expectMobileNumberStepVisible();
    await this.enterMobileNumber(phoneNumber);
    await this.clickNext();
  }

  /** Assert the standalone user-web phone capture step (after “Use Phone”). */
  async expectMobileNumberStepVisible() {
    await expect(this.mobileHeading).toBeVisible();
  }

  /**
   * Assert the Password screen is visible, fill in the password, and click Login.
   * Call this after signInWithPhone() when the app shows the password screen first.
   */
  async loginWithPassword(password) {
    await expect(this.passwordInput).toBeVisible({ timeout: 10000 });
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /**
   * Wait for the password screen to fully transition away.
   * Call this after loginWithPassword() before checking what screen comes next,
   * to avoid detecting the still-disappearing password field as the next state.
   */
  async waitForPasswordScreenToLeave() {
    await expect(this.passwordInput).not.toBeVisible({ timeout: 10000 });
  }

  /**
   * Assert that login was successful by confirming the URL is no longer
   * on the sign-in page.
   */
  async verifyLoginSuccessful() {
    await expect(this.page).not.toHaveURL(/signin/, { timeout: 15000 });
  }
}

module.exports = SignInPage;
