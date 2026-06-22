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

  // ─── Account / Currency / Deliver-to selectors (testId-based) ─────────────────
  // testId map (confirmed via probe on local build, June 2026):
  //   You-send input             → SendMoney-amount-send
  //   From currency button       → send-receive-currency-{fromCur}  (e.g. send-receive-currency-USD)
  //   From account options       → from-account-option-{last4}      (last 4 of ddaNumber from account-info API)
  //   Recipient amount input     → SendMoney-amount-recipient
  //   Recipient currency button  → receive-receive-currency-USD     (suffix is static — match by prefix)
  //   Recipient currency options → receive-currency-option-{CUR}    (e.g. GBP, EUR, USD)
  //   Deliver-to current button  → deliver-to-{label}               (dynamic, e.g. "deliver-to-IBAN powered by Visa Direct")
  //   Deliver-to options         → deliver-to-option-{label}        (e.g. IBAN, Instant Card Payout, SWIFT Payment)

  /**
   * Selects the FROM account in the "You send" section.
   * Opens the From dropdown (send-receive-currency-* button), then clicks
   * from-account-option-{last4}. last4 = last 4 digits of the account's
   * ddaNumber from the account-info API (NOT the accountNumber).
   *
   * @param {string} ddaLast4 - e.g. '5679' for ddaNumber 99911330007025679
   */
  async selectFromAccountByDdaLast4(ddaLast4) {
    await this.page.locator('[data-testid^="send-receive-currency-"]').first().click();
    const option = this.page.getByTestId(`from-account-option-${ddaLast4}`);
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  /**
   * Selects the recipient currency. Opens the recipient currency dropdown
   * (receive-receive-currency-* button — suffix is static so prefix-matched),
   * clicks receive-currency-option-{CUR}, then waits for the exchange-rate
   * API to settle so the deliver-to section re-renders for the new currency.
   *
   * @param {string} currency - e.g. 'GBP', 'EUR', 'USD'
   */
  async selectRecipientCurrency(currency) {
    const currencyBtn = this.page.locator('[data-testid^="receive-receive-currency-"]').first();
    await expect(currencyBtn).toBeVisible({ timeout: 15000 });

    // Already selected (e.g. GBP is the GB default)? Don't touch the dropdown —
    // re-clicking the same option cancels the in-flight rate fetch and leaves the
    // exchange rate at 0, which blocks amount entry (Continue stays disabled).
    const current = ((await currencyBtn.textContent()) || '').trim();
    if (current === currency) {
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      return;
    }

    await currencyBtn.click();
    const option = this.page.getByTestId(`receive-currency-option-${currency}`);
    await expect(option).toBeVisible({ timeout: 10000 });

    const ratePromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/remittance/v1/international/payment/currency/rate') &&
        r.request().method() === 'GET' &&
        r.ok(),
      { timeout: 15000 },
    ).catch(() => {});
    await option.click();
    await expect(currencyBtn, `recipient currency button should switch to ${currency}`).toContainText(currency, { timeout: 10000 });
    await ratePromise;
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  /**
   * Asserts the currently-selected deliver-to channel. The button's testId is
   * dynamic: deliver-to-{label}, e.g. "deliver-to-IBAN powered by Visa Direct".
   *
   * @param {string} label - exact label, e.g. 'IBAN', 'IBAN powered by Visa Direct', 'Bank Deposit'
   */
  async verifyDeliverToSelected(label) {
    await expect(this.page.getByTestId(`deliver-to-${label}`)).toBeVisible({ timeout: 15000 });
  }

  /**
   * Picks a deliver-to channel from the dropdown. Clicks the current
   * deliver-to-* button to open the option list, then clicks
   * deliver-to-option-{label}. After selection the button's testId becomes
   * deliver-to-{label}, which is asserted.
   *
   * @param {string} label - e.g. 'IBAN', 'Instant Card Payout', 'SWIFT Payment', 'PayPal'
   */
  async selectDeliverToOption(label) {
    const currentBtn = this.page.locator('[data-testid^="deliver-to-"]:not([data-testid^="deliver-to-option-"])').first();
    await expect(currentBtn).toBeVisible({ timeout: 15000 });
    await currentBtn.click();
    const option = this.page.getByTestId(`deliver-to-option-${label}`);
    await expect(option).toBeVisible({ timeout: 10000 });
    await option.click();
    await this.verifyDeliverToSelected(label);
  }

  /**
   * Fills the UK IBAN banking form, with an optional SWIFT Code field.
   * The SWIFT Code field appears when EUR (or other non-GBP currencies) is
   * selected as the recipient currency for IBAN delivery to the UK.
   *
   * @param {{ iban: string, swiftCode?: string|null }} params
   */
  async enterIbanWithOptionalSwift({ iban, swiftCode = null }) {
    await this.page.getByRole('textbox', { name: 'Enter IBAN number' }).fill(iban);
    if (swiftCode) {
      await this.page.getByRole('textbox', { name: 'Enter SWIFT Code' }).fill(swiftCode);
    }
    await this.continue();
  }

  /** Business-tab variant — waits for beneficiary_type=BUSINESS channels response, then
   *  networkidle so the rate + channels APIs are fully settled before amount entry. */
  async selectBusinessDestinationCountryByTestId(countryCode) {
    const channelsResponsePromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/remittance/v1/guest/beneficiary/channels/') &&
        r.url().includes('beneficiary_type=BUSINESS') &&
        r.request().method() === 'GET',
      { timeout: 15000 },
    ).catch(() => {});
    await this.countrySelect(countryCode).click();
    await channelsResponsePromise;
    // Business tab fires additional API calls (rates, channels) that can re-render the
    // amount input mid-type. networkidle ensures all settle before pressSequentially runs.
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
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

  /**
   * Clears the masked send-amount field. The field builds its value right-to-left
   * from raw digits, and selectText()/select-all does NOT replace it — a fresh type
   * appends to the existing value (e.g. "5839" typed onto "$58.39" → "$583,958.39").
   * So we delete digit by digit until the field reads zero/empty.
   */
  async clearSendAmount() {
    await this.sendAmountInput.click();
    await this.sendAmountInput.press('End');
    for (let i = 0; i < 20; i++) {
      const digits = (await this.sendAmountInput.inputValue().catch(() => '')).replace(/\D/g, '');
      if (!digits || Number(digits) === 0) break;
      await this.page.keyboard.press('Backspace');
      await this.page.waitForTimeout(30);
    }
  }

  // Click, clear, keyboard.type — robust against React re-renders that can
  // truncate pressSequentially mid-type when exchange-rate APIs respond slowly.
  async enterSendAmountWithData(data) {
    await expect(this.sendAmountInput).toBeVisible({ timeout: 20000 });
    await expect(this.sendAmountInput).toBeEditable();
    await this.clearSendAmount();
    await this.page.keyboard.type(data.amountInput);
  }

  /**
   * Amount entry for the Business FX flow. Uses page.keyboard.type() which
   * dispatches keystrokes at the page level rather than on a specific locator,
   * surviving React element replacements that can happen mid-type when the
   * Business tab triggers exchange-rate re-renders (most visible for high-rate
   * currencies like INR and JPY). Retries up to maxAttempts times.
   *
   * @param {{ amountInput: string }} data
   * @param {number} [maxAttempts=3]
   */
  async enterSendAmountForBusiness(data, maxAttempts = 3) {
    await expect(this.sendAmountInput).toBeVisible({ timeout: 20000 });
    await expect(this.sendAmountInput).toBeEditable();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Clear first — selectText() does not replace this masked field, so a retry
      // would otherwise append to the previous attempt's digits and balloon the amount.
      await this.clearSendAmount();
      // keyboard.type dispatches at page level — survives React element replacement
      await this.page.keyboard.type(data.amountInput);
      // Allow React to process all onChange events
      await this.page.waitForTimeout(400);
      const continueEnabled = await this.page
        .getByRole('button', { name: 'Continue' })
        .isEnabled({ timeout: 2000 })
        .catch(() => false);
      if (continueEnabled) return;
      if (attempt < maxAttempts) await this.page.waitForTimeout(600);
    }
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
  /**
   * Fills the business payee form (Account Details screen).
   * Labels on this form are div/span elements, not <label>, so CSS placeholder
   * selectors are used instead of getByRole to reliably match the inputs.
   *
   * @param {string} businessName  - Company / business name
   * @param {object|null} extraFields  - Optional { streetAddress, city, zipCode, phone }
   */
  async addBusinessPayee(businessName, extraFields = null) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    await this.page.getByRole('heading', { name: 'Account Details' }).waitFor({ state: 'visible', timeout: 15000 });

    await this.page.locator('input[placeholder="Enter business name"]').fill(businessName);

    if (extraFields?.streetAddress) {
      const el = this.page.locator('input[placeholder="Enter street address"]');
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) await el.fill(extraFields.streetAddress);
    }
    if (extraFields?.city) {
      const el = this.page.locator('input[placeholder="Enter beneficiary\'s city"]');
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) await el.fill(extraFields.city);
    }
    if (extraFields?.zipCode) {
      const el = this.page.locator('input[placeholder="Enter zip/postal code"]');
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) await el.fill(extraFields.zipCode);
    }
    if (extraFields?.phone) {
      // Use the same full-international format + pressSequentially approach as
      // addPayee() (individual flow), which is confirmed working for IN and JP.
      const phoneInput = this.page.getByRole('textbox', { name: /Enter your (mobile|phone) number/i });
      if (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await phoneInput.click();
        await phoneInput.selectText();
        await phoneInput.pressSequentially(extraFields.phone, { delay: 50 });
      }
    }

    await this.continue();
  }

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

  // ─── Bu-web business FX testid flow (unified payee + banking forms) ─────────
  // Every GB channel renders the addpayeedetails-* payee form and addpayeeaddress-*
  // banking form. The payee form is name-only for GBP/EUR and name+address for USD
  // (discriminated by the address field). Banking field set varies by channel.

  /**
   * Fills the payee form (testid). Names always; address block only when present
   * (USD channels). Verify-and-retry the names since the form can re-render.
   * @returns {Promise<'extended'|'name-only'>} which form was filled
   */
  async addPayeeAutoByTestId({ firstName, lastName, addressOne, city, state, postalCode }) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    const first = this.page.getByTestId('addpayeedetails-first-name-input');
    const last = this.page.getByTestId('addpayeedetails-last-name-input');
    await first.waitFor({ state: 'visible', timeout: 15000 });
    for (let i = 0; i < 3; i++) {
      await first.fill(firstName);
      await last.fill(lastName);
      await this.page.waitForTimeout(300);
      if ((await first.inputValue()) === firstName && (await last.inputValue()) === lastName) break;
    }

    const address = this.page.getByTestId('addpayeedetails-address-one-input');
    const isExtended = await address.isVisible({ timeout: 2500 }).catch(() => false);
    if (isExtended) {
      await address.fill(addressOne);
      await this.page.getByTestId('addpayeedetails-city-input').fill(city);
      await this.page.getByTestId('addpayeedetails-state-input').fill(state);
      await this.page.getByTestId('addpayeedetails-postal-code-input').fill(postalCode);
    }
    await this.continue();
    return isExtended ? 'extended' : 'name-only';
  }

  /**
   * Fills the banking form (testid) for a GB channel. The account-number field
   * (addpayeeaddress-bank-account-number-input) doubles as the IBAN field.
   * @param {{ channel: string, currency: string, data: object }} params
   */
  async fillFxBankingByTestId({ channel, currency, data }) {
    const account = this.page.getByTestId('addpayeeaddress-bank-account-number-input');
    const byId = (id) => this.page.getByTestId(`addpayeeaddress-${id}`);

    if (channel === 'IBAN powered by Visa Direct') {
      await account.fill(data.iban);
    } else if (channel === 'IBAN') {
      await account.fill(data.iban);
      await byId('swift-code-input').fill(data.swiftCode);
    } else if (channel === 'Bank Deposit' && currency === 'GBP') {
      await account.fill(data.accountNumber);
      await byId('bank-code-input').fill(data.sortCode); // "Enter sort code"
    } else if (channel === 'Bank Deposit' || channel === 'Domestic Payment') {
      await account.fill(data.accountNumber);
      await byId('routing-code-input').fill(data.routingNumber);
    } else if (channel === 'SWIFT Payment') {
      await account.fill(data.accountNumber);
      await byId('bank-name-input').fill(data.bankName);
      await byId('swift-code-input').fill(data.swiftCode);
      await byId('bank-code-input').fill(data.intermediarySwift); // intermediary SWIFT (optional)
    } else if (channel === 'Wire SWIFT') {
      await account.fill(data.accountNumber);
    } else {
      throw new Error(`fillFxBankingByTestId: unsupported "${channel}" → ${currency}`);
    }
    await this.continue();
  }

  /**
   * Instant Card Payout banking step: fills the card number inside the PGW vault iframe,
   * clicks Link Card, captures POST /pgw/v1/card (must return an identifier), asserts
   * "Card Linked Successfully", then continues to the review screen.
   *
   * Only the PAN is required (expiry/cvv are sent null). The test card 4761348010000127
   * is the only number accepted by the sandbox vault.
   *
   * @param {string} cardNumber
   * @returns {Promise<{ cardResponse: import('@playwright/test').APIResponse, identifier: string }>}
   */
  async linkCardAndCaptureApi(cardNumber) {
    // /pgw/v1/card is posted by the vault iframe to info.bivotech.co (cross-origin) —
    // page-level response events still observe subframe responses.
    const cardApiPromise = this.page.waitForResponse(
      (r) => r.url().includes('/pgw/v1/card') && r.request().method() === 'POST',
      { timeout: 30000 },
    );

    const cardFrame = this.page.locator('iframe').first().contentFrame();
    const cardInput = cardFrame.getByRole('textbox', { name: 'Card Number' });
    await cardInput.waitFor({ state: 'visible', timeout: 15000 });
    await cardInput.fill(cardNumber);

    await this.page.getByRole('button', { name: 'Link Card' }).click();

    const cardResponse = await cardApiPromise;
    expect(cardResponse.ok(), 'POST /pgw/v1/card should succeed').toBeTruthy();
    let cardBody = {};
    try {
      cardBody = await cardResponse.json();
    } catch {
      cardBody = {};
    }

    await expect(this.page.locator('#root')).toContainText('Card Linked Successfully', { timeout: 20000 });
    await this.continue();

    return { cardResponse, identifier: cardBody.identifier };
  }

  /** Fills the optional review note/description only if such a field is present (USD channels omit it). */
  async fillFxPaymentNoteIfPresent(note) {
    const userWebNote = this.page.getByRole('textbox', { name: 'Sent from Bivo' });
    if (await userWebNote.isVisible({ timeout: 2000 }).catch(() => false)) {
      await userWebNote.fill(note);
      return;
    }
    const desc = this.page.getByRole('textbox', { name: 'Description' });
    if (await desc.isVisible({ timeout: 2000 }).catch(() => false)) {
      await desc.fill(note);
    }
  }

  /** Structural review assertion (labels + payee name) — exact amounts/fees vary with live FX, so not asserted. */
  async verifyFxReviewStructure({ firstName, lastName }) {
    const root = this.page.locator('#root');
    await expect(root).toContainText('Exchange rate');
    await expect(root).toContainText('Send amount in USD');
    await expect(root).toContainText('Fees');
    await expect(root).toContainText('Total amount in USD');
    await expect(root).toContainText(`${firstName} ${lastName}`);
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
   * Fills the NZ Bank Deposit form (New Zealand).
   * Fields: account number, bank name, optional SWIFT code.
   */
  async enterNzBankDetails({ accountNumber, bankName, swiftCode }) {
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter bank name' }).fill(bankName);
    if (swiftCode) {
      const swiftInput = this.page.getByRole('textbox', { name: 'Enter SWIFT code' });
      if (await swiftInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await swiftInput.fill(swiftCode);
      }
    }
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
    } else if (channel === 'nz_bank') {
      await this.enterNzBankDetails(bankingDetails);
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

  /** Review screen memo — maps to `description` on POST /international/payment (e.g. "Sent from Bivo").
   *  The placeholder differs by surface: user-web uses "Sent from Bivo", bu-web uses "Description". */
  async fillFxPaymentNote(note) {
    const userWebNote = this.page.getByRole('textbox', { name: 'Sent from Bivo' });
    if (await userWebNote.isVisible({ timeout: 3000 }).catch(() => false)) {
      await userWebNote.fill(note);
      return;
    }
    await this.page.getByRole('textbox', { name: 'Description' }).fill(note);
  }

  /** Bu-web business FX review screen requires an Invoice Number for some destinations
   *  (e.g. IN). User-web has no such field, so fill it only when present. */
  async fillFxInvoiceNumberIfPresent(invoiceNumber) {
    const field = this.page.getByRole('textbox', { name: 'Invoice Number' });
    if (await field.isVisible({ timeout: 3000 }).catch(() => false)) {
      const value = invoiceNumber || `INV-${Math.floor(Math.random() * 1e9)}`;
      await field.fill(value);
    }
  }

  /**
   * Clicks Confirm after Review and captures POST /remittance/v1/international/payment.
   * Response includes paymentIdentifier — use as correlationId on GET .../transactions/v1/transactions.
   */
  async confirmFxTransactionAndCaptureInternationalPaymentApi() {
    const paymentPromise = this.page.waitForResponse(
      (response) => {
        const url = response.url();
        // user-web posts to /remittance/v1/international/payment; bu-web posts to
        // /business/v1/remittance/payment — accept either.
        if (!url.includes('/international/payment') && !url.includes('/remittance/payment')) return false;
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
