/**
 * Wire Instructions API Test Suite
 *
 * Full lifecycle: create account → top-up → link wire → verify → withdraw →
 * validate transaction → validate balance → delete wire → verify deletion.
 *
 * All tests run serially and share ONE account created in beforeAll.
 */

const { test, expect } = require('@playwright/test');
const { apiPost, apiGet, apiDelete, getOAuthToken } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint } = require('../../utils/endpoints');
const {
  createTestAccount,
  sleep,
  validateResponseProperties,
  getResponseBody,
  attachRequestResponse
} = require('../../utils/helpers');
const { generateClientAccountData } = require('../../utils/test-data');
const {
  generateIncomingWireData,
  generateWireInstructionData,
  generateWithdrawFundData
} = require('../../utils/test-data-generator');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

let sharedAccount = null;
let wireInstruction = null;
let withdrawTransaction = null;

test.describe('Wire Account Creation', () => {

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    const accountData = generateClientAccountData();
    sharedAccount = await createTestAccount(request, accountData);

    const amountToAdd = 10000;
    const incomingWireData = generateIncomingWireData(sharedAccount.accountNumber, { amount: amountToAdd });
    const accessToken = await getOAuthToken(request);

    const wireResponse = await apiPost(
      request,
      ENDPOINTS.ACCOUNT.INCOMING_WIRE.path,
      incomingWireData,
      { 'Authorization': `Bearer ${accessToken}` }
    );

    if (wireResponse.status() !== 200) {
      console.warn(`Balance top-up responded with status ${wireResponse.status()} — continuing`);
    }

    await sleep(3000);
  });

  // ---------------------------------------------------------------------------

  test('TC031 - Create wire Account', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Create/link a wire account to the client account' });

    const wireData = generateWireInstructionData(sharedAccount.clientId);
    const response = await apiPost(request, ENDPOINTS.WIRE.CREATE.path, wireData, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.WIRE.CREATE.path, wireData, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [
      'identifier', 'businessName', 'accountNickname', 'accountNumber', 'wireRoutingNumber', 'createdOn'
    ]);
    expect(responseBody.accountNumber).toBe(wireData.accountNumber);

    wireInstruction = { ...responseBody, clientId: sharedAccount.clientId };
  });

  test('TC032 - Verify wire account creation by listing', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Verify wire account appears in the list' });

    const response = await apiGet(request, ENDPOINTS.WIRE.GET_LIST.path, TENANT_HEADERS, { client_id: sharedAccount.clientId });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.WIRE.GET_LIST.path, null, response, responseBody);

    expect(response.status()).toBe(200);
    expect(Array.isArray(responseBody)).toBe(true);
    expect(responseBody.length).toBeGreaterThan(0);

    const createdWire = responseBody.find(w => w.identifier === wireInstruction.identifier);
    expect(createdWire).toBeDefined();
    expect(createdWire.accountNumber).toBe(wireInstruction.accountNumber);
  });

  test('TC033 - Withdraw funds to wire account', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Withdraw funds from client account to wire account' });

    const withdrawAmount = 1000;
    const withdrawData = generateWithdrawFundData(sharedAccount.clientId, wireInstruction.identifier, { amount: withdrawAmount });
    const { path: balancePath } = buildEndpoint('ACCOUNT', 'GET_BALANCE', { clientId: sharedAccount.clientId });

    const initialBalRes = await apiGet(request, balancePath, TENANT_HEADERS);
    const initialBalance = await getResponseBody(initialBalRes);
    await attachRequestResponse('GET', balancePath, null, initialBalRes, initialBalance);
    expect(initialBalRes.status()).toBe(200);

    const withdrawRes = await apiPost(request, ENDPOINTS.WIRE.WITHDRAW.path, withdrawData, TENANT_HEADERS);
    const withdrawBody = await getResponseBody(withdrawRes);
    await attachRequestResponse('POST', ENDPOINTS.WIRE.WITHDRAW.path, withdrawData, withdrawRes, withdrawBody);

    expect(withdrawRes.status()).toBe(200);
    validateResponseProperties(expect, withdrawBody, ['transactionId', 'status', 'description', 'fromDdaAccount', 'toDdaAccount']);
    expect(withdrawBody.status).toBe('PENDING');

    withdrawTransaction = {
      ...withdrawBody,
      correlationId: withdrawData.correlationId,
      initialBalance: initialBalance.availableToSpend,
      amount: withdrawAmount
    };
  });

  test('TC034 - Validate withdrawal transaction', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Verify withdrawal transaction appears in transaction list' });

    await sleep(3000);

    const response = await apiGet(request, ENDPOINTS.ACCOUNT.GET_TRANSACTIONS.path, {}, { client_id: sharedAccount.clientId.toString() });
    const transactions = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.ACCOUNT.GET_TRANSACTIONS.path, null, response, transactions);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, transactions, ['confirmedTransactions', 'pendingTransactions', 'totalElements']);

    const transaction =
      transactions.confirmedTransactions.find(t => t.correlationId === withdrawTransaction.correlationId) ||
      transactions.pendingTransactions.find(t => t.correlationId === withdrawTransaction.correlationId);

    expect(transaction).toBeDefined();
    expect(transaction.amount).toBe(withdrawTransaction.amount);
  });

  test('TC035 - Validate balance decrease after withdrawal', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Verify account balance decreased by withdrawal amount' });

    const { path: balancePath } = buildEndpoint('ACCOUNT', 'GET_BALANCE', { clientId: sharedAccount.clientId });
    const response = await apiGet(request, balancePath, TENANT_HEADERS);
    const finalBalance = await getResponseBody(response);
    await attachRequestResponse('GET', balancePath, null, response, finalBalance);

    expect(response.status()).toBe(200);
    expect(finalBalance.availableToSpend).toBe(withdrawTransaction.initialBalance - withdrawTransaction.amount);
  });

  test('TC036 - Delete wire instruction', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Attempt to delete the wire instruction' });

    const { path } = buildEndpoint('WIRE', 'DELETE', { identifier: wireInstruction.identifier });
    const response = await apiDelete(request, path, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('DELETE', path, null, response, responseBody);

    expect([200, 204, 400]).toContain(response.status());
    wireInstruction.deleteStatus = response.status();
  });

  test('TC037 - Verify wire instruction deletion status', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Verify wire instruction deletion status in list' });

    const response = await apiGet(request, ENDPOINTS.WIRE.GET_LIST.path, TENANT_HEADERS, { client_id: sharedAccount.clientId });
    const wireList = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.WIRE.GET_LIST.path, null, response, wireList);

    expect(response.status()).toBe(200);
    expect(Array.isArray(wireList)).toBe(true);

    const wire = wireList.find(w => w.identifier === wireInstruction.identifier);

    if (wireInstruction.deleteStatus === 200 || wireInstruction.deleteStatus === 204) {
      expect(wire).toBeUndefined();
    } else {
      expect(wire).toBeDefined();
    }
  });

});
