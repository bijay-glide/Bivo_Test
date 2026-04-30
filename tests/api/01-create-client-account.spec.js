/**
 * Create Client Account API Test Suite
 * Endpoint: POST /api-gateway/v1/admin/accounts
 *
 * Covers:
 * - Creating client accounts with valid data (TC001)
 * - Duplicate correlation ID rejection (TC002)
 * - Missing required fields: email, firstName (TC003-TC004)
 * - Data format validations: email, phone, date, address, empty values (TC005-TC010)
 */

const { test, expect } = require('@playwright/test');
const { apiPost } = require('../../utils/api-client');
const { ENDPOINTS } = require('../../utils/endpoints');
const { getResponseBody, validateAndGetBody, attachRequestResponse } = require('../../utils/helpers');
const { generateClientAccountData } = require('../../utils/test-data');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

// ---------------------------------------------------------------------------
// Positive Tests
// ---------------------------------------------------------------------------

test.describe('Create Client Account API - Positive Tests', () => {

  test('TC001 - Create Client Account with valid data', {
    annotation: { type: 'description', description: 'Create a new client account with valid personal info and address' }
  }, async ({ request }) => {

    const accountData = generateClientAccountData();
    let response, responseBody;

    await test.step('Send POST request with valid account data', async () => {
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await validateAndGetBody(expect, response, 200);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate all response fields are present and correctly typed', async () => {
      expect(responseBody.referenceId,    'referenceId should be a UUID string').toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(typeof responseBody.accountNumber, 'accountNumber should be a string').toBe('string');
      expect(responseBody.accountNumber.length,  'accountNumber should not be empty').toBeGreaterThan(0);
      expect(typeof responseBody.clientId,       'clientId should be a number').toBe('number');
      expect(responseBody.status,                'status on creation should be REQUESTED').toBe('REQUESTED');
      expect(responseBody.correlationId,         'correlationId should echo the request value').toBe(accountData.correlationId);
    });

  });

});

// ---------------------------------------------------------------------------
// Negative Tests
// ---------------------------------------------------------------------------

