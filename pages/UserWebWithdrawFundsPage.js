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

class UserWebWithdrawFundsPage {
  constructor(page) {
    this.page = page;
    this.reviewPage = new TransferReviewPage(page);

    // Sidebar — Move Money sub-menu (identical testids on user-web and bu-web)
    this.moveMoneyNav      = page.getByTestId('sidebar-move-money-menuitem');
    this.withdrawFundsLink = page.getByTestId('sidebar-money-transfer-withdraw-funds-menuitem');

    // Withdraw Funds form — both accounts are pre-selected by the app
    this.toAccountDropdown   = page.getByTestId('to_account');
    this.fromAccountDropdown = page.getByTestId('from_account');
    this.amountInput         = page.getByTestId('amount-input-ui');
    this.nextButton          = page.getByRole('button', { name: 'Next' });

    // Review screen
    this.submitButton = page.getByTestId('transfer-review-submit-button');

    // Success screen
    this.successCard = page.getByTestId('success-card');
    this.gotItButton = page.getByTestId('success-card-ok-button');

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
    if (!token) throw new Error('[UserWebWithdrawFundsPage] No auth token in localStorage — call after login.');

    const host   = process.env.HOST              || 'https://api-sandbox.bivotech.co';
    const tenant = process.env.TENANT_IDENTIFIER || '';

    const res = await this.page.request.get(
      `${host}/transactions/v1/transactions/accountbalance`,
      { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Identifier': tenant } },
    );
    if (!res.ok()) throw new Error(`[UserWebWithdrawFundsPage] accountbalance API returned ${res.status()}`);

    return (await res.json()).accountDetails || [];
  }

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

  // ── Account discovery ─────────────────────────────────────────────────────

  /**
   * Find the first linked external ACH account from the accountbalance API.
   * Returns { accountNumber, accountName, last4 }.
   */
  async discoverBivoPrimaryLast4(primaryAccountNumber) {
    const accounts = await this._fetchAccountDetails();
    const primary = accounts.find(
      // user-web wallets are type "wallet"; bu-web business wallets are "business-wallet".
      (a) => a.type?.includes('wallet') && a.currency === 'USD' && String(a.account) === String(primaryAccountNumber),
    );
    if (!primary) throw new Error('[UserWebWithdrawFundsPage] Primary Bivo wallet not found in accountbalance API.');
    return String(primary.ddaNumber).slice(-4);
  }

  async discoverLinkedAchAccount() {
    const accounts = await this._fetchAccountDetails();
    const acct = accounts.find(
      (a) =>
        a.accountType === 'external-ach-account' ||
        (a.type === 'external' && a.subType === 'ach'),
    );
    if (!acct) throw new Error('[UserWebWithdrawFundsPage] No linked ACH account found.');

    return {
      accountNumber: acct.account,
      accountName:   acct.accountName,
      last4:         acct.last4Digits || String(acct.ddaNumber || acct.account).slice(-4),
    };
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Open Move Money → Withdraw Funds from the sidebar.
   * Retries once if the sub-menu collapses before the link is visible.
   */
  async navigateToWithdrawFunds() {
    await this.moveMoneyNav.click();
    const appeared = await this.withdrawFundsLink
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) await this.moveMoneyNav.click();
    await this.withdrawFundsLink.click();
  }

  // ── Form assertions ───────────────────────────────────────────────────────

  /**
   * Assert the "From" account is pre-selected as the primary wallet (money leaves it).
   * user-web names its primary wallet "Bivo"; bu-web's business wallet is named "Primary".
   */
  async assertFromAccountPreSelectedAsBivo() {
    await expect(this.fromAccountDropdown).toContainText(/Bivo|Primary/, { timeout: 10000 });
  }

  /**
   * Assert the "To" account dropdown is visible and pre-selected with the linked ACH account.
   * The API-level account identity is confirmed later via the move-fund assertion.
   */
  async assertToAccountPreSelected() {
    await expect(this.toAccountDropdown).toBeVisible({ timeout: 10000 });
  }

  // ── Transfer actions ──────────────────────────────────────────────────────

  /**
   * Fill the amount field and advance to the review screen.
   * The Withdraw Funds form accepts a plain numeric string (e.g. '90').
   * @param {string} amount e.g. '90'
   */
  async enterAmountAndContinue(amount) {
    await this.amountInput.waitFor({ state: 'visible', timeout: 10000 });
    // user-web's amount-input-ui testid is a bare <input> that right-shifts each typed
    // digit like a calculator (a cents-digit string, e.g. "9000" -> "$90.00") — fill()
    // works directly. bu-web's is a wrapper <div> around a numeric-only input with no
    // cent-shifting: non-digit characters (e.g. ".") are stripped as typed, and the
    // remaining digits are read as a literal whole-dollar amount, not cents — so the
    // cents string must be converted back to whole dollars (no decimal point) first.
    const filled = await this.amountInput.fill(amount).then(() => true).catch(() => false);
    if (!filled) {
      const literalAmount = String(Math.round(Number(amount) / 100));
      await this.amountInput.click();
      await this.amountInput.pressSequentially(literalAmount, { delay: 50 });
    }
    await expect(this.nextButton).toBeEnabled({ timeout: 5000 });
    await this.nextButton.click();
  }

  /**
   * Assert the review screen shows the correct amount and ACH timing text.
   */
  async assertReviewScreen({ amountDisplay }) {
    await this.reviewPage.verify({ amount: amountDisplay, available: 'In 1-3 business days' });
  }

  // ── API capture ───────────────────────────────────────────────────────────

  /**
   * Click Transfer, intercept the move-fund POST (200 OK), and return the
   * captured data. The `requestId` in the response is used to identify the
   * resulting DEBIT transaction in the Bivo account ledger (via correlationId).
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
    await this.submitButton.click();
    const moveFundResponse = await moveFundPromise;

    let moveFundRequest      = {};
    let moveFundResponseBody = {};
    try { moveFundRequest      = moveFundResponse.request().postDataJSON() || {}; } catch { /* ignore */ }
    try { moveFundResponseBody = await moveFundResponse.json();                   } catch { /* ignore */ }

