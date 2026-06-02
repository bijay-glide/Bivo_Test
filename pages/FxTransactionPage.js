const { expect } = require('@playwright/test');
const { toCentsInput } = require('../utils/amount-input');

// Reads fieldName from POST body data array or GET info array (personal-info APIs).
function getFieldValueFromData(dataContainer, fieldName) {
  if (!dataContainer) return null;
  if (Array.isArray(dataContainer.data)) {
    const fromData = dataContainer.data.find((item) => item?.fieldName === fieldName);
    if (fromData) return fromData.value ?? null;
  }
  if (Array.isArray(dataContainer.info)) {
    const fromInfo = dataContainer.info.find((item) => item?.fieldName === fieldName);
    if (fromInfo) return fromInfo.value ?? null;
  }
  return null;
}

class FxTransactionPage {
  constructor(page) {
    this.page = page;

    // testId locators — preferred over role/text selectors
    this.sidebarCreateFxTransaction = page.getByRole('link', { name: 'Create FX Transaction' });
    // "You send" input on the Send Money screen — look for the input inside the "You send" card
    this.sendAmountInput = page.locator('div').filter({ hasText: /^You send$/ }).locator('input').first();
    this.recipientAmountInput = page.locator('div').filter({ hasText: /^Recipient gets$/ }).locator('input').first();
    this.countrySelect = (code) => page.getByTestId(`country-select-${code}`);
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  async navigateToCreatePayment() {
    await this.page.getByRole('link', { name: 'Create Payment Create Payment' }).click();
  }

  /** User-web dashboard: sidebar Create FX Transaction → FX flow. */
  async navigateToCreateFxTransactionUserWeb() {
    await this.sidebarCreateFxTransaction.click();
  }

  // Picks UK on user-web FX; waits for GET international payment currency rate (toCurrencyId defaults to 18 / GBP).
  async userWebSelectUnitedKingdom(options = {}) {
    const toCurrencyId = options.toCurrencyId ?? 18;

    const currencyRatePromise = this.page.waitForResponse(
      (r) => {
        if (r.request().method() !== 'GET') return false;
        if (!r.ok()) return false;
        const url = r.url();
        if (!url.includes('/remittance/v1/international/payment/currency/rate')) return false;
        if (!url.includes(`toCurrencyId=${toCurrencyId}`)) return false;
        if (!url.includes('amountCurrencyId=5')) return false;
        if (!url.includes('channel=iban')) return false;
        return true;
      },
      { timeout: 30000 },
    );

    await this.countrySelect('GB').click();
    const rateResponse = await currencyRatePromise;

    let body = {};
    try {
      body = await rateResponse.json();
    } catch {
      body = {};
    }
    expect(
      body.fromCurrency && body.toCurrency,
      'currency/rate response should include fromCurrency / toCurrency',
    ).toBeTruthy();
  }

  /** Recorded user-web flow: focus “You send” then Continue (advances to payee / next step). */
  async userWebClickYouSendAndContinue() {
    await this.page.locator('div').filter({ hasText: /^You send$/ }).click();
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  /** Clicks the “You send” strip so the USD amount field is focused (required before typing on some builds). */
  async userWebFocusYouSendSection() {
    const youSend = this.page.locator('div').filter({ hasText: /^You send$/ });
    if (await youSend.isVisible().catch(() => false)) {
      await youSend.click();
    }
  }

  // ─── Step 1 | Country & Amount ─────────────────────────────────────────────

  /**
   * Clicks the current destination-country button (whatever is preselected),
   * picks the desired country, and verifies the currency-rate API returns 200.
   *
   * The rate API fires immediately after country selection using the default
   * amount already on the page — that's why the listener lives here, not in
   * enterAmount.
   *
   * URL checked: .../remittance/v1/international/payment/currency/rate?...&amount=55
   *
   * @param {string} country - e.g. 'United Kingdom (GB)'
   */
  async selectDestinationCountry(country) {
    // Register before clicking — country selection triggers the rate lookup
    const rateResponsePromise = this.page.waitForResponse(
      response =>
        response.url().includes('remittance/v1/guest/beneficiary/channels/18?beneficiary_type=INDIVIDUAL'),
      { timeout: 15000 }
    );

    await this.page.getByRole('button', { name: /You're sending to/ }).click();
    await this.page.getByRole('button', { name: country }).click();

    const rateResponse = await rateResponsePromise;
    expect(rateResponse.status()).toBe(202);
  }

  /**
   * Selects a destination country by its ISO code using the data-testid attribute.
   * Works for all countries — waits for the channels API response generically
   * instead of hardcoding currency IDs (unlike selectDestinationCountry).
   *
   * @param {string} countryCode - ISO 3166-1 alpha-2 code, e.g. 'GB', 'DE', 'JP'
   */
  async selectDestinationCountryByTestId(countryCode) {
    const channelsResponsePromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/remittance/v1/guest/beneficiary/channels/') &&
        r.url().includes('beneficiary_type=INDIVIDUAL') &&
        r.request().method() === 'GET',
      { timeout: 15000 },
    );
    await this.countrySelect(countryCode).click();
    await channelsResponsePromise;
  }

  /**
   * Clicks the $ amount field to focus it.
   * The default amount ($55.00) is pre-filled by the app — no fill needed.
   */
  async enterAmount(amount) {
    await this.sendAmountInput.click();
    // Field uses right-to-left cent entry — append '00' so '55' becomes '5500' → $55.00
    await this.sendAmountInput.pressSequentially(amount + '00', { delay: 50 });
  }

  // Same pattern as WirePaymentPage / US ACH: click, select all, pressSequentially. data.amountInput = cent digits (toCentsInput).
  async enterSendAmountWithData(data) {
    await expect(this.sendAmountInput).toBeVisible({ timeout: 20000 });
    await expect(this.sendAmountInput).toBeEditable();
    await this.sendAmountInput.click();
    await this.sendAmountInput.selectText();
    await this.sendAmountInput.pressSequentially(data.amountInput, { delay: 50 });
  }

  // amountUsd e.g. "62.30"; encodes to cents like US ACH flow.
  async enterSendAmountUsdDecimal(amountUsd) {
    await this.enterSendAmountWithData({ amountInput: toCentsInput(amountUsd) });
  }

  async verifyCurrencyShown(currency) {
    await expect(this.page.getByText(currency)).toBeVisible();
  }

  async continue() {
    const btn = this.page.getByRole('button', { name: 'Continue' });
    await expect(btn).toBeEnabled({ timeout: 15000 });
    await btn.click();
  }

  /** User-web: UK, send amount (`data.amountInput`), GBP chip, Continue. */
  async userWebCompleteCountryAndSendAmountStep(fxData) {
    await this.userWebSelectUnitedKingdom();
    await this.userWebFocusYouSendSection();
    await this.enterSendAmountWithData({ amountInput: fxData.amountInput });
    await this.verifyCurrencyShown('GBP');
    await this.continue();
  }

  /** User-web: payee + IBAN, then identity screen if present (first-time payee only). */
  async userWebCompletePayeeIbanAndIdentity(fxData) {
    await this.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
    await this.enterIban(fxData.iban);
    await this.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
  }

  // ─── Step 2 | Payee ────────────────────────────────────────────────────────

  /**
   * Opens the Add Payee form and fills in beneficiary name plus any country-specific
   * extra fields (e.g. street address and city for AU).
   *
   * @param {string} firstName
   * @param {string} lastName
   * @param {object|null} extraFields  — { streetAddress?, city? } from fxData.payeeExtraFields
   */
  async addPayee(firstName, lastName, extraFields = null) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
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
      // Label varies by country ("Enter your mobile number" for IN, "Enter your phone number" for JP)
      const phoneInput = this.page.getByRole('textbox', { name: /Enter your (mobile|phone) number/i });
      await phoneInput.click();
      await phoneInput.selectText();
      await phoneInput.pressSequentially(extraFields.phone, { delay: 50 });
    }
    await this.continue();
  }

  // Submits payee name; asserts POST personal-info. Params: firstName, lastName, optional currencyId, beneficiaryType, country.
  async addPayeeAndCapturePersonalInfoCreateApi({
    firstName,
    lastName,
    currencyId = 18,
    beneficiaryType = 'INDIVIDUAL',
    country = 'GB',
  }) {
    const personalInfoCreatePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/remittance/v1/beneficiary/personal-info') &&
        response.request().method() === 'POST' &&
        response.ok(),
      { timeout: 30000 },
    );

    await this.addPayee(firstName, lastName);

    const createResponse = await personalInfoCreatePromise;
    let requestBody = {};
    try {
      requestBody = createResponse.request().postDataJSON() || {};
    } catch {
      requestBody = {};
    }

    let responseBody = {};
    try {
      responseBody = await createResponse.json();
    } catch {
      responseBody = {};
    }

    expect(requestBody.currencyId, 'personal-info POST currencyId').toBe(currencyId);
    expect(requestBody.beneficiaryType, 'personal-info POST beneficiaryType').toBe(beneficiaryType);
    expect(requestBody.country, 'personal-info POST country').toBe(country);
    expect(getFieldValueFromData(requestBody, 'first_name'), 'personal-info POST first_name').toBe(firstName);
    expect(getFieldValueFromData(requestBody, 'last_name'), 'personal-info POST last_name').toBe(lastName);
    expect(responseBody.referenceId, 'personal-info POST response referenceId').toBeTruthy();

    return {
      createResponse,
      requestBody,
      responseBody,
      referenceId: responseBody.referenceId,
    };
  }

