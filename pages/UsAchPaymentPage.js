const { expect } = require('@playwright/test');

function extractTransactions(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;

  const confirmed = Array.isArray(body.confirmedTransactions) ? body.confirmedTransactions : [];
  const pending = Array.isArray(body.pendingTransactions) ? body.pendingTransactions : [];
  if (confirmed.length > 0 || pending.length > 0) return [...pending, ...confirmed];

  const candidates = [body.content, body.data, body.items, body.results, body.transactions];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

class UsAchPaymentPage {
  constructor(page) {
    this.page = page;
  }

  /** e.g. "Apr 29, 2026" — matches review screen "Requested date" copy. */
  static formatReviewDate(date = new Date()) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  }

  async navigateToCreateUsPayment() {
    const createUsPaymentLink = this.page.getByRole('link', { name: 'Create US Payment Create US' });
    // Payments section starts expanded — only click the parent if the sub-item is hidden
    const isVisible = await createUsPaymentLink.isVisible().catch(() => false);
    if (!isVisible) {
      await this.page.getByRole('link', { name: 'Payments Payments' }).click();
    }
    await createUsPaymentLink.click();
  }

  async addPayee(firstName, lastName) {
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
    await this.page.getByRole('textbox', { name: "Enter beneficiary's first name" }).fill(firstName);
    await this.page.getByRole('textbox', { name: "Enter beneficiary's last name" }).fill(lastName);
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  async addBankDetailsAndCaptureBeneficiaryApi({ accountNumber, routingNumber }) {
    const beneficiaryResponsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/remittance/v1/beneficiary/account') &&
        response.request().method() === 'POST' &&
        response.ok(),
      { timeout: 30000 },
    );

    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(accountNumber);
    await this.page.getByRole('textbox', { name: 'Enter routing number' }).fill(routingNumber);
    await this.page.getByRole('button', { name: 'Continue' }).click();

    const beneficiaryResponse = await beneficiaryResponsePromise;
    let requestBody = {};
    try {
      requestBody = beneficiaryResponse.request().postDataJSON() || {};
    } catch {
      requestBody = {};
    }

    const dataFields = Array.isArray(requestBody.data) ? requestBody.data : [];
    const bankAccountField = dataFields.find((f) => f.fieldName === 'bank_account_number');
    const bankAchAccountNumber = bankAccountField?.value || accountNumber;

    return {
      bankAchAccountNumber,
      beneficiaryResponse,
    };
  }

  async verifyVendorDetailsAndSelectAch({ usAchAccountLast4 }) {
    await expect(this.page.locator('#root')).toContainText(`*${usAchAccountLast4}`);
    await expect(this.page.getByRole('heading')).toContainText('Vendor Details');
    await expect(this.page.locator('#root')).toContainText('Wire Transfer');
    await expect(this.page.locator('#root')).toContainText('ACH Transfer');

    await this.page.locator('#anyone').nth(1).check();
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  async fillTransferDetailsAndContinue({ amountInputValue, message, bivoAccountLast4 }) {
    if (bivoAccountLast4) {
      await expect(this.page.getByTestId('dropdown_transfer_from_account')).toContainText(
        `Bivo Account*${bivoAccountLast4}`,
      );
    }

    const amountInput = this.page.locator('input[type="text"]').first();
    await amountInput.click();
    await amountInput.selectText();
    await amountInput.pressSequentially(amountInputValue, { delay: 50 });

    await this.page.getByTestId('dropdown_frequency').click();
    await this.page.getByTestId('dropdown_option_once').click();
    await this.page.getByRole('textbox', { name: 'Enter a message' }).fill(message);
    await this.page.getByTestId('button_now').click();
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  async verifyReviewDetails({
    firstName,
    lastName,
    routingNumber,
    accountNumber,
    amountDisplay,
    expectedToday,
  }) {
    await expect(this.page.locator('#root')).toContainText(`Routing number${routingNumber}`);
    await expect(this.page.locator('#root')).toContainText(`Recipient${firstName} ${lastName}`);
    await expect(this.page.locator('#root')).toContainText(`Account number${accountNumber}`);
    await expect(this.page.locator('#root')).toContainText(`Amount${amountDisplay}`);
    await expect(this.page.locator('#root')).toContainText('Payment viaACH');
    //await expect(this.page.locator('#root')).toContainText(`Requested date${expectedToday}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Shared bu-web / individual-user US payment flow (data-testid based).
  // Both surfaces render the same add-payee → account → send-method → execution
  // → review → transfer screens, so these methods work on either. API checkpoints
  // captured from USPAyment-UserDetails / -AccountDetails / -transferAPI HARs.
  // ────────────────────────────────────────────────────────────────────────

  /** Payments → Money Transfer (internal payee) → Add Payee. */
  async navigateToAddPayeeInternal() {
    await this.page.getByTestId('sidebar-menuitem-payments').click();
    const payeeInternal = this.page.getByTestId('sidebar-menuitem-money-transfer-payee-internal');
    await payeeInternal.waitFor({ state: 'visible', timeout: 10000 });
    await payeeInternal.click();
    await this.page.getByRole('button', { name: 'Add Payee' }).click();
  }

  /** Fills payee personal details and captures POST /remittance/v1/beneficiary/personal-info (202 → referenceId). */
  async addPayeeDetailsAndCaptureApi({ firstName, lastName, addressOne, city, state, postalCode }) {
    const personalInfoPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/remittance/v1/beneficiary/personal-info') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 30000 },
    );

    await this.page.getByTestId('addpayeedetails-first-name-input').fill(firstName);
    await this.page.getByTestId('addpayeedetails-last-name-input').fill(lastName);
    await this.page.getByTestId('addpayeedetails-address-one-input').fill(addressOne);
    await this.page.getByTestId('addpayeedetails-city-input').fill(city);
    await this.page.getByTestId('addpayeedetails-state-input').fill(state);
    await this.page.getByTestId('addpayeedetails-postal-code-input').fill(postalCode);
    await this.page.getByRole('button', { name: 'Continue' }).click();

    const response = await personalInfoPromise;
    const body = await response.json().catch(() => ({}));
    return { referenceId: body.referenceId, response };
  }

  /** Fills bank account + routing and captures POST /business/v1/beneficiary/account (202 → state, accountNumber). */
  async addBankAccountAndCaptureApi({ bankAccountNumber, routingCode }) {
    const accountPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/business/v1/beneficiary/account') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 30000 },
    );

    await this.page.getByTestId('addpayeeaddress-bank-account-number-input').fill(bankAccountNumber);
    await this.page.getByTestId('addpayeeaddress-routing-code-input').fill(routingCode);
    await this.page.getByRole('button', { name: 'Continue' }).click();

    const response = await accountPromise;
    const body = await response.json().catch(() => ({}));
    // accountNumber here is the internal beneficiary account — it becomes transfer-fund's toAccount.
    return { state: body.state, beneficiaryAccountNumber: body.accountNumber, response };
  }

  /** Selects WIRE or ACH send method and continues. */
  async selectSendMethodAndContinue(channelType) {
    const testId =
      channelType === 'ACH' ? 'otherinternalsend-ach-radio' : 'otherinternalsend-wire-radio';
    await this.page.getByTestId(testId).check();
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  /** Enters amount (cent-string), instruction, frequency=once, executes now, continues to review. */
  async fillExecutionDetailsAndContinue({ amountInputValue, instruction }) {
    const amount = this.page.getByTestId('otherinternalexecution-amount-input');
    await amount.click();
    await amount.pressSequentially(amountInputValue, { delay: 50 });

    await this.page.getByTestId('otherinternalexecution-instruction-input').fill(instruction);
    await this.page.getByTestId('dropdown_frequency').click();
    await this.page.getByTestId('dropdown_option_once').click();
    await this.page.getByTestId('button_now').click();
    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  /** Review screen assertions for the shared bu-web/individual flow. */
  async verifyUsPaymentReview({
    firstName,
    lastName,
    bankAccountNumber,
    routingNumber,
    amountDisplay,
    paymentVia,
    expectedToday,
  }) {
    const root = this.page.locator('#root');
    await expect(root).toContainText(`${firstName} ${lastName}`);
    await expect(root).toContainText(`Account number${bankAccountNumber}`);
    await expect(root).toContainText(`Routing number${routingNumber}`);
    await expect(root).toContainText(`Amount${amountDisplay}`);
    await expect(root).toContainText(`Payment via${paymentVia}`);
    if (expectedToday) await expect(root).toContainText(`Requested date${expectedToday}`);
  }

  /** Clicks Transfer and captures POST /business/v1/transaction/transfer-fund (200 → identifier, status). */
  async submitBusinessTransferAndCaptureApi() {
    const transferPromise = this.page.waitForResponse(
      (r) =>
        r.url().includes('/business/v1/transaction/transfer-fund') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 30000 },
    );

    await this.page.getByRole('button', { name: 'Transfer' }).click();

    const response = await transferPromise;
    let request = {};
    try {
      request = response.request().postDataJSON() || {};
    } catch {
      request = {};
    }
    const body = await response.json().catch(() => ({}));
    return { request, identifier: body.identifier, status: body.status, response };
  }

  async submitTransferAndCaptureTransferFundApi() {
    const transferFundPromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/user/v1/transaction/transfer-fund') &&
        response.request().method() === 'POST' &&
        response.ok(),
      { timeout: 30000 },
    );

    await this.page.getByRole('button', { name: 'Transfer' }).click();

    const transferFundResponse = await transferFundPromise;
    let transferFundRequest = {};
    try {
      transferFundRequest = transferFundResponse.request().postDataJSON() || {};
    } catch {
      transferFundRequest = {};
    }

    let transferFundResponseBody = {};
    try {
      transferFundResponseBody = await transferFundResponse.json();
    } catch {
      transferFundResponseBody = {};
    }

    // transfer-fund returns { identifier, status }; transactions list exposes the same UUID as correlationId
    const correlationId =
      transferFundResponseBody.identifier ??
      transferFundResponseBody.correlationId ??
      transferFundResponseBody.correlation_id ??
      transferFundResponseBody.data?.identifier ??
      transferFundResponseBody.data?.correlationId ??
      transferFundResponseBody.data?.correlation_id ??
      transferFundRequest.correlationId ??
      transferFundRequest.correlation_id ??
      null;

    return {
      transferFundResponse,
      transferFundRequest,
      transferFundResponseBody,
      correlationId,
    };
  }

  async openTransactionsAndCaptureApi({ accountNumber }) {
    const transactionsResponsePromise = this.page.waitForResponse(
      (response) => {
        const url = response.url();
        if (!url.includes('/transactions/v1/transactions')) return false;
        if (response.request().method() !== 'GET') return false;
        if (!response.ok()) return false;
        if (accountNumber && !url.includes(String(accountNumber))) return false;
        return true;
      },
      { timeout: 30000 },
    );

    await this.page.getByRole('link', { name: 'View Transactions' }).click();

    const transactionsResponse = await transactionsResponsePromise;
    const transactionsBody = await transactionsResponse.json();
    return {
      transactionsResponse,
      transactionsBody,
      transactions: extractTransactions(transactionsBody),
    };
  }

  assertTransferFundAchCaptured(captured, { bivoAccountNumber, amountUsd }) {
    const { transferFundRequest, correlationId } = captured;
    expect(
      correlationId,
      'transfer-fund response should include identifier (matches correlationId on transactions API)',
    ).toBeTruthy();
    expect(
      String(transferFundRequest?.fromAccount),
      'transfer-fund fromAccount should match bivo_account_number',
    ).toBe(String(bivoAccountNumber));
    expect(
      String(transferFundRequest.amount),
      'transfer-fund amount should match selected amount',
    ).toBe(Number(amountUsd).toFixed(2));
    expect(transferFundRequest.type, 'transfer-fund type should be ACH').toBe('ACH');
    expect(transferFundRequest.toAccount, 'transfer-fund toAccount should be populated').toBeTruthy();
  }

  /**
   * Opens the transactions list and locates the row whose correlationId matches the
   * transfer identifier. Retries (UI reload) then falls back to scanning the paginated
   * transactions API directly, since a freshly-created row can lag and/or land beyond
   * page 0 when the account already has many transactions.
   *
   * @returns {Promise<{ transactions: object[], tx: object|null }>}
   */
  async locateTransactionByCorrelationId({ accountNumber, correlationId }) {
    const { transactions: initialTransactions } = await this.openTransactionsAndCaptureApi({ accountNumber });

    let transactions = initialTransactions;

    if (correlationId && !this.findTransactionByCorrelationId(transactions, correlationId)) {
      const txUrlFilter = (r) =>
        r.url().includes('/transactions/v1/transactions') &&
        r.request().method() === 'GET' &&
        r.ok() &&
        (!accountNumber || r.url().includes(String(accountNumber)));

      for (let attempt = 0; attempt < 3; attempt++) {
        await this.page.waitForTimeout(4000);
        const retryPromise = this.page.waitForResponse(txUrlFilter, { timeout: 30000 });
        await this.page.reload();
        const retryBody = await (await retryPromise).json();
        transactions = extractTransactions(retryBody);
        if (this.findTransactionByCorrelationId(transactions, correlationId)) break;
      }
    }

    // Paginated fallback: the UI reload fetches only the first page of results.
    // If the API defaults to oldest-first sort and the account has many transactions,
    // the new row lands beyond page 0. Scan pages 0-9 per attempt to cover
    // accounts where hundreds of prior transactions have accumulated.
    if (correlationId && !this.findTransactionByCorrelationId(transactions, correlationId)) {
      const token = await this.page.evaluate(() => {
        try {
          const root = JSON.parse(localStorage.getItem('persist:root') || '{}');
          const auth = JSON.parse(root.authentication || '{}');
          return auth.loginData?.accessToken || null;
        } catch { return null; }
      });

      if (token) {
        const host = process.env.HOST || 'https://api-sandbox.bivotech.co';
        const tenant = process.env.TENANT_IDENTIFIER || '';
        const headers = { Authorization: `Bearer ${token}`, 'X-Tenant-Identifier': tenant };

        for (let attempt = 0; attempt < 3 && !this.findTransactionByCorrelationId(transactions, correlationId); attempt++) {
          if (attempt > 0) await this.page.waitForTimeout(5000);
          let scanned = [];
          for (let pg = 0; pg < 10; pg++) {
            const url = `${host}/transactions/v1/transactions?accountId=${accountNumber}&page=${pg}&size=100`;
            const res = await this.page.request.get(url, { headers });
            if (!res.ok()) break;
            const pageItems = extractTransactions(await res.json());
            if (!pageItems.length) break;
            scanned = [...scanned, ...pageItems];
            if (this.findTransactionByCorrelationId(scanned, correlationId)) break;
          }
          if (scanned.length > 0) transactions = scanned;
        }
      }
    }

    return { transactions, tx: this.findTransactionByCorrelationId(transactions, correlationId) };
  }

  /**
   * GET transactions list after ACH transfer: locate row by correlationId and assert API fields.
   * Retries up to 3 times (4 s apart) if the transaction isn't visible yet — ACH processing lag.
   */
  async assertTransactionsApiAchDebitRow({
    accountNumber,
    correlationId,
    bivoAccountNumber,
    amountUsd,
    payeeFirstName,
    payeeLastName,
    transferFundRequest,
  }) {
    const { transactions, tx } = await this.locateTransactionByCorrelationId({ accountNumber, correlationId });

    expect(
      transactions.length,
      'transactions API should return at least one transaction row',
    ).toBeGreaterThan(0);
    expect(
      tx,
      `transactions API should include a row with correlationId ${correlationId}`,
    ).toBeTruthy();

    const expectedPayeeDescription = `To ${payeeFirstName} ${payeeLastName}`;
    const expectedAmount = Number(amountUsd);

    expect(String(tx.account)).toBe(String(bivoAccountNumber));
    expect(Number(tx.amount)).toBe(expectedAmount);
    expect(tx.description).toBe(expectedPayeeDescription);
    expect(tx.transactionCode).toBe('DEBIT');
    expect(tx.currencyCode).toBe('USD');
    expect(tx.transactionType).toBe('External Deposit');

    if (transferFundRequest?.toAccount != null) {
      expect(String(tx.reference)).toBe(String(transferFundRequest.toAccount));
    }

    return { transactions, tx };
  }

  /**
   * Bu-web / business transfer-fund verification: open the transactions list and confirm
   * the API row whose correlationId equals the transfer identifier. Asserts only the fields
   * proven by the transfer-fund request/response — account, amount, and status — so it holds
   * for both WIRE and ACH without depending on user-web-specific copy.
   *
   * @param {string} expectedStatus  WIRE settles as PENDING; ACH settles as CONFIRMED.
   * @returns {Promise<{ transactions: object[], tx: object }>}
   */
  async assertBusinessTransferInTransactionsApi({ accountNumber, correlationId, amountUsd, expectedStatus }) {
    const { transactions, tx } = await this.locateTransactionByCorrelationId({ accountNumber, correlationId });

    expect(
      transactions.length,
      'transactions API should return at least one transaction row',
    ).toBeGreaterThan(0);
    expect(
      tx,
      `transactions API should include a row with correlationId ${correlationId}`,
    ).toBeTruthy();

    expect(String(tx.account), 'transaction account should match the Bivo account').toBe(String(accountNumber));
    expect(Number(tx.amount), 'transaction amount should match the transfer').toBe(Number(amountUsd));

    // Status is channel-specific: WIRE lands as PENDING, ACH lands as CONFIRMED.
    const status = tx.status ?? tx.transactionStatus;
    expect(status, 'transactions row should expose a status').toBeTruthy();
    expect(
      String(status).toUpperCase(),
      `newly created transfer should be ${expectedStatus}`,
    ).toBe(String(expectedStatus).toUpperCase());

    return { transactions, tx };
  }

  /**
   * Finds the transactions table row (by correlation id / identifier when provided),
   * then asserts column cells match the resizable-table layout:
   * Date | Logo | Description | Type | Status | Transaction Amount | Balance
   * Pass expected* values from the transactions API row you matched in the test.
   */
  async verifyAchTransactionRowInTable({
    correlationId,
    description,
    amountDisplay,
    expectedDateLabel,
    expectedTypeLabel = 'Debit',
    expectedStatus = 'PENDING',
    expectedBalanceDisplay,
  }) {
    const table = this.page.locator('table.resizable-table');
    await expect(table).toBeVisible({ timeout: 20000 });

    const debitAmountLabel = `- ${amountDisplay}`;

    /** Prefer the row that contains the transfer-fund identifier (same value as correlationId in transactions API). */
    const row = correlationId
      ? table.locator('tbody tr').filter({ hasText: correlationId }).first()
      : table
          .locator('tbody tr')
          .filter({ hasText: description })
          .filter({ hasText: debitAmountLabel })
          .first();

    await expect(
      row,
      correlationId
        ? `row containing correlation id ${correlationId}`
        : `row for "${description}" / ${debitAmountLabel}`,
    ).toBeVisible({
      timeout: 15000,
    });

    const cellText = async (tdIndex) => {
      const cell = row.locator('td').nth(tdIndex);
      await expect(cell).toBeVisible();
      const inner = cell.locator('.table-cell').first();
      return (await inner.innerText()).trim();
    };

    const dateText = await cellText(0);
    if (expectedDateLabel) {
      expect(dateText, 'Date cell').toBe(expectedDateLabel);
    } else {
      expect(dateText, 'Date cell should look like "Apr 28, 2026"').toMatch(
        /^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}$/,
      );
    }

    expect(await cellText(2), 'Description cell').toBe(description);
    expect(await cellText(3), 'Type cell').toBe(expectedTypeLabel);
    expect(await cellText(4), 'Status cell').toBe(expectedStatus);

    const txAmountText = await cellText(5);
    expect(txAmountText.replace(/\s+/g, ' '), 'Transaction Amount cell').toBe(debitAmountLabel);

    const balanceText = await cellText(6);
    const balanceNormalized = balanceText.replace(/\s+/g, ' ');
    if (expectedBalanceDisplay !== undefined) {
      expect(balanceNormalized, 'Balance cell').toBe(expectedBalanceDisplay);
    } else {
      expect(
        balanceText,
        'Balance cell should be currency or dash placeholder',
      ).toMatch(/^(\$[\d,]+\.\d{2}|-)$/);
    }
  }

  findTransactionByCorrelationId(transactions, correlationId) {
    return (
      transactions.find((tx) => {
        const cid = tx.correlationId ?? tx.correlation_id;
        return cid && cid === correlationId;
      }) || null
    );
  }

  /** FX `paymentIdentifier` is stored as `correlationId` on account transaction rows. */
  expectPendingTransactionForPaymentIdentifier(transactions, paymentIdentifier, expectedAmountUsd) {
    const tx = this.findTransactionByCorrelationId(transactions, paymentIdentifier);
    expect(
      tx,
      `transactions API should include correlationId ${paymentIdentifier}`,
    ).toBeTruthy();
    expect(tx.correlationId ?? tx.correlation_id).toBe(paymentIdentifier);
    expect(Number(tx.amount)).toBeCloseTo(Number(expectedAmountUsd), 2);
    expect(tx.status).toBe('PENDING');
    return tx;
  }
}

module.exports = UsAchPaymentPage;
