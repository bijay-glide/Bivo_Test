/**
 * Beneficiary and Currency API Test Suite
 *
 * Covers:
 * - Get Currency List (GET /api-gateway/v1/admin/beneficiary/currencies)
 * - Get Payment Channels (GET /api-gateway/v1/admin/beneficiary/channels/{currencyId})
 * - Create Beneficiary (POST /api-gateway/v1/admin/beneficiary)
 * - Get Currency Rates (GET /api-gateway/v1/admin/payments/currency/rate)
 */

const { test, expect } = require('@playwright/test');
const { apiGet, apiPost } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint } = require('../../utils/endpoints');
const {
  getResponseBody,
  validateResponseProperties,
  attachRequestResponse
} = require('../../utils/helpers');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

let testContext = {
  currencies: [],
  selectedCurrency: null,
  createdBeneficiary: null
};

// ===========================================================================
// Currency APIs
// ===========================================================================

test.describe('Currency APIs - Positive Tests', () => {

  test('TC101 - Get Currency List', {
    annotation: { type: 'description', description: 'Retrieve all supported currencies from the system' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const response = await apiGet(request, ENDPOINTS.BENEFICIARY.GET_CURRENCIES.path);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.BENEFICIARY.GET_CURRENCIES.path, null, response, responseBody);

    expect(response.status()).toBe(200);

    if (responseBody.length > 0) {
      validateResponseProperties(expect, responseBody[0], ['id', 'country', 'countryCode', 'currency', 'currencyCode']);
    }

    testContext.currencies = responseBody;
    testContext.selectedCurrency = responseBody.find(c => c.currencyCode === 'INR') || responseBody[0];
  });

  test('TC102 - Verify currency list contains expected countries', {
    annotation: { type: 'description', description: 'Verify that currency list contains common countries' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const response = await apiGet(request, ENDPOINTS.BENEFICIARY.GET_CURRENCIES.path);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.BENEFICIARY.GET_CURRENCIES.path, null, response, responseBody);

    expect(response.status()).toBe(200);
    const countryCodes = responseBody.map(c => c.countryCode);
    for (const code of ['US', 'IN', 'GB', 'CA']) {
      expect(countryCodes).toContain(code);
    }
  });

});

// ===========================================================================
// Payment Channels
// ===========================================================================

