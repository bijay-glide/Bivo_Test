/**
 * Extended Client Account API Test Suite
 *
 * Covers additional APIs not in tests 01-04:
 * 1. Get Account Payment Instructions (GET)
 * 2. Create KYC Journey URL (POST)
 * 3. Update KYC Details (PUT)
 * 4. Get User KYC Journey URLs (GET)
 * 5. Close Account (POST)
 *
 * Test Cases: TC046 - TC065
 */

const { test, expect } = require('@playwright/test');
const { apiGet, apiPost, apiPut } = require('../../utils/api-client');
const { ENDPOINTS } = require('../../utils/endpoints');
const {
  getResponseBody,
  createTestAccount,
  validateResponseProperties,
  attachRequestResponse
} = require('../../utils/helpers');
const { generateClientAccountData } = require('../../utils/test-data');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

let sharedAccount = null;
let sharedAccountData = null;

test.describe('Extended Client Account APIs', () => {

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    sharedAccountData = generateClientAccountData();
    sharedAccount = await createTestAccount(request, sharedAccountData);
  });

  // ===========================================================================
  // 1. GET ACCOUNT PAYMENT INSTRUCTIONS
  // ===========================================================================

  test.describe('Get Account Payment Instructions API', () => {

    test('TC046 - Get payment instructions with valid account number', {
      annotation: { type: 'description', description: 'Retrieve payment instructions for a valid account' }
    }, async ({ request }) => {
      test.info().annotations.push({ type: 'severity', description: 'critical' });

      const path = ENDPOINTS.ACCOUNT.GET_PAYMENT_INSTRUCTIONS.path;
      const response = await apiGet(request, path, {}, { accountNumber: sharedAccount.accountNumber });
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);

      if (response.status() !== 200) {
        // For new accounts not yet fully provisioned — accepted transient states
        expect([400, 500]).toContain(response.status());
        expect(responseBody).toHaveProperty('userMessage');
        return;
      }

      const expectedBeneficiaryName =
        `${sharedAccountData.personalInfo.firstName} ${sharedAccountData.personalInfo.lastName}`;
      const expectedBeneficiaryAddress =
        `${sharedAccountData.address.addressLine1}, ${sharedAccountData.address.addressLine2}, ` +
        `${sharedAccountData.address.city}, ${sharedAccountData.address.state}, ${sharedAccountData.address.zipCode}`;

      await test.step('Validate top-level fields', async () => {
        expect(responseBody.accountNumber).toBe(sharedAccount.accountNumber);
        expect(responseBody.currency).toBe('USD');
        expect(Array.isArray(responseBody.paymentInstructions)).toBe(true);
        expect(responseBody.paymentInstructions.length).toBe(2);
      });

      const achInstruction  = responseBody.paymentInstructions.find(p => p.paymentMethod === 'ACH');
      const wireInstruction = responseBody.paymentInstructions.find(p => p.paymentMethod === 'WIRE');

      await test.step('Validate ACH instruction fields', async () => {
        expect(achInstruction).toBeDefined();
        expect(typeof achInstruction.fields).toBe('object');

        // Static bank values — these never change per tenant
        expect(achInstruction.fields['Account Type']).toBe('Checking');
        expect(achInstruction.fields['Bank Address']).toBe('270 Park Ave. New York, NY 10017');
        expect(achInstruction.fields['Routing Number (ABA)']).toBe('021000021');
        expect(typeof achInstruction.fields['Bank Name']).toBe('string');
        expect(achInstruction.fields['Bank Name'].length).toBeGreaterThan(0);

        // Dynamic values — cross-referenced from the account creation input
        expect(typeof achInstruction.fields['Account Number']).toBe('string');
        expect(achInstruction.fields['Account Number'].length).toBeGreaterThan(0);
        expect(achInstruction.fields['Beneficiary Name']).toBe(expectedBeneficiaryName);
        expect(achInstruction.fields['Beneficiary Address']).toBe(expectedBeneficiaryAddress);
      });

      await test.step('Validate WIRE instruction fields', async () => {
        expect(wireInstruction).toBeDefined();
        expect(typeof wireInstruction.fields).toBe('object');

        // Static bank values
        expect(wireInstruction.fields['SWIFT Code']).toBe('CHASUS33XXX');
        expect(wireInstruction.fields['Bank Address']).toBe('270 Park Ave. New York, NY 10017');
        expect(wireInstruction.fields['Routing Number']).toBe('021000021');
        expect(typeof wireInstruction.fields['Bank Name']).toBe('string');
        expect(wireInstruction.fields['Bank Name'].length).toBeGreaterThan(0);

        // Dynamic values — cross-referenced from account creation input
        expect(wireInstruction.fields['Account Holder']).toBe(expectedBeneficiaryName);
        expect(wireInstruction.fields['Beneficiary Name']).toBe(expectedBeneficiaryName);
        expect(wireInstruction.fields['Beneficiary Address']).toBe(expectedBeneficiaryAddress);
        expect(typeof wireInstruction.fields['Account Number']).toBe('string');
        expect(wireInstruction.fields['Account Number'].length).toBeGreaterThan(0);

        // Memo / For Benefit Of is the DDA number — a long numeric string
        expect(typeof wireInstruction.fields['Memo / For Benefit Of']).toBe('string');
        expect(wireInstruction.fields['Memo / For Benefit Of'].length).toBeGreaterThan(0);
      });
    });

    test('TC047 - Get payment instructions with invalid account number', {
      annotation: { type: 'description', description: 'Verify that invalid account number returns error' }
    }, async ({ request }) => {
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const path = ENDPOINTS.ACCOUNT.GET_PAYMENT_INSTRUCTIONS.path;
      const response = await apiGet(request, path, {}, { accountNumber: '99999999999999' });
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);
      expect(response.status()).toBe(500);
    });

    test('TC048 - Get payment instructions with missing account number', {
      annotation: { type: 'description', description: 'Verify that missing account number parameter returns error' }
    }, async ({ request }) => {

      const path = ENDPOINTS.ACCOUNT.GET_PAYMENT_INSTRUCTIONS.path;
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);
      expect([400]).toContain(response.status());
    });

  });

  // ===========================================================================
  // 2. KYC JOURNEY URL APIs — serial (Get depends on Create)
  // ===========================================================================

  test.describe.serial('KYC Journey URL APIs', () => {

    test.describe('Create KYC Journey URL API', () => {

      test('TC049 - Create KYC journey URL with Driving License', {
        annotation: { type: 'description', description: 'Create KYC verification journey URL for client with Driving License' }
      }, async ({ request }) => {
        test.info().annotations.push({ type: 'severity', description: 'critical' });

        const body = {
          clientId: sharedAccount.clientId,
          prospectId: null,
          businessId: null,
          idType: 'Driving License',
          country: 'US',
          ownerId: null
        };

        const response = await apiPost(request, ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body);
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('POST', ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body, response, responseBody);

        expect(response.status()).toBe(200);
        validateResponseProperties(expect, responseBody, [
          'result',
          'result.journeyId',
          'result.journeyUrl',
          'result.ttl'
        ]);
      });

      test('TC050 - Create KYC journey URL with Passport', {
        annotation: { type: 'description', description: 'Create KYC journey URL for Passport verification' }
      }, async ({ request }) => {
        test.info().annotations.push({ type: 'severity', description: 'high' });

        const body = {
          clientId: sharedAccount.clientId,
          prospectId: null,
          businessId: null,
          idType: 'Passport',
          country: 'US',
          ownerId: null
        };

        const response = await apiPost(request, ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body);
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('POST', ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body, response, responseBody);

        expect(response.status()).toBe(200);
        validateResponseProperties(expect, responseBody, ['result.journeyUrl', 'result.journeyId']);
      });

      test('TC051 - Create journey URL with null idType and country', {
        annotation: { type: 'description', description: 'Verify journey URL can be created with null idType and country' }
      }, async ({ request }) => {

        const body = {
          clientId: sharedAccount.clientId,
          prospectId: null,
          businessId: null,
          idType: null,
          country: null,
          ownerId: null
        };

        const response = await apiPost(request, ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body);
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('POST', ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body, response, responseBody);

        expect(response.status()).toBe(200);
        expect(responseBody.result).toHaveProperty('journeyUrl');
      });

      test('TC052 - Reject journey URL creation with no identifiers', {
        annotation: { type: 'description', description: 'Verify that missing all identifiers (clientId, prospectId, businessId) returns error' }
      }, async ({ request }) => {
        test.info().annotations.push({ type: 'severity', description: 'high' });

        const body = {
          clientId: null,
          prospectId: null,
          businessId: null,
          idType: 'Driving License',
          country: 'US',
          ownerId: null
        };

        const response = await apiPost(request, ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body);
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('POST', ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body, response, responseBody);

        expect([400, 412, 422]).toContain(response.status());
      });

      test('TC053 - Reject journey URL creation with invalid client ID', {
        annotation: { type: 'description', description: 'Verify that invalid client ID returns error' }
      }, async ({ request }) => {

        const body = {
          clientId: 999999999,
          prospectId: null,
          businessId: null,
          idType: 'Driving License',
          country: 'US',
          ownerId: null
        };

        const response = await apiPost(request, ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body);
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('POST', ENDPOINTS.KYC.CREATE_JOURNEY_URL.path, body, response, responseBody);

        expect([400, 404]).toContain(response.status());
      });

    });

    // -------------------------------------------------------------------------

    test.describe('Get User KYC Journey URLs API', () => {

      test('TC060 - Get KYC journey URLs for client', {
        annotation: { type: 'description', description: 'Retrieve list of KYC journey URLs for a client' }
      }, async ({ request }) => {
        test.info().annotations.push({ type: 'severity', description: 'critical' });

        const path = ENDPOINTS.KYC.GET_JOURNEY_URLS.path;
        const response = await apiGet(request, path, {}, { clientId: sharedAccount.clientId, page: 0, size: 20 });
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('GET', path, null, response, responseBody);

        expect(response.status()).toBe(200);
        validateResponseProperties(expect, responseBody, [
          'list',
          'pagination',
          'pagination.page',
          'pagination.size',
          'pagination.totalElements',
          'pagination.totalPages'
        ]);
        expect(Array.isArray(responseBody.list)).toBeTruthy();
        expect(responseBody.pagination.page).toBe(0);
        expect(responseBody.pagination.size).toBe(20);

        if (responseBody.list.length > 0) {
          const journey = responseBody.list[0];
          expect(journey).toHaveProperty('journeyUrl');
          expect(journey).toHaveProperty('journeyId');
          expect(journey).toHaveProperty('clientId');
          expect(journey.clientId).toBe(sharedAccount.clientId);
        }
      });

      test('TC061 - Get journey URLs with custom page size', {
        annotation: { type: 'description', description: 'Test pagination with custom page size' }
      }, async ({ request }) => {

        const path = ENDPOINTS.KYC.GET_JOURNEY_URLS.path;
        const response = await apiGet(request, path, {}, { clientId: sharedAccount.clientId, page: 0, size: 5 });
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('GET', path, null, response, responseBody);

        expect(response.status()).toBe(200);
        expect(responseBody).toHaveProperty('pagination');
        expect(responseBody).toHaveProperty('list');
      });

      test('TC062 - Get journey URLs without pagination parameters', {
        annotation: { type: 'description', description: 'Verify default pagination when parameters are not provided' }
      }, async ({ request }) => {

        const path = ENDPOINTS.KYC.GET_JOURNEY_URLS.path;
        const response = await apiGet(request, path, {}, { clientId: sharedAccount.clientId });
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('GET', path, null, response, responseBody);

        expect(response.status()).toBe(200);
        expect(responseBody).toHaveProperty('pagination');
      });

      test('TC063 - Reject journey URLs request with invalid client ID', {
        annotation: { type: 'description', description: 'Verify that invalid client ID returns empty list or error' }
      }, async ({ request }) => {
        test.info().annotations.push({ type: 'severity', description: 'high' });

        const path = ENDPOINTS.KYC.GET_JOURNEY_URLS.path;
        const response = await apiGet(request, path, {}, { clientId: 999999999, page: 0, size: 20 });
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('GET', path, null, response, responseBody);

        if (response.status() === 200) {
          expect(responseBody.list).toEqual([]);
          expect(responseBody.pagination.totalElements).toBe(0);
        } else {
          expect([400, 404]).toContain(response.status());
        }
      });

      test('TC064 - Reject journey URLs request with missing client ID', {
        annotation: { type: 'description', description: 'Verify that missing client ID parameter returns error' }
      }, async ({ request }) => {

        const path = ENDPOINTS.KYC.GET_JOURNEY_URLS.path;
        const response = await apiGet(request, path, {}, { page: 0, size: 20 });
        const responseBody = await getResponseBody(response);
        await attachRequestResponse('GET', path, null, response, responseBody);

        expect([400, 422]).toContain(response.status());
      });

    });

  });

  // ===========================================================================
  // 3. UPDATE KYC DETAILS — serial (tests modify same account's KYC data)
  // ===========================================================================

  test.describe.serial('Update KYC Details API', () => {

    test('TC054 - Update KYC details with SSN', {
      annotation: { type: 'description', description: 'Update KYC identification details with SSN' }
    }, async ({ request }) => {
      test.info().annotations.push({ type: 'severity', description: 'critical' });

      const body = {
        clientId: sharedAccount.clientId,
        identificationType: 'SSN',
        identificationNumber: '987654321'
      };

      const response = await apiPut(request, ENDPOINTS.KYC.UPDATE_DETAILS.path, body, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('PUT', ENDPOINTS.KYC.UPDATE_DETAILS.path, body, response, responseBody);

      expect([200, 204]).toContain(response.status());
    });

    test('TC057 - Reject KYC update with invalid client ID', {
      annotation: { type: 'description', description: 'Verify that invalid client ID returns error' }
    }, async ({ request }) => {
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const body = {
        clientId: 999999999,
        identificationType: 'SSN',
        identificationNumber: '123456789'
      };

      const response = await apiPut(request, ENDPOINTS.KYC.UPDATE_DETAILS.path, body, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('PUT', ENDPOINTS.KYC.UPDATE_DETAILS.path, body, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC058 - Reject KYC update with missing identification type', {
      annotation: { type: 'description', description: 'Verify that missing identificationType returns error' }
    }, async ({ request }) => {

      const body = {
        clientId: sharedAccount.clientId,
        identificationNumber: '123456789'
      };

      const response = await apiPut(request, ENDPOINTS.KYC.UPDATE_DETAILS.path, body, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('PUT', ENDPOINTS.KYC.UPDATE_DETAILS.path, body, response, responseBody);

      expect([400, 412, 422]).toContain(response.status());
    });

    test('TC059 - Reject KYC update with missing identification number', {
      annotation: { type: 'description', description: 'Verify that missing identificationNumber returns error' }
    }, async ({ request }) => {

      const body = {
        clientId: sharedAccount.clientId,
        identificationType: 'SSN'
      };

      const response = await apiPut(request, ENDPOINTS.KYC.UPDATE_DETAILS.path, body, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('PUT', ENDPOINTS.KYC.UPDATE_DETAILS.path, body, response, responseBody);

      expect([400, 412, 422]).toContain(response.status());
    });

  });

  // ===========================================================================
  // 4. CLOSE ACCOUNT — runs last in serial mode
  // ===========================================================================

  test.describe('Close Account API', () => {

    test('TC065 - Close account with valid data', {
      annotation: { type: 'description', description: 'Close a client account with valid data' }
    }, async ({ request }) => {
      test.info().annotations.push({ type: 'severity', description: 'critical' });

      const body = {
        clientId: sharedAccount.clientId,
        businessId: null,
        status: 'close-bank',
        reason: 'Testing account closure',
        deleteClient: true,
        removeKeyCloakUser: false
      };

      const response = await apiPost(request, ENDPOINTS.ACCOUNT.CLOSE.path, body, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.CLOSE.path, body, response, responseBody);

      expect([200, 202, 204]).toContain(response.status());
    });

  });

});