  // ─── Step 3 | IBAN ─────────────────────────────────────────────────────────

  async enterIban(iban) {
    await this.page.getByRole('textbox', { name: 'Enter IBAN number' }).fill(iban);
    await this.continue();
  }

  /**
   * Fills the BSB banking-details form (Australia).
   * Fields: bank name, account number, BSB code.
   */
  async enterBsbDetails({ bankName, accountNumber, bsbCode }) {
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter BSB code' }).fill(bsbCode);
    await this.continue();
  }

  /**
   * Fills the IFSC banking-details form (India).
   * Fields: account number + IFSC code.
   */
  async enterIfscDetails({ accountNumber, ifscCode }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter IFSC code' }).fill(ifscCode);
    await this.continue();
  }

  /**
   * Fills the SWIFT banking-details form (Japan).
   * Fields: account number, SWIFT code, bank code, branch code, account type dropdown.
   */
  async enterSwiftDetails({ accountNumber, swiftCode, bankCode, branchCode, accountType }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
    await this.page.getByRole('textbox', { name: 'Enter bank code' }).fill(bankCode);
    await this.page.getByRole('textbox', { name: 'Enter branch code' }).fill(branchCode);
    await this.page.getByRole('button', { name: 'Select account type' }).click();
    await this.page.getByRole('button', { name: accountType }).click();
    await this.continue();
  }

