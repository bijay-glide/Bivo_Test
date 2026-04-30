/**
 * Account Write Operations API Test Suite
 *
 * Covers WRITE/UPDATE operations for account data:
 * - Add Balance via Incoming Wire: POST /transactions/v1/internal/external-payment/incoming-wire
 *
 * All tests share ONE account created in beforeAll().
 */

const { test, expect } = require('@playwright/test');
const { apiPost, apiGet, getOAuthToken } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint } = require('../../utils/endpoints');
const {
  getResponseBody,
  createTestAccount,
  sleep,
  validateResponseProperties,
  attachRequestResponse
} = require('../../utils/helpers');
const { generateClientAccountData } = require('../../utils/test-data');
const { generateIncomingWireData } = require('../../utils/test-data-generator');

let sharedAccount = null;

test.describe('Account Write Operations', () => {

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    const accountData = generateClientAccountData();
    sharedAccount = await createTestAccount(request, accountData);
  });

  // ---------------------------------------------------------------------------

  test.describe('Add Balance via Incoming Wire API - Positive Tests', () => {

    test('TC026 - Verify balance increased after adding funds via incoming wire', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify balance increased after adding funds using incoming-wire API with OAuth' });

      const amountToAdd = 5000;
      const incomingWireData = generateIncomingWireData(sharedAccount.accountNumber, { amount: amountToAdd });
      const { path: balancePath } = buildEndpoint('ACCOUNT', 'GET_BALANCE', { clientId: sharedAccount.clientId });

      const accessToken = await getOAuthToken(request);

      // Record initial balance
      const initialBalRes = await apiGet(request, balancePath, { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER });
      const initialBalance = await getResponseBody(initialBalRes);
      await attachRequestResponse('GET', balancePath, null, initialBalRes, initialBalance);
      expect(initialBalRes.status()).toBe(200);

      // Add funds
      const wireRes = await apiPost(request, ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, { 'Authorization': `Bearer ${accessToken}` });
      const wireBody = await getResponseBody(wireRes);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, wireRes, wireBody);
      expect(wireRes.status()).toBe(200);

      await sleep(3000);

      // Verify transaction in list
      const txRes = await apiGet(request, ENDPOINTS.ACCOUNT.GET_TRANSACTIONS.path, {}, { client_id: sharedAccount.clientId.toString() });
      const transactions = await getResponseBody(txRes);
      await attachRequestResponse('GET', ENDPOINTS.ACCOUNT.GET_TRANSACTIONS.path, null, txRes, transactions);
      expect(txRes.status()).toBe(200);

      validateResponseProperties(expect, transactions, [
        'confirmedTransactions',
        'pendingTransactions',
        'totalElements'
      ]);

      const transaction =
        transactions.confirmedTransactions.find(t => t.correlationId === incomingWireData.correlationId) ||
        transactions.pendingTransactions.find(t => t.correlationId === incomingWireData.correlationId);

      expect(transaction).toBeDefined();
      validateResponseProperties(expect, transaction, [
        { field: 'amount', value: amountToAdd },
        { field: 'correlationId', value: incomingWireData.correlationId },
        { field: 'account', value: sharedAccount.accountNumber }
      ]);

      // Verify final balance
      const finalBalRes = await apiGet(request, balancePath, { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER });
      const finalBalance = await getResponseBody(finalBalRes);
      await attachRequestResponse('GET', balancePath, null, finalBalRes, finalBalance);
      expect(finalBalRes.status()).toBe(200);
      expect(finalBalance.availableToSpend).toBe(initialBalance.availableToSpend + amountToAdd);
    });

    test('TC024 - Add small balance amount via incoming wire', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Add small balance amount to verify system handles small transactions' });

      const accessToken = await getOAuthToken(request);
      const incomingWireData = generateIncomingWireData(sharedAccount.accountNumber, {
        amount: 1,
        description: 'Test small incoming wire transfer'
      });

      const response = await apiPost(request, ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, { 'Authorization': `Bearer ${accessToken}` });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, response, responseBody);
      expect(response.status()).toBe(200);
    });

    test('TC025 - Add large balance amount via incoming wire', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Add large balance amount to verify system handles large transactions' });

      const accessToken = await getOAuthToken(request);
      const incomingWireData = generateIncomingWireData(sharedAccount.accountNumber, {
        amount: 1000000,
        description: 'Test large incoming wire transfer'
      });

      const response = await apiPost(request, ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, { 'Authorization': `Bearer ${accessToken}` });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, response, responseBody);
      expect(response.status()).toBe(200);
    });

  });

  // ---------------------------------------------------------------------------

  test.describe('Incoming Wire API - Negative Tests', () => {

    test('TC027 - Add Balance with negative amount should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that negative amount is rejected' });
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const accessToken = await getOAuthToken(request);
      const incomingWireData = generateIncomingWireData(sharedAccount.accountNumber, { amount: -1000, description: 'Test negative amount' });

      const response = await apiPost(request, ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, { 'Authorization': `Bearer ${accessToken}` });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, response, responseBody);
      expect([400, 412, 422, 500]).toContain(response.status());
    });

    test('TC028 - Add Balance with zero amount', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify system behavior with zero amount' });

      const accessToken = await getOAuthToken(request);
      const incomingWireData = generateIncomingWireData(sharedAccount.accountNumber, { amount: 0, description: 'Test zero amount' });

      const response = await apiPost(request, ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, { 'Authorization': `Bearer ${accessToken}` });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, response, responseBody);
      expect([200, 400, 412, 422, 500]).toContain(response.status());
    });

    test('TC029 - Add Balance with missing amount should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that missing amount is rejected' });

      const accessToken = await getOAuthToken(request);
      const wireData = generateIncomingWireData(sharedAccount.accountNumber);
      delete wireData.amount;

      const response = await apiPost(request, ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, wireData, { 'Authorization': `Bearer ${accessToken}` });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, wireData, response, responseBody);
      expect([400, 412, 422, 500]).toContain(response.status());
    });

    test('TC030 - Add Balance with invalid account number should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that invalid account number is rejected' });

      const accessToken = await getOAuthToken(request);
      const incomingWireData = generateIncomingWireData('99999999999999', { amount: 1000, description: 'Test invalid account' });

      const response = await apiPost(request, ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, { 'Authorization': `Bearer ${accessToken}` });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.INCOMING_WIRE.path, incomingWireData, response, responseBody);
      expect([400, 404, 422, 500]).toContain(response.status());
    });

  });

});
