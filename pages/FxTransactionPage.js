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

function extractTransactions(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  const confirmed = Array.isArray(body.confirmedTransactions) ? body.confirmedTransactions : [];
  const pending   = Array.isArray(body.pendingTransactions)   ? body.pendingTransactions   : [];
  if (confirmed.length > 0 || pending.length > 0) return [...pending, ...confirmed];
  for (const c of [body.content, body.data, body.items, body.results, body.transactions]) {
    if (Array.isArray(c)) return c;
  }
  return [];
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

    // Sidebar — Accounts section (same testid on both surfaces).
    this.accountsNav = page.getByTestId('sidebar-accounts-menuitem');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _getAuthHeaders() {
    const token = await this.page.evaluate(() => {
      try {
        const root = JSON.parse(localStorage.getItem('persist:root') || '{}');
        const auth = JSON.parse(root.authentication || '{}');
        return auth.loginData?.accessToken || null;
      } catch { return null; }
    });
    if (!token) return null;
    return {
      Authorization:        `Bearer ${token}`,
      'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER || '',
    };
  }

  async _fetchAccountDetails() {
    const headers = await this._getAuthHeaders();
    if (!headers) throw new Error('[FxTransactionPage] No auth token in localStorage — call after login.');

    const host = process.env.HOST || 'https://api-sandbox.bivotech.co';
    const res = await this.page.request.get(`${host}/transactions/v1/transactions/accountbalance`, { headers });
    if (!res.ok()) throw new Error(`[FxTransactionPage] accountbalance API returned ${res.status()}`);

    const body = await res.json();
    return body.accountDetails || [];
  }

  /**
   * Find a wallet account by currency code (e.g. 'MXN') — used to switch the FX "You
   * send" FROM account to a same-currency wallet for a same-currency corridor test.
   * Returns { accountNumber, accountName, last4 }.
   */
  async discoverWalletByCurrency(currencyCode) {
    const accounts = await this._fetchAccountDetails();
    const account = accounts.find(
      (a) => a.type?.includes('wallet') && a.currency === currencyCode,
    );
    if (!account) throw new Error(`[FxTransactionPage] No ${currencyCode} wallet found.`);
    return {
      accountNumber: account.account,
      accountName:   account.accountName,
      last4:         String(account.ddaNumber).slice(-4),
    };
  }

  /**
   * Resolve the primary Bivo account's DDA last4 from its account number — needed on
   * bu-web, where loginBuWebWithEmail (unlike loginUserWebWithPhone) doesn't capture
   * the account-info API response, so bivo_dda_number isn't available off the login
   * result. Same lookup as UserWebWithdrawFundsPage.discoverBivoPrimaryLast4.
   */
  async discoverBivoPrimaryLast4(primaryAccountNumber) {
    const accounts = await this._fetchAccountDetails();
    const primary = accounts.find(
      // user-web wallets are type "wallet"; bu-web business wallets are "business-wallet".
      (a) => a.type?.includes('wallet') && a.currency === 'USD' && String(a.account) === String(primaryAccountNumber),
    );
    if (!primary) throw new Error('[FxTransactionPage] Primary Bivo wallet not found in accountbalance API.');
    return String(primary.ddaNumber).slice(-4);
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
   * Asserts the "You're sending to {country}" heading shown right after selecting a
   * destination country.
   * @param {string} countryName - e.g. 'China', 'Mexico', 'India', 'United Kingdom', 'Philippines'
   */
  async verifyDestinationCountryHeading(countryName) {
    await expect(this.page.getByTestId('sendmoney-country-select')).toContainText(`You're sending to ${countryName}`);
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
   * Asserts the currently-selected recipient currency via its dedicated testid
   * (`receive-receive-currency-{currency}`) — confirmed via live recording, Aug 2026.
   * Distinct from selectRecipientCurrency's own currencyBtn lookup, which matches by
   * testid *prefix* only (`receive-receive-currency-`) because that button's testid was
   * previously found to stay fixed at "-USD" regardless of the selected currency on
   * other corridors (see the testid map above) — this method instead targets the
   * currency-specific testid directly, for callers that already know which currency to
   * expect and just want to assert it.
   *
   * @param {string} currency - e.g. 'CNY', 'GBP', 'INR'
   */
  async verifyRecipientCurrencySelected(currency) {
    await expect(this.page.getByTestId(`receive-receive-currency-${currency}`)).toContainText(currency, { timeout: 15000 });
  }

  /**
   * Asserts the "You send" FROM-currency chip shows the given currency. Unlike the
   * recipient-currency button, this one's testid suffix is the currency itself
   * (send-receive-currency-{currency}), not a fixed value.
   * @param {string} currency - e.g. 'USD'
   */
  async verifyFromCurrencySelected(currency) {
    await expect(this.page.getByTestId(`send-receive-currency-${currency}`)).toContainText(currency);
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
   * Selects a deliver-to option that renders as a duplicate <a> in the dropdown — a real
   * FE bug (e.g. India's "US Payment - ACH"), not a probe artifact. Behaves like
   * selectDeliverToOption otherwise; .first() avoids the resulting strict-mode violation.
   * verifyDeliverToSelected (checking the now-current button, not the dropdown list) is
   * unaffected by the duplication and still safe to reuse here.
   *
   * @param {string} label
   */
  async selectDuplicatedDeliverToOption(label) {
    const currentBtn = this.page.locator('[data-testid^="deliver-to-"]:not([data-testid^="deliver-to-option-"])').first();
    await currentBtn.click();
    await this.page.getByTestId(`deliver-to-option-${label}`).first().click();
    await this.verifyDeliverToSelected(label);
  }

  /**
   * Switches to the given deliver-to channel only if it isn't already the current
   * selection — re-selecting an already-current option can cancel an in-flight rate
   * fetch (same hazard selectRecipientCurrency guards against).
   *
   * @param {string} channel
   */
  async ensureDeliverToSelected(channel) {
    const currentBtn = this.page.locator('[data-testid^="deliver-to-"]:not([data-testid^="deliver-to-option-"])').first();
    const currentText = (await currentBtn.textContent()) || '';
    if (currentText.includes(channel)) return;
    await this.selectDeliverToOption(channel);
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

  /** Switches the Create FX Transaction screen from Individual (default) to the Business tab. */
  async switchToBusinessTab() {
    await this.page.getByText('Business', { exact: true }).click();
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
    const digitCount = (await this.sendAmountInput.inputValue().catch(() => '')).replace(/\D/g, '').length;
    for (let i = 0; i < digitCount; i++) {
      await this.page.keyboard.press('Backspace');
    }
  }

  // Click, keyboard.type — robust against React re-renders that can truncate
  // pressSequentially mid-type when exchange-rate APIs respond slowly. The field
  // defaults to $0.00 on a fresh Send Money screen, so no clear is needed first.
  async enterSendAmountWithData(data) {
    await expect(this.sendAmountInput).toBeVisible({ timeout: 20000 });
    await expect(this.sendAmountInput).toBeEditable();
    await this.sendAmountInput.click();
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
  async enterSendAmountForBusiness(data) {
    await expect(this.sendAmountInput).toBeVisible({ timeout: 20000 });
    await expect(this.sendAmountInput).toBeEditable();
    await this.sendAmountInput.click();
    await this.page.keyboard.type(data.amountInput);
    await this.page.waitForTimeout(400);
      const continueEnabled = await this.page
        .getByRole('button', { name: 'Continue' })
        .isEnabled({ timeout: 2000 })
        .catch(() => false);
      if (continueEnabled) return;

  }

  // amountUsd e.g. "62.30"; encodes to cents like US ACH flow.
  async enterSendAmountUsdDecimal(amountUsd) {
    await this.enterSendAmountWithData({ amountInput: toCentsInput(amountUsd) });
  }

  async verifyCurrencyShown(currency) {
    await expect(this.page.getByText(currency)).toBeVisible();
  }

  /**
   * Asserts the fee/exchange-rate summary shown on the "You send" step before Continue.
   * Values are exact strings as rendered on screen (e.g. '$0.00', '$20.00', '$1 =1').
   */
  async verifySendMoneySummary({ fee, exchangeAmount, rate }) {
    await expect(this.page.getByTestId('sendmoney-fees-value')).toContainText(fee);
    if (exchangeAmount != null) {
      await expect(this.page.getByTestId('sendmoney-exchange-amount-value')).toContainText(exchangeAmount);
    }
    await expect(this.page.getByTestId('sendmoney-exchange-rate-value')).toContainText(rate);
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
      // The business payee phone field is a country-flag-masked input — pressSequentially
      // (used by addPayee()'s plain-text phone field) races the mask's incremental
      // re-render here: typing "+81 90 9017 0953" character-by-character landed as
      // "+81 81 9017 0953" (confirmed live), leaving Continue disabled. .fill() sets the
      // value in one shot and avoids the race.
      const phoneInput = this.page.getByRole('textbox', { name: /Enter your (mobile|phone) number/i });
      if (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await phoneInput.click();
        await phoneInput.fill(extraFields.phone);
      }
    }

    await this.continue();
  }

  async addPayee(firstName, lastName, extraFields = null) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    await this.page.getByRole('textbox', { name: "Enter beneficiary's first name" }).fill(firstName);
    await this.page.getByRole('textbox', { name: "Enter beneficiary's last name" }).fill(lastName);

    // The personal-info form varies by country (e.g. CN shows names only — no address),
    // so fill each optional field only when it is actually rendered. Avoids timing out on
    // inputs that aren't present for a given destination — same pattern as AddPayeePage.
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
    if (extraFields?.phone) {
      // Label varies by country ("Enter your mobile number" for IN, "Enter your phone number" for JP).
      // .fill() rather than pressSequentially — this is a country-flag-masked input whose
      // incremental re-render races keystroke-by-keystroke typing (confirmed live for JP:
      // "+81 90 9017 0953" landed as "+81 81 9017 0953", leaving Continue disabled).
      const phoneInput = this.page.getByRole('textbox', { name: /Enter your (mobile|phone) number/i });
      if (await phoneInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await phoneInput.click();
        await phoneInput.fill(extraFields.phone);
      }
    }
    if (extraFields?.identityType) {
      // CN UnionPay-only: identity type + number collected on the payee-details screen
      // itself (not the later "your identity type" step handleIdentityStepIfPresent
      // covers) — confirmed via live probe. Options: Driver's License, Passport,
      // National ID, Other.
      const idTypeButton = this.page.getByRole('button', { name: "Select beneficiary's identity type" });
      if (await idTypeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await idTypeButton.click();
        await this.page.getByText(extraFields.identityType, { exact: true }).click();
        await fillIfVisible("Enter beneficiary's identity number", extraFields.identityNumber);
      }
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
    // Fall back to the placeholder-based locator when the testid isn't rendered
    // (the FE has been observed to drop addpayeedetails-* testids from this form).
    const first = this.page
      .getByTestId('addpayeedetails-first-name-input')
      .or(this.page.getByPlaceholder("Enter beneficiary's first name"));
    const last = this.page
      .getByTestId('addpayeedetails-last-name-input')
      .or(this.page.getByPlaceholder("Enter beneficiary's last name"));
    await first.waitFor({ state: 'visible', timeout: 15000 });
    for (let i = 0; i < 3; i++) {
      await first.fill(firstName);
      await last.fill(lastName);
      await this.page.waitForTimeout(300);
      if ((await first.inputValue()) === firstName && (await last.inputValue()) === lastName) break;
    }

    const address = this.page
      .getByTestId('addpayeedetails-address-one-input')
      .or(this.fieldByLabel(/Address/i));
    const isExtended = await address.isVisible({ timeout: 2500 }).catch(() => false);
    if (isExtended) {
      await address.fill(addressOne);
      await this.page.getByTestId('addpayeedetails-city-input').or(this.fieldByLabel(/City/i)).fill(city);
      await this.page.getByTestId('addpayeedetails-state-input').or(this.fieldByLabel(/State/i)).fill(state);
      await this.page
        .getByTestId('addpayeedetails-postal-code-input')
        .or(this.fieldByLabel(/Zip|Postal/i))
        .fill(postalCode);
    }
    await this.continue();
    return isExtended ? 'extended' : 'name-only';
  }

  /**
   * Falls back to the field's visible label when the FE drops its data-testid — every
   * add-beneficiary field renders as `.add-beneficiary-input.form-group` wrapping a
   * `.add-beneficiary-label` + `input`, so label text stays a stable target either way.
   */
  fieldByLabel(labelPattern) {
    return this.page
      .locator('.add-beneficiary-input.form-group')
      .filter({ has: this.page.locator('.add-beneficiary-label', { hasText: labelPattern }) })
      .locator('input');
  }

  /**
   * Fills the banking form (testid) for a GB channel. The account-number field
   * (addpayeeaddress-bank-account-number-input) doubles as the IBAN field.
   * @param {{ channel: string, currency: string, data: object }} params
   */
  async fillFxBankingByTestId({ channel, currency, data }) {
    const account = this.page
      .getByTestId('addpayeeaddress-bank-account-number-input')
      .or(this.fieldByLabel(/IBAN|Account Number/i));
    const byId = (id, labelPattern) =>
      this.page.getByTestId(`addpayeeaddress-${id}`).or(this.fieldByLabel(labelPattern));

    if (channel === 'IBAN powered by Visa Direct') {
      await account.fill(data.iban);
    } else if (channel === 'IBAN') {
      await account.fill(data.iban);
      // Anchored at the start — "Intermediary Bank SWIFT Code (optional)" also contains
      // "SWIFT" and would otherwise match too, causing a strict-mode violation.
      await byId('swift-code-input', /^SWIFT/i).fill(data.swiftCode);
    } else if (channel === 'Bank Deposit' && currency === 'GBP') {
      await account.fill(data.accountNumber);
      await byId('bank-code-input', /Sort Code/i).fill(data.sortCode); // "Enter sort code"
    } else if (channel === 'Bank Deposit' || channel === 'Domestic Payment' || channel === 'Bank Deposit - ACH') {
      await account.fill(data.accountNumber);
      await byId('routing-code-input', /Routing/i).fill(data.routingNumber);
    } else if (channel === 'SWIFT Payment') {
      await account.fill(data.accountNumber);
      await byId('bank-name-input', /Bank Name/i).fill(data.bankName);
      // Anchored at the start — "Intermediary Bank SWIFT Code (optional)" also contains
      // "SWIFT" and would otherwise match too, causing a strict-mode violation.
      await byId('swift-code-input', /^SWIFT/i).fill(data.swiftCode);
      await byId('bank-code-input', /Intermediary/i).fill(data.intermediarySwift); // intermediary SWIFT (optional)
    } else if (channel === 'Wire - SWIFT') {
      // Confirmed via live recording (Aug 2026): bank name + this form's own Bank Code +
      // SWIFT code + a country-code field. testid is account-country-code-input (not
      // country-code-input like SWIFT Payment), and bank-code-input holds this form's Bank
      // Code — not the optional Intermediary SWIFT that SWIFT Payment uses the same testid for.
      await account.fill(data.accountNumber);
      await byId('bank-name-input', /Bank Name/i).fill(data.bankName);
      await byId('bank-code-input', /Bank Code/i).fill(data.bankCode);
      // Anchored at the start — "Intermediary Bank SWIFT Code (optional)" also contains
      // "SWIFT" and would otherwise match too, causing a strict-mode violation.
      await byId('swift-code-input', /^SWIFT/i).fill(data.swiftCode);
      await byId('account-country-code-input', /Country/i).fill(data.bankCountryCode);
    } else if (channel === 'International  - SWIFT') {
      // India USD-recipient SWIFT wire — confirmed via live recording. Note the double
      // space in the label/testid ("International  - SWIFT") — that's the FE's actual
      // rendered testid, not a typo here. Unlike Wire - SWIFT (UK), there's no separate
      // Bank Code field: just account + bank name + SWIFT code + country code.
      await account.fill(data.accountNumber);
      await byId('bank-name-input', /Bank Name/i).fill(data.bankName);
      await byId('swift-code-input', /^SWIFT/i).fill(data.swiftCode);
      await byId('account-country-code-input', /Country/i).fill(data.bankCountryCode);
    } else if (channel === 'US Payment - Wire' || channel === 'US Payment - ACH') {
      // India USD-recipient domestic-style channels — confirmed via live probe: both
      // render the identical shape (account + bank name + routing number).
      await account.fill(data.accountNumber);
      await byId('bank-name-input', /Bank Name/i).fill(data.bankName);
      await byId('routing-code-input', /Routing/i).fill(data.routingNumber);
    } else if (channel === 'PayPal' && currency === 'USD') {
      // India USD-recipient PayPal — confirmed via live probe: two dropdowns (Wallet ID
      // Type: "Email Address" | "PayPal.Me link"; Wallet Type: "PAYPAL" | "VENMO"), then
      // the account-number testid doubles as "Enter Wallet ID". Dropdowns first, value
      // field last — same ordering rule as the UK matrix's PayPal handling, where filling
      // the value field before the dropdowns left validation stale.
      await this.page.getByRole('button', { name: 'Select Wallet ID Type' }).click();
      await this.page.locator('a').filter({ hasText: /^PayPal\.Me link$/ }).first().click();
      await this.page.getByRole('button', { name: 'Select Wallet Type' }).click();
      await this.page.locator('a').filter({ hasText: /^PAYPAL$/ }).first().click();
      await account.fill(data.walletId);
    } else {
      throw new Error(`fillFxBankingByTestId: unsupported "${channel}" → ${currency}`);
    }
    await this.continue();
  }

  /**
   * Fills the PayPal banking form (UK) — two dropdowns (recipient type, then "PayPal or
   * Venmo") followed by the ID value field. Options render as <a> in a dropdown menu, and
   * the dropdowns must be filled BEFORE the value field or Continue can stay disabled.
   * GBP renders "Email" as the recipient type with a "PayPal account ID" field; USD
   * renders "PayPal ID" with a literal "Enter account number" field. The first Continue
   * click can be swallowed by a re-render after wallet selection, so it retries until the
   * form actually leaves the screen.
   *
   * @param {{ currency: string, data: { paypalId?: string, accountNumber?: string } }} params
   */
  async fillPayPalBankingDetails({ currency, data }) {
    const recipientType = currency === 'GBP' ? /^Email$/ : /^PayPal ID$/;
    await this.page.getByRole('button', { name: 'Select PayPal ID Type' }).click();
    await this.page.locator('a').filter({ hasText: recipientType }).first().click();
    await this.page.getByRole('button', { name: 'PayPal or Venmo' }).click();
    await this.page.locator('a').filter({ hasText: /^PayPal$/ }).first().click();

    const idInput = currency === 'GBP'
      ? this.page.getByRole('textbox', { name: 'PayPal account ID' })
      : this.page.getByRole('textbox', { name: 'Enter account number' });
    const idValue = currency === 'GBP' ? data.paypalId : data.accountNumber;
    const continueBtn = this.page.getByRole('button', { name: 'Continue' });
    for (let i = 0; i < 3; i++) {
      await idInput.fill(idValue);
      if (await continueBtn.isEnabled({ timeout: 4000 }).catch(() => false)) break;
      await idInput.fill('');
      await this.page.waitForTimeout(400);
    }
    // The first Continue click can be swallowed by a re-render after wallet
    // selection — click until the form actually leaves the screen.
    for (let i = 0; i < 3; i++) {
      await this.continue();
      const left = await idInput
        .waitFor({ state: 'hidden', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (left) break;
    }
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

  /**
   * Selects a previously-saved payee from the Select Payee screen instead of adding a new
   * one. Existing payee rows render as div.d-flex.flex-column.pl-12 with no data-testid
   * (probed July 2026 via exploratory tests L/N/P).
   *
   * Normally this skips personal-info and banking-details entirely, landing straight on
   * Review Transfer. EXCEPTION: if the transaction's delivery channel is one this payee
   * has no saved banking details for yet (e.g. switching from "IBAN powered by Visa
   * Direct" to "Bank Deposit"), the app shows "Edit Beneficiary Details" instead — pass
   * expectReviewTransfer: false in that case and assert/handle that screen separately
   * (see fillEditBeneficiaryBankDepositDetailsAndCaptureApi).
   *
   * @param {string} firstName
   * @param {string} lastName
   * @param {{ expectReviewTransfer?: boolean }} [options]
   */
  async selectExistingPayeeByName(firstName, lastName, { expectReviewTransfer = true } = {}) {
    const payeeRow = this.page
      .locator('div.d-flex.flex-column.pl-12')
      .filter({ hasText: `${firstName} ${lastName}` })
      .first();

    // The Select Payee list only loads 10 payees at a time and lazy-loads more as the
    // page is scrolled (confirmed via network capture: scrolling fires GET
    // /remittance/v1/beneficiary/accounts?page=1... etc). Keep scrolling until the
    // target payee appears or the row count stops growing (no more pages left).
    const allRows = this.page.locator('div.d-flex.flex-column.pl-12');
    let previousCount = -1;
    for (let i = 0; i < 10; i++) {
      if (await payeeRow.isVisible()) break;
      const currentCount = await allRows.count();
      if (currentCount === previousCount) break;
      previousCount = currentCount;
      await this.page.mouse.wheel(0, 2000);
      await this.page.waitForTimeout(800);
    }

    await expect(
      payeeRow,
      `saved payee "${firstName} ${lastName}" should be visible on Select Payee screen`,
    ).toBeVisible({ timeout: 15000 });
    await payeeRow.click();
    if (expectReviewTransfer) {
      await expect(this.page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    }
  }

  /**
   * Business-payee counterpart of selectExistingPayeeByName — same Select Payee screen
   * and row shape, filtered by the single business-name string instead of a
   * firstName/lastName pair (avoids a trailing-space substring mismatch a two-part
   * filter would produce when lastName is empty).
   *
   * @param {string} businessName
   */
  async selectExistingBusinessPayeeByName(businessName) {
    const payeeRow = this.page
      .locator('div.d-flex.flex-column.pl-12')
      .filter({ hasText: businessName })
      .first();

    const allRows = this.page.locator('div.d-flex.flex-column.pl-12');
    let previousCount = -1;
    for (let i = 0; i < 10; i++) {
      if (await payeeRow.isVisible()) break;
      const currentCount = await allRows.count();
      if (currentCount === previousCount) break;
      previousCount = currentCount;
      await this.page.mouse.wheel(0, 2000);
      await this.page.waitForTimeout(800);
    }

    await expect(
      payeeRow,
      `saved business payee "${businessName}" should be visible on Select Payee screen`,
    ).toBeVisible({ timeout: 15000 });
    await payeeRow.click();
    await expect(this.page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
  }

  /**
   * Handles the "Edit Beneficiary Details" screen — shown when sending to an existing
   * payee via a delivery channel it has no saved banking details for yet. Clicks Next to
   * reach the banking form, fills the GBP Bank Deposit fields (account number + sort
   * code), and captures the account-creation API for this new channel (same
   * /beneficiary/account POST used when a channel's banking details are added the first
   * time — see AddPayeePage.fillBankingDetailsByChannelAndCaptureApi).
   *
   * @param {{ accountNumber: string, sortCode: string }} params
   */
  async fillEditBeneficiaryBankDepositDetailsAndCaptureApi({ accountNumber, sortCode }) {
    await this.page.getByRole('button', { name: 'Next' }).click();

    const accountPromise = this.page.waitForResponse(
      (r) => r.url().includes('/beneficiary/account') && r.request().method() === 'POST' && r.ok(),
      { timeout: 20000 },
    );
    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter sort code' }).fill(sortCode);
    await this.continue();

    const acctResponse = await accountPromise;
    return { acctResponse };
  }

  /**
   * Generalizes fillEditBeneficiaryBankDepositDetailsAndCaptureApi to any channel's
   * "Edit Beneficiary Details" banking fields (used when reusing a saved payee via a
   * channel it has no saved details for yet, on countries whose banking fields aren't
   * GB Bank Deposit's account-number/sort-code shape). Each field is located by testid
   * when given (e.g. India's UPI field, which has no stable accessible name) or by
   * placeholder/accessible-name otherwise.
   *
   * @param {{ fields: Array<{ testId?: string, placeholder?: string, value: string }>, dropdowns?: Array<{ selectTestId: string, optionTestId: string }> }} params
   */
  async fillEditBeneficiaryDetailsAndCaptureApi({ fields, dropdowns = [] }) {
    await this.page.getByRole('button', { name: 'Next' }).click();

    const accountPromise = this.page.waitForResponse(
      (r) => r.url().includes('/beneficiary/account') && r.request().method() === 'POST' && r.ok(),
      { timeout: 20000 },
    );
    for (const { selectTestId, optionTestId } of dropdowns) {
      await this.page.getByTestId(selectTestId).click();
      await this.page.getByTestId(optionTestId).click();
    }
    for (const { testId, placeholder, value } of fields) {
      const input = testId ? this.page.getByTestId(testId) : this.page.getByRole('textbox', { name: placeholder });
      await input.fill(value);
    }
    await this.continue();

    const acctResponse = await accountPromise;
    return { acctResponse };
  }

  /**
   * Opens the read-only details view for a saved payee from the Select Payee screen
   * (the "eye"-style icon next to each row). testid is
   * `payee-list-item-view-details-button-{firstName}-{lastName}` — hyphen-separated, same real
   * testid AddPayeePage.openPayeeDetails() uses on the standalone Payees list.
   *
   * @param {string} firstName
   * @param {string} lastName
   */
  async viewExistingPayeeDetails(firstName, lastName) {
    const viewBtn = this.page.getByTestId(`payee-list-item-view-details-button-${firstName}-${lastName}`);
    await expect(
      viewBtn,
      `"view details" button for saved payee "${firstName} ${lastName}" should be visible`,
    ).toBeVisible({ timeout: 15000 });
    await viewBtn.click();
  }

  /**
   * Opens the payee-details view from the Review Transfer screen itself — a distinct
   * entry point from viewExistingPayeeDetails (reached from the Select Payee list,
   * before Review Transfer). Confirmed via live recording (Aug 2026): the payee's row on
   * Review Transfer renders inside a `.selected-account` card with a pencil-icon button
   * that has no data-testid/aria-label, so it's located structurally by filtering that
   * card on the payee's name. Clicking it lands on the same "Payee Details" heading
   * viewExistingPayeeDetails reaches — from there, editPayeeNameAndCaptureApi (which
   * itself clicks "Edit Payee") and the channel-specific account-edit method proceed
   * identically regardless of which entry point was used.
   *
   * @param {string} firstName
   * @param {string} lastName
   */
  async openPayeeDetailsFromReviewTransfer(firstName, lastName) {
    await expect(this.page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    const payeeCard = this.page.locator('.selected-account').filter({ hasText: `${firstName} ${lastName}` });
    await expect(
      payeeCard,
      `Review Transfer should show a selected-account card for "${firstName} ${lastName}"`,
    ).toBeVisible({ timeout: 15000 });
    await payeeCard.getByRole('button').first().click();
    await expect(this.page.getByRole('heading', { name: 'Payee Details' })).toBeVisible({ timeout: 15000 });
  }

  /**
   * Business-payee counterpart of openPayeeDetailsFromReviewTransfer — same pencil-icon
   * affordance on the Review Transfer `.selected-account` card, just filtered by the
   * single business-name string instead of a firstName/lastName pair.
   *
   * @param {string} businessName
   */
  async openBusinessPayeeDetailsFromReviewTransfer(businessName) {
    await expect(this.page.getByRole('heading', { name: 'Review Transfer' })).toBeVisible({ timeout: 15000 });
    const payeeCard = this.page.locator('.selected-account').filter({ hasText: businessName });
    await expect(
      payeeCard,
      `Review Transfer should show a selected-account card for "${businessName}"`,
    ).toBeVisible({ timeout: 15000 });
    await payeeCard.getByRole('button').first().click();
    await expect(this.page.getByRole('heading', { name: 'Payee Details' })).toBeVisible({ timeout: 15000 });
  }

  /**
   * Clears a text input before filling it. Plain `.fill()` alone was observed (via
   * recorded codegen) to leave stale characters behind on this form — the same kind of
   * controlled-input quirk as the masked send-amount field (see clearSendAmount) — so
   * select-all + backspace first.
   */
  async _clearAndFill(locator, value) {
    await locator.click();
    await locator.press('Control+A');
    await locator.press('Backspace');
    await locator.fill(value);
  }

  async _safeJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  /**
   * Edit Payee — step 1 of 2: updates the beneficiary's first/last name from the payee
   * details view (opened via viewExistingPayeeDetails) and captures the update API.
   *
   * The exact verb/path haven't been confirmed by a live probe — the admin beneficiary
   * API (tests/api/06-beneficiary-management.spec.js) updates personal info via PUT, but
   * this app's write calls elsewhere are all POST, so the matcher below accepts any
   * non-GET response touching "personal-info" rather than assuming a specific verb.
   *
   * @param {{ firstName: string, lastName: string }} params
   */
  async editPayeeNameAndCaptureApi({ firstName, lastName }) {
    await this.page.getByRole('button', { name: 'Edit Payee' }).click();

    const firstNameInput = this.page.getByRole('textbox', { name: "Enter beneficiary's first name" });
    const lastNameInput = this.page.getByRole('textbox', { name: "Enter beneficiary's last name" });
    await this._clearAndFill(firstNameInput, firstName);
    await this._clearAndFill(lastNameInput, lastName);

    const updatePromise = this.page.waitForResponse(
      (r) => r.url().includes('personal-info') && r.request().method() !== 'GET',
      { timeout: 20000 },
    );
    await this.page.getByRole('button', { name: 'Save' }).click();

    const updateResponse = await updatePromise;
    console.log(
      `[EditPayee] personal-info update: ${updateResponse.request().method()} ${updateResponse.url()} -> ${updateResponse.status()}`,
    );
    expect(updateResponse.ok(), 'personal-info update request should succeed').toBeTruthy();

    let requestBody = {};
    try {
      requestBody = updateResponse.request().postDataJSON() || {};
    } catch {
      requestBody = {};
    }
    expect(getFieldValueFromData(requestBody, 'first_name'), 'updated personal-info first_name').toBe(firstName);
    expect(getFieldValueFromData(requestBody, 'last_name'), 'updated personal-info last_name').toBe(lastName);

    return { updateResponse, requestBody };
  }

  /**
   * Business-payee counterpart of editPayeeNameAndCaptureApi — the "Edit Beneficiary
   * Details" screen for a business payee is a single combined form (business name +
   * address fields) rather than the individual flow's first/last name pair, confirmed
   * via live probe. Only the business name is updated here; address fields are left as
   * pre-filled.
   *
   * @param {{ businessName: string }} params
   */
  async editBusinessPayeeNameAndCaptureApi({ businessName }) {
    await this.page.getByRole('button', { name: 'Edit Payee' }).click();

    const nameInput = this.page.getByRole('textbox', { name: 'Enter business name' });
    await this._clearAndFill(nameInput, businessName);

    const updatePromise = this.page.waitForResponse(
      (r) => r.url().includes('personal-info') && r.request().method() !== 'GET',
      { timeout: 20000 },
    );
    await this.page.getByRole('button', { name: 'Save' }).click();

    const updateResponse = await updatePromise;
    console.log(
      `[EditPayee] business personal-info update: ${updateResponse.request().method()} ${updateResponse.url()} -> ${updateResponse.status()}`,
    );
    expect(updateResponse.ok(), 'personal-info update request should succeed').toBeTruthy();

    return { updateResponse };
  }

  /**
   * Edit Payee — step 2 of 2: updates the IBAN on the banking screen the app advances to
   * right after editPayeeNameAndCaptureApi's Save, and captures the account-update API.
   * Same verb caveat as editPayeeNameAndCaptureApi — matches any non-GET response
   * touching "beneficiary/account".
   *
   * @param {{ iban: string }} params
   */
  async editPayeeIbanAndCaptureApi({ iban }) {
    const ibanInput = this.page.getByRole('textbox', { name: 'Enter IBAN number' });
    await this._clearAndFill(ibanInput, iban);

    const updatePromise = this.page.waitForResponse(
      (r) => r.url().includes('beneficiary/account') && r.request().method() !== 'GET',
      { timeout: 20000 },
    );
    await this.page.getByRole('button', { name: 'Save' }).click();

    const updateResponse = await updatePromise;
    console.log(
      `[EditPayee] account update: ${updateResponse.request().method()} ${updateResponse.url()} -> ${updateResponse.status()}`,
    );
    expect(updateResponse.ok(), 'beneficiary/account update request should succeed').toBeTruthy();

    return { updateResponse };
  }

  /**
   * Generalizes editPayeeIbanAndCaptureApi to any channel's account-edit fields — used
   * by non-GB countries whose "Edit Beneficiary Account Details" screen collects
   * different fields (e.g. India's IFSC code, China's UnionPay card number). Same
   * screen/flow as editPayeeIbanAndCaptureApi (reached right after
   * editPayeeNameAndCaptureApi's Save); only the field set differs.
   *
   * @param {{ fields: Array<{ testId?: string, placeholder?: string, value: string }> }} params
   */
  async editPayeeAccountFieldsAndCaptureApi({ fields }) {
    for (const { testId, placeholder, value } of fields) {
      const input = testId ? this.page.getByTestId(testId) : this.page.getByRole('textbox', { name: placeholder });
      await this._clearAndFill(input, value);
    }

    const updatePromise = this.page.waitForResponse(
      (r) => r.url().includes('beneficiary/account') && r.request().method() !== 'GET',
      { timeout: 20000 },
    );
    await this.page.getByRole('button', { name: 'Save' }).click();

    const updateResponse = await updatePromise;
    console.log(
      `[EditPayee] account update: ${updateResponse.request().method()} ${updateResponse.url()} -> ${updateResponse.status()}`,
    );
    expect(updateResponse.ok(), 'beneficiary/account update request should succeed').toBeTruthy();

    return { updateResponse };
  }

  /**
   * Proves an IBAN edit actually persisted server-side, rather than just trusting that
   * the update request returned 200. The confirm-transaction payment API can't be used
   * for this: its `beneficiaryAccount` field is the internal Bivo account reference (e.g.
   * "5000000024462"), not the raw IBAN, so it stays identical whether the edit persisted
   * or not — asserting on it would be a false-positive check.
   *
   * Instead this re-enters the GB Create FX flow up to the Select Payee screen and
   * captures GET /remittance/v1/beneficiary/accounts — the same list endpoint confirmed
   * via a captured HAR (see this file's header comment history) to back that screen,
   * filtered by currency_id/country — then asserts the named payee's bankAccountNumber
   * matches the new IBAN.
   *
   * @param {{ firstName: string, lastName: string, iban: string, amountInput: string, country?: string, beneficiaryType?: string }} params
   */
  async verifyPayeeIbanPersisted({
    firstName,
    lastName,
    iban,
    amountInput,
    country = 'GB',
    beneficiaryType = 'INDIVIDUAL',
  }) {
    // Matches on the query params the test itself is driving (country, beneficiary_type)
    // rather than currency_id — that's a derived/opaque value with no local meaning here.
    // Matching only the base path would risk resolving on an earlier/unrelated fetch to
    // this same endpoint (e.g. a default-scoped list before the country selection takes
    // effect), which is what produced the "beneficiary list should include X" failure.
    // `page` is also pinned per-call below: the app can fire more than one accounts-list
    // request in close succession (e.g. a page=1 prefetch alongside the page=0 load), and
    // without matching on page, waitForResponse could resolve on whichever arrives first —
    // silently returning a later page that doesn't contain the target beneficiary.
    const isBeneficiaryAccountsList = (page) => (r) => {
      if (r.request().method() !== 'GET' || !r.ok()) return false;
      if (!r.url().includes('/remittance/v1/beneficiary/accounts')) return false;
      const params = new URL(r.url()).searchParams;
      return (
        params.get('country') === country &&
        params.get('beneficiary_type') === beneficiaryType &&
        params.get('page') === String(page)
      );
    };

    await this.navigateToCreateFxTransactionUserWeb();
    await this.selectDestinationCountryByTestId(country);
    await this.userWebFocusYouSendSection();
    await this.enterSendAmountForBusiness({ amountInput });

    // Armed immediately before the action that triggers the Select Payee screen —
    // minimizes the window for an unrelated response to resolve this promise first.
    const listPromise = this.page.waitForResponse(isBeneficiaryAccountsList(0), { timeout: 20000 });
    await this.continue();

    let listResponse = await listPromise;
    let listBody = await this._safeJson(listResponse);
    let beneficiaries = Array.isArray(listBody.beneficiaries) ? listBody.beneficiaries : [];
    let matchingBeneficiary = beneficiaries.find((b) => b.firstName === firstName && b.lastName === lastName);

    // The Select Payee list paginates 10 at a time (see selectExistingPayeeByName) — a
    // recently edited payee may be beyond the first page. Keep scrolling to trigger
    // subsequent pages until it's found or the API reports there's nothing more to load.
    for (let i = 0; !matchingBeneficiary && listBody.hasNextPage && i < 10; i++) {
      const nextPagePromise = this.page
        .waitForResponse(isBeneficiaryAccountsList(i + 1), { timeout: 10000 })
        .catch(() => null);
      await this.page.mouse.wheel(0, 2000);
      const nextResponse = await nextPagePromise;
      if (!nextResponse) break;

      listResponse = nextResponse;
      listBody = await this._safeJson(listResponse);
      beneficiaries = Array.isArray(listBody.beneficiaries) ? listBody.beneficiaries : [];
      matchingBeneficiary = beneficiaries.find((b) => b.firstName === firstName && b.lastName === lastName);
    }

    expect(matchingBeneficiary, `beneficiary list should include "${firstName} ${lastName}"`).toBeTruthy();

    const beneficiaryAccounts = Array.isArray(matchingBeneficiary?.beneficiaryAccounts)
      ? matchingBeneficiary.beneficiaryAccounts
      : [];
    const matchingIbanAccount = beneficiaryAccounts.find(
      (acct) => String(acct?.bankAccountNumber || '').toUpperCase() === String(iban).toUpperCase(),
    );
    expect(matchingIbanAccount, `beneficiary accounts should reflect the updated IBAN "${iban}"`).toBeTruthy();

    return { listResponse, matchingBeneficiary };
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
   * Fills the UPI banking-details form (India — alternate to IFSC/Bank Deposit).
   * Single field: UPI ID. Recorded via codegen — the form reuses the same
   * account-number input testid as the IFSC channel, with no accessible-name
   * label of its own, so it's targeted by testid rather than role.
   */
  async enterUpiDetails({ upiId }) {
    await this.page.getByTestId('addpayeeaddress-bank-account-number-input').fill(upiId);
    await this.continue();
  }

  /**
   * Confirms the Cash Pickup pickup mobile number (India — alternate to IFSC/UPI/card).
   * This "Enter your mobile number" field auto pre-fills with the contact number just
   * entered on the Add Payee step — confirmed live: its value was already the target
   * number, masked as "+91 98765-43210", before any typing. Typing over it (via .fill()
   * or pressSequentially, with or without clearing first) corrupted the masked value
   * down to a bare "+91" and left Continue disabled, so this only verifies the
   * auto-filled digits match and continues — no typing needed.
   */
  async enterCashPickupDetails({ phone }) {
    const phoneInput = this.page.getByRole('textbox', { name: 'Enter your mobile number' });
    const digitsOnly = String(phone).replace(/\D/g, '');
    const localNumber = digitsOnly.startsWith('91') ? digitsOnly.slice(2) : digitsOnly;

    // Confirmed live: the field briefly auto-fills with the payee's contact number on
    // load, then an app-side effect clears it back down to "+91" about a second later
    // regardless of user action — Continue is disabled even during that brief correct
    // window. Typing before the clear settles just races it and gets wiped, so wait it
    // out first, then type into the now-stable, empty field.
    await expect(phoneInput).toHaveValue('+91', { timeout: 5000 });
    await phoneInput.click();
    await phoneInput.pressSequentially(localNumber, { delay: 80 });
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
   * Fills the Alipay banking-details form (China, user-web only — bu-web has no Alipay
   * channel). Fields: mobile number (no testid — role stays), wallet-provider dropdown,
   * SWIFT code, bank name. Note: phone lives here, not in the payee form (unlike IN/JP).
   * Confirmed live (Aug 2026) that the wallet-provider button/option and the SWIFT/bank-name
   * inputs carry the same addpayeeaddress-* testids already used by enterCnBusinessBankDetails
   * for the other CN channels — using them here too instead of role locators, per that
   * convention. "alipay" is the option's fixed slug (single option, same as UnionPay's
   * fixed "UnionPay" bank-name option).
   */
  async enterAlipayDetails({ phone, swiftCode, bankName }) {
    await this.page.getByRole('textbox', { name: 'Enter your mobile number' }).fill(phone);
    await this.page.getByTestId('addpayeeaddress-bank-code-select').click();
    await this.page.getByTestId('addpayeeaddress-bank-code-select-option-alipay').click();
    await this.page
      .getByTestId('addpayeeaddress-swift-code-input')
      .or(this.fieldByLabel(/SWIFT/i))
      .fill(swiftCode);
    await this.page
      .getByTestId('addpayeeaddress-bank-name-input')
      .or(this.fieldByLabel(/Bank Name/i))
      .fill(bankName);
    await this.continue();
  }

  /**
   * Fills the Bank Deposit banking-details form for China (CNH and CNY both render this
   * same 3-field shape — confirmed via live probe; user-web only, bu-web's equivalent form
   * uses enterCnBusinessBankDetails). Fields: bank name (free text), account number, SWIFT
   * code. Distinct from other countries' "Bank Deposit" channel, which use different field
   * shapes (e.g. sort code for GB, IFSC for IN) — this is CN-specific. Same
   * addpayeeaddress-* testids as enterCnBusinessBankDetails, confirmed live (Aug 2026).
   */
  async enterCnBankDepositDetails({ bankName, accountNumber, swiftCode }) {
    await this.page
      .getByTestId('addpayeeaddress-bank-account-number-input')
      .or(this.fieldByLabel(/Account Number/i))
      .fill(accountNumber);
    await this.page
      .getByTestId('addpayeeaddress-swift-code-input')
      .or(this.fieldByLabel(/SWIFT/i))
      .fill(swiftCode);
    await this.page
      .getByTestId('addpayeeaddress-bank-name-input')
      .or(this.fieldByLabel(/Bank Name/i))
      .fill(bankName);
    await this.continue();
  }

  /**
   * Fills the UnionPay banking-details form (China, CNY only). "Bank name" is a searchable
   * dropdown with a single fixed option ("UnionPay" itself — the payment network, not an
   * actual bank) rather than free text; confirmed via live probe — no search term needed,
   * the one option is visible immediately on open. Fields: bank name (dropdown, fixed to
   * "UnionPay"), card number (reuses the account-number testid), SWIFT code.
   */
  async enterUnionPayDetails({ cardNumber, swiftCode }) {
    await this.page.getByRole('button', { name: 'Enter bank name' }).click();
    await this.page.getByText('UnionPay', { exact: true }).click();
    await this.page.getByTestId('addpayeeaddress-bank-account-number-input').fill(cardNumber);
    await this.page.getByRole('textbox', { name: 'Enter SWIFT code' }).fill(swiftCode);
    await this.continue();
  }

  /**
   * Bu-web China UnionPay payee-details form (testid-based) — confirmed via live
   * recording, Aug 2026. Distinct from addPayee's identity-type handling (role-based
   * "Select beneficiary's identity type" button + "Enter beneficiary's identity number"
   * textbox): this screen's identity-type control is a generic `option-select` testid
   * with options `option-select-option-{slug}`, and the identity number field is
   * `addpayeedetails-id-name-input`.
   *
   * @param {{ firstName: string, lastName: string, addressOne: string, city: string,
   *   identitySlug: 'driver-s-license'|'passport'|'national-id'|'other',
   *   postalCode: string, identityNumber: string }} params
   */
  async addCnUnionPayPayeeByTestId({ firstName, lastName, addressOne, city, identitySlug, postalCode, identityNumber }) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    await this.page.getByTestId('addpayeedetails-first-name-input').fill(firstName);
    await this.page.getByTestId('addpayeedetails-last-name-input').fill(lastName);
    await this.page.getByTestId('addpayeedetails-address-one-input').fill(addressOne);
    await this.page.getByTestId('addpayeedetails-city-input').fill(city);

    await this.page.getByTestId('addpayeedetails-id-type-select').click();
    await this.page.getByTestId(`addpayeedetails-id-type-select-option-${identitySlug}`).click();

    await this.page.getByTestId('addpayeedetails-postal-code-input').fill(postalCode);
    await this.page.getByTestId('addpayeedetails-id-name-input').fill(identityNumber);
    await this.continue();
  }

  /**
   * Bu-web China Bank Deposit payee-details form (testid-based) — confirmed via live
   * recording, Aug 2026. Unlike addCnUnionPayPayeeByTestId, this form has no
   * identity-type step and no state field: just name, address, city, and postal code.
   *
   * @param {{ firstName: string, lastName: string, addressOne: string, city: string,
   *   postalCode: string }} params
   */
  async addCnBankDepositPayeeByTestId({ firstName, lastName, addressOne, city, postalCode }) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    await this.page.getByTestId('addpayeedetails-first-name-input').fill(firstName);
    await this.page.getByTestId('addpayeedetails-last-name-input').fill(lastName);
    await this.page.getByTestId('addpayeedetails-address-one-input').fill(addressOne);
    await this.page.getByTestId('addpayeedetails-city-input').fill(city);
    await this.page.getByTestId('addpayeedetails-postal-code-input').fill(postalCode);
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
   * Bu-web El Salvador BCR Pay banking form (testid-based) — confirmed via live
   * recording, Aug 2026. Single field: DUI (Documento Único de Identidad), entered into
   * the generic account-number testid rather than the role-based "Enter beneficiary's
   * DUI" textbox enterBcrPayDetails targets — distinct method since it's unconfirmed
   * whether both selectors hit the same underlying field.
   *
   * @param {{ dui: string }} params
   */
  async enterSvBcrPayDetailsByTestId({ dui }) {
    await this.page.getByTestId('addpayeeaddress-bank-account-number-input').fill(dui);
    await this.continue();
  }

  /**
   * Bu-web El Salvador Bank Deposit banking form (testid/role-based) — confirmed via
   * live recording, Aug 2026. Fields: bank name, bank code (SWIFT/BIC-format value, no
   * separate SWIFT field), and a mobile number (role-based "Enter your mobile number")
   * in place of a traditional account number — no account-number field renders for this
   * channel.
   *
   * @param {{ bankName: string, bankCode: string, phone: string }} params
   */
  async enterSvBankDepositDetails({ bankName, bankCode, phone }) {
    await this.page.getByTestId('addpayeeaddress-bank-name-input').fill(bankName);
    await this.page.getByTestId('addpayeeaddress-bank-code-input').fill(bankCode);
    await this.page.getByRole('textbox', { name: 'Enter your mobile number' }).fill(phone);
    await this.continue();
  }

  /**
   * Fills the CN Business banking form — account number, SWIFT code, bank name.
   * Unlike the individual CN flow (Alipay), the business flow renders a standard
   * bank-deposit form. testids confirmed via live probe, July 2026.
   * @param {{ accountNumber: string, swiftCode: string, bankName: string }} data
   */
  async enterCnBusinessBankDetails({ accountNumber, swiftCode, bankName }) {
    await this.page
      .getByTestId('addpayeeaddress-bank-account-number-input')
      .or(this.fieldByLabel(/Account Number/i))
      .fill(accountNumber);
    await this.page
      .getByTestId('addpayeeaddress-swift-code-input')
      .or(this.fieldByLabel(/SWIFT/i))
      .fill(swiftCode);
    await this.page
      .getByTestId('addpayeeaddress-bank-name-input')
      .or(this.fieldByLabel(/Bank Name/i))
      .fill(bankName);
    await this.continue();
  }

  /**
   * Bu-web Philippines Bank Deposit payee-details form (testid-based) — confirmed via
   * live recording, Aug 2026. Unlike China's Bank Deposit form (addCnBankDepositPayeeByTestId),
   * there's no city or postal code field: just first name, last name, and address.
   *
   * @param {{ firstName: string, lastName: string, addressOne: string }} params
   */
  async addPhBankDepositPayeeByTestId({ firstName, lastName, addressOne }) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    await this.page.getByTestId('addpayeedetails-first-name-input').fill(firstName);
    await this.page.getByTestId('addpayeedetails-last-name-input').fill(lastName);
    await this.page.getByTestId('addpayeedetails-address-one-input').fill(addressOne);
    await this.continue();
  }

  /**
   * Fills the Philippines Bank Deposit banking form — bank name, bank code, SWIFT code,
   * and account number (testid-based, confirmed via live recording, Aug 2026). Distinct
   * from China's business banking form (enterCnBusinessBankDetails), which has no bank
   * code field.
   *
   * @param {{ bankName: string, bankCode: string, swiftCode: string, accountNumber: string }} data
   */
  async enterPhBankDepositDetails({ bankName, bankCode, swiftCode, accountNumber }) {
    await this.page.getByTestId('addpayeeaddress-bank-name-input').fill(bankName);
    await this.page.getByTestId('addpayeeaddress-bank-code-input').fill(bankCode);
    await this.page.getByTestId('addpayeeaddress-swift-code-input').fill(swiftCode);
    await this.page.getByTestId('addpayeeaddress-bank-account-number-input').fill(accountNumber);
    await this.continue();
  }

  /**
   * Fills the Philippines Mobile Wallet banking form — selects a wallet provider from
   * the bank-code dropdown (testid-based `option-select` pattern, same shape as China's
   * UnionPay identity-type dropdown — see addCnUnionPayPayeeByTestId) then fills the
   * wallet's mobile number, reusing the same account-number testid as Bank Deposit.
   *
   * @param {{ providerSlug: string, walletNumber: string }} data
   */
  async enterPhMobileWalletDetails({ providerSlug, walletNumber }) {
    await this.page.getByTestId('addpayeeaddress-bank-code-select').click();
    await this.page.getByTestId(`addpayeeaddress-bank-code-select-option-${providerSlug}`).click();
    await this.page.getByTestId('addpayeeaddress-bank-account-number-input').fill(walletNumber);
    await this.continue();
  }

  /**
   * Bu-web Vietnam payee-details form (testid-based) — same 3-field shape (name +
   * address, no city/postal) as Philippines' addPhBankDepositPayeeByTestId, shared by
   * both Vietnam's Bank Deposit and Mobile Wallet channels.
   *
   * @param {{ firstName: string, lastName: string, addressOne: string }} params
   */
  async addVnPayeeByTestId({ firstName, lastName, addressOne }) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    await this.page.getByTestId('addpayeedetails-first-name-input').fill(firstName);
    await this.page.getByTestId('addpayeedetails-last-name-input').fill(lastName);
    await this.page.getByTestId('addpayeedetails-address-one-input').fill(addressOne);
    await this.continue();
  }

  /**
   * Fills the Vietnam Bank Deposit banking form — bank name, bank code, account number.
   * Unlike Philippines' Bank Deposit form (enterPhBankDepositDetails), there's no
   * separate SWIFT code field: bank code alone holds the SWIFT/BIC-format value.
   *
   * @param {{ bankName: string, bankCode: string, accountNumber: string }} data
   */
  async enterVnBankDepositDetails({ bankName, bankCode, accountNumber }) {
    await this.page.getByTestId('addpayeeaddress-bank-name-input').fill(bankName);
    await this.page.getByTestId('addpayeeaddress-bank-code-input').fill(bankCode);
    await this.page.getByTestId('addpayeeaddress-bank-account-number-input').fill(accountNumber);
    await this.continue();
  }

  /**
   * Fills the Vietnam Mobile Wallet banking form — a mobile-number field (role-based,
   * unlike Philippines' Mobile Wallet form which has no separate phone step) followed by
   * the wallet-provider dropdown (same testid-based `option-select` pattern as
   * Philippines' enterPhMobileWalletDetails / China's addCnUnionPayPayeeByTestId).
   *
   * @param {{ phone: string, providerSlug: string }} data
   */
  async enterVnMobileWalletDetails({ phone, providerSlug }) {
    await this.page.getByRole('textbox', { name: 'Enter your mobile number' }).fill(phone);
    await this.page.getByTestId('addpayeeaddress-bank-code-select').click();
    await this.page.getByTestId(`addpayeeaddress-bank-code-select-option-${providerSlug}`).click();
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
    } else if (channel === 'upi') {
      await this.enterUpiDetails(bankingDetails);
    } else if (channel === 'cash_pickup') {
      await this.enterCashPickupDetails(bankingDetails);
    } else if (channel === 'swift') {
      await this.enterSwiftDetails(bankingDetails);
    } else if (channel === 'hk_bank') {
      await this.enterHkBankDetails(bankingDetails);
    } else if (channel === 'rtp') {
      await this.enterRtpDetails(bankingDetails);
    } else if (channel === 'alipay') {
      await this.enterAlipayDetails(bankingDetails);
    } else if (channel === 'cn_bank_deposit') {
      await this.enterCnBankDepositDetails(bankingDetails);
    } else if (channel === 'unionpay') {
      await this.enterUnionPayDetails(bankingDetails);
    } else if (channel === 'bcr_pay') {
      await this.enterBcrPayDetails(bankingDetails);
    } else if (channel === 'nz_bank') {
      await this.enterNzBankDetails(bankingDetails);
    } else if (channel === 'cn_business_bank') {
      await this.enterCnBusinessBankDetails(bankingDetails);
    } else if (channel === 'no_fields') {
      // Some destinations render a banking form with no inputs — the enabled
      // Continue alone creates the beneficiary account.
      await this.continue();
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

  /** Asserts the Review Transfer heading is showing and the payee/business name appears on screen. */
  async verifyReviewTransferScreenShowsName(name) {
    await expect(this.page.getByRole('heading')).toContainText('Review Transfer');
    await expect(this.page.locator('#root')).toContainText(name);
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
   *  (e.g. IN) — appears right after the Description field. User-web has no such field,
   *  so fill it only when present. Value must be letters/numbers only (no space or other
   *  separator) — the field rejects punctuation. */
  async fillFxInvoiceNumberIfPresent(invoiceNumber) {
    const field = this.page.getByRole('textbox', { name: 'Invoice Number' });
    if (await field.isVisible({ timeout: 3000 }).catch(() => false)) {
      const value = invoiceNumber || `INV${Math.floor(Math.random() * 1e9)}`;
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

  /**
   * Tolerant post-confirmation check. After a confirmed FX payment the app shows EITHER
   * "Processing Transaction" (wallet had enough balance) OR "Ways To Fund" (balance low —
   * the app asks for a funding source). Both prove the payment was accepted; the
   * paymentIdentifier returned by the payment POST is the definitive "initiated" check.
   * A freshly-onboarded user has a small balance, so later FX sends land on Ways To Fund.
   */
  async verifyProcessingOrWaysToFundAndDismiss({ timeout = 15000 } = {}) {
    const processingHeading = this.page.getByRole('heading', { name: 'Processing Transaction' });
    const waysToFundHeading = this.page.getByRole('heading', { name: 'Ways To Fund' });
    await expect(
      processingHeading.or(waysToFundHeading),
      'Expected either Processing Transaction modal or Ways To Fund funding screen',
    ).toBeVisible({ timeout });
    const landedOnProcessing = await processingHeading.isVisible({ timeout: 1000 }).catch(() => false);
    if (landedOnProcessing) {
      await this.verifyProcessingAndDismiss();
    }
    // Ways To Fund doesn't return to the dashboard, so callers should skip any
    // subsequent dashboard-only checks (e.g. verifyTransactionOnDashboard) when false.
    return { landedOnProcessing };
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

  /**
   * Verifies the new FX transaction appears in the dashboard's "Account Transactions"
   * widget on user-web — a card-based panel (no <table>), unlike the BCR surface that
   * verifyTransactionInList targets. Confirmed via live run: rows render as
   * "To {firstName}: ₹{localAmount}" / "- {amount}" paragraphs, not table rows.
   *
   * @param {string} firstName  - Beneficiary first name
   * @param {string} amount     - Sent amount, e.g. '$50.00'
   */
  async verifyTransactionOnDashboard(firstName, amount) {
    await expect(this.page.locator('#root')).toContainText(`To ${firstName}:`);
    await expect(this.page.locator('#root')).toContainText(`- ${amount}`);
  }

  /**
   * Navigate to the Bivo (funding) account and capture the initial
   * transactions API response. Call after the success/Ways-To-Fund modal has
   * already been dismissed (e.g. via verifyProcessingOrWaysToFundAndDismiss).
   *
   * accountsNav toggles the sidebar's Accounts submenu open/closed rather than just
   * opening it — calling this method a second time in the same test (e.g. a second
   * transaction's ledger check, after the submenu was already left expanded by the
   * first) would otherwise collapse it and hide the account link. Only click it when
   * the target link isn't already visible.
   */
  async navigateToBivoAccountAndCaptureTransactions({ bivoLast4, bivoAccountNumber }) {
    const transactionsPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/transactions/v1/transactions') &&
        r.url().includes(String(bivoAccountNumber)) &&
        r.request().method() === 'GET' &&
        r.ok(),
      { timeout: 30000 },
    );

    const accountLink = this.page.getByTestId(`sidebar-account-${bivoLast4}`);
    if (!(await accountLink.isVisible({ timeout: 2000 }).catch(() => false))) {
      await this.accountsNav.click();
    }
    await accountLink.click();

    const response = await transactionsPromise;
    const body     = await response.json();
    return {
      transactionsResponse: response,
      transactionsBody:     body,
      transactions:         extractTransactions(body),
    };
  }

  /**
   * Scan pages 0–4 of Bivo's ledger for the DEBIT transaction matching
   * correlationId === paymentIdentifier. Returns the transaction row or null.
   */
  async findFxDebitTransactionAcrossPages({ bivoAccountNumber, paymentIdentifier }) {
    const headers = await this._getAuthHeaders();
    if (!headers) return null;

    const host = process.env.HOST || 'https://api-sandbox.bivotech.co';

    for (let pg = 0; pg < 5; pg++) {
      const url = `${host}/transactions/v1/transactions?accountId=${bivoAccountNumber}&page=${pg}&size=50`;
      const res = await this.page.request.get(url, { headers });
      if (!res.ok()) break;

      const txns = extractTransactions(await res.json());
      if (!txns.length) break;

      const tx = txns.find((t) => t.correlationId === paymentIdentifier);
      if (tx) return tx;
    }
    return null;
  }

  /**
   * Assert the DEBIT transaction on the Bivo account that corresponds to the
   * FX send. Matches by correlationId = paymentIdentifier (the international
   * payment POST's response field — see confirmFxTransactionAndCaptureInternationalPaymentApi).
   */
  async assertFxDebitTransaction({ initialTransactions, bivoAccountNumber, paymentIdentifier, amountUsd, currencyCode = 'USD' }) {
    let tx = initialTransactions.find((t) => t.correlationId === paymentIdentifier);

    if (!tx) {
      console.log('[fx-transaction] transaction not on page 0 — scanning further pages by correlationId');
      tx = await this.findFxDebitTransactionAcrossPages({ bivoAccountNumber, paymentIdentifier });
    }

    expect(
      tx,
      `DEBIT transaction with correlationId "${paymentIdentifier}" should appear in the Bivo account ledger`,
    ).toBeTruthy();

    expect(Number(tx.amount), `DEBIT amount should match sent ${currencyCode} amount`).toBeCloseTo(Number(amountUsd), 2);
    expect(tx.transactionCode, 'FX send should DEBIT the funding account').toBe('DEBIT');
    expect(['PENDING', 'CONFIRMED']).toContain(tx.status);
    expect(tx.currencyCode, `transaction currency should be ${currencyCode}`).toBe(currencyCode);
  }
}

module.exports = FxTransactionPage;
