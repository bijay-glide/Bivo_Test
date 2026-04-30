/**
 * Beneficiary Management API Test Suite
 *
 * Covers:
 * - Get Beneficiary Account Metadata (GET /api-gateway/v1/admin/beneficiary/account/fields)
 * - Add Beneficiary Account Details (PATCH /api-gateway/v1/admin/beneficiary/account)
 * - Get Beneficiary List (GET /api-gateway/v1/admin/beneficiary/accounts)
 * - Get Beneficiary By Account Number (GET /api-gateway/v1/admin/beneficiary/account/{accountNumber})
 * - Update Personal Info (PUT /api-gateway/v1/admin/beneficiary/{beneficiaryId})
 * - Update Account Details (PUT /api-gateway/v1/admin/beneficiary/account/{accountNumber})
 */

const { test, expect } = require('@playwright/test');
const { apiGet, apiPost, apiPut, apiPatch } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint } = require('../../utils/endpoints');
const {
  getResponseBody,
  validateResponseProperties,
  attachRequestResponse
} = require('../../utils/helpers');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

let testContext = {
  beneficiaryReferenceId: null,
  beneficiaryAccountNumber: null,
  accountMetadata: null
};

// ===========================================================================
// Beneficiary Account Metadata
// ===========================================================================

test.describe('Beneficiary Account Metadata API - Positive Tests', () => {

  test('TC201 - Get Beneficiary Account Metadata for bank channel', {
    annotation: { type: 'description', description: 'Retrieve required fields metadata for beneficiary bank account' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const path = ENDPOINTS.BENEFICIARY.GET_ACCOUNT_METADATA.path;
    const response = await apiGet(request, path, {}, { currency_id: '15', channel: 'bank', beneficiary_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['required', 'optional', 'properties']);

    if (responseBody.required.length > 0) {
      const firstField = responseBody.required[0];
      expect(responseBody.properties).toHaveProperty(firstField);
      expect(responseBody.properties[firstField]).toHaveProperty('mandatory');
    }

    testContext.accountMetadata = responseBody;
  });

  test('TC202 - Get Beneficiary Account Metadata for different currency', {
    annotation: { type: 'description', description: 'Retrieve metadata for INR currency (India)' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const path = ENDPOINTS.BENEFICIARY.GET_ACCOUNT_METADATA.path;
    const response = await apiGet(request, path, {}, { currency_id: '4', channel: 'bank', beneficiary_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['required', 'properties']);
  });

  test('TC203 - Verify field validation rules in metadata', {
    annotation: { type: 'description', description: 'Verify that field metadata includes validation rules' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const path = ENDPOINTS.BENEFICIARY.GET_ACCOUNT_METADATA.path;
    const response = await apiGet(request, path, {}, { currency_id: '4', channel: 'bank', beneficiary_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);

    const hasValidationRules = Object.values(responseBody.properties).some(
      field => field.regex || field.maxLength || field.minLength
    );
    expect(hasValidationRules).toBe(true);
  });

});

test.describe('Beneficiary Account Metadata API - Negative Tests', () => {

  test('TC204 - Get metadata with missing required parameter should fail', {
    annotation: { type: 'description', description: 'Verify that missing currency_id parameter is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const path = ENDPOINTS.BENEFICIARY.GET_ACCOUNT_METADATA.path;
    const response = await apiGet(request, path, {}, { channel: 'bank', beneficiary_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

  test('TC205 - Get metadata with invalid currency_id should fail', {
    annotation: { type: 'description', description: 'Verify that invalid currency_id is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const path = ENDPOINTS.BENEFICIARY.GET_ACCOUNT_METADATA.path;
    const response = await apiGet(request, path, {}, { currency_id: '99999', channel: 'bank', beneficiary_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect([400, 404, 422]).toContain(response.status());
  });

});

// ===========================================================================
// Add Beneficiary Account Details
// ===========================================================================

test.describe('Add Beneficiary Account Details API - Positive Tests', () => {

  test.beforeAll(async ({ request }) => {
    const beneficiaryData = {
      currencyId: 3,
      beneficiaryType: 'INDIVIDUAL',
      clientId: 20505,
      businessId: null,
      fields: {
        first_name: 'TestUser',
        last_name: 'ForAccount',
        phone: '9999988776',
        address_one: '789 Elm St',
        city: 'Toronto',
        postal_code: 'M5A 1A1',
        province: 'ON'
      }
    };

    const response = await apiPost(request, ENDPOINTS.BENEFICIARY.CREATE.path, beneficiaryData, TENANT_HEADERS);
    if (response.status() === 200) {
      const responseBody = await getResponseBody(response);
      testContext.beneficiaryReferenceId = responseBody.referenceId;
    }
  });

  test('TC206 - Add bank account details to beneficiary', {
    annotation: { type: 'description', description: 'Add bank account details to an existing beneficiary' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    if (!testContext.beneficiaryReferenceId) {
      test.skip();
    }

    const body = {
      businessId: null,
      clientId: 20505,
      channel: 'bank',
      beneficiaryType: 'INDIVIDUAL',
      referenceId: '886bcc50-643c-45b5-a051-b91511a3e852',
      fields: {
        bank_account_number: '004',
        routing_code: '12345',
        bank_name: 'Toronto-Dominion Bank',
        bank_code: '004'
      }
    };

    const path = ENDPOINTS.BENEFICIARY.ADD_ACCOUNT_DETAILS.path;
    const response = await apiPatch(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PATCH', path, body, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['accountNumber', 'status']);
    testContext.beneficiaryAccountNumber = responseBody.accountNumber;
  });

});

test.describe('Add Beneficiary Account Details API - Negative Tests', () => {

  test('TC207 - Add account with missing required field should fail', {
    annotation: { type: 'description', description: 'Verify that missing referenceId is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const body = {
      businessId: null,
      clientId: 20505,
      channel: 'bank',
      beneficiaryType: 'INDIVIDUAL',
      fields: { bank_account_number: '9876543210', routing_code: '011000015' }
    };

    const path = ENDPOINTS.BENEFICIARY.ADD_ACCOUNT_DETAILS.path;
    const response = await apiPatch(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PATCH', path, body, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

  test('TC208 - Add account with invalid referenceId should fail', {
    annotation: { type: 'description', description: 'Verify that invalid beneficiary referenceId is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const body = {
      businessId: null,
      clientId: 20505,
      channel: 'bank',
      beneficiaryType: 'INDIVIDUAL',
      referenceId: 'invalid-reference-id-12345',
      fields: { bank_account_number: '9876543210', routing_code: '011000015' }
    };

    const path = ENDPOINTS.BENEFICIARY.ADD_ACCOUNT_DETAILS.path;
    const response = await apiPatch(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PATCH', path, body, response, responseBody);

    expect([400, 404, 422]).toContain(response.status());
  });

});

// ===========================================================================
// Get Beneficiary List
// ===========================================================================

test.describe('Get Beneficiary List API - Positive Tests', () => {

  test('TC209 - Get beneficiary list by client_id', {
    annotation: { type: 'description', description: 'Retrieve all beneficiaries associated with a client' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const path = ENDPOINTS.BENEFICIARY.GET_LIST.path;
    const response = await apiGet(request, path, {}, { client_id: '20505' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, ['totalElements', 'totalPage', 'currentPage', 'beneficiaries']);

    if (responseBody.beneficiaries.length > 0) {
      validateResponseProperties(expect, responseBody.beneficiaries[0], [
        'referenceId', 'beneficiaryType', 'category', 'countryCode', 'currencyCode'
      ]);
    }
  });

  test('TC211 - Get beneficiary list with pagination', {
    annotation: { type: 'description', description: 'Retrieve beneficiary list with pagination parameters' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const path = ENDPOINTS.BENEFICIARY.GET_LIST.path;
    const response = await apiGet(request, path, {}, { client_id: '20505', page: 0, size: 5 });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    expect(responseBody).toHaveProperty('currentPage');
    expect(responseBody).toHaveProperty('beneficiaries');
  });

  test('TC212 - Get beneficiary list with filters', {
    annotation: { type: 'description', description: 'Retrieve beneficiary list with currency and type filters' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const path = ENDPOINTS.BENEFICIARY.GET_LIST.path;
    const response = await apiGet(request, path, {}, { client_id: '20505', currency_id: '5', beneficiary_type: 'INDIVIDUAL' });
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    expect(responseBody).toHaveProperty('beneficiaries');
  });

});

test.describe('Get Beneficiary List API - Negative Tests', () => {

  test('TC213 - Get beneficiary list without client_id or business_id should fail', {
    annotation: { type: 'description', description: 'Verify that missing both client_id and business_id is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const path = ENDPOINTS.BENEFICIARY.GET_LIST.path;
    const response = await apiGet(request, path);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

});

// ===========================================================================
// Get Beneficiary By Account Number
// ===========================================================================

test.describe('Get Beneficiary By Account Number API - Positive Tests', () => {

  test('TC214 - Get beneficiary by account number', {
    annotation: { type: 'description', description: 'Retrieve beneficiary details using account number' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const accountNumber = '5000000004460';
    const { path } = buildEndpoint('BENEFICIARY', 'GET_BY_ACCOUNT', { accountNumber });
    const response = await apiGet(request, path);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [
      'referenceId', 'beneficiaryType', 'category', 'countryCode', 'currencyCode',
      'accounts', 'accounts.accountNumber', 'accounts.channel', 'accounts.status'
    ]);
  });

});

test.describe('Get Beneficiary By Account Number API - Negative Tests', () => {

  test('TC215 - Get beneficiary with invalid account number should fail', {
    annotation: { type: 'description', description: 'Verify that invalid account number is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const { path } = buildEndpoint('BENEFICIARY', 'GET_BY_ACCOUNT', { accountNumber: '9999999999999' });
    const response = await apiGet(request, path);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('GET', path, null, response, responseBody);

    expect([500]).toContain(response.status());
  });

});

// ===========================================================================
// Update Personal Info
// ===========================================================================

test.describe('Update Personal Info API - Positive Tests', () => {

  test('TC216 - Update beneficiary personal information', {
    annotation: { type: 'description', description: 'Update personal details of an existing beneficiary' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'critical' });

    const beneficiaryId = '5a0ef078-a41f-45f3-99cc-670e847bb359';
    const { path } = buildEndpoint('BENEFICIARY', 'UPDATE_PERSONAL_INFO', { beneficiaryId });

    const body = {
      currencyId: 15,
      beneficiaryType: 'INDIVIDUAL',
      clientId: null,
      businessId: 3864,
      fields: {
        first_name: 'UpdatedFirstName',
        last_name: 'UpdatedLastName',
        phone: '9909922222',
        address_one: '121 W 70th St',
        city: 'Cincinnati',
        postal_code: '45216',
        state: 'OH'
      }
    };

    const response = await apiPut(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PUT', path, body, response, responseBody);

    expect(response.status()).toBe(200);
    validateResponseProperties(expect, responseBody, [{ field: 'referenceId', value: beneficiaryId }]);
  });

});

test.describe('Update Personal Info API - Negative Tests', () => {

  test('TC217 - Update beneficiary with invalid ID should fail', {
    annotation: { type: 'description', description: 'Verify that invalid beneficiary ID is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const { path } = buildEndpoint('BENEFICIARY', 'UPDATE_PERSONAL_INFO', { beneficiaryId: 'invalid-id-12345' });

    const body = {
      currencyId: 15,
      beneficiaryType: 'INDIVIDUAL',
      clientId: null,
      businessId: 3864,
      fields: { first_name: 'John', last_name: 'Doe', phone: '9909922222', address_one: '121 W 70th St', city: 'Cincinnati', postal_code: '45216', state: 'OH' }
    };

    const response = await apiPut(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PUT', path, body, response, responseBody);

    expect([400, 404]).toContain(response.status());
  });

  test('TC218 - Update beneficiary with missing required field should fail', {
    annotation: { type: 'description', description: 'Verify that missing first_name is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const { path } = buildEndpoint('BENEFICIARY', 'UPDATE_PERSONAL_INFO', { beneficiaryId: '5a0ef078-a41f-45f3-99cc-670e847bb359' });

    const body = {
      currencyId: 15,
      beneficiaryType: 'INDIVIDUAL',
      clientId: null,
      businessId: 3864,
      fields: { last_name: 'Doe', phone: '9909922222', address_one: '121 W 70th St', city: 'Cincinnati', postal_code: '45216', state: 'OH' }
    };

    const response = await apiPut(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PUT', path, body, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

});

// ===========================================================================
// Update Account Details
// ===========================================================================

test.describe('Update Account Details API - Negative Tests', () => {

  test('TC220 - Update account with invalid account number should fail', {
    annotation: { type: 'description', description: 'Verify that invalid account number is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'high' });

    const { path } = buildEndpoint('BENEFICIARY', 'UPDATE_ACCOUNT_DETAILS', { accountNumber: '9999999999999' });

    const body = {
      businessId: 1466,
      clientId: null,
      channel: 'bank',
      beneficiaryType: 'INDIVIDUAL',
      referenceId: '7b8c426a-f7a6-4bf1-9308-a063d46db453',
      fields: { bank_account_number: '1234567890', routing_code: '111000025' }
    };

    const response = await apiPut(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PUT', path, body, response, responseBody);

    expect([400, 404]).toContain(response.status());
  });

  test('TC221 - Update account with missing required field should fail', {
    annotation: { type: 'description', description: 'Verify that missing referenceId is rejected' }
  }, async ({ request }) => {
    test.info().annotations.push({ type: 'severity', description: 'medium' });

    const { path } = buildEndpoint('BENEFICIARY', 'UPDATE_ACCOUNT_DETAILS', { accountNumber: '5000000000877' });

    const body = {
      businessId: 1466,
      clientId: null,
      channel: 'bank',
      beneficiaryType: 'INDIVIDUAL',
      fields: { bank_account_number: '1234567890', routing_code: '111000025' }
    };

    const response = await apiPut(request, path, body, TENANT_HEADERS);
    const responseBody = await getResponseBody(response);
    await attachRequestResponse('PUT', path, body, response, responseBody);

    expect([400, 412, 422]).toContain(response.status());
  });

});
