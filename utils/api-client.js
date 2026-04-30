/**
 * Unified API Client
 * A single function to handle all HTTP methods (GET, POST, PUT, PATCH, DELETE)
 */

/**
 * Get Basic Authentication header
 */
function getBasicAuthHeader() {
  const username = process.env.API_USERNAME;
  const password = process.env.API_PASSWORD;

  if (!username || !password) {
    console.warn('Warning: API_USERNAME or API_PASSWORD not set in environment variables');
    return {};
  }

  const credentials = Buffer.from(`${username}:${password}`).toString('base64');
  return {
    'Authorization': `Basic ${credentials}`
  };
}

/**
 * Get Base URL from environment
 */
function getBaseUrl() {
  return process.env.API_BASE_URL || 'https://devapi.bivotech.co';
}

/**
 * Unified API Request Function
 *
 * @param {Object} request - Playwright request fixture
 * @param {Object} options - Request options
 * @param {string} options.method - HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string} options.endpoint - API endpoint path (can include query params)
 * @param {Object} [options.body] - Request body (for POST, PUT, PATCH)
 * @param {Object} [options.headers] - Additional headers
 * @param {Object} [options.queryParams] - Query parameters as object
 * @param {boolean} [options.useBaseUrl=false] - Whether to prepend base URL
 *
 * @returns {Promise<Response>} Playwright response object
 *
 * @example
 * // GET request
 * const response = await apiRequest(request, {
 *   method: 'GET',
 *   endpoint: '/api-gateway/v1/admin/accounts/123'
 * });
 *
 * @example
 * // POST request with body
 * const response = await apiRequest(request, {
 *   method: 'POST',
 *   endpoint: '/api-gateway/v1/admin/accounts',
 *   body: { firstName: 'John', lastName: 'Doe' },
 *   headers: { 'X-Tenant-Identifier': 'tenant123' }
 * });
 *
 * @example
 * // GET with query params
 * const response = await apiRequest(request, {
 *   method: 'GET',
 *   endpoint: '/api-gateway/v1/admin/beneficiary/accounts',
 *   queryParams: { client_id: '20066', page: 0, size: 20 }
 * });
 */
async function apiRequest(request, options) {
  const {
    method,
    endpoint,
    body = null,
    headers = {},
    queryParams = null,
    timeout = 30000 // Default 30 seconds timeout
  } = options;

  // Validate required parameters
  if (!method) {
    throw new Error('HTTP method is required');
  }
  if (!endpoint) {
    throw new Error('Endpoint is required');
  }

  // Build full URL
  let fullUrl = endpoint;

  // Add query parameters if provided
  if (queryParams) {
    const searchParams = new URLSearchParams(queryParams);
    const separator = fullUrl.includes('?') ? '&' : '?';
    fullUrl = `${fullUrl}${separator}${searchParams.toString()}`;
  }

  // Build headers
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...getBasicAuthHeader(),
    ...headers
  };

  // Build request config
  const config = {
    headers: defaultHeaders,
    timeout: timeout
  };

  // Add body for methods that support it
  if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    config.data = body;
  }

  // Make the request
  const methodLower = method.toLowerCase();
  let response;

  switch (methodLower) {
    case 'get':
      response = await request.get(fullUrl, config);
      break;
    case 'post':
      response = await request.post(fullUrl, config);
      break;
    case 'put':
      response = await request.put(fullUrl, config);
      break;
    case 'patch':
      response = await request.patch(fullUrl, config);
      break;
    case 'delete':
      response = await request.delete(fullUrl, config);
      break;
    default:
      throw new Error(`Unsupported HTTP method: ${method}`);
  }

  return response;
}

/**
 * Convenience wrapper for GET requests
 */
async function apiGet(request, endpoint, headers = {}, queryParams = null, timeout = 30000) {
  return apiRequest(request, {
    method: 'GET',
    endpoint,
    headers,
    queryParams,
    timeout
  });
}

/**
 * Convenience wrapper for POST requests
 */
async function apiPost(request, endpoint, body, headers = {}, timeout = 30000) {
  return apiRequest(request, {
    method: 'POST',
    endpoint,
    body,
    headers,
    timeout
  });
}

/**
 * Convenience wrapper for PUT requests
 */
async function apiPut(request, endpoint, body, headers = {}, timeout = 30000) {
  return apiRequest(request, {
    method: 'PUT',
    endpoint,
    body,
    headers,
    timeout
  });
}

/**
 * Convenience wrapper for PATCH requests
 */
async function apiPatch(request, endpoint, body, headers = {}, timeout = 30000) {
  return apiRequest(request, {
    method: 'PATCH',
    endpoint,
    body,
    headers,
    timeout
  });
}

/**
 * Convenience wrapper for DELETE requests
 */
async function apiDelete(request, endpoint, headers = {}, timeout = 30000) {
  return apiRequest(request, {
    method: 'DELETE',
    endpoint,
    headers,
    timeout
  });
}

/**
 * Get OAuth token for transaction APIs
 * Uses client credentials grant type
 *
 * @param {Object} request - Playwright request fixture
 * @returns {Promise<string>} Access token
 */
async function getOAuthToken(request) {
  const clientId = process.env.TRANSACTION_CLIENT_ID || 'transaction-v1';
  const clientSecret = process.env.TRANSACTION_CLIENT_SECRET || '16d105f7-0306-4bf5-8f69-f5b2840d1c7c';
  const grantType = process.env.TRANSACTION_GRANT_TYPE || 'client_credentials';
  const keycloakHost = process.env.KEYCLOAK_HOST || 'http://4.224.110.58';

  const tokenUrl = `${keycloakHost}/realms/glidecash/protocol/openid-connect/token`;

  // Prepare form-urlencoded body
  const formData = new URLSearchParams();
  formData.append('client_id', clientId);
  formData.append('client_secret', clientSecret);
  formData.append('grant_type', grantType);
  formData.append('glide_auth_type', 'client_credentials');

  try {
    const response = await request.post(tokenUrl, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: formData.toString(),
      timeout: 10000
    });

    if (response.status() !== 200) {
      throw new Error(`Failed to get OAuth token: ${response.status()}`);
    }

    const responseBody = await response.json();

    if (!responseBody.access_token) {
      throw new Error('No access_token in OAuth response');
    }

    return responseBody.access_token;
  } catch (error) {
    console.error('❌ OAuth token retrieval failed:', error.message);
    throw error;
  }
}

module.exports = {
  apiRequest,
  apiGet,
  apiPost,
  apiPut,
  apiPatch,
  apiDelete,
  getBasicAuthHeader,
  getBaseUrl,
  getOAuthToken
};
