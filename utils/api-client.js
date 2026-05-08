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

  const methodLower = method.toLowerCase();
  if (!request[methodLower]) {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }
  return await request[methodLower](fullUrl, config);
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
async function getOAuthToken(request, realm = null) {
  const clientId = process.env.TRANSACTION_CLIENT_ID;
  const clientSecret = process.env.TRANSACTION_CLIENT_SECRET;
  const grantType = process.env.TRANSACTION_GRANT_TYPE || 'client_credentials';
  const keycloakHost = process.env.KEYCLOAK_HOST;

  if (!clientId || !clientSecret) throw new Error('TRANSACTION_CLIENT_ID and TRANSACTION_CLIENT_SECRET must be set');
  if (!keycloakHost) throw new Error('KEYCLOAK_HOST must be set');

  const resolvedRealm = realm || process.env.KEYCLOAK_REALM || 'glidecash';
  const tokenUrl = `${keycloakHost}/realms/${resolvedRealm}/protocol/openid-connect/token`;

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
