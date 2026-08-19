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

class UserWebCardFundsPage {
  constructor(page) {
    this.page = page;
    this.reviewPage = new TransferReviewPage(page);

    // Sidebar — Move Money sub-menu (identical testids on user-web and bu-web)
    this.moveMoneyNav = page.getByTestId('sidebar-move-money-menuitem');
    this.addFundsLink = page.getByTestId('sidebar-money-transfer-add-fund-menuitem');

    // Add Funds page — Card tab
    this.cardTab = page.getByTestId('tab_card');

    // Transfer form
    this.fromAccountDropdown = page.getByTestId('from_account');
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
    if (!token) throw new Error('[UserWebCardFundsPage] No auth token in localStorage — call after login.');

    const host   = process.env.HOST              || 'https://api-sandbox.bivotech.co';
    const tenant = process.env.TENANT_IDENTIFIER || '';

    const res = await this.page.request.get(
      `${host}/transactions/v1/transactions/accountbalance`,
      { headers: { Authorization: `Bearer ${token}`, 'X-Tenant-Identifier': tenant } },
    );
    if (!res.ok()) throw new Error(`[UserWebCardFundsPage] accountbalance API returned ${res.status()}`);

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
   * Find the linked external-card account from the accountbalance API.
   * Returns { accountNumber, accountName, last4 } where last4 is the card's
   * last 4 digits (last4Digits field) — used to build the `card-account-{last4}` testid.
   */
  async discoverBivoPrimaryLast4(primaryAccountNumber) {
    const accounts = await this._fetchAccountDetails();
    const primary = accounts.find(
      // user-web wallets are type "wallet"; bu-web business wallets are "business-wallet".
      (a) => a.type?.includes('wallet') && a.currency === 'USD' && String(a.account) === String(primaryAccountNumber),
    );
    if (!primary) throw new Error('[UserWebCardFundsPage] Primary Bivo wallet not found in accountbalance API.');
    return String(primary.ddaNumber).slice(-4);
  }

  async discoverLinkedCardAccount() {
    const accounts = await this._fetchAccountDetails();
    const card = accounts.find(
      (a) => a.accountType === 'external-card' || (a.type === 'external' && a.subType === 'card'),
    );
    if (!card) throw new Error('[UserWebCardFundsPage] No linked card account found — link a card first (spec 4).');

    return {
      accountNumber: card.account,
      accountName:   card.accountName,
      last4:         card.last4Digits || String(card.account).slice(-4),
    };
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Open Move Money → Add Funds, then switch to the Card tab.
   * Retries once if the sub-menu collapses before the link is visible.
   */
  async navigateToAddFundsCardTab() {
    await this.moveMoneyNav.click();
    const appeared = await this.addFundsLink
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) await this.moveMoneyNav.click();
    await this.addFundsLink.click();
    await this.cardTab.waitFor({ state: 'visible', timeout: 10000 });
    await this.cardTab.click();
  }

  // ── Transfer actions ──────────────────────────────────────────────────────

  /**
   * Open the "From" dropdown and select the card account whose testid ends
   * with the given last4 (last 4 digits of the card number).
   * @param {string} cardLast4 e.g. '0125'
   */
  async selectCardFromAccount(cardLast4) {
    await this.fromAccountDropdown.click();
    const cardOptions = this.page.getByTestId(`card-account-${cardLast4}`);
    const count = await cardOptions.count();
    if (count > 1) {
      await cardOptions.first().click();
    } else {
      await cardOptions.click();
    }
  }

  /**
   * Fill the amount field and advance to the review screen.
   * The Add Funds card tab accepts a formatted dollar string (e.g. '$90.00')
   * directly — no pressSequentially / toCentsInput needed for this flow.
   * @param {string} amount e.g. '$90.00'
   */
  async enterAmountAndContinue(amount) {
    await this.amountInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.amountInput.fill(amount);
    await this.nextButton.click();
  }

  /**
   * Assert the review screen shows the expected amount, source card, destination
   * Bivo account, and "Instantly" settlement label.
   */
  async assertReviewScreen({ amountDisplay }) {
    await this.reviewPage.verify({
      amount: amountDisplay,
      from: 'Card account',
      to: 'Bivo Account',
      available: 'Instantly',
    });
  }

  // ── API capture ───────────────────────────────────────────────────────────

  /**
   * Click Transfer, intercept the move-fund POST (200 OK), and return the
   * captured data. The `requestId` in the response is the key used to
   * identify the resulting transaction in the Bivo account ledger
   * (it appears as `correlationId` in the transactions API).
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

    return {
      moveFundResponse,
      moveFundRequest,
      moveFundResponseBody,
      requestId:         moveFundResponseBody.requestId         ?? null,
      paymentIdentifier: moveFundResponseBody.paymentIdentifier ?? null,
    };
  }

  assertMoveFundApiCaptured(captured, { cardAccountNumber, bivoAccountNumber, amountUsd }) {
    const { moveFundRequest, moveFundResponseBody, requestId } = captured;

    expect(requestId, 'move-fund response should include a requestId').toBeTruthy();
    expect(moveFundResponseBody.status, 'move-fund status should be PENDING').toBe('PENDING');
    expect(
      String(moveFundRequest.fromAccount),
      'fromAccount should match the linked card account',
    ).toBe(String(cardAccountNumber));
    expect(
      String(moveFundRequest.toAccount),
      'toAccount should match the primary Bivo account',
    ).toBe(String(bivoAccountNumber));
    expect(
      Number(moveFundRequest.amount),
      'request amount should match entered amount',
    ).toBeCloseTo(Number(amountUsd), 2);
    expect(moveFundRequest.type, 'transfer type should be CARD').toBe('CARD');
  }

  // ── Success screen ────────────────────────────────────────────────────────

  async assertTransferCompleteScreen({ amountDisplay }) {
    const root = this.page.locator('#root');
    await expect(root).toContainText('Transfer Complete', { timeout: 15000 });
    await expect(this.page.getByTestId('success-card-description')).toContainText(
      `${amountDisplay} has been transferred to your Bivo Account account.`,
    );
    await expect(this.gotItButton).toBeVisible();
  }

  // ── Transaction verification ──────────────────────────────────────────────

  /**
   * Dismiss the success screen, navigate to the Bivo primary account in the
   * sidebar, and capture the initial (page 0) transactions API response.
   *
   * The waitForResponse is armed BEFORE navigation so it catches the API
   * call triggered by opening the account detail view.
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
   * Find the Card AFT transaction in the Bivo account ledger by matching
   * correlationId = requestId from the move-fund response.
   *
   * Bivo accounts accumulate many transactions so the card AFT entry may
   * not be on page 0. This method scans up to 5 pages via direct API calls
   * and returns the matching transaction row (or null if not found).
   *
   * @param {{ bivoAccountNumber: string, requestId: string }} opts
   */
  async findCardAftTransactionAcrossPages({ bivoAccountNumber, requestId }) {
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
   * Assert the Card AFT (Account Funding Transaction) entry in the Bivo ledger.
   * Matches by correlationId = requestId. Falls back to a cross-page scan
   * when the entry is not on the first page already loaded.
   *
   * @param {{ initialTransactions: object[], bivoAccountNumber: string, requestId: string, amountUsd: string }} opts
   */
  async assertCardAftTransaction({ initialTransactions, bivoAccountNumber, requestId, amountUsd }) {
    let tx = initialTransactions.find((t) => t.correlationId === requestId);

    if (!tx) {
      console.log('[card-funds] transaction not on page 0 — scanning further pages by correlationId');
      tx = await this.findCardAftTransactionAcrossPages({ bivoAccountNumber, requestId });
    }

    expect(
      tx,
      `Card AFT transaction with requestId "${requestId}" should be in the Bivo account ledger`,
    ).toBeTruthy();

    expect(Number(tx.amount), 'Card AFT amount should match transferred amount').toBeCloseTo(Number(amountUsd), 2);
    expect(['PENDING', 'CONFIRMED']).toContain(tx.status);
    expect(tx.transactionCode, 'card pull should CREDIT the Bivo account').toBe('CREDIT');
    expect(tx.currencyCode, 'transaction currency should be USD').toBe('USD');
    expect(tx.transactionType, 'transaction type should be Card AFT').toBe('Card AFT');
    expect(tx.description, 'description should reflect card pull').toBe('Pull funds from card');
  }
}

module.exports = UserWebCardFundsPage;
