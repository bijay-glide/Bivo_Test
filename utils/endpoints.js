/**
 * API Endpoints Configuration
 * Centralized location for all API endpoints with their metadata
 */

/**
 * Build endpoint path with parameters
 * @example buildPath('/accounts/{clientId}', { clientId: 123 }) => '/accounts/123'
 */
function buildPath(template, params = {}) {
  let path = template;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, value);
  }
  return path;
}

/**
 * All API Endpoints organized by domain
 */
const ENDPOINTS = {

  // ==========================================
  // AUTHENTICATION ENDPOINTS
  // ==========================================
  AUTH: {
    // Get OAuth token for transactions API
    GET_TOKEN: {
      method: 'POST',
      path: '/realms/glidecash/protocol/openid-connect/token',
      description: 'Get OAuth access token for authenticated APIs',
      baseUrlOverride: process.env.KEYCLOAK_HOST || 'http://4.224.110.58',
      contentType: 'application/x-www-form-urlencoded'
    }
  },

  // ==========================================
  // CLIENT ACCOUNT ENDPOINTS
  // ==========================================
  ACCOUNT: {
    // Create client account
    CREATE: {
      method: 'POST',
      path: '/api-gateway/v1/admin/accounts',
      description: 'Create a new client account'
    },

    // Get account information
    GET_INFO: {
      method: 'GET',
      path: '/api-gateway/v1/admin/accounts/{clientId}',
      description: 'Get account information by client ID',
      params: ['clientId']
    },

    // Get account profile
    GET_PROFILE: {
      method: 'GET',
      path: '/api-gateway/v1/admin/accounts/profile/{clientId}',
      description: 'Get account profile by client ID',
      params: ['clientId']
    },

    // Get account balance
    GET_BALANCE: {
      method: 'GET',
      path: '/api-gateway/v1/admin/accounts/balance/{clientId}',
      description: 'Get account balance by client ID',
      params: ['clientId'],
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Add balance to account (legacy)
    ADD_BALANCE: {
      method: 'POST',
      path: '/api-gateway/v1/admin/account/add-balance',
      description: 'Add balance to an account (legacy method)'
    },

    // Add balance via incoming wire (new method with OAuth)
    INCOMING_WIRE: {
      method: 'POST',
      path: '/transactions/v1/internal/external-payment/incoming-wire',
      description: 'Add balance to account via incoming wire transfer',
      requiresAuth: true
    },

    // Get transaction list
    GET_TRANSACTIONS: {
      method: 'GET',
      path: '/api-gateway/v1/admin/transactions',
      description: 'Get list of transactions for a client',
      queryParams: ['client_id', 'business_id', 'account_number', 'payment_type', 'page', 'size']
    },

    // Get payment instructions
    GET_PAYMENT_INSTRUCTIONS: {
      method: 'GET',
      path: '/api-gateway/v1/admin/account/instructions',
      description: 'Get payment instructions for an account',
      queryParams: ['accountNumber']
    },

    // Add multi-currency sub-account (EUR, GBP, etc.)
    ADD_CURRENCY: {
      method: 'POST',
      path: '/api-gateway/v1/admin/accounts/{clientId}/currency',
      description: 'Add a multi-currency sub-account to an existing client account',
      params: ['clientId'],
      queryParams: ['currency']
    },

    // Close account via admin gateway
    CLOSE_ACCOUNT: {
      method: 'POST',
      path: '/api-gateway/v1/admin/accounts/close',
      description: 'Close a client account via admin gateway',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Close account (internal path — legacy)
    CLOSE: {
      method: 'POST',
      path: '/clientaccount/v1/internal/account/close',
      description: 'Close a client account (internal path)',
      requiredHeaders: ['X-Tenant-Identifier']
    }
  },

  // ==========================================
  // KYC ENDPOINTS
  // ==========================================
  KYC: {
    // Create KYC journey URL
    CREATE_JOURNEY_URL: {
      method: 'POST',
      path: '/api-gateway/v1/admin/accounts/create-journey-url',
      description: 'Create a KYC verification journey URL'
    },

    // Get journey URLs
    GET_JOURNEY_URLS: {
      method: 'GET',
      path: '/api-gateway/v1/admin/accounts/journey-url',
      description: 'Get KYC journey URLs for a client',
      queryParams: ['clientId', 'page', 'size']
    },

    // Update KYC details
    UPDATE_DETAILS: {
      method: 'PUT',
      path: '/api-gateway/v1/admin/accounts/kyc',
      description: 'Update KYC identification details',
      requiredHeaders: ['X-Tenant-Identifier']
    }
  },

  // ==========================================
  // BENEFICIARY ENDPOINTS
  // ==========================================
  BENEFICIARY: {
    // Get currencies
    GET_CURRENCIES: {
      method: 'GET',
      path: '/api-gateway/v1/admin/beneficiary/currencies',
      description: 'Get list of supported currencies'
    },

    // Get payment channels
    GET_CHANNELS: {
      method: 'GET',
      path: '/api-gateway/v1/admin/beneficiary/channels/{currencyId}',
      description: 'Get payment channels for a currency',
      params: ['currencyId'],
      queryParams: ['beneficiary_type', 'sender_type']
    },

    // Create beneficiary
    CREATE: {
      method: 'POST',
      path: '/api-gateway/v1/admin/beneficiary',
      description: 'Create a new beneficiary',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Get beneficiary list
    GET_LIST: {
      method: 'GET',
      path: '/api-gateway/v1/admin/beneficiary/accounts',
      description: 'Get list of beneficiaries',
      queryParams: ['client_id', 'business_id', 'page', 'size', 'currency_id', 'beneficiary_type']
    },

    // Get beneficiary by account number
    GET_BY_ACCOUNT: {
      method: 'GET',
      path: '/api-gateway/v1/admin/beneficiary/account/{accountNumber}',
      description: 'Get beneficiary by account number',
      params: ['accountNumber']
    },

    // Update personal info
    UPDATE_PERSONAL_INFO: {
      method: 'PUT',
      path: '/api-gateway/v1/admin/beneficiary/{beneficiaryId}',
      description: 'Update beneficiary personal information',
      params: ['beneficiaryId'],
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Get account metadata
    GET_ACCOUNT_METADATA: {
      method: 'GET',
      path: '/api-gateway/v1/admin/beneficiary/account/fields',
      description: 'Get beneficiary account fields metadata',
      queryParams: ['currency_id', 'channel', 'beneficiary_type']
    },

    // Add account details
    ADD_ACCOUNT_DETAILS: {
      method: 'PATCH',
      path: '/api-gateway/v1/admin/beneficiary/account',
      description: 'Add bank account details to beneficiary',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Update account details
    UPDATE_ACCOUNT_DETAILS: {
      method: 'PUT',
      path: '/api-gateway/v1/admin/beneficiary/account/{accountNumber}',
      description: 'Update beneficiary account details',
      params: ['accountNumber'],
      requiredHeaders: ['X-Tenant-Identifier']
    }
  },

  // ==========================================
  // WIRE INSTRUCTION ENDPOINTS
  // ==========================================
  WIRE: {
    // Create wire instruction
    CREATE: {
      method: 'POST',
      path: '/api-gateway/v1/admin/wire/instructions',
      description: 'Create a wire instruction for client account',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Get wire instructions list
    GET_LIST: {
      method: 'GET',
      path: '/api-gateway/v1/admin/wire/instructions',
      description: 'Get list of wire instructions',
      queryParams: ['client_id', 'business_id']
    },

    // Withdraw funds to wire account
    WITHDRAW: {
      method: 'POST',
      path: '/api-gateway/v1/admin/wire/withdraw-fund',
      description: 'Withdraw funds from client account to wire account',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Delete wire instruction
    DELETE: {
      method: 'DELETE',
      path: '/api-gateway/v1/admin/wire/instructions/{identifier}',
      description: 'Delete a wire instruction by identifier',
      params: ['identifier'],
      requiredHeaders: ['X-Tenant-Identifier']
    }
  },

  // ==========================================
  // ACH EXTERNAL ACCOUNT ENDPOINTS
  // ==========================================
  ACH: {
    // Link external ACH account
    LINK_EXTERNAL_ACCOUNT: {
      method: 'POST',
      path: '/api-gateway/v1/admin/ach/link/external-account',
      description: 'Link an external ACH account to a client/business',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // List linked external accounts
    GET_EXTERNAL_ACCOUNT_LIST: {
      method: 'GET',
      path: '/api-gateway/v1/admin/ach/link/external-account/list',
      description: 'Get list of linked external accounts',
      queryParams: ['client_id', 'business_id']
    },

    // Get micro deposit amounts for an external account
    GET_MICRO_DEPOSIT: {
      method: 'GET',
      path: '/api-gateway/v1/admin/account/micro-deposit/{externalAccountId}',
      description: 'Get micro deposit amounts for verifying an external account',
      params: ['externalAccountId']
    },

    // Verify external account using micro deposit amounts
    VERIFY_EXTERNAL_ACCOUNT: {
      method: 'POST',
      path: '/api-gateway/v1/admin/ach/link/external-account/verify',
      description: 'Verify an external account using micro deposit amounts',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Move funds via ACH
    MOVE_FUND: {
      method: 'POST',
      path: '/api-gateway/v1/admin/ach/move-fund',
      description: 'Move funds between internal and external ACH account',
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // List ACH transactions
    GET_TRANSACTIONS: {
      method: 'GET',
      path: '/api-gateway/v1/admin/ach/transactions',
      description: 'Get list of ACH transactions for a client/business',
      queryParams: ['client_id', 'business_id']
    },

    // Get ACH transaction details
    GET_TRANSACTION_DETAILS: {
      method: 'GET',
      path: '/api-gateway/v1/admin/ach/transactions/{transactionId}',
      description: 'Get details of a specific ACH transaction',
      params: ['transactionId'],
      queryParams: ['client_id', 'business_id']
    }
  },

  // ==========================================
  // FX PAYMENT ENDPOINTS
  // ==========================================
  PAYMENT: {
    // Create FX transfer
    CREATE: {
      method: 'POST',
      path: '/api-gateway/v1/admin/payments',
      description: 'Create a new FX payment transfer'
    },

    // Get transactions list
    GET_LIST: {
      method: 'GET',
      path: '/api-gateway/v1/admin/payments/list',
      description: 'Get list of FX transactions',
      queryParams: ['page', 'size', 'client_id', 'business_id'],
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Get pending transactions
    GET_PENDING: {
      method: 'GET',
      path: '/api-gateway/v1/admin/payments/list/pending',
      description: 'Get list of pending FX transactions',
      queryParams: ['page', 'size', 'client_id', 'business_id'],
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Get payment status
    GET_STATUS: {
      method: 'GET',
      path: '/api-gateway/v1/admin/payments/status/{paymentIdentifier}',
      description: 'Get payment status by identifier',
      params: ['paymentIdentifier'],
      queryParams: ['client_id', 'business_id'],
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Cancel payment
    CANCEL: {
      method: 'POST',
      path: '/api-gateway/v1/admin/payments/cancel/{paymentIdentifier}',
      description: 'Cancel a payment',
      params: ['paymentIdentifier'],
      queryParams: ['client_id', 'business_id'],
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Download receipt
    DOWNLOAD_RECEIPT: {
      method: 'GET',
      path: '/api-gateway/v1/admin/payments/receipt/{receiptId}',
      description: 'Download payment receipt',
      params: ['receiptId'],
      queryParams: ['client_id', 'business_id'],
      requiredHeaders: ['X-Tenant-Identifier']
    },

    // Get currency rate
    GET_CURRENCY_RATE: {
      method: 'GET',
      path: '/api-gateway/v1/admin/payments/currency/rate',
      description: 'Get currency exchange rate',
      queryParams: ['to_currency_code', 'amount', 'to_country_code', 'amount_currency_code', 'channel'],
      requiredHeaders: ['X-Tenant-Identifier']
    }
  }
};

/**
 * Helper function to get endpoint configuration
 *
 * @param {string} domain - Domain name (e.g., 'ACCOUNT', 'BENEFICIARY')
 * @param {string} action - Action name (e.g., 'CREATE', 'GET_INFO')
 * @returns {Object} Endpoint configuration
 *
 * @example
 * const config = getEndpoint('ACCOUNT', 'GET_INFO');
 * // Returns: { method: 'GET', path: '/api-gateway/v1/admin/accounts/{clientId}', ... }
 */
function getEndpoint(domain, action) {
  if (!ENDPOINTS[domain]) {
    throw new Error(`Domain '${domain}' not found in endpoints configuration`);
  }
  if (!ENDPOINTS[domain][action]) {
    throw new Error(`Action '${action}' not found in domain '${domain}'`);
  }
  return ENDPOINTS[domain][action];
}

/**
 * Build full endpoint URL with parameters
 *
 * @param {string} domain - Domain name
 * @param {string} action - Action name
 * @param {Object} [pathParams] - Path parameters (e.g., { clientId: 123 })
 * @param {Object} [queryParams] - Query parameters (e.g., { page: 0, size: 20 })
 * @returns {Object} Object with endpoint path and query params
 *
 * @example
 * const { path, queryParams } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: 123 });
 * // Returns: { path: '/api-gateway/v1/admin/accounts/123', queryParams: null }
 *
 * @example
 * const { path, queryParams } = buildEndpoint('BENEFICIARY', 'GET_LIST', null, { client_id: '20066', page: 0 });
 * // Returns: { path: '/api-gateway/v1/admin/beneficiary/accounts', queryParams: { client_id: '20066', page: 0 } }
 */
function buildEndpoint(domain, action, pathParams = {}, queryParams = null) {
  const config = getEndpoint(domain, action);
  const path = buildPath(config.path, pathParams);

  return {
    path,
    queryParams,
    method: config.method,
    requiredHeaders: config.requiredHeaders || []
  };
}

module.exports = {
  ENDPOINTS,
  getEndpoint,
  buildEndpoint,
  buildPath
};
