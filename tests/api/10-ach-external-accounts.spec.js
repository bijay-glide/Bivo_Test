/**
 * ACH External Accounts - End-to-End Flow Test Suite
 *
 * Full lifecycle:
 * 1. Create a new client account (shared for all tests)
 * 2. Top-up balance via incoming wire
 * 3. Link an external ACH account
 * 4. Verify the linked account appears in the list
 * 5. Retrieve micro deposit amounts
 * 6. Verify the external account using micro deposit amounts
 * 7. Move funds (ACH) from internal to external account
 * 8. List ACH payments and confirm the transaction appears
 * 9. Get ACH transaction details and verify fields
 *
 * All tests run serially and share ONE account created in beforeAll.
 */

const { test, expect } = require('@playwright/test');
const { apiPost, apiGet, getOAuthToken } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint } = require('../../utils/endpoints');
const {
  createTestAccount,
  sleep,
  validateResponseProperties,
  getResponseBody,
  attachRequestResponse
} = require('../../utils/helpers');
const { generateClientAccountData } = require('../../utils/test-data');
const { generateIncomingWireData, generateRandomDigits } = require('../../utils/test-data-generator');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

let sharedAccount = null;
let externalAccountId = null;
let microDepositAmounts = null;
let achTransaction = null;

test.describe('ACH External Accounts - Full Flow', () => {

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    const accountData = generateClientAccountData();
    sharedAccount = await createTestAccount(request, accountData);

    const topUpAmount = 10000;
    const incomingWireData = generateIncomingWireData(sharedAccount.accountNumber, { amount: topUpAmount });
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

  test('TC041 - Link ACH external account', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Link a first-party external bank account via account and routing number' });

    const randomSuffix = generateRandomDigits(8);
    const body = {
      clientId: sharedAccount.clientId,
      accountNo: `141511${randomSuffix}`,
      accountAlias: `QA ACH Account ${randomSuffix}`,
      routingNo: '011401533',
      bankName: 'Chase',
      accountType: 'ACH'
    };

    const response = await apiPost(request, ENDPOINTS.ACH.LINK_EXTERNAL_ACCOUNT.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.ACH.LINK_EXTERNAL_ACCOUNT.path, body, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [
      'accountNumber', 'routingNo', 'accountName', 'accountSubType', { field: 'isVerified', value: false }
    ]);

    externalAccountId = responseBody.accountNumber;
  });

  test('TC042 - Verify linked account appears in external account list', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Confirm the newly linked ACH account is present in the external account list' });

    const response = await apiGet(request, ENDPOINTS.ACH.GET_EXTERNAL_ACCOUNT_LIST.path, TENANT_HEADERS, { client_id: sharedAccount.clientId });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.ACH.GET_EXTERNAL_ACCOUNT_LIST.path, null, response, responseBody);

    expect(response.status()).toBe(202);
    expect(Array.isArray(responseBody)).toBe(true);
    expect(responseBody.length).toBeGreaterThan(0);

    const linked = responseBody.find(acct => acct.externalAccountId === externalAccountId);
    expect(linked).toBeDefined();
    expect(linked.accountType).toBe('ACH');
  });

  test('TC043 - Retrieve micro deposit amounts for external account', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Simulate micro deposit retrieval to get amounts needed for account verification' });

    const { path } = buildEndpoint('ACH', 'GET_MICRO_DEPOSIT', { externalAccountId });
    const response = await apiGet(request, path, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['externalAccountId', 'amountOne', 'amountTwo']);
    expect(responseBody.externalAccountId).toBe(externalAccountId);

    microDepositAmounts = { amountOne: responseBody.amountOne, amountTwo: responseBody.amountTwo };
  });

  test('TC044 - Verify external account using micro deposit amounts', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Submit micro deposit amounts to verify the external account' });

    const body = {
      externalAccountId,
      amountOne: microDepositAmounts.amountOne,
      amountTwo: microDepositAmounts.amountTwo
    };

    const response = await apiPost(request, ENDPOINTS.ACH.VERIFY_EXTERNAL_ACCOUNT.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.ACH.VERIFY_EXTERNAL_ACCOUNT.path, body, response, responseBody);

    expect(response.status()).toBe(200);
  });

  test('TC045 - Move funds from internal account to external ACH account', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Initiate an ACH fund transfer from the client internal account to the verified external account' });

    const correlationId = `QA-ACH-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const body = {
      clientId: sharedAccount.clientId,
      fromAccount: sharedAccount.accountNumber,
      toAccount: externalAccountId,
      amount: 1.30,
      description: 'QA ACH move fund test',
      correlationId,
      instantPayment: false,
      settlementPriority: 'STANDARD'
    };

    const response = await apiPost(request, ENDPOINTS.ACH.MOVE_FUND.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.ACH.MOVE_FUND.path, body, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [
      'transactionId', 'status', 'description', 'fromDdaAccount', 'toDdaAccount', 'amount', 'correlationId'
    ]);
    expect(responseBody.status).toBe('PENDING');
    expect(responseBody.error).toBe(false);

    achTransaction = { transactionId: responseBody.transactionId, correlationId, amount: 1.30 };
  });

  test('TC046 - List ACH transactions and confirm new transaction appears', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Retrieve the ACH transaction list and confirm the initiated transfer is present' });

    await sleep(2000);

    const response = await apiGet(request, ENDPOINTS.ACH.GET_TRANSACTIONS.path, TENANT_HEADERS, { client_id: sharedAccount.clientId });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.ACH.GET_TRANSACTIONS.path, null, response, responseBody);

    expect(response.status()).toBe(202);
    expect(Array.isArray(responseBody)).toBe(true);
    expect(responseBody.length).toBeGreaterThan(0);

    const transaction = responseBody.find(t => t.transactionId === achTransaction.transactionId);
    expect(transaction).toBeDefined();
    expect(transaction.amount).toBe(achTransaction.amount);
  });

  test('TC047 - Get ACH transaction details', async ({ request }) => {
    test.info().annotations.push({ type: 'description', description: 'Fetch details of the specific ACH transaction by transaction ID and verify fields' });

    const { path } = buildEndpoint('ACH', 'GET_TRANSACTION_DETAILS', { transactionId: achTransaction.transactionId });
    const response = await apiGet(request, path, TENANT_HEADERS, { client_id: sharedAccount.clientId });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(202);
    validateResponseProperties(expect, responseBody, [
      'transactionId', 'externalAccountId', 'primaryAccount', 'amount',
      'transactionType', 'achType', 'transactionDate', 'transactionStatus',
      'correlationId', 'currencyCode'
    ]);
    expect(responseBody.transactionId).toBe(achTransaction.transactionId);
    expect(responseBody.externalAccountId).toBe(externalAccountId);
    expect(responseBody.amount).toBe(achTransaction.amount);
    expect(responseBody.correlationId).toBe(achTransaction.correlationId);
  });

});
