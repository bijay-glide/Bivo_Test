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
    await this.page.getByRole('link', { name: 'Payments Payments' }).click();
    await this.page.getByRole('link', { name: 'Create US Payment Create US' }).click();
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
    await expect(this.page.locator('#root')).toContainText(`Requested date${expectedToday}`);
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
   * GET transactions list after ACH transfer: locate row by correlationId and assert API fields.
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
    const { transactions } = await this.openTransactionsAndCaptureApi({ accountNumber });

    expect(
      transactions.length,
      'transactions API should return at least one transaction row',
    ).toBeGreaterThan(0);

    const tx = this.findTransactionByCorrelationId(transactions, correlationId);
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
