/**
 * Account Read Operations API Test Suite
 *
 * Covers READ operations for account data:
 * - Get Account Info:    GET /api-gateway/v1/admin/accounts/{clientId}
 * - Get Account Profile: GET /api-gateway/v1/admin/accounts/profile/{clientId}
 * - Get Account Balance: GET /api-gateway/v1/admin/accounts/balance/{clientId}
 *
 * All tests share ONE account created in beforeAll().
 * sharedAccountData stores the input used to create the account so responses
 * can be fully cross-validated against the original request values.
 */

const { test, expect } = require('@playwright/test');
const { apiGet } = require('../../utils/api-client');
const { buildEndpoint } = require('../../utils/endpoints');
const {
  getResponseBody,
  createTestAccount,
  validateResponseProperties,
  attachRequestResponse,
  sleep
} = require('../../utils/helpers');
const { generateClientAccountData } = require('../../utils/test-data');

let sharedAccount = null;
let sharedAccountData = null;

test.describe('Account Read Operations', () => {

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    sharedAccountData = generateClientAccountData();
    sharedAccount = await createTestAccount(request, sharedAccountData);
    // Allow time for the account to be fully provisioned before read tests begin
    await sleep(3000);
  });

  // ---------------------------------------------------------------------------

  test.describe('Get Account Info API', () => {

    test('TC011 - Get Account Info with valid client ID', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Retrieve account information using valid client ID' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: sharedAccount.clientId });
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);

      await test.step('Validate status 200', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate all response field values', async () => {
        // Account identifier — must match what was returned when the account was created
        expect(responseBody.accountNumber).toBe(sharedAccount.accountNumber);

        // DDA number is a system-generated long numeric string
        expect(typeof responseBody.ddaNumber).toBe('string');
        expect(responseBody.ddaNumber.length).toBeGreaterThan(0);

        // Static bank / system values — these never change per tenant
        expect(responseBody.accountType).toBe('wallet');
        expect(responseBody.accountName).toBe('Bivo Account');
        expect(responseBody.accountStatus).toBe('active');
        expect(responseBody.routingNumber).toBe('021000021');
        expect(responseBody.bankName).toBe('JP Morgan Chase');
        expect(responseBody.bankAddress).toBe('270 Park Ave. New York, NY 10017');
        expect(responseBody.currency).toBe('USD');
      });
    });

  });

  // ---------------------------------------------------------------------------

  test.describe('Get Account Profile API', () => {

    test('TC012 - Get Account Profile with valid client ID', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Retrieve client profile information using valid client ID' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_PROFILE', { clientId: sharedAccount.clientId });
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);

      await test.step('Validate status 200', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate personal info matches input data', async () => {
        // identifiers
        expect(responseBody.clientId).toBe(sharedAccount.clientId);

        // Name — must echo back the exact values sent in the create request
        expect(responseBody.firstName).toBe(sharedAccountData.personalInfo.firstName);
        expect(responseBody.lastName).toBe(sharedAccountData.personalInfo.lastName);

        // Contact — same source as create request
        expect(responseBody.emailAddress).toBe(sharedAccountData.personalInfo.email);
        expect(responseBody.phoneNumber).toBe(sharedAccountData.personalInfo.phoneNumber);
      });

      await test.step('Validate address matches input data', async () => {
        expect(responseBody.address.addressOne).toBe(sharedAccountData.address.addressLine1);
        expect(responseBody.address.addressTwo).toBe(sharedAccountData.address.addressLine2);
        expect(responseBody.address.city).toBe(sharedAccountData.address.city);
        expect(responseBody.address.state).toBe(sharedAccountData.address.state);
        expect(responseBody.address.postalCode).toBe(sharedAccountData.address.zipCode);
        expect(responseBody.address.countryCode).toBe('US');

        // identifier is a system-assigned string
        expect(typeof responseBody.address.identifier).toBe('string');
        expect(responseBody.address.identifier.length).toBeGreaterThan(0);
      });
    });

  });

  // ---------------------------------------------------------------------------

  test.describe('Get Account Balance API', () => {

    test('TC013 - Get Account Balance with valid client ID', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Retrieve account balance using valid client ID' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_BALANCE', { clientId: sharedAccount.clientId });
      const response = await apiGet(request, path, {
        'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER
      });
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);

      await test.step('Validate status 200', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate top-level balance fields', async () => {
        // Numeric fields — newly created account starts at 0
        expect(typeof responseBody.availableToSpend).toBe('number');
        expect(responseBody.availableToSpend).toBeGreaterThanOrEqual(0);
        expect(typeof responseBody.totalPendingAmount).toBe('number');
        expect(responseBody.totalPendingAmount).toBeGreaterThanOrEqual(0);

        // Exactly one sub-account for a standard client wallet
        expect(Array.isArray(responseBody.accounts)).toBe(true);
        expect(responseBody.accounts.length).toBe(1);
      });

      await test.step('Validate nested account object', async () => {
        const acct = responseBody.accounts[0];

        // Account identifiers
        expect(acct.accountNumber).toBe(sharedAccount.accountNumber);
        expect(typeof acct.ddaNumber).toBe('string');
        expect(acct.ddaNumber.length).toBeGreaterThan(0);

        // Static account metadata
        expect(acct.accountType).toBe('wallet');
        expect(acct.currency).toBe('USD');

        // Balance figures — numeric and non-negative
        expect(typeof acct.balance).toBe('number');
        expect(acct.balance).toBeGreaterThanOrEqual(0);
        expect(typeof acct.pendingAmount).toBe('number');
        expect(acct.pendingAmount).toBeGreaterThanOrEqual(0);
      });
    });

  });

});