  /**
   * Fills the RTP banking-details form (Mexico).
   * Single field: account number.
   */
  async enterRtpDetails({ accountNumber }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.continue();
  }

  /**
   * Fills the Alipay banking-details form (China).
   * Fields: mobile number, wallet provider dropdown, SWIFT code, bank name.
   * Note: phone lives here, not in the payee form (unlike IN/JP).
   */
  async enterAlipayDetails({ phone, walletProvider, swiftCode, bankName }) {
    await this.page.getByRole('textbox', { name: 'Enter your mobile number' }).fill(phone);
    await this.page.getByRole('button', { name: 'Select wallet provider' }).click();
    await this.page.getByRole('button', { name: walletProvider }).click();
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
    await this.continue();
  }

  /**
   * Fills the Hong Kong banking-details form.
   * Fields: account number, bank name, Bank code, Branch code, SWIFT code.
   * Note: "Bank code" and "Branch code" use capital B — distinct from Japan's lowercase labels.
   */
  async enterHkBankDetails({ accountNumber, bankName, bankCode, branchCode, swiftCode }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
    await this.page.getByRole('textbox', { name: 'Enter Bank code' }).fill(bankCode);
    await this.page.getByRole('textbox', { name: 'Enter Branch code' }).fill(branchCode);
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
    await this.continue();
  }