test.describe('Payment Channels APIs - Positive Tests', () => {

  test.beforeAll(async ({ request }) => {
    if (testContext.currencies.length === 0) {
      const res = await apiGet(request, ENDPOINTS.BENEFICIARY.GET_CURRENCIES.path);
      testContext.currencies = await getResponseBody(res);
      testContext.selectedCurrency = testContext.currencies.find(c => c.currencyCode === 'INR') || testContext.currencies[0];
    }
  });

  test('TC103 - Get Payment Channels for INDIVIDUAL beneficiary', {
    annotation: { type: 'description', description: 'Retrieve available payment channels for individual beneficiary type' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const { path } = buildEndpoint('BENEFICIARY', 'GET_CHANNELS', { currencyId: testContext.selectedCurrency.id });
    const response = await apiGet(request, path, {}, { beneficiary_type: 'INDIVIDUAL', sender_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect([200, 202]).toContain(response.status());
    expect(Array.isArray(responseBody)).toBeTruthy();

    if (responseBody.length > 0) {
      expect(responseBody[0]).toHaveProperty('name');
      expect(responseBody[0]).toHaveProperty('displayName');
      expect(responseBody[0]).toHaveProperty('beneficiaryType');
    }
  });

  test('TC104 - Get Payment Channels for BUSINESS beneficiary', {
    annotation: { type: 'description', description: 'Retrieve available payment channels for business beneficiary type' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const { path } = buildEndpoint('BENEFICIARY', 'GET_CHANNELS', { currencyId: testContext.selectedCurrency.id });
    const response = await apiGet(request, path, {}, { beneficiary_type: 'BUSINESS', sender_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect([200, 202]).toContain(response.status());
    expect(Array.isArray(responseBody)).toBeTruthy();
  });

});

// ===========================================================================
// Create Beneficiary
// ===========================================================================

test.describe('Create Beneficiary API - Positive Tests', () => {

  test('TC105 - Create Individual Beneficiary with valid data', {
    annotation: { type: 'description', description: 'Create a new individual beneficiary with valid personal information' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const canadaCurrency = testContext.currencies.find(c => c.countryCode === 'CA');
    const body = {
      currencyId: canadaCurrency ? canadaCurrency.id : 3,
      beneficiaryType: 'INDIVIDUAL',
      clientId: 20505,
      businessId: null,
      fields: {
        first_name: 'Mia',
        last_name: 'Johnson',
        phone: '9999988776',
        address_one: '789 Elm St',
        city: 'Toronto',
        postal_code: 'M5A 1A1',
        province: 'ON'
      }
    };

    const response = await apiPost(request, ENDPOINTS.BENEFICIARY.CREATE.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.BENEFICIARY.CREATE.path, body, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['referenceId']);
    testContext.createdBeneficiary = responseBody;
  });

  test('TC106 - Create Business Beneficiary with valid data', {
    annotation: { type: 'description', description: 'Create a new business beneficiary with valid information' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const usCurrency = testContext.currencies.find(c => c.countryCode === 'US');
    const body = {
      currencyId: usCurrency ? usCurrency.id : 5,
      beneficiaryType: 'BUSINESS',
      clientId: null,
      businessId: 1466,
      fields: {
        business_name: 'Tech Solutions Inc',
        phone: '9999922222',
        address_one: '121 W 70th St',
        city: 'Cincinnati',
        postal_code: '45216',
        state: 'OH'
      }
    };

    const response = await apiPost(request, ENDPOINTS.BENEFICIARY.CREATE.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.BENEFICIARY.CREATE.path, body, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['referenceId']);
  });

});

test.describe('Create Beneficiary API - Negative Tests', () => {

  test('TC107 - Create Beneficiary with missing required field should fail', {
    annotation: { type: 'description', description: 'Verify that missing first_name field is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const body = {
      currencyId: 3,
      beneficiaryType: 'INDIVIDUAL',
      clientId: 20505,
      businessId: null,
      fields: { last_name: 'Johnson', phone: '9999988776', address_one: '789 Elm St', city: 'Toronto', postal_code: 'M5A 1A1', province: 'ON' }
    };

    const response = await apiPost(request, ENDPOINTS.BENEFICIARY.CREATE.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.BENEFICIARY.CREATE.path, body, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

  test('TC108 - Create Beneficiary with invalid beneficiaryType should fail', {
    annotation: { type: 'description', description: 'Verify that invalid beneficiary type is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const body = {
      currencyId: 3,
      beneficiaryType: 'INVALID_TYPE',
      clientId: 20505,
      businessId: null,
      fields: { first_name: 'John', last_name: 'Doe', phone: '9999988776', address_one: '789 Elm St', city: 'Toronto', postal_code: 'M5A 1A1', province: 'ON' }
    };

    const response = await apiPost(request, ENDPOINTS.BENEFICIARY.CREATE.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.BENEFICIARY.CREATE.path, body, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

  test('TC109 - Create Beneficiary with missing currencyId should fail', {
    annotation: { type: 'description', description: 'Verify that missing currencyId is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const body = {
      beneficiaryType: 'INDIVIDUAL',
      clientId: 20505,
      businessId: null,
      fields: { first_name: 'Jane', last_name: 'Smith', phone: '9999988776', address_one: '789 Elm St', city: 'Toronto', postal_code: 'M5A 1A1', province: 'ON' }
    };

    const response = await apiPost(request, ENDPOINTS.BENEFICIARY.CREATE.path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('POST', ENDPOINTS.BENEFICIARY.CREATE.path, body, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

});

// ===========================================================================
// Currency Rate APIs
// ===========================================================================

test.describe('Currency Rate APIs - Positive Tests', () => {

  test('TC110 - Get Currency Exchange Rate (USD to INR)', {
    annotation: { type: 'description', description: 'Retrieve exchange rate for USD to INR conversion' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, TENANT_HEADERS, {
      to_currency_code: 'INR', amount: '1000', to_country_code: 'IN', amount_currency_code: 'USD'
    });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [
      { field: 'fromCurrency', value: 'USD' },
      { field: 'toCurrency', value: 'INR' },
      'fromCurrencyId', 'toCurrencyId', 'amount', 'amountReceives', 'exchangeAmount', 'conversionRate', 'fees'
    ]);
  });

  test('TC111 - Get Currency Exchange Rate with different amount', {
    annotation: { type: 'description', description: 'Verify exchange rate calculation for different amounts' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, TENANT_HEADERS, {
      to_currency_code: 'GBP', amount: '500', to_country_code: 'GB', amount_currency_code: 'USD'
    });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [
      { field: 'fromCurrency', value: 'USD' },
      { field: 'toCurrency', value: 'GBP' },
      { field: 'amount', value: 500.00 }
    ]);
  });

  test('TC112 - Get Currency Exchange Rate with channel parameter', {
    annotation: { type: 'description', description: 'Retrieve exchange rate with specific payment channel' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, TENANT_HEADERS, {
      to_currency_code: 'INR', amount: '2000', to_country_code: 'IN', amount_currency_code: 'USD', channel: 'bank'
    });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, null, response, responseBody);

    expect(response.status()).toBe(200);
  });

});

test.describe('Currency Rate APIs - Negative Tests', () => {

  test('TC113 - Get Currency Rate with missing required parameter should fail', {
    annotation: { type: 'description', description: 'Verify that missing to_currency_code parameter is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, TENANT_HEADERS, {
      amount: '1000', to_country_code: 'IN', amount_currency_code: 'USD'
    });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, null, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

  test('TC114 - Get Currency Rate with invalid currency code should fail', {
    annotation: { type: 'description', description: 'Verify that invalid currency code is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, TENANT_HEADERS, {
      to_currency_code: 'INVALID', amount: '1000', to_country_code: 'XX', amount_currency_code: 'USD'
    });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, null, response, responseBody);

    expect([500]).toContain(response.status());
  });

  test('TC115 - Get Currency Rate with invalid amount should fail', {
    annotation: { type: 'description', description: 'Verify that invalid amount format is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const response = await apiGet(request, ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, TENANT_HEADERS, {
      to_currency_code: 'INR', amount: 'invalid_amount', to_country_code: 'IN', amount_currency_code: 'USD'
    });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', ENDPOINTS.PAYMENT.GET_CURRENCY_RATE.path, null, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

});
