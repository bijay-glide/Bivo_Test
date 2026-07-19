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

  // Bu-web sidebar uses a text "Payees" link (testid sidebar-menuitem-money-transfer-payee)
  // rather than the user-web "Sidebar-nav-payees" testid.
  async navigateToPayeesBuWeb() {
    await this.page.getByRole('link', { name: 'Payees' }).first().click();
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
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

    // Optional address fields are filled only when the form actually renders them.
    // The personal-info form varies by surface/country (e.g. bu-web CN shows names
    // only), so guard each field with a visibility check to avoid hanging on absent
    // inputs — same pattern as addBusinessPayee() in FxTransactionPage.
    const fillIfVisible = async (name, value) => {
      const field = this.page.getByRole('textbox', { name });
      if (await field.isVisible({ timeout: 3000 }).catch(() => false)) {
        await field.fill(value);
      }
    };

    if (extraFields?.streetAddress) {
      await fillIfVisible('Enter street address', extraFields.streetAddress);
    }
    if (extraFields?.city) {
      await fillIfVisible("Enter beneficiary's city", extraFields.city);
    }
    if (extraFields?.zipCode) {
      await fillIfVisible('Enter zip/postal code', extraFields.zipCode);
    }
    if (extraFields?.phone && await this.page.getByRole('textbox', { name: /Enter your (mobile|phone) number/i }).isVisible({ timeout: 3000 }).catch(() => false)) {
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
    await this.page.keyboard.press('Tab'); // blur branch code to trigger final field validation
    await this.page.getByRole('button', { name: 'Select account type' }).click();
    await this.page.getByRole('button', { name: accountType }).click();
  }

  async _fillHkBankDetails({ accountNumber, bankName, bankCode, branchCode, swiftCode }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
    await this.page.getByRole('textbox', { name: 'Enter Bank code' }).fill(bankCode);
    await this.page.getByRole('textbox', { name: 'Enter Branch code' }).fill(branchCode);
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
    await this.page.keyboard.press('Tab'); // blur SWIFT code field to trigger form validation
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
  async fillBankingDetailsByChannelAndCaptureApi(channel, bankingDetails, options = {}) {
    // Bu-web posts the beneficiary account to /business/v1/beneficiary/account;
    // user-web uses /remittance/v1/beneficiary/account. Both end in /beneficiary/account.
    const accountUrlFragment = options.accountUrlFragment || '/beneficiary/account';
    const accountPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes(accountUrlFragment) &&
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
    } else if (channel === 'no_fields') {
      // Some destinations (e.g. CN in this build) render a banking form with no inputs —
      // the Continue click below alone creates the beneficiary account.
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
    await this._scrollUntilPayeeVisible(this.page.getByTestId(testId));
    await expect(this.page.getByTestId(testId)).toContainText(
      `${firstName} ${lastName}`,
      { timeout: 20000 },
    );
  }

  /**
   * The Payees tab list only loads 10 payees at a time and lazy-loads more as the
   * page is scrolled (same pagination behavior as the FX flow's Select Payee screen —
   * see FxTransactionPage.selectExistingPayeeByName). Keep scrolling until the target
   * row appears or the row count stops growing (no more pages left).
   */
  async _scrollUntilPayeeVisible(targetLocator) {
    const allRows = this.page.locator(
      '[data-testid^="payee-list-item-"]:not([data-testid*="-view-details-button-"])',
    );
    let previousCount = -1;
    for (let i = 0; i < 10; i++) {
      if (await targetLocator.isVisible()) break;
      const currentCount = await allRows.count();
      if (currentCount === previousCount) break;
      previousCount = currentCount;
      await this.page.mouse.wheel(0, 2000);
      await this.page.waitForTimeout(800);
    }
  }

  /**
   * Opens a payee's details view from the standalone Payees list (same
   * payee-list-item-{firstName}-{lastName} testid as verifyPayeeInList).
   *
   * ASSUMPTION (unconfirmed by a live probe): this lands on the same shared
   * "Payee Details" screen reached via the FX flow's view-details button — the one
   * FxTransactionPage.editPayeeNameAndCaptureApi/editPayeeIbanAndCaptureApi already
   * drive (Edit Payee button → name form → Save → IBAN form → Save). If the standalone
   * entry point renders a different screen, those two methods will need adjusting.
   */
  async openPayeeDetails(firstName, lastName) {
    const testId = `payee-list-item-view-details-button-${firstName}-${lastName}`;
    const listItem = this.page.getByTestId(testId);
    await this._scrollUntilPayeeVisible(listItem);
    await expect(listItem, `payee list item "${testId}" should be visible`).toBeVisible({ timeout: 15000 });
    await listItem.click();
  }
}

module.exports = AddPayeePage;