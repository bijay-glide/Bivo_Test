const { expect } = require('@playwright/test');
const TransferReviewPage = require('./TransferReviewPage');

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

class UserWebInternalTransferPage {
  constructor(page) {
    this.page = page;
    this.reviewPage = new TransferReviewPage(page);

    // Sidebar — Move Money sub-menu (identical testids on user-web and bu-web)
    this.moveMoneynav         = page.getByTestId('sidebar-move-money-menuitem');
    this.internalTransferLink = page.getByTestId('sidebar-money-transfer-add-funds-menuitem');

    // Transfer form
    this.fromAccountDropdown = page.getByTestId('from_account');
    this.toAccountDropdown   = page.getByTestId('to_account');
    this.amountInput         = page.getByTestId('amount-input-ui');
    this.nextButton          = page.getByRole('button', { name: 'Next' });
    this.transferButton      = page.getByRole('button', { name: 'Transfer' });
    this.gotItButton         = page.getByRole('button', { name: 'Got it' });

    // Sidebar — Accounts section (same testid on both surfaces).
    this.accountsNav = page.getByTestId('sidebar-accounts-menuitem');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _fetchAccountDetails() {
    const token = await this.page.evaluate(() => {
      try {
        const root = JSON.parse(localStorage.getItem('persist:root') || '{}');
        const auth = JSON.parse(root.authentication || '{}');
        return auth.loginData?.accessToken || null;
      } catch { return null; }
    });
    if (!token) throw new Error('[UserWebInternalTransferPage] No auth token in localStorage — call after login.');

    const host   = process.env.HOST              || 'https://api-sandbox.bivotech.co';
    const tenant = process.env.TENANT_IDENTIFIER || '';

    const res = await this.page.request.get(
      `${host}/transactions/v1/transactions/accountbalance`,
      { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Identifier': tenant } },
    );
    if (!res.ok()) throw new Error(`[UserWebInternalTransferPage] accountbalance API returned ${res.status()}`);

    const body = await res.json();
    return body.accountDetails || [];
  }

  // ── Account discovery ─────────────────────────────────────────────────────

  /**
   * Find the secondary USD fiat wallet — any wallet account with currency=USD
   * whose account number is NOT the primary Bivo account.
   * Excludes by account number (authoritative) rather than by name.
   *
   * @param {string} primaryAccountNumber  bivo_account_number from the login result
   * Returns { accountNumber, accountName, last4 }.
   */
  async discoverSecondaryUsdWallet(primaryAccountNumber) {
    const accounts = await this._fetchAccountDetails();
    const account  = accounts.find(
      // user-web wallets are type "wallet"; bu-web business wallets are "business-wallet".
      (a) =>
        a.type?.includes('wallet') &&
        a.currency === 'USD' &&
        String(a.account) !== String(primaryAccountNumber),
    );
    if (!account) throw new Error('[UserWebInternalTransferPage] No secondary USD wallet found.');
    return {
      accountNumber: account.account,
      accountName:   account.accountName,
      last4:         String(account.ddaNumber).slice(-4),
    };
  }

  /**
   * Find two distinct USD wallet accounts to use as the From/To legs of an internal
   * transfer. Unlike discoverSecondaryUsdWallet, this doesn't assume which one is
   * "primary" — for shared/reused test accounts with several renamed USD wallets, the
   * FE's default "From" preselection isn't stable, so both legs get explicitly selected
   * via the dropdowns instead of relying on whichever one loads in by default.
   * Returns [{ accountNumber, accountName, last4 }, { accountNumber, accountName, last4 }].
   */
  async discoverTwoUsdWallets() {
    const accounts   = await this._fetchAccountDetails();
    const usdWallets = accounts
      // user-web wallets are type "wallet"; bu-web business wallets are "business-wallet".
      .filter((a) => a.type?.includes('wallet') && a.currency === 'USD')
      .map((a) => ({
        accountNumber: a.account,
        accountName:   a.accountName,
        last4:         String(a.ddaNumber).slice(-4),
      }));
    if (usdWallets.length < 2) {
      throw new Error('[UserWebInternalTransferPage] Need at least two USD wallet accounts for an internal transfer.');
    }
    return usdWallets;
  }

  /**
   * Read the currently preselected "From" account's display name straight off the
   * dropdown button (e.g. "The USD Vault I$466,767.02" → "The USD Vault I").
   *
   * The FE preselects whatever wallet is "active" for the logged-in user — for a
   * freshly onboarded user that's the literal "Bivo" wallet, but shared/reused test
   * accounts with multiple renamed wallets can preselect a different one each login.
   * Reading it live avoids guessing which wallet the FE will pick.
   */
  async getFromAccountLabel() {
    // The button briefly shows a generic placeholder (e.g. "Primary Account") before
    // the wallet data loads in — wait for the real label, which always has a balance
    // ("$…") appended, before reading it.
    await expect(this.fromAccountDropdown).toContainText('$', { timeout: 10000 });
    const text = (await this.fromAccountDropdown.textContent()) || '';
    return text.split('$')[0].trim();
  }

  /**
   * Find the first non-USD fiat wallet (type=wallet, currency≠'USD').
   * Used to test cross-currency transfer rejection.
   * Returns { accountNumber, accountName, currency, last4 }.
   */
  async discoverNonUsdFiatWallet() {
    const accounts = await this._fetchAccountDetails();
    const account  = accounts.find(
      // user-web wallets are type "wallet"; bu-web business wallets are "business-wallet".
      (a) => a.type?.includes('wallet') && a.currency !== 'USD',
    );
    if (!account) throw new Error('[UserWebInternalTransferPage] No non-USD fiat wallet found.');
    return {
      accountNumber: account.account,
      accountName:   account.accountName,
      currency:      account.currency,
      last4:         String(account.ddaNumber).slice(-4),
    };
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Open Move Money → Internal Transfer from the sidebar.
   * Retries once if the sub-menu collapses before the link is visible.
   */
  async navigateToInternalTransfer() {
    await this.moveMoneynav.click();
    const appeared = await this.internalTransferLink
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) await this.moveMoneynav.click();
    await this.internalTransferLink.click();
  }

  // ── Dropdown assertions ───────────────────────────────────────────────────

  /**
   * Open the "From" dropdown, assert it contains the primary wallet's name, then close it.
   * Verifies the primary wallet is the sender option.
   * @param {string} [expectedName='Bivo'] display name of the primary wallet —
   *   pass the result of discoverPrimaryWalletName() for accounts that have been renamed.
   */
  async assertFromAccountDropdownContainsBivo(expectedName = 'Bivo') {
    // The from_account is pre-selected as the primary wallet — assert the label text
    // without opening the dropdown (opening it renders both dropdowns' options in the
    // DOM simultaneously, causing strict-mode violations on broad text matchers).
    await expect(this.fromAccountDropdown).toContainText(expectedName, { timeout: 5000 });
  }

  /**
   * Open the "To" dropdown, verify a known non-USD fiat wallet IS listed and
   * that stablecoin (coin-type) accounts are NOT listed, then close it.
   *
   * Only fiat wallet accounts appear as internal transfer recipients;
   * coin/stablecoin and external accounts are excluded by the FE.
   *
   * @param {{ nonUsdLast4: string }} opts last4 of a known non-USD fiat wallet ddaNumber
   */
  async assertToAccountDropdownShowsOnlyFiatWallets({ nonUsdLast4 }) {
    const fiatWalletTestId = `to-account-internal-${nonUsdLast4}`;

    // A fiat account created moments earlier (e.g. by spec 9.2) can lag behind this
    // dropdown's data source by a few seconds — retry with a reload rather than
    // failing on the first miss (same pattern as MoveFundsPage's transaction retry).
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.toAccountDropdown.click();
      const appeared = await this.page.getByTestId(fiatWalletTestId)
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (appeared) break;
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(4000);
      await this.page.reload();
      await this.navigateToInternalTransfer();
    }

    // Fiat wallet should be present
    await expect(this.page.getByTestId(fiatWalletTestId)).toBeVisible({ timeout: 5000 });
    // Coin/stablecoin accounts must not appear (e.g. "USDC" in the account name)
    await expect(
      this.page.getByText('USDC', { exact: false }),
    ).not.toBeVisible();
    await this.page.keyboard.press('Escape');
  }

  /**
   * Open the "To" dropdown and assert it lists every USD wallet account (primary +
   * any secondary USD wallets) and NONE of the non-USD accounts (multicurrency
   * fiat or stablecoin) — derived from the live account list, not a single known ID.
   */
  async assertToAccountDropdownShowsOnlyUsdWallets() {
    const accounts = await this._fetchAccountDetails();
    const usdLast4s = accounts
      // user-web wallets are type "wallet"; bu-web business wallets are "business-wallet".
      .filter((a) => a.type?.includes('wallet') && a.currency === 'USD')
      .map((a) => String(a.ddaNumber).slice(-4));
    const nonUsdLast4s = accounts
      .filter((a) => a.currency !== 'USD')
      .map((a) => String(a.ddaNumber).slice(-4));

    if (usdLast4s.length === 0) {
      throw new Error('[UserWebInternalTransferPage] No USD wallet accounts found.');
    }

    const allUsdWalletsVisible = async () => {
      const results = await Promise.all(
        usdLast4s.map((last4) =>
          this.page.getByTestId(`to-account-internal-${last4}`)
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false),
        ),
      );
      return results.every(Boolean);
    };

    await this.toAccountDropdown.click();

    // A USD wallet created moments earlier (e.g. by spec 9.1) can lag behind this
    // dropdown's data source by a few seconds — retry with a reload rather than
    // failing on the first miss (same pattern as MoveFundsPage's transaction retry).
    for (let attempt = 0; attempt < 2 && !(await allUsdWalletsVisible()); attempt++) {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(4000);
      await this.page.reload();
      await this.navigateToInternalTransfer();
      await this.toAccountDropdown.click();
    }

    for (const last4 of usdLast4s) {
      await expect(
        this.page.getByTestId(`to-account-internal-${last4}`),
        `USD wallet ending ${last4} should be listed in the To-account dropdown`,
      ).toBeVisible({ timeout: 5000 });
    }
    for (const last4 of nonUsdLast4s) {
      await expect(
        this.page.getByTestId(`to-account-internal-${last4}`),
        `non-USD account ending ${last4} should NOT be listed in the To-account dropdown`,
      ).not.toBeVisible();
    }
    await this.page.keyboard.press('Escape');
  }

  // ── Transfer actions ──────────────────────────────────────────────────────

  /**
   * Open the "From account" dropdown and select the account whose testid
   * ends with the given last4 digits of the ddaNumber.
   * @param {string} last4 e.g. '6077'
   */
  async selectFromAccount(last4) {
    await this.fromAccountDropdown.click();
    await this.page.getByTestId(`from-account-internal-${last4}`).click();
  }

  /**
   * Open the "To account" dropdown and select the account whose testid
   * ends with the given last4 digits of the ddaNumber.
   * @param {string} last4 e.g. '0904'
   */
  async selectToAccount(last4) {
    await this.toAccountDropdown.click();
    await this.page.getByTestId(`to-account-internal-${last4}`).click();
  }

  /**
   * Type the amount (cents-formatted digit string) and advance to the review screen.
   * @param {string} amountInput result of toCentsInput(), e.g. '9000' for $90.00
   */
  async enterAmountAndContinue(amountInput) {
    await this.amountInput.click({ clickCount: 3 });
    await this.amountInput.pressSequentially(amountInput, { delay: 50 });
    await expect(this.nextButton).toBeEnabled({ timeout: 5000 });
    await this.nextButton.click();
  }

  /**
   * Assert the review screen contains the from/to names and formatted amount.
   */
  async assertReviewScreen({ fromName, toName, amountDisplay }) {
    // Wait on the Transfer button — it only appears on the review screen (form has "Next").
    // Uses 60s because the app makes an async validation call before rendering the review.
    await expect(this.transferButton).toBeVisible({ timeout: 60000 });
    await this.reviewPage.verify({ from: fromName, to: toName, amount: amountDisplay });
  }