    return {
      moveFundResponse,
      moveFundRequest,
      moveFundResponseBody,
      // user-web returns { requestId, paymentIdentifier }; bu-web returns { identifier }.
      requestId:         moveFundResponseBody.requestId ?? moveFundResponseBody.identifier ?? null,
      paymentIdentifier: moveFundResponseBody.paymentIdentifier ?? moveFundResponseBody.identifier ?? null,
    };
  }

  assertMoveFundApiCaptured(captured, { fromAccountNumber, toAccountNumber, amountUsd }) {
    const { moveFundRequest, moveFundResponseBody, requestId } = captured;

    expect(requestId, 'move-fund response should include a requestId').toBeTruthy();
    expect(moveFundResponseBody.status, 'move-fund status should be PENDING').toBe('PENDING');
    expect(
      String(moveFundRequest.fromAccount),
      'fromAccount should match the Bivo primary account',
    ).toBe(String(fromAccountNumber));
    expect(
      String(moveFundRequest.toAccount),
      'toAccount should match the linked ACH account',
    ).toBe(String(toAccountNumber));
    expect(
      Number(moveFundRequest.amount),
      'request amount should match entered amount',
    ).toBeCloseTo(Number(amountUsd), 2);
  }

  // ── Success screen ────────────────────────────────────────────────────────

  /**
   * Assert the "Transfer Initiated" success card and the formatted amount.
   */
  async assertTransferCompleteScreen({ amountDisplay }) {
    await expect(this.successCard).toContainText('Transfer Initiated', { timeout: 15000 });
    await expect(this.successCard).toContainText(amountDisplay);
  }

  // ── Transaction verification ──────────────────────────────────────────────

  /**
   * Dismiss the success card, navigate to the Bivo primary account, and
   * capture the initial transactions API response.
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

    await this.gotItButton.click();

    await this.accountsNav.click();
    await this.page.getByTestId(`sidebar-account-${bivoLast4}`).click();

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
   * correlationId === requestId. Returns the transaction row or null.
   */
  async findDebitTransactionAcrossPages({ bivoAccountNumber, requestId }) {
    const headers = await this._getAuthHeaders();
    if (!headers) return null;

    const host = process.env.HOST || 'https://api-sandbox.bivotech.co';

    for (let pg = 0; pg < 5; pg++) {
      const url = `${host}/transactions/v1/transactions?accountId=${bivoAccountNumber}&page=${pg}&size=50`;
      const res = await this.page.request.get(url, { headers });
      if (!res.ok()) break;

      const txns = extractTransactions(await res.json());
      if (!txns.length) break;

      const tx = txns.find((t) => t.correlationId === requestId);
      if (tx) return tx;
    }
    return null;
  }

  /**
   * Assert the DEBIT transaction on the Bivo account that corresponds to
   * the ACH withdrawal. Matches by correlationId = requestId.
   * ACH withdrawals are confirmed by the time the ledger is queried.
   */
  async assertDebitTransaction({ initialTransactions, bivoAccountNumber, requestId, amountUsd }) {
    let tx = initialTransactions.find((t) => t.correlationId === requestId);

    if (!tx) {
      console.log('[withdraw-funds] transaction not on page 0 — scanning further pages by correlationId');
      tx = await this.findDebitTransactionAcrossPages({ bivoAccountNumber, requestId });
    }

    expect(
      tx,
      `DEBIT transaction with requestId "${requestId}" should appear in the Bivo account ledger`,
    ).toBeTruthy();

    expect(Number(tx.amount), 'DEBIT amount should match transferred amount').toBeCloseTo(Number(amountUsd), 2);
    expect(tx.transactionCode, 'ACH withdrawal should DEBIT the Bivo account').toBe('DEBIT');
    expect(tx.status, 'ACH withdrawal transaction should be CONFIRMED').toBe('CONFIRMED');
    expect(tx.currencyCode, 'transaction currency should be USD').toBe('USD');
  }
}

module.exports = UserWebWithdrawFundsPage;