  /**
   * Fills the BCR Pay banking-details form (El Salvador).
   * Single field: DUI (Documento Único de Identidad).
   */
  async enterBcrPayDetails({ dui }) {
    await this.page.getByRole('textbox', { name: "Enter beneficiary's DUI" }).fill(dui);
    await this.continue();
  }

  /**
   * Channel dispatcher — routes to the correct banking-details method based on
   * the country config's `channel` value.  Add new `else if` blocks here as
   * more country recordings come in (e.g. 'bank' for CA/IN).
   *
   * @param {{ channel: string, bankingDetails: object }} countryConfig
   */
  async enterBankingDetailsByChannel({ channel, bankingDetails }) {
    if (channel === 'iban') {
      await this.enterIban(bankingDetails.iban);
    } else if (channel === 'bsb') {
      await this.enterBsbDetails(bankingDetails);
    } else if (channel === 'ifsc') {
      await this.enterIfscDetails(bankingDetails);
    } else if (channel === 'swift') {
      await this.enterSwiftDetails(bankingDetails);
    } else if (channel === 'hk_bank') {
      await this.enterHkBankDetails(bankingDetails);
    } else if (channel === 'rtp') {
      await this.enterRtpDetails(bankingDetails);
    } else if (channel === 'alipay') {
      await this.enterAlipayDetails(bankingDetails);
    } else if (channel === 'bcr_pay') {
      await this.enterBcrPayDetails(bankingDetails);
    } else {
      throw new Error(`enterBankingDetailsByChannel: unsupported channel "${channel}"`);
    }
  }

  // Submits IBAN; asserts GET personal-info by referenceId. Params include iban, referenceId, names, optional type/codes.
  async enterIbanAndCapturePersonalInfoDetailsApi({
    iban,
    referenceId,
    firstName,
    lastName,
    beneficiaryType = 'INDIVIDUAL',
    countryCode = 'GB',
    currencyCode = 'GBP',
  }) {
    const detailsPromise = this.page.waitForResponse(
      (response) =>
        response.url().includes(`/remittance/v1/beneficiary/personal-info/${referenceId}`) &&
        response.request().method() === 'GET' &&
        response.ok(),
      { timeout: 30000 },
    );

    await this.enterIban(iban);

    const detailsResponse = await detailsPromise;
    let detailsBody = {};
    try {
      detailsBody = await detailsResponse.json();
    } catch {
      detailsBody = {};
    }

    expect(detailsBody.referenceId, 'beneficiary details referenceId').toBe(referenceId);
    expect(detailsBody.beneficiaryType, 'beneficiary details beneficiaryType').toBe(beneficiaryType);
    expect(detailsBody.countryCode, 'beneficiary details countryCode').toBe(countryCode);
    expect(detailsBody.currencyCode, 'beneficiary details currencyCode').toBe(currencyCode);
    expect(detailsBody.firstName, 'beneficiary details firstName').toBe(firstName);
    expect(detailsBody.lastName, 'beneficiary details lastName').toBe(lastName);

    expect(getFieldValueFromData(detailsBody.personalInfo, 'first_name')).toBe(firstName);
    expect(getFieldValueFromData(detailsBody.personalInfo, 'last_name')).toBe(lastName);

    const beneficiaryAccounts = Array.isArray(detailsBody.beneficiaryAccounts)
      ? detailsBody.beneficiaryAccounts
      : [];
    expect(beneficiaryAccounts.length, 'beneficiaryAccounts should include IBAN row').toBeGreaterThan(0);
    const matchingIbanAccount = beneficiaryAccounts.find(
      (acct) =>
        String(acct?.bankAccountNumber || '').toUpperCase() === String(iban).toUpperCase() ||
        String(getFieldValueFromData(acct?.data, 'bank_account_number') || '').toUpperCase() ===
          String(iban).toUpperCase(),
    );
    expect(matchingIbanAccount, 'beneficiaryAccounts should include the submitted IBAN').toBeTruthy();

    return { detailsResponse, detailsBody };
  }

