const { expect } = require('@playwright/test');

/** Normalize transaction list bodies from GET /transactions/v1/transactions across shape variants. */
function extractTransactionList(body) {
  if (body == null) return null;
  if (Array.isArray(body)) return body;

  // Transactions API commonly returns separate buckets.
  if (typeof body === 'object') {
    const confirmed = Array.isArray(body.confirmedTransactions) ? body.confirmedTransactions : [];
    const pending = Array.isArray(body.pendingTransactions) ? body.pendingTransactions : [];
    if (confirmed.length > 0 || pending.length > 0) {
      return [...pending, ...confirmed];
    }
  }

  const preferredKeys = new Set([
    'content',
    'data',
    'results',
    'items',
    'records',
    'transactions',
    'transactionList',
    'list',
  ]);
  const queue = [body];
  const visited = new Set();
  let firstArrayFallback = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (Array.isArray(value)) {
        // Prefer well-known list keys first.
        if (preferredKeys.has(key)) return value;
        // Fallback: accept first non-empty array; if all arrays are empty,
        // we still return an array at the end via firstArrayFallback.
        if (value.length > 0) return value;
        if (!firstArrayFallback) firstArrayFallback = value;
      }
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return firstArrayFallback ?? null;
}

class WirePaymentPage {
  constructor(page) {
    this.page = page;
    this.moveMoneyLink = page.getByRole('link', { name: 'Move Money' });
    this.withdrawFundsLink = page.getByRole('link', { name: 'Withdraw Funds' });
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  async navigateToWireSection() {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const withdrawVisible = await this.withdrawFundsLink.isVisible().catch(() => false);
      if (withdrawVisible) break;

      // In user-web, Withdraw Funds is under Move Money; expand it first.
      const moveMoneyVisible = await this.moveMoneyLink.isVisible().catch(() => false);
      if (moveMoneyVisible) {
        console.log(
          `[WirePaymentPage] "Withdraw Funds" not visible — expanding Move Money (attempt ${attempt}/${MAX_ATTEMPTS})`,
        );
        await this.moveMoneyLink.click();
        await this.page.waitForTimeout(500);
      }

      await this.withdrawFundsLink.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    }

    await this.withdrawFundsLink.waitFor({ state: 'visible', timeout: 15000 });
    await this.withdrawFundsLink.click();
    await this.page.getByText('Wire', { exact: true }).click();
  }

  // ─── Wire Details Form ─────────────────────────────────────────────────────

  /**
   * Fills and submits the Add Wire Details form.
   *
   * @param {object} data
   * @param {string} data.firstName
   * @param {string} data.lastName
   * @param {string} data.nickname
   * @param {string} data.streetAddress
   * @param {string} data.city
   * @param {string} data.zipCode
   * @param {string} data.state        - 2-letter state code, e.g. 'NY'
   * @param {string} data.accountNumber
   * @param {string} data.routingNumber
   */
  async fillWireDetailsForm(data) {
    await this.page.getByRole('button', { name: 'Add Wire Details' }).click();

    await this.page.getByRole('textbox', { name: 'First name' }).fill(data.firstName);
    await this.page.getByRole('textbox', { name: 'Last name' }).fill(data.lastName);
    await this.page.getByRole('textbox', { name: 'Enter account nickname' }).fill(data.nickname);

    // Press Enter then click outside to dismiss the street-address autocomplete
    
    await this.page.getByRole('textbox', { name: 'Street Address (No PO Box)' }).fill(data.streetAddress);
    await this.page.getByRole('textbox', { name: 'Street Address (No PO Box)' }).press('Enter');
    await this.page.locator('.dashboard-main-container').click();

    await this.page.getByRole('textbox', { name: 'City' }).fill(data.city);
    await this.page.getByRole('textbox', { name: 'Zip Code' }).fill(data.zipCode);

    await this.page.getByRole('button', { name: 'Enter state' }).click();
    await this.page.getByRole('button', { name: data.state }).click();

    await this.page.getByRole('textbox', { name: 'Enter account number' }).fill(data.accountNumber);
    await this.page.getByRole('textbox', { name: 'Routing number (wire)' }).fill(data.routingNumber);

    await this.page.getByRole('button', { name: 'Continue' }).click();
  }

  // ─── Payment Schedule ──────────────────────────────────────────────────────

  /**
   * Fills and submits the payment schedule screen.
   *
   * @param {object} data
   * @param {string} data.amountInput  - Digits only, e.g. '9000' → $90.00
   * @param {string} data.frequency    - e.g. 'One Time Only'
   * @param {string} data.message
   */
  async fillPaymentSchedule(data) {
    // React-controlled inputs ignore fill() — pressSequentially fires real key
    // events (keydown/keypress/input/keyup) that trigger the onChange handler.
    await this.page.waitForTimeout(5000);
    const amountInput = this.page.locator('input.form-control');
    await amountInput.click();
    await amountInput.selectText();
    await amountInput.pressSequentially(data.amountInput, { delay: 50 });

    await this.page.getByRole('button', { name: 'Select frequency' }).click();
    await this.page.getByText(data.frequency, { exact: true }).click();

    await this.page.getByRole('textbox', { name: 'Enter a message' }).fill(data.message);

    await this.page.getByText('Now').click();
    await this.page.getByRole('button', { name: 'Continue' }).click();
    await this.page.waitForURL('**/money-transfer/payee-internal-review')
  }