  // ── API capture — success ─────────────────────────────────────────────────

  /**
   * Click Transfer, intercept the move-fund POST (200 OK), and return the
   * captured request/response data for assertion.
   */
  async submitAndCaptureMoveFundApi() {
    const moveFundPromise = this.page.waitForResponse(
      (r) =>
        // user-web posts to /user/v1/..., bu-web to /business/v1/...
        r.url().includes('/transaction/move-fund') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 30000 },
    );
    await this.transferButton.click();
    const moveFundResponse = await moveFundPromise;

    let moveFundRequest     = {};
    let moveFundResponseBody = {};
    try { moveFundRequest      = moveFundResponse.request().postDataJSON() || {}; } catch { /* ignore */ }
    try { moveFundResponseBody = await moveFundResponse.json();               } catch { /* ignore */ }

    const paymentIdentifier =
      moveFundResponseBody.paymentIdentifier ??
      moveFundResponseBody.identifier         ??
      moveFundResponseBody.correlationId      ??
      null;

    return { moveFundResponse, moveFundRequest, moveFundResponseBody, paymentIdentifier };
  }

  assertMoveFundApiCaptured(captured, { fromAccountNumber, toAccountNumber, amountUsd }) {
    const { moveFundRequest, moveFundResponseBody, paymentIdentifier } = captured;

    expect(paymentIdentifier, 'move-fund response should include a paymentIdentifier').toBeTruthy();
    expect(moveFundResponseBody.status, 'move-fund status should be PENDING').toBe('PENDING');
    expect(
      String(moveFundRequest.fromAccount),
      'fromAccount should match primary Bivo account',
    ).toBe(String(fromAccountNumber));
    expect(
      String(moveFundRequest.toAccount),
      'toAccount should match secondary USD wallet',
    ).toBe(String(toAccountNumber));
    expect(
      Number(moveFundRequest.amount),
      'request amount should match entered amount',
    ).toBeCloseTo(Number(amountUsd), 2);
    expect(moveFundRequest.type, 'transfer type should be INTERNAL').toBe('INTERNAL');
  }

  // ── API capture — error ───────────────────────────────────────────────────

  /**
   * Click Transfer, intercept the move-fund POST regardless of HTTP status,
   * and return the response body. Used to capture expected 400 errors.
   */
  async submitAndCaptureTransferErrorApi() {
    const errorPromise = this.page.waitForResponse(
      (r) =>
        // user-web posts to /user/v1/..., bu-web to /business/v1/...
        r.url().includes('/transaction/move-fund') &&
        r.request().method() === 'POST',
      { timeout: 30000 },
    );
    await this.transferButton.click();
    const errorResponse = await errorPromise;

    let errorBody = {};
    try { errorBody = await errorResponse.json(); } catch { /* ignore */ }
    return errorBody;
  }

  assertCrossAccountApiError(errorBody) {
    expect(
      errorBody.errorCode,
      'error code should be 101300103 (cross-currency internal transfer)',
    ).toBe('101300103');
    expect(errorBody.statusCode, 'HTTP status code should be 400').toBe(400);
    expect(
      errorBody.userMessage,
      'user message should indicate same-currency requirement',
    ).toContain('Please use same currency account to initiate internal account transfer.');
  }

  async assertCrossAccountTransferUiError() {
    await expect(
      this.page.getByRole('paragraph'),
    ).toContainText(
      'Please use same currency account to initiate internal account transfer.',
      { timeout: 10000 },
    );
  }

  // ── Success screen + post-transfer navigation ─────────────────────────────

  /**
   * Assert the "Transfer Complete" success screen.
   */
  async assertTransferCompleteScreen({ toAccountName, amountDisplay }) {
    const root = this.page.locator('#root');
    await expect(root).toContainText('Transfer Complete', { timeout: 15000 });
    await expect(root).toContainText(
      `${amountDisplay} has been transferred to your ${toAccountName} account.`,
    );
    await expect(this.gotItButton).toBeVisible();
  }

  /**
   * Dismiss the success screen, navigate to the secondary account in the
   * sidebar, and capture the transactions API response for that account.
   *
   * The waitForResponse is armed BEFORE navigation so it catches the API
   * call triggered by opening the account detail view.
   */
  async navigateToAccountAndCaptureTransactions({ last4, accountNumber }) {
    const transactionsPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/transactions/v1/transactions') &&
        r.url().includes(String(accountNumber)) &&
        r.request().method() === 'GET' &&
        r.ok(),
      { timeout: 30000 },
    );

    await this.gotItButton.click();
    await this.accountsNav.click();
    await this.page.getByTestId(`sidebar-account-${last4}`).click();

    const response = await transactionsPromise;
    const body     = await response.json();
    return {
      transactionsResponse: response,
      transactionsBody:     body,
      transactions:         extractTransactions(body),
    };
  }

  /**
   * Assert the CREDIT transaction on the secondary (recipient) account.
   * Matches by paymentIdentifier → transactionId, falls back to the first row.
   */
  assertCreditTransaction({ transactions, paymentIdentifier, amountUsd }) {
    expect(
      transactions.length,
      'transactions API should return at least one row for the secondary account',
    ).toBeGreaterThan(0);

    const tx =
      transactions.find((t) =>
        [t.transactionId, t.correlationId, t.paymentIdentifier].some(
          (v) => v && v === paymentIdentifier,
        ),
      ) || transactions[0];

    expect(
      tx,
      `transaction matching paymentIdentifier ${paymentIdentifier} should exist`,
    ).toBeTruthy();
    expect(Number(tx.amount), 'transaction amount should match transferred amount').toBeCloseTo(Number(amountUsd), 2);
    expect(['PENDING', 'CONFIRMED']).toContain(tx.status);
    expect(tx.transactionCode, 'internal deposit to secondary account should be a CREDIT').toBe('CREDIT');
    expect(tx.currencyCode, 'transaction currency should be USD').toBe('USD');
  }
}

module.exports = UserWebInternalTransferPage;