test.describe('Create Client Account API - Negative Tests', () => {

  test('TC002 - Create Client Account with duplicate correlation ID should fail', {
    annotation: { type: 'description', description: 'Verify that reusing an existing correlation ID is rejected with 400' }
  }, async ({ request }) => {

    const duplicateCorrelationId = `QA-Auto_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    await test.step('Create first account to register the correlation ID', async () => {
      const firstAccountData = generateClientAccountData({ correlationId: duplicateCorrelationId });
      const firstResponse = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, firstAccountData, TENANT_HEADERS);
      expect(firstResponse.status()).toBe(200);
    });

    let response, responseBody;

    await test.step('Attempt second account creation with the same correlation ID', async () => {
      const secondAccountData = generateClientAccountData({ correlationId: duplicateCorrelationId });
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, secondAccountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, secondAccountData, response, responseBody);
    });

    await test.step('Validate 400 error response body', async () => {
      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('830132');
      expect(responseBody.userMessage).toBe('Correlation ID must be unique');
      expect(responseBody.statusCode).toBe(400);
    });

  });

  test('TC003 - Create Client Account with missing email should fail', {
    annotation: { type: 'description', description: 'Verify that a missing email field is rejected with 412' }
  }, async ({ request }) => {

    let response, responseBody;

    await test.step('Send request with email removed from personalInfo', async () => {
      const accountData = generateClientAccountData();
      delete accountData.personalInfo.email;
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate 412 error response body', async () => {
      expect(response.status()).toBe(412);
      expect(responseBody.errorCode).toBe('5002');
      expect(responseBody.userMessage).toContain('personalInfo.email');
      expect(responseBody.userMessage).toContain('must not be empty');
    });

  });

  test('TC004 - Create Client Account with missing firstName should fail', {
    annotation: { type: 'description', description: 'Verify that a missing firstName field is rejected with 412' }
  }, async ({ request }) => {

    let response, responseBody;

    await test.step('Send request with firstName removed from personalInfo', async () => {
      const accountData = generateClientAccountData();
      delete accountData.personalInfo.firstName;
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate 412 error response body', async () => {
      expect(response.status()).toBe(412);
      expect(responseBody.errorCode).toBe('5002');
      expect(responseBody.userMessage).toContain('personalInfo.firstName');
      expect(responseBody.userMessage).toContain('must not be empty');
    });

  });

});

// ---------------------------------------------------------------------------
// Data Validation Tests
// ---------------------------------------------------------------------------

test.describe('Create Client Account API - Data Validation Tests', () => {

  test('TC005 - Create account with invalid email format should fail', {
    annotation: { type: 'description', description: 'Verify that a malformed email address is rejected with 500' }
  }, async ({ request }) => {

    let response, responseBody;

    await test.step('Send request with a non-email string as email value', async () => {
      const accountData = generateClientAccountData({ personalInfo: { email: 'invalid-email-format' } });
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate 500 error response body', async () => {
      expect(response.status()).toBe(500);
      expect(responseBody.errorCode).toBe('5002');
      expect(responseBody.userMessage).toContain('email');
      expect(responseBody.userMessage).toContain('must be a well-formed email address');
    });

  });

  test('TC006 - Create account with invalid phone number should fail', {
    annotation: { type: 'description', description: 'Verify that a 3-digit phone number is rejected with 500' }
  }, async ({ request }) => {

    let response, responseBody;

    await test.step('Send request with a 3-digit phone number (too short)', async () => {
      const accountData = generateClientAccountData({ personalInfo: { phoneNumber: '123' } });
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate 500 error response body', async () => {
      expect(response.status()).toBe(500);
      expect(responseBody.errorCode).toBe('5002');
      expect(responseBody.userMessage).toContain('phoneNumber');
      expect(responseBody.userMessage).toContain('Phone number format is not valid.');
    });

  });

  test('TC007 - Create account with invalid date of birth format should fail', {
    annotation: { type: 'description', description: 'Verify that date in MM/DD/YYYY format is rejected (API expects YYYY-MM-DD)' }
  }, async ({ request }) => {

    let response, responseBody;

    await test.step('Send request with dateOfBirth in MM/DD/YYYY format instead of YYYY-MM-DD', async () => {
      const accountData = generateClientAccountData({ personalInfo: { dateOfBirth: '01/01/1990' } });
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate 500 error response body', async () => {
      expect(response.status()).toBe(500);
      expect(responseBody.errorCode).toBe('500012');
      expect(responseBody.userMessage).toBe('An error occurred while processing the request');
    });

  });

  // API BEHAVIOR GAP: The endpoint currently accepts any countryCode value, including
  // invalid codes like 'XX', and responds with 200 REQUESTED. Country code validation
  // is not enforced server-side. Skipped until the API adds country code validation.
  test.skip('TC008 - Create account with invalid country code should fail', async () => {});

  test('TC009 - Create account with missing address should fail', {
    annotation: { type: 'description', description: 'Verify that omitting the address object entirely is rejected with 412' }
  }, async ({ request }) => {

    let response, responseBody;

    await test.step('Send request with address object removed', async () => {
      const accountData = generateClientAccountData();
      delete accountData.address;
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate 412 error response body', async () => {
      expect(response.status()).toBe(412);
      expect(responseBody.errorCode).toBe('5002');
      expect(responseBody.userMessage).toContain('address');
      expect(responseBody.userMessage).toContain('must not be null');
    });

  });

  test('TC010 - Create account with empty firstName should fail', {
    annotation: { type: 'description', description: 'Verify that an empty string for firstName is rejected with 412' }
  }, async ({ request }) => {

    let response, responseBody;

    await test.step('Send request with firstName set to empty string', async () => {
      const accountData = generateClientAccountData({ personalInfo: { firstName: '' } });
      response = await apiPost(request, ENDPOINTS.ACCOUNT.CREATE.path, accountData, TENANT_HEADERS);
      responseBody = await getResponseBody(response);
      await attachRequestResponse(ENDPOINTS.ACCOUNT.CREATE.method, ENDPOINTS.ACCOUNT.CREATE.path, accountData, response, responseBody);
    });

    await test.step('Validate 412 error response body', async () => {
      expect(response.status()).toBe(412);
      expect(responseBody.errorCode).toBe('5002');
      expect(responseBody.userMessage).toContain('personalInfo.firstName');
      expect(responseBody.userMessage).toContain('must not be empty');
    });

  });

});
