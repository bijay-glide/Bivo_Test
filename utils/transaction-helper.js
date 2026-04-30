/**
 * Transaction Helper
 *
 * Provides reusable API-level helpers for funding / moving money in tests.
 * Call these functions from any test that needs an account balance before
 * exercising UI payment flows.
 */

const { getOAuthToken } = require('./api-client');

/**
 * Deposits funds into a user's account by simulating an incoming wire transfer.
 *
 * Executes the three-step flow from the "z transaction incoming" Postman collection:
 *   1. Get OAuth token  (transaction-v1 client credentials)
 *   2. POST incoming-wire → receives transactionId
 *   3. POST approve      → settles the transaction and credits the account
 *
 * @param {object} request        - Playwright APIRequestContext (from test fixture)
 * @param {string} accountNumber  - Recipient account number (load from shared state)
 * @param {object} [options]      - Optional overrides for the wire body
 * @param {number} [options.amount=100000]          - Amount in cents (default $1,000.00)
 * @param {string} [options.description]
 * @param {string} [options.provider='SVB']
 *
 * @returns {Promise<{ transactionId: string }>}
 *
 * @example
 * // Fund the account before running a withdraw UI flow
 * await depositFundsViaWire(request, userData.accountNumber);
 *
 * @example
 * // Deposit a custom amount
 * await depositFundsViaWire(request, accountNumber, { amount: 500000 }); // $5,000
 */
async function depositFundsViaWire(request, accountNumber, options = {}) {
  const host             = process.env.HOST;
  const tenantIdentifier = process.env.TENANT_IDENTIFIER;

  const amount      = options.amount      ?? 1000;
  const description = options.description ?? 'QA_Automation — incoming wire deposit';
  const provider    = options.provider    ?? 'SVB';
  // Unique correlationId prevents duplicate-transaction rejections across runs
  const correlationId = `QA-wire-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  console.log('\n── depositFundsViaWire ───────────────────────────────────────');
  console.log(`   accountNumber : ${accountNumber}`);
  console.log(`   amount        : ${amount} cents ($${(amount / 100).toFixed(2)})`);
  console.log(`   correlationId : ${correlationId}`);

  // ── Step 1 | Get token ────────────────────────────────────────────────────
  const token = await getOAuthToken(request);
  console.log(`   token         : ${token.substring(0, 25)}...`);

  const authHeaders = {
    'Authorization':       `Bearer ${token}`,
    'Content-Type':        'application/json',
    'X-Tenant-Identifier': tenantIdentifier,
  };

  // ── Step 2 | Incoming wire ────────────────────────────────────────────────
  const incomingResponse = await request.post(
    `${host}/transactions/v1/internal/external-payment/incoming-wire`,
    {
      headers: authHeaders,
      data: {
        accountNumber,
        amount,
        description,
        correlationId,
        traceId: null,
        provider,
      },
    }
  );

  if (incomingResponse.status() !== 200) {
    const body = await incomingResponse.text();
    throw new Error(`Incoming wire failed (${incomingResponse.status()}): ${body}`);
  }

  const { transactionId } = await incomingResponse.json();
  console.log(`   transactionId : ${transactionId}`);

  // ── Step 3 | Approve ─────────────────────────────────────────────────────
  const approveResponse = await request.post(
    `${host}/transactions/v1/internal/external-payment/approve`,
    {
      headers: authHeaders,
      data: { transactionId, provider },
    }
  );

  if (approveResponse.status() !== 200) {
    const body = await approveResponse.text();
    throw new Error(`Approve wire failed (${approveResponse.status()}): ${body}`);
  }

  console.log(`   ✓ Wire deposit approved — account credited`);
  console.log('─────────────────────────────────────────────────────────────\n');

  return { transactionId };
}

module.exports = { depositFundsViaWire };
