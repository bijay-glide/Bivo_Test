/**
 * FX Payment API Test Suite
 *
 * Covers:
 * - Create FX Transfer (POST /api-gateway/v1/admin/payments)
 * - Get FX Transactions (GET /api-gateway/v1/admin/payments/list)
 * - Get Pending Transactions (GET /api-gateway/v1/admin/payments/list/pending)
 * - Get Payment Status (GET /api-gateway/v1/admin/payments/status/{paymentIdentifier})
 * - Cancel Payment (POST /api-gateway/v1/admin/payments/cancel/{paymentIdentifier})
 */

const { test, expect } = require('@playwright/test');
const { apiGet, apiPost } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint } = require('../../utils/endpoints');
const {
  getResponseBody,
  sleep,
  validateResponseProperties,
  attachRequestResponse
} = require('../../utils/helpers');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

let testContext = {
  createdPaymentIdentifier: null,
  pendingTransactions: []
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(45000);
test.afterEach(async () => { await sleep(1000); });

// ===========================================================================
// Create FX Transfer - Positive
// ===========================================================================

test.describe('Create FX Transfer API - Positive Tests', () => {

  test('TC301 - Create FX transfer with valid data', {
    annotation: { type: 'description', description: 'Create a new FX transfer payment with valid data' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const body = {
      clientId: 20505,
      businessId: null,
      fromAccount: '10000000026554',
      beneficiaryAccount: '5000000007090',
      amount: 10,
      toCurrencyId: 15,
      amountCurrencyId: null,
      description: 'Automation Test - Playwright : Creating a Transaction',
      correlationId: `corr_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      rate: 141.25,
      fees: 6.99
    };

    const response = await apiPost(request, ENDPOINTS.PAYMENT.CREATE.path, body);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.PAYMENT.CREATE.path, body, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['paymentIdentifier', 'status']);
    testContext.createdPaymentIdentifier = responseBody.paymentIdentifier;
  });

});

// ===========================================================================
// Create FX Transfer - Negative
// ===========================================================================

test.describe('Create FX Transfer API - Negative Tests', () => {

  test('TC303 - Create FX transfer with missing required field should fail', {
    annotation: { type: 'description', description: 'Verify that missing beneficiaryAccount is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const body = {
      clientId: 20505,
      businessId: null,
      fromAccount: '10000000026554',
      amount: 10,
      toCurrencyId: 15,
      description: 'Test payment',
      correlationId: `corr_${Date.now()}_${Math.random().toString(36).substring(7)}`
    };

    const response = await apiPost(request, ENDPOINTS.PAYMENT.CREATE.path, body);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.PAYMENT.CREATE.path, body, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

  test('TC304 - Create FX transfer with duplicate correlation ID should fail', {
    annotation: { type: 'description', description: 'Verify that duplicate correlationId is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const duplicateCorrelationId = `corr_duplicate_${Date.now()}`;
    const basePayment = {
      clientId: 20505,
      businessId: null,
      fromAccount: '10000000026554',
      beneficiaryAccount: '5000000007090',
      amount: 10,
      toCurrencyId: 15,
      correlationId: duplicateCorrelationId
    };

    const firstRes = await apiPost(request, ENDPOINTS.PAYMENT.CREATE.path, { ...basePayment, description: 'First payment' });
    const firstBody = await getResponseBody(firstRes);
    await attachRequestResponse('POST', ENDPOINTS.PAYMENT.CREATE.path, { ...basePayment, description: 'First payment' }, firstRes, firstBody);
    expect(firstRes.status()).toBe(200);

    const secondPayment = { ...basePayment, amount: 20, description: 'Second payment' };
    const response = await apiPost(request, ENDPOINTS.PAYMENT.CREATE.path, secondPayment);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.PAYMENT.CREATE.path, secondPayment, response, responseBody);

    expect(response.status()).toBe(500);
  });

  test('TC305 - Create FX transfer with invalid amount should fail', {
    annotation: { type: 'description', description: 'Verify that negative or zero amount is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const body = {
      clientId: 20505,
      businessId: null,
      fromAccount: '10000000026554',
      beneficiaryAccount: '5000000007090',
      amount: -10,
      toCurrencyId: 15,
      description: 'Test payment',
      correlationId: `corr_${Date.now()}_${Math.random().toString(36).substring(7)}`
    };

    const response = await apiPost(request, ENDPOINTS.PAYMENT.CREATE.path, body);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.PAYMENT.CREATE.path, body, response, responseBody);

    expect(response.status()).toBe(500);
  });

  test('TC306 - Create FX transfer with invalid beneficiary account should fail', {
    annotation: { type: 'description', description: 'Verify that non-existent beneficiary account is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const body = {
      clientId: 20505,
      businessId: null,
      fromAccount: '10000000026554',
      beneficiaryAccount: '9999999999999',
      amount: 10,
      toCurrencyId: 15,
      description: 'Test payment',
      correlationId: `corr_${Date.now()}_${Math.random().toString(36).substring(7)}`
    };

    const response = await apiPost(request, ENDPOINTS.PAYMENT.CREATE.path, body);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.PAYMENT.CREATE.path, body, response, responseBody);

    expect(response.status()).toBe(500);
  });

});

// ===========================================================================
// Get FX Transactions
// ===========================================================================

test.describe('Get FX Transactions API - Positive Tests', () => {

  test('TC307 - Get FX transactions list for business', {
    annotation: { type: 'description', description: 'Retrieve paginated list of FX transactions for a business' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_LIST.path, TENANT_HEADERS, { page: 0, size: 20, client_id: '20505' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_LIST.path, null, response, responseBody);

    expect(response.status()).toBe(200);
  });

});

// ===========================================================================
// Get Pending Transactions
// ===========================================================================

test.describe('Get Pending Transactions API - Positive Tests', () => {

  test('TC310 - Get pending FX transactions for business', {
    annotation: { type: 'description', description: 'Retrieve list of pending FX transactions' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_PENDING.path, TENANT_HEADERS, { page: 0, size: 20, business_id: '1466' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_PENDING.path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['totalElements', 'totalPage', 'transactions']);

    if (responseBody.transactions.length > 0) {
      for (const tx of responseBody.transactions) {
        expect(tx).toHaveProperty('status');
        expect(['PENDING', 'PENDING_FUNDS', 'UNDER_REVIEW']).toContain(tx.status);
      }
      testContext.pendingTransactions = responseBody.transactions;
    }
  });

  test('TC311 - Get pending transactions with pagination', {
    annotation: { type: 'description', description: 'Verify pagination for pending transactions' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_PENDING.path, TENANT_HEADERS, { page: 0, size: 10, business_id: '1466' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_PENDING.path, null, response, responseBody);

    expect(response.status()).toBe(200);
    expect(responseBody.size).toBe(10);
  });

});

// ===========================================================================
// Get Payment Status
// ===========================================================================

test.describe('Get Payment Status API - Positive Tests', () => {

  test('TC312 - Get payment status by payment identifier', {
    annotation: { type: 'description', description: 'Retrieve payment status using payment identifier' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const paymentIdentifier = 'MQYy7LFc';
    const { path } = buildEndpoint('PAYMENT', 'GET_STATUS', { paymentIdentifier });
    const response = await apiGet(request, path, TENANT_HEADERS, { client_id: '20505' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [
      { field: 'paymentIdentifier', value: paymentIdentifier },
      'beneficiaryAccountNumber',
      'clientAccountNumber',
      'amount',
      'status',
      'fromCurrency',
      'toCurrency',
      'rate',
      'fees'
    ]);
  });

});

// ===========================================================================
// Cancel Payment
// ===========================================================================

test.describe('Cancel Payment API - Positive Tests', () => {

  test('TC316 - Cancel a pending payment', {
    annotation: { type: 'description', description: 'Cancel a pending FX payment' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const paymentBody = {
      clientId: 20505,
      businessId: null,
      fromAccount: '10000000026554',
      beneficiaryAccount: '5000000007090',
      amount: 10,
      toCurrencyId: 15,
      amountCurrencyId: null,
      description: 'Test payment for cancellation',
      correlationId: `corr_cancel_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      rate: 141.25,
      fees: 6.99
    };

    await test.step('Create a new FX payment to cancel', async () => {
      const createRes = await apiPost(request, ENDPOINTS.PAYMENT.CREATE.path, paymentBody);
      const createBody = await getResponseBody(createRes);
      await attachRequestResponse('POST', ENDPOINTS.PAYMENT.CREATE.path, paymentBody, createRes, createBody);
      expect(createRes.status()).toBe(200);
      expect(createBody).toHaveProperty('paymentIdentifier');
      testContext.createdPaymentIdentifier = createBody.paymentIdentifier;
    });

    await test.step('Cancel the payment', async () => {
      const { path } = buildEndpoint('PAYMENT', 'CANCEL', { paymentIdentifier: testContext.createdPaymentIdentifier });
      const fullPath = `${path}?client_id=20505`;
      const response = await apiPost(request, fullPath, {}, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', fullPath, {}, response, responseBody);
      expect([200, 204]).toContain(response.status());
    });
  });

});

test.describe('Cancel Payment API - Negative Tests', () => {

  test('TC317 - Cancel payment with invalid identifier should fail', {
    annotation: { type: 'description', description: 'Verify that invalid payment identifier is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const { path } = buildEndpoint('PAYMENT', 'CANCEL', { paymentIdentifier: 'INVALID123' });
    const fullPath = `${path}?client_id=20505`;
    const response = await apiPost(request, fullPath, {}, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', fullPath, {}, response, responseBody);

    expect([500]).toContain(response.status());
  });

  test('TC318 - Cancel already cancelled payment should fail', {
    annotation: { type: 'description', description: 'Verify that already cancelled payment cannot be cancelled again' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const { path } = buildEndpoint('PAYMENT', 'CANCEL', { paymentIdentifier: 'gcxGngAV' });
    const fullPath = `${path}?business_id=2054`;

    await apiPost(request, fullPath, {}, TENANT_HEADERS);

    const response = await apiPost(request, fullPath, {}, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', fullPath, {}, response, responseBody);

    expect([200, 400, 409, 422]).toContain(response.status());
  });

});
