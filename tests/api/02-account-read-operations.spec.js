/**
 * Account Read Operations API Test Suite
 *
 * Covers READ operations for account data:
 * - Get Account Info:    GET /api-gateway/v1/admin/accounts/{clientId}
 * - Get Account Profile: GET /api-gateway/v1/admin/accounts/profile/{clientId}
 * - Get Account Balance: GET /api-gateway/v1/admin/accounts/balance/{clientId}
 *
 * These tests read a PRE-PROVISIONED active account (SEEDED_CLIENT_ID /
 * SEEDED_ACCOUNT_NUMBER). On this sandbox, accounts created via the API stay
 * status=REQUESTED and are never readable, so read coverage targets a known
 * seeded fixture and validates against its stable facts + structural invariants.
 */

const { test, expect } = require('@playwright/test');
const { apiGet } = require('../../utils/api-client');
const { buildEndpoint } = require('../../utils/endpoints');
const { getResponseBody, attachRequestResponse } = require('../../utils/helpers');

const SEEDED_CLIENT_ID = process.env.SEEDED_CLIENT_ID;
const SEEDED_ACCOUNT_NUMBER = process.env.SEEDED_ACCOUNT_NUMBER;

test.describe('Account Read Operations', () => {

  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    if (!SEEDED_CLIENT_ID || !SEEDED_ACCOUNT_NUMBER) {
      throw new Error('SEEDED_CLIENT_ID and SEEDED_ACCOUNT_NUMBER must be set in .env for read tests');
    }
  });

  // ---------------------------------------------------------------------------

  test.describe('Get Account Info API', () => {

    test('TC011 - Get Account Info with valid client ID', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Retrieve account information for the seeded active account' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: SEEDED_CLIENT_ID });
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);

      await test.step('Validate status 200', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate response field values', async () => {
        // Account identifier — must match the seeded account
        expect(responseBody.accountNumber).toBe(SEEDED_ACCOUNT_NUMBER);

        // DDA number is a system-generated long numeric string
        expect(typeof responseBody.ddaNumber).toBe('string');
        expect(responseBody.ddaNumber.length).toBeGreaterThan(0);

        // Static bank / system values — these never change per tenant
        expect(responseBody.accountType).toBe('wallet');
        expect(responseBody.accountStatus).toBe('active');
        expect(responseBody.routingNumber).toBe('021000021');
        expect(responseBody.bankName).toBe('JP Morgan Chase');
        expect(responseBody.currency).toBe('USD');

        // Display name is a non-empty string
        expect(typeof responseBody.accountName).toBe('string');
        expect(responseBody.accountName.length).toBeGreaterThan(0);
      });
    });

  });

  // ---------------------------------------------------------------------------

  test.describe('Get Account Profile API', () => {

    test('TC012 - Get Account Profile with valid client ID', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Retrieve client profile information for the seeded active account' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_PROFILE', { clientId: SEEDED_CLIENT_ID });
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);

      await test.step('Validate status 200', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate personal info is well-formed', async () => {
        // identifier echoes the requested client
        expect(String(responseBody.clientId)).toBe(String(SEEDED_CLIENT_ID));

        // Name / contact — present and well-typed
        expect(typeof responseBody.firstName).toBe('string');
        expect(responseBody.firstName.length).toBeGreaterThan(0);
        expect(typeof responseBody.lastName).toBe('string');
        expect(responseBody.lastName.length).toBeGreaterThan(0);
        expect(responseBody.emailAddress).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
        expect(typeof responseBody.phoneNumber).toBe('string');
        expect(responseBody.phoneNumber.length).toBeGreaterThan(0);
      });

      await test.step('Validate address structure', async () => {
        expect(typeof responseBody.address).toBe('object');
        expect(typeof responseBody.address.addressOne).toBe('string');
        expect(responseBody.address.addressOne.length).toBeGreaterThan(0);
        expect(typeof responseBody.address.city).toBe('string');
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
      test.info().annotations.push({ type: 'description', description: 'Retrieve account balance for the seeded active account' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_BALANCE', { clientId: SEEDED_CLIENT_ID });
      const response = await apiGet(request, path, {
        'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER
      });
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody);

      await test.step('Validate status 200', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate top-level balance fields', async () => {
        // Numeric, non-negative aggregate balances
        expect(typeof responseBody.availableToSpend).toBe('number');
        expect(responseBody.availableToSpend).toBeGreaterThanOrEqual(0);
        expect(typeof responseBody.totalPendingAmount).toBe('number');
        expect(responseBody.totalPendingAmount).toBeGreaterThanOrEqual(0);

        // At least one sub-account for the client wallet
        expect(Array.isArray(responseBody.accounts)).toBe(true);
        expect(responseBody.accounts.length).toBeGreaterThanOrEqual(1);
      });

      await test.step('Validate the seeded wallet sub-account', async () => {
        const acct = responseBody.accounts.find(a => a.accountNumber === SEEDED_ACCOUNT_NUMBER);
        expect(acct, `wallet sub-account ${SEEDED_ACCOUNT_NUMBER} should be present`).toBeTruthy();

        expect(typeof acct.ddaNumber).toBe('string');
        expect(acct.ddaNumber.length).toBeGreaterThan(0);
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
