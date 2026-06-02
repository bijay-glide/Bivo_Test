const { expect } = require('@playwright/test');

class AddPayeePage {
  constructor(page) {
    this.page = page;
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  async navigateToPayees() {
    await this.page.getByTestId('Sidebar-nav-payees').click();
    // Wait for the page to finish loading — the spinner disappears and the payee
    // list (or empty state) renders before we attempt to interact with it.
    await this.page.waitForLoadState('networkidle', { timeout: 30000 });
  }

  async clickAddPayee() {
    const btn = this.page.getByRole('button', { name: 'Add Payee' });
    await expect(btn).toBeVisible({ timeout: 30000 });
    await expect(btn).toBeEnabled({ timeout: 10000 });
    await btn.click();
  }

  // ─── Country selection ─────────────────────────────────────────────────────

  async selectCountry(countryCode) {
    const channelsPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/remittance/v1/guest/beneficiary/channels/') &&
        r.url().includes('beneficiary_type=INDIVIDUAL') &&
        r.request().method() === 'GET',
      { timeout: 15000 },
    ).catch(() => null);

    await this.page.getByTestId(`country-select-${countryCode}`).click();
    await channelsPromise;
  }

  // ─── Personal info form ────────────────────────────────────────────────────

  /**
   * Fills personal info (name + optional extra fields) and captures POST personal-info.
   * Returns { piResponse, requestBody, responseBody, referenceId }.
   */
  async fillPersonalInfoAndCaptureApi(firstName, lastName, extraFields = null) {
    const personalInfoPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/remittance/v1/beneficiary/personal-info') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 30000 },
    );

    await this.page.getByRole('textbox', { name: "Enter beneficiary's first name" }).fill(firstName);
    await this.page.getByRole('textbox', { name: "Enter beneficiary's last name" }).fill(lastName);

    if (extraFields?.streetAddress) {
      await this.page.getByRole('textbox', { name: 'Enter street address' }).fill(extraFields.streetAddress);
    }
    if (extraFields?.city) {
      await this.page.getByRole('textbox', { name: "Enter beneficiary's city" }).fill(extraFields.city);
    }
    if (extraFields?.zipCode) {
      await this.page.getByRole('textbox', { name: 'Enter zip/postal code' }).fill(extraFields.zipCode);
    }
    if (extraFields?.phone) {
      // Label varies by country — IN: "mobile number", JP: "phone number"
      const phoneInput = this.page.getByRole('textbox', { name: /Enter your (mobile|phone) number/i });
      await phoneInput.click();
      await phoneInput.selectText();
      await phoneInput.pressSequentially(extraFields.phone, { delay: 50 });
    }

    await this.continue();

    const piResponse = await personalInfoPromise;
    let requestBody = {};
    try { requestBody = piResponse.request().postDataJSON() || {}; } catch {}
    let responseBody = {};
    try { responseBody = await piResponse.json(); } catch {}

    console.log(`[AddPayee] personal-info POST body: ${JSON.stringify(requestBody)}`);

    return { piResponse, requestBody, responseBody, referenceId: responseBody.referenceId };
  }

  // ─── Continue helper ───────────────────────────────────────────────────────

  async continue() {
    const btn = this.page.getByRole('button', { name: 'Continue' });
    await expect(btn).toBeEnabled({ timeout: 15000 });
    await btn.click();
  }

  // ─── Banking detail fillers (per channel) ──────────────────────────────────

  async _fillIbanDetails({ iban }) {
    await this.page.getByRole('textbox', { name: 'Enter IBAN number' }).fill(iban);
  }

  async _fillBsbDetails({ bankName, accountNumber, bsbCode }) {
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter BSB code' }).fill(bsbCode);
  }

  async _fillIfscDetails({ accountNumber, ifscCode }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter IFSC code' }).fill(ifscCode);
  }

  async _fillSwiftDetails({ accountNumber, swiftCode, bankCode, branchCode, accountType }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
    await this.page.getByRole('textbox', { name: 'Enter bank code' }).fill(bankCode);
    await this.page.getByRole('textbox', { name: 'Enter branch code' }).fill(branchCode);
    await this.page.getByRole('button', { name: 'Select account type' }).click();
    await this.page.getByRole('button', { name: accountType }).click();
  }

  async _fillHkBankDetails({ accountNumber, bankName, bankCode, branchCode, swiftCode }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
    await this.page.getByRole('textbox', { name: 'Enter Bank code' }).fill(bankCode);
    await this.page.getByRole('textbox', { name: 'Enter Branch code' }).fill(branchCode);
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
  }

  async _fillAlipayDetails({ phone, walletProvider, swiftCode, bankName }) {
    await this.page.getByRole('textbox', { name: 'Enter your mobile number' }).fill(phone);
    await this.page.getByRole('button', { name: 'Select wallet provider' }).click();
    await this.page.getByRole('button', { name: walletProvider }).click();
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
  }

  async _fillRtpDetails({ accountNumber }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
  }

  // ─── Banking detail dispatcher with API capture ────────────────────────────

  /**
   * Dispatches to the correct banking-details filler based on channel, then
   * captures POST /remittance/v1/beneficiary/account.
   * Returns { acctResponse, requestBody, responseBody }.
   */
  async fillBankingDetailsByChannelAndCaptureApi(channel, bankingDetails) {
    const accountPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/remittance/v1/beneficiary/account') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 30000 },
    );

    if (channel === 'iban') {
      await this._fillIbanDetails(bankingDetails);
    } else if (channel === 'bsb') {
      await this._fillBsbDetails(bankingDetails);
    } else if (channel === 'ifsc') {
      await this._fillIfscDetails(bankingDetails);
    } else if (channel === 'swift') {
      await this._fillSwiftDetails(bankingDetails);
    } else if (channel === 'hk_bank') {
      await this._fillHkBankDetails(bankingDetails);
    } else if (channel === 'alipay') {
      await this._fillAlipayDetails(bankingDetails);
    } else if (channel === 'rtp') {
      await this._fillRtpDetails(bankingDetails);
    } else {
      throw new Error(`fillBankingDetailsByChannelAndCaptureApi: unsupported channel "${channel}"`);
    }

    await this.continue();

    const acctResponse = await accountPromise;
    let requestBody = {};
    try { requestBody = acctResponse.request().postDataJSON() || {}; } catch {}
    let responseBody = {};
    try { responseBody = await acctResponse.json(); } catch {}

    console.log(`[AddPayee] account POST body: ${JSON.stringify(requestBody)}`);

    return { acctResponse, requestBody, responseBody };
  }

  // ─── Post-submission verification ─────────────────────────────────────────

  /**
   * Verifies the newly added payee appears in the list.
   * Uses the data-testid `payee-list-item-{firstName}-{lastName}` pattern.
   */
  async verifyPayeeInList(firstName, lastName) {
    const testId = `payee-list-item-${firstName}-${lastName}`;
    await expect(this.page.getByTestId(testId)).toContainText(
      `${firstName} ${lastName}`,
      { timeout: 20000 },
    );
  }
}

module.exports = AddPayeePage;