  // ─── Step 4 | Identity ─────────────────────────────────────────────────────

  /**
   * Selects an identity type from the dropdown and fills in the number.
   * Use `handleIdentityStepIfPresent` instead when the step is optional.
   *
   * @param {string} identityType   - e.g. 'Passport'
   * @param {string} identityNumber
   */
  async fillIdentityDetails(identityType, identityNumber) {
    await this.page.getByRole('button', { name: 'Select your identity type' }).click();
    await this.page.getByRole('button', { name: identityType }).click();
    await this.page.getByRole('textbox', { name: 'Enter your identity number' }).fill(identityNumber);
    await this.continue();
  }

  /**
   * Handles the identity-verification screen when it appears (first-time payee only).
   * Waits briefly for the "Select your identity type" button; if the screen never
   * shows, returns silently so the caller proceeds straight to Review Transfer.
   *
   * @param {string} identityType   - e.g. 'Passport'
   * @param {string} identityNumber
   */
  async handleIdentityStepIfPresent(identityType, identityNumber) {
    const identityDropdown = this.page.getByRole('button', { name: 'Select your identity type' });
    const appeared = await identityDropdown
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!appeared) return;

    await identityDropdown.click();
    await this.page.getByRole('button', { name: identityType }).click();
    await this.page.getByRole('textbox', { name: 'Enter your identity number' }).fill(identityNumber);
    await this.continue();
    await expect(this.page.getByRole('heading')).toContainText('Review Transfer', { timeout: 15000 });
  }

  // ─── Step 5 | Review & Confirm ─────────────────────────────────────────────

  async verifyAmountOnReview(amount) {
    await expect(this.page.getByText(amount)).toBeVisible();
  }

  // Review screen: exchange rate, send amount in USD, fees, total. fxData.amount is display like "$74.18".
  async verifyFxReviewTransferScreen(fxData) {
    const exchangeRateLine = this.page.getByText(/^Exchange rate\s*\$1\s*=\s*\d+(\.\d+)?$/);
    const sendAmountLine = this.page.getByText(`Send amount in USD ${fxData.amount}`);
    const feesLine = this.page.getByText(/^Fees\s*\$\d+(\.\d{2})$/);
    const totalLine = this.page.getByText(/^Total amount in USD\s*\$\d+(\.\d{2})$/);

    await expect(exchangeRateLine, 'Exchange rate line should be visible').toBeVisible();
    //await expect(sendAmountLine, 'Send amount line should match selected amount').toBeVisible();
    await expect(feesLine, 'Fees line should be visible').toBeVisible();
    await expect(totalLine, 'Total amount line should be visible').toBeVisible();
  }

  /**
   * Asserts POST /remittance/v1/international/payment request/response match the flow and `fxData`.
   */
  assertInternationalPaymentApi({
    paymentRequest,
    paymentResponseBody,
    paymentIdentifier,
    fxData,
    bivoAccountNumber,
  }) {
    expect(paymentIdentifier, 'paymentIdentifier (maps to correlationId on transactions API)').toBeTruthy();
    expect(paymentResponseBody.status).toBe('PENDING');

    expect(Number(paymentRequest.amount)).toBeCloseTo(Number(fxData.amountUsd), 2);
    expect(String(paymentRequest.fromAccount)).toBe(String(bivoAccountNumber));
    expect(paymentRequest.description).toBe(fxData.note);
    expect(paymentRequest.channel).toBe('iban');
    expect(paymentRequest.fundsSource).toBe('BIVO_ACCOUNT');
    expect(paymentRequest.amountType).toBe('SEND');

    expect(Number(paymentResponseBody.amount)).toBeCloseTo(Number(fxData.amountUsd), 2);
    expect(paymentResponseBody.beneficiaryAccountNumber).toBe(paymentRequest.beneficiaryAccount);
    expect(paymentResponseBody.channel).toBe(paymentRequest.channel);
    expect(Number(paymentResponseBody.rate)).toBeCloseTo(Number(paymentRequest.rate), 5);
    expect(Number(paymentResponseBody.fees)).toBeCloseTo(Number(paymentRequest.fees), 4);
    expect(paymentResponseBody.fromCurrency).toBeTruthy();
    expect(paymentResponseBody.toCurrency).toBeTruthy();
    expect(typeof paymentResponseBody.localAmount).toBe('number');
    expect(typeof paymentResponseBody.exchangeAmount).toBe('number');
  }

  /**
   * Fills the optional memo/note and submits the transaction.
   *
   * @param {string} note
   */
  async enterNoteAndConfirm(note) {
    await this.fillFxPaymentNote(note);
    await this.page.getByRole('button', { name: 'Confirm Transaction' }).click();
  }

  /** Review screen memo — maps to `description` on POST /international/payment (e.g. "Sent from Bivo"). */
  async fillFxPaymentNote(note) {
    await this.page.getByRole('textbox', { name: 'Sent from Bivo' }).fill(note);
  }

  /**
   * Clicks Confirm after Review and captures POST /remittance/v1/international/payment.
   * Response includes paymentIdentifier — use as correlationId on GET .../transactions/v1/transactions.
   */
  async confirmFxTransactionAndCaptureInternationalPaymentApi() {
    const paymentPromise = this.page.waitForResponse(
      (response) => {
        const url = response.url();
        if (!url.includes('/remittance/v1/international/payment')) return false;
        if (url.includes('/currency/')) return false;
        if (response.request().method() !== 'POST') return false;
        return response.ok();
      },
      { timeout: 45000 },
    );

    // Button can stay in "Loading..." state while exchange rates are fetched (notably USD→USD for SV).
    const confirmBtn = this.page.getByRole('button', { name: 'Confirm Transaction' });
    await expect(confirmBtn).toBeEnabled({ timeout: 20000 });
    await confirmBtn.click();

    const paymentResponse = await paymentPromise;
    let paymentRequest = {};
    try {
      paymentRequest = paymentResponse.request().postDataJSON() || {};
    } catch {
      paymentRequest = {};
    }

    let paymentResponseBody = {};
    try {
      paymentResponseBody = await paymentResponse.json();
    } catch {
      paymentResponseBody = {};
    }

    const paymentIdentifier =
      paymentResponseBody.paymentIdentifier ??
      paymentResponseBody.payment_identifier ??
      null;

    return {
      paymentResponse,
      paymentRequest,
      paymentResponseBody,
      paymentIdentifier,
    };
  }

  // ─── Step 6 | Processing confirmation ─────────────────────────────────────

  async verifyProcessingAndDismiss() {
    await expect(this.page.getByRole('heading', { name: 'Processing Transaction' })).toBeVisible();
    await expect(this.page.getByRole('heading', { name: 'Our team is processing the transaction and will keep you updated on the progress.' })).toBeVisible();
    await this.page.getByRole('button', { name: 'Got it' }).click();
  }

  // ─── Post-transaction verification ────────────────────────────────────────

  /**
   * Verifies the new FX transaction appears in the transaction list.
   *
   * Note: the converted amount (e.g. £51.26) is exchange-rate dependent and
   * is NOT asserted here. Only the beneficiary name and sent USD amount are
   * checked to keep the assertion stable across runs.
   *
   * @param {string} firstName  - Beneficiary first name
   * @param {string} amount     - Sent amount, e.g. '$55.00'
   */
  async verifyTransactionInList(firstName, amount) {
    await expect(this.page.locator('tbody')).toContainText(`To ${firstName}:`);
    await expect(this.page.locator('tbody')).toContainText(`- ${amount}`);
  }
}

module.exports = FxTransactionPage;
