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

class MoveFundsPage {
  constructor(page) {
    this.page = page;
  }

  async navigateToMoveFunds() {
    const internalTransfer = this.page.getByTestId('Sidebar-moveMoney-withdrawFunds');
    await this.page.getByTestId('Sidebar-nav-moveMoney').click();
    // Sub-menu may collapse if a background re-render fires (e.g. balance update after pre-fund).
    // Retry once if the item doesn't become visible within 5 s.
    const appeared = await internalTransfer.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (!appeared) {
      await this.page.getByTestId('Sidebar-nav-moveMoney').click();
    }
    await internalTransfer.click();
  }

  async enterAmountAndContinue(amountInput) {
    const input = this.page.getByTestId('amount-input-ui');
    await input.click();
    await input.selectText();
    await input.pressSequentially(amountInput, { delay: 50 });
    await this.page.getByRole('button', { name: 'Next' }).click();
  }

  async submitAndCaptureMoveFundApi() {
    const moveFundPromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/user/v1/transaction/move-fund') &&
        response.request().method() === 'POST' &&
        response.ok(),
      { timeout: 30000 },
    );

    await this.page.getByRole('button', { name: 'Transfer' }).click();

    const moveFundResponse = await moveFundPromise;

    let moveFundRequest = {};
    try {
      moveFundRequest = moveFundResponse.request().postDataJSON() || {};
    } catch {
      moveFundRequest = {};
    }

    let moveFundResponseBody = {};
    try {
      moveFundResponseBody = await moveFundResponse.json();
    } catch {
      moveFundResponseBody = {};
    }

    const paymentIdentifier =
      moveFundResponseBody.paymentIdentifier ??
      moveFundResponseBody.identifier ??
      moveFundResponseBody.correlationId ??
      null;

    return { moveFundResponse, moveFundRequest, moveFundResponseBody, paymentIdentifier };
  }

  assertMoveFundApiCaptured(captured, { bivoAccountNumber, amountUsd }) {
    const { moveFundRequest, moveFundResponseBody, paymentIdentifier } = captured;

    expect(
      paymentIdentifier,
      'move-fund response should include a paymentIdentifier',
    ).toBeTruthy();
    expect(
      moveFundResponseBody.status,
      'move-fund response status should be PENDING',
    ).toBe('PENDING');
    expect(
      String(moveFundRequest.fromAccount),
      'move-fund fromAccount should match bivo_account_number',
    ).toBe(String(bivoAccountNumber));
    expect(
      Number(moveFundRequest.amount),
      'move-fund request amount should match entered amount',
    ).toBeCloseTo(Number(amountUsd), 2);
    expect(moveFundRequest.type, 'move-fund type should be INTERNAL').toBe('INTERNAL');
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

    // Move-fund success screen shows "Got it" — dismiss it then open Accounts to load transactions.
    await this.page.getByRole('button', { name: 'Got it' }).click();
    await this.page.getByTestId('Sidebar-nav-accounts').click();

    const transactionsResponse = await transactionsResponsePromise;
    const transactionsBody = await transactionsResponse.json();
    return {
      transactionsResponse,
      transactionsBody,
      transactions: extractTransactions(transactionsBody),
    };
  }

  findTransactionByPaymentIdentifier(transactions, paymentIdentifier) {
    return (
      transactions.find((tx) => {
        // move-fund paymentIdentifier maps to transactionId on the transactions API row
        const candidates = [tx.transactionId, tx.correlationId, tx.correlation_id, tx.paymentIdentifier];
        return candidates.some((v) => v && v === paymentIdentifier);
      }) || null
    );
  }

  async assertTransactionsApiMoveFundRow({ accountNumber, paymentIdentifier, amountUsd }) {
    const { transactions: initialTransactions } = await this.openTransactionsAndCaptureApi({
      accountNumber,
    });

    let transactions = initialTransactions;

    if (paymentIdentifier && !this.findTransactionByPaymentIdentifier(transactions, paymentIdentifier)) {
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
        if (this.findTransactionByPaymentIdentifier(transactions, paymentIdentifier)) break;
      }
    }

    // Fallback: direct authenticated API scan when the UI page-size misses the transaction.
    // Paginates pages 0-9 (up to 1000 rows) per attempt — handles accounts where the API
    // defaults to oldest-first sort and the new transaction lands beyond the first page.
    if (paymentIdentifier && !this.findTransactionByPaymentIdentifier(transactions, paymentIdentifier)) {
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

        for (let attempt = 0; attempt < 3 && !this.findTransactionByPaymentIdentifier(transactions, paymentIdentifier); attempt++) {
          if (attempt > 0) await this.page.waitForTimeout(5000);
          let scanned = [];
          for (let pg = 0; pg < 10; pg++) {
            const url = `${host}/transactions/v1/transactions?accountId=${accountNumber}&page=${pg}&size=100`;
            const res = await this.page.request.get(url, { headers });
            if (!res.ok()) break;
            const pageItems = extractTransactions(await res.json());
            if (!pageItems.length) break;
            scanned = [...scanned, ...pageItems];
            if (this.findTransactionByPaymentIdentifier(scanned, paymentIdentifier)) break;
          }
          if (scanned.length > 0) transactions = scanned;
        }
      }
    }

    expect(
      transactions.length,
      'transactions API should return at least one row',
    ).toBeGreaterThan(0);

    const tx = this.findTransactionByPaymentIdentifier(transactions, paymentIdentifier);
    expect(
      tx,
      `transactions API should include a row with paymentIdentifier ${paymentIdentifier}`,
    ).toBeTruthy();

    expect(Number(tx.amount)).toBeCloseTo(Number(amountUsd), 2);
    expect(['PENDING', 'CONFIRMED'], 'move-fund transaction status').toContain(tx.status);
    expect(tx.currencyCode, 'move-fund transaction currency should be USD').toBe('USD');
    expect(tx.transactionCode, 'move-fund should be a DEBIT').toBe('DEBIT');

    return { transactions, tx };
  }
}

module.exports = MoveFundsPage;