  // ─── Review & Submit ───────────────────────────────────────────────────────

  /**
   * Asserts all fields are correct on the review screen before submitting.
   *
   * @param {object} wireData
   * @param {object} paymentData
   * @param {string} paymentData.requestedDate  - e.g. 'Mar 19, 2026'
   * @param {string} paymentData.amount         - e.g. '$90.00'
   */
  async verifyReviewScreen(wireData, paymentData) {
    await expect(this.page.getByText(wireData.nickname)).toBeVisible();
    await expect(this.page.getByText(`Account number${wireData.accountNumber}`)).toBeVisible();
    await expect(this.page.getByText('Payment viaWire Transfer')).toBeVisible();
    //await expect(this.page.getByText(`Requested date${paymentData.requestedDate}`)).toBeVisible();
    await expect(this.page.getByText(`Amount${paymentData.amount}`)).toBeVisible();
    await expect(this.page.getByText(`Routing number${wireData.routingNumber}`)).toBeVisible();
  }

  /**
   * Clicks Transfer, waits for the transactions list API (same fetch the UI uses),
   * validates the response, then asserts the success row is visible.
   *
   * @param {string} firstName
   * @param {object} [options]
   * @param {string|number} [options.accountId] - If set, only match GET requests whose URL includes this (query `accountId=`).
   */
  async submitTransfer(firstName, options = {}) {
    const { accountId } = options;

    const waitForTransactions = this.page.waitForResponse(
      (response) => {
        const url = response.url();
        if (!url.includes('/transactions/v1/transactions')) return false;
        if (response.request().method() !== 'GET') return false;
        if (!response.ok()) return false;

        // Filter only when the URL actually uses the `accountId=` query.
        // In some environments the list call may omit it (or use a different identifier),
        // and a strict filter would cause a false timeout.
        if (accountId != null && url.includes('accountId=')) {
          if (!url.includes(`accountId=${encodeURIComponent(String(accountId))}`)) return false;
        }
        return true;
      },
      { timeout: 60000 },
    );

    const [response] = await Promise.all([
      waitForTransactions,
      this.page.getByRole('button', { name: 'Transfer' }).click(),
    ]);
    const body = await response.json();
    const responseUrl = response.url();
    const bodyText = (() => {
      try {
        return JSON.stringify(body, null, 2);
      } catch {
        return String(body);
      }
    })();

    const items = extractTransactionList(body);
    const topLevelKeys = body && typeof body === 'object' ? Object.keys(body).join(', ') : typeof body;
    if (items == null) {
      console.error(
        `[WirePaymentPage] Could not extract transactions list from ${responseUrl}.\nResponse body:\n${bodyText}`,
      );
    }
    expect(
      items != null,
      `transactions API should return (or contain) a list. Top-level shape: ${topLevelKeys}`,
    ).toBe(true);
    if (items.length === 0) {
      console.error(
        `[WirePaymentPage] Transactions list is empty from ${responseUrl}.\nResponse body:\n${bodyText}`,
      );
    }
    expect(items.length, 'transactions list should include at least one row after transfer').toBeGreaterThan(0);

    await expect(this.page.getByText(`Withdraw fund to ${firstName}`)).toBeVisible();
  }

  // ─── Post-Transfer Verification ────────────────────────────────────────────

  /**
   * Navigates to Transactions and verifies the new entry.
   *
   * @param {string} firstName
   * @param {string} amount  - e.g. '$90.00'
   */
  async verifyTransactionHistory(firstName, amount) {
    await this.page.getByRole('link', { name: 'View Transactions' }).click();

    await expect(this.page.locator('tbody')).toContainText(`- ${amount}`);
    await expect(this.page.locator('tbody')).toContainText(`Withdraw fund to ${firstName}`);
    await expect(this.page.locator('tbody')).toContainText('PENDING');
    await expect(this.page.locator('tbody')).toContainText('Debit');
  }

  /**
   * Navigates back to the Wire dashboard and verifies the newly added account
   * appears as the last entry with the expected label format.
   *
   * @param {string} nickname
   * @param {string} lastFourDigits
   */
  async verifyAddedAccount(nickname, lastFourDigits) {
    await this.navigateToWireSection();

    const expectedLabel  = `${nickname} *${lastFourDigits}`;
    const lastAddedEntry = this.page.locator('.d-flex.flex-column.pl-12 .PARAGRAPH_1M_16').last();

    await expect(lastAddedEntry).toHaveText(expectedLabel);
  }
}

module.exports = WirePaymentPage;
