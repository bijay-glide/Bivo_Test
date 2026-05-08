/**
 * API Testing Helper Utilities
 *
 * This file contains generic helper functions used across test suites.
 * For API client functions, import from './api-client.js'
 * For endpoints configuration, import from './endpoints.js'
 */

const { test } = require('@playwright/test');
const { apiPost, apiGet, getOAuthToken } = require('./api-client');
const { ENDPOINTS, buildEndpoint } = require('./endpoints');

const BASE_URL = process.env.API_BASE_URL || 'https://devapi.bivotech.co';

/**
 * Parse JSON response body safely.
 * Returns null when the response body is empty (e.g. 204 No Content).
 */
async function getResponseBody(response) {
  try {
    return await response.json();
  } catch (error) {
    const text = await response.text();
    if (!text || text.trim() === '') {
      return null;
    }
    throw new Error(`Failed to parse JSON: ${error.message}\nResponse: ${text}`);
  }
}

/**
 * Log HTTP request details for debugging (only when DEBUG=true)
 */
function logRequest(method, endpoint, body = null) {
  if (process.env.DEBUG !== 'true') return;

  const separator = '='.repeat(50);
  console.log(`\n${separator}`);
  console.log(`REQUEST: ${method} ${endpoint}`);
  if (body) console.log('Body:', JSON.stringify(body, null, 2));
  console.log(separator);
}

/**
 * Log HTTP response details and return parsed body
 */
async function logResponse(response) {
  const body = await getResponseBody(response);
  if (process.env.DEBUG !== 'true') return body;
  const separator = '='.repeat(50);
  console.log(`\n${separator}`);
  console.log(`RESPONSE: ${response.status()} ${response.statusText()}`);
  console.log('Body:', JSON.stringify(body, null, 2));
  console.log(`${separator}\n`);
  return body;
}

/**
 * Sleep/delay for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper to validate nested property path
 */
function validateNestedProperty(expect, obj, path) {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    expect(current).toHaveProperty(part);
    current = current[part];
  }

  return current;
}

/**
 * Validate response properties
 *
 * @example
 * validateResponseProperties(expect, body, ['accountNumber', 'clientId']);
 * validateResponseProperties(expect, body, [{ field: 'status', value: 'ACTIVE' }]);
 * validateResponseProperties(expect, body, ['address.city', 'address.state']);
 */
function validateResponseProperties(expect, responseBody, requiredFields) {
  if (!Array.isArray(requiredFields)) {
    throw new Error('requiredFields must be an array');
  }

  for (const field of requiredFields) {
    if (typeof field === 'string') {
      // Simple property check (supports nested like 'address.city')
      validateNestedProperty(expect, responseBody, field);
    } else if (field.field) {
      // Property with value check
      const actualValue = validateNestedProperty(expect, responseBody, field.field);
      if (field.value !== undefined) {
        expect(actualValue).toBe(field.value);
      }
    }
  }
}

/**
 * Validate response status and extract body
 * Combines status check and body parsing in one call
 *
 * @param {Object} expect - Playwright expect function
 * @param {Object} response - Playwright response object
 * @param {number} expectedStatus - Expected HTTP status code (default: 200)
 * @returns {Promise<Object>} Parsed response body
 *
 * @example
 * const body = await validateAndGetBody(expect, response, 200);
 */
async function validateAndGetBody(expect, response, expectedStatus = 200) {
  expect(response.status()).toBe(expectedStatus);
  return await getResponseBody(response);
}

/**
 * Create test account with retry logic and exponential backoff
 */
async function createTestAccount(request, accountData, retries = 3) {
  const endpoint = ENDPOINTS.ACCOUNT.CREATE.path;
  const requiredFields = ['referenceId', 'accountNumber', 'clientId', 'status'];

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await apiPost(request, endpoint, accountData, {
        'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER
      });

      if (response.status() === 200) {
        const body = await getResponseBody(response);
        const missingFields = requiredFields.filter(field => !(field in body));

        if (missingFields.length > 0) {
          throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        return body;
      }

      // Non-200 response
      const errorBody = await getResponseBody(response);
      const error = new Error(`Expected status 200 but got ${response.status()}`);
      error.responseBody = errorBody;
      throw error;

    } catch (error) {
      const isLastAttempt = attempt === retries;

      console.log(`${isLastAttempt ? '❌' : '⚠️'}  Account creation attempt ${attempt}/${retries} failed: ${error.message}`);

      if (isLastAttempt) {
        if (error.responseBody) {
          console.error('Response:', JSON.stringify(error.responseBody, null, 2));
        }
        throw error;
      }

      const waitTime = 2 ** attempt * 1000; // 2s, 4s, 8s
      console.log(`   Retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }
}

// Grants ACH-linking permission groups (optional options.groups, businessId, realm). Returns token and add-groups HTTP statuses.
async function grantAchLinkingPermission(request, clientId, options = {}) {
  const groups = options.groups || [-2, -3];
  const businessId = Object.prototype.hasOwnProperty.call(options, 'businessId')
    ? options.businessId
    : null;
  const realm = options.realm || null;

  const accessToken = await getOAuthToken(request, realm);

  const addGroupsResponse = await request.post(
    `${process.env.HOST}/identity/v1/internal/user/add-groups`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: { clientId, businessId, groups },
    },
  );

  if (addGroupsResponse.status() !== 202) {
    const body = await addGroupsResponse.text();
    throw new Error(`Add-groups request failed (${addGroupsResponse.status()}): ${body}`);
  }

  return {
    addGroupsStatus: addGroupsResponse.status(),
  };
}

/**
 * Attaches the full HTTP exchange to the Playwright HTML report.
 * Visible on every run regardless of pass/fail.
 *
 * Call this BEFORE any expect() assertions so the attachment is present even
 * when a test fails on a status code mismatch.
 *
 * @param {string}      method         - HTTP method ('GET', 'POST', etc.)
 * @param {string}      path           - Endpoint path, including query params when present
 * @param {Object|null} requestBody    - Request payload; null for body-less requests
 * @param {Object}      response       - Playwright response object
 * @param {Object}      responseBody   - Already-parsed response body
 * @param {Object}      [requestHeaders] - Headers sent with the request (optional)
 */
async function attachRequestResponse(method, path, requestBody, response, responseBody, requestHeaders = null) {
  const info = test.info();

  // ── Request ──────────────────────────────────────────────────────────────
  info.attach('Request URL', {
    body: `${method.toUpperCase()} ${BASE_URL}${path}`,
    contentType: 'text/plain'
  });

  if (requestHeaders != null) {
    info.attach('Request Headers', {
      body: JSON.stringify(requestHeaders, null, 2),
      contentType: 'text/plain'
    });
  }

  info.attach('Request Body', {
    body: requestBody != null ? JSON.stringify(requestBody, null, 2) : '(no body)',
    contentType: 'text/plain'
  });

  // ── Response ─────────────────────────────────────────────────────────────
  info.attach('Response Status', {
    body: `${response.status()} ${response.statusText()}`,
    contentType: 'text/plain'
  });

  info.attach('Response Headers', {
    body: JSON.stringify(response.headers(), null, 2),
    contentType: 'text/plain'
  });

  info.attach('Response Body', {
    body: responseBody != null ? JSON.stringify(responseBody, null, 2) : '(empty body)',
    contentType: 'text/plain'
  });
}

module.exports = {
  getResponseBody,
  logRequest,
  logResponse,
  sleep,
  validateResponseProperties,
  validateAndGetBody,
  createTestAccount,
  attachRequestResponse,
  grantAchLinkingPermission
};
