/**
 * Account Negative Scenarios Test Suite
 *
 * Covers all negative test cases across account API endpoints:
 * - Invalid client IDs (non-existent, negative, zero, non-numeric)
 * - Missing required headers (tenant identifier)
 * - Invalid account numbers
 * - Missing required fields
 *
 * These tests don't require creating real accounts.
 */

const { test, expect } = require('@playwright/test');
const { apiGet, apiPost } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint } = require('../../utils/endpoints');
const { getResponseBody, validateResponseProperties, attachRequestResponse } = require('../../utils/helpers');

test.describe('Account API - Negative Scenarios', () => {

  // ---------------------------------------------------------------------------

  test.describe('Get Account Info - Error Handling', () => {

    test('TC031 - Get Account Info with invalid client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that invalid client ID returns appropriate error' });
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: 99999999 });
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect(response.status()).toBe(400);
      validateResponseProperties(expect, responseBody, ['errorCode', 'userMessage']);
    });

    test('TC032 - Get Account Info with non-numeric client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that non-numeric client ID returns error' });
      test.info().annotations.push({ type: 'severity', description: 'medium' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: 'invalid-id' });
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC033 - Get Account Info with negative client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that negative client ID returns error' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: -123 });
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC034 - Get Account Info with zero client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that zero client ID returns error' });

      const path = `/api-gateway/v1/admin/accounts/0`;
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

  });

  // ---------------------------------------------------------------------------

  test.describe('Get Account Profile - Error Handling', () => {

    test('TC035 - Get Account Profile with invalid client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that invalid client ID returns appropriate error' });
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const path = `/api-gateway/v1/admin/accounts/profile/99999999`;
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect(response.status()).toBe(400);
      validateResponseProperties(expect, responseBody, ['errorCode', 'userMessage']);
    });

    test('TC036 - Get Account Profile with non-numeric client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that non-numeric client ID returns error' });
      test.info().annotations.push({ type: 'severity', description: 'medium' });

      const path = `/api-gateway/v1/admin/accounts/profile/invalid-id`;
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC037 - Get Account Profile with negative client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that negative client ID returns error' });

      const path = `/api-gateway/v1/admin/accounts/profile/-123`;
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC038 - Get Account Profile with zero client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that zero client ID returns error' });

      const path = `/api-gateway/v1/admin/accounts/profile/0`;
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

  });

  // ---------------------------------------------------------------------------

  test.describe('Get Account Balance - Error Handling', () => {

    test('TC039 - Get Account Balance with invalid client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that invalid client ID returns appropriate error' });
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const path = `/api-gateway/v1/admin/accounts/balance/99999999`;
      const response = await apiGet(request, path, { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect(response.status()).toBe(400);
      validateResponseProperties(expect, responseBody, ['errorCode', 'userMessage']);
    });

    test('TC040 - Get Account Balance with non-numeric client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that non-numeric client ID returns error' });

      const path = `/api-gateway/v1/admin/accounts/balance/invalid-id`;
      const response = await apiGet(request, path, { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC041 - Get Account Balance with negative client ID should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that negative client ID returns error' });

      const path = `/api-gateway/v1/admin/accounts/balance/-123`;
      const response = await apiGet(request, path, { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER });
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC042 - Get Account Balance without tenant identifier header should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that missing tenant identifier header returns error' });
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const path = `/api-gateway/v1/admin/accounts/balance/12345`;
      const response = await apiGet(request, path);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', path, null, response, responseBody);

      expect([400, 401, 403]).toContain(response.status());
    });

  });

  // ---------------------------------------------------------------------------

  test.describe('Add Balance - Error Handling', () => {

    test('TC043 - Add Balance with invalid account number should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that invalid account number returns error' });
      test.info().annotations.push({ type: 'severity', description: 'high' });

      const body = { accountNumber: '99999999999999', amount: 10000 };
      const response = await apiPost(request, ENDPOINTS.ACCOUNT.ADD_BALANCE.path, body);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.ADD_BALANCE.path, body, response, responseBody);

      expect([400, 404]).toContain(response.status());
    });

    test('TC044 - Add Balance with missing account number should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that missing account number is rejected' });

      const body = { amount: 10000 };
      const response = await apiPost(request, ENDPOINTS.ACCOUNT.ADD_BALANCE.path, body);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.ADD_BALANCE.path, body, response, responseBody);

      expect(response.status()).toBe(412);
    });

    test('TC045 - Add Balance with empty account number should fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'Verify that empty account number is rejected' });

      const body = { accountNumber: '', amount: 10000 };
      const response = await apiPost(request, ENDPOINTS.ACCOUNT.ADD_BALANCE.path, body);
      const responseBody = await getResponseBody(response);
      await attachRequestResponse('POST', ENDPOINTS.ACCOUNT.ADD_BALANCE.path, body, response, responseBody);

      expect([400, 422]).toContain(response.status());
    });

  });

});
