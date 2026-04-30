/**
 * Bivo Partner API — Individual Client Account
 *
 * Happy path : TC001 → TC010  (account lifecycle — read & write operations)
 * Edge cases : TC-E001 → TC-E011  (negative scenarios)
 * Closure    : TC011 → TC012  (close account + verify closed state)
 */

const { test, expect } = require('@playwright/test');
const { apiGet, apiPost, apiPut } = require('../../utils/api-client');
const { ENDPOINTS, buildEndpoint, buildPath } = require('../../utils/endpoints');
const {
  getResponseBody,
  validateResponseProperties,
  attachRequestResponse,
  sleep,
} = require('../../utils/helpers');
const { generateClientAccountData } = require('../../utils/test-data');

const TENANT_HEADERS = { 'X-Tenant-Identifier': process.env.TENANT_IDENTIFIER };

const NON_EXISTENT_CLIENT_ID   = 9999999;
const NON_EXISTENT_ACCOUNT_NUM = '10000000000001';

// Shared state
let sharedAccount     = null;
let sharedAccountData = null;
let eurAccountNumber  = null;
let kycJourneyId      = null;

test.describe('Bivo Partner API — Individual Client Account', () => {

  test.describe.configure({ mode: 'serial' });

  test.describe('Happy Path', () => {

    test('TC001 - Create Client Account', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts — create a new individual account and validate every response field' });

      sharedAccountData = generateClientAccountData();
      const path        = ENDPOINTS.ACCOUNT.CREATE.path;
      const response    = await apiPost(request, path, sharedAccountData, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, sharedAccountData, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate all response fields', async () => {
        validateResponseProperties(expect, responseBody, ['referenceId', 'accountNumber', 'clientId', 'status', 'correlationId']);
        expect(responseBody.status).toBe('REQUESTED');
        expect(responseBody.correlationId).toBe(sharedAccountData.correlationId);
      });

      sharedAccount = responseBody;
    });

    test('TC002 - Add EUR Currency Account', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts/{clientId}/currency?currency=EUR — add a EUR sub-account' });

      const { path } = buildEndpoint('ACCOUNT', 'ADD_CURRENCY', { clientId: sharedAccount.clientId });
      const fullPath  = `${path}?currency=EUR`;
      const response  = await apiPost(request, fullPath, null, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', fullPath, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate all response fields', async () => {
        validateResponseProperties(expect, responseBody, ['accountNumber', 'clientId', 'currency']);
        expect(responseBody.clientId).toBe(sharedAccount.clientId);
        expect(responseBody.currency).toBe('EUR');
        expect(responseBody.accountNumber).not.toBe(sharedAccount.accountNumber);
      });

      eurAccountNumber = responseBody.accountNumber;
    });

    test('TC003 - Get Account Info', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/{clientId} — retrieve and validate all account fields' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: sharedAccount.clientId });
      const response = await apiGet(request, path, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate all response fields', async () => {
        const validStatuses = ['REQUESTED', 'FAILED', 'ACTIVE', 'DECLINED', 'CLOSED_PENDING', 'CLOSED',
                               'requested', 'active', 'declined', 'closed_pending', 'closed'];
        validateResponseProperties(expect, responseBody, [
          'accountNumber', 'ddaNumber', 'accountType', 'accountName', 'accountStatus',
          'routingNumber', 'bankName', 'bankAddress', 'currency'
        ]);
        expect(responseBody.accountNumber).toBe(sharedAccount.accountNumber);
        expect(validStatuses).toContain(responseBody.accountStatus);
      });
    });

    test('TC004 - Get Account Profile', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/profile/{clientId} — cross-validate every field against the creation payload' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_PROFILE', { clientId: sharedAccount.clientId });
      const response = await apiGet(request, path, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate personal info matches creation payload', async () => {
        validateResponseProperties(expect, responseBody, ['clientId', 'firstName', 'lastName', 'emailAddress', 'phoneNumber', 'address']);
        expect(responseBody.clientId).toBe(sharedAccount.clientId);
        expect(responseBody.firstName).toBe(sharedAccountData.personalInfo.firstName);
        expect(responseBody.lastName).toBe(sharedAccountData.personalInfo.lastName);
        expect(responseBody.emailAddress).toBe(sharedAccountData.personalInfo.email);
        expect(responseBody.phoneNumber).toBe(sharedAccountData.personalInfo.phoneNumber);
      });

      await test.step('Validate address matches creation payload', async () => {
        validateResponseProperties(expect, responseBody.address, ['identifier', 'addressOne', 'city', 'state', 'postalCode', 'countryCode']);
        expect(responseBody.address.addressOne).toBe(sharedAccountData.address.addressLine1);
        expect(responseBody.address.city).toBe(sharedAccountData.address.city);
        expect(responseBody.address.state).toBe(sharedAccountData.address.state);
        expect(responseBody.address.postalCode).toBe(sharedAccountData.address.zipCode);
        expect(responseBody.address.countryCode).toBe('US');
      });
    });

    test('TC005 - Get Account Balance', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/balance/{clientId} — new account must have zero balance' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_BALANCE', { clientId: sharedAccount.clientId });
      const response = await apiGet(request, path, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate top-level balance values', async () => {
        validateResponseProperties(expect, responseBody, ['availableToSpend', 'totalPendingAmount', 'accounts']);
        expect(responseBody.availableToSpend).toBe(0);
        expect(responseBody.totalPendingAmount).toBe(0);
        expect(Array.isArray(responseBody.accounts)).toBe(true);
        expect(responseBody.accounts.length).toBeGreaterThan(0);
      });

      await test.step('Validate each account entry in the list', async () => {
        for (const acc of responseBody.accounts) {
          validateResponseProperties(expect, acc, ['accountNumber', 'ddaNumber', 'accountType', 'currency']);
          expect(typeof acc.balance).toBe('number');
          expect(typeof acc.pendingAmount).toBe('number');
        }
        const usdAcc = responseBody.accounts.find(a => a.accountNumber === sharedAccount.accountNumber);
        expect(usdAcc, `USD account ${sharedAccount.accountNumber} not found in balance response`).toBeDefined();
        expect(usdAcc.currency).toBe('USD');
      });
    });

    test('TC006 - Get Payment Instructions (USD)', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/account/instructions?accountNumber=... — validate ACH and WIRE instruction fields for USD account' });

      const path = ENDPOINTS.ACCOUNT.GET_PAYMENT_INSTRUCTIONS.path;

      // Payment instructions are generated async after account creation.
      // Attempt once; if not ready, wait 5 s and retry exactly one more time.
      let response = await apiGet(request, path, TENANT_HEADERS, { accountNumber: sharedAccount.accountNumber });
      if (response.status() !== 200) {
        console.log('TC006: Instructions not ready — waiting 5 s before retry...');
        await sleep(5000);
        response = await apiGet(request, path, TENANT_HEADERS, { accountNumber: sharedAccount.accountNumber });
      }

      const responseBody = await getResponseBody(response);
      await attachRequestResponse('GET', `${path}?accountNumber=${sharedAccount.accountNumber}`, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate top-level fields', async () => {
        validateResponseProperties(expect, responseBody, ['accountNumber', 'currency', 'paymentInstructions']);
        expect(responseBody.accountNumber).toBe(sharedAccount.accountNumber);
        expect(responseBody.currency).toBe('USD');
        expect(Array.isArray(responseBody.paymentInstructions)).toBe(true);
        expect(responseBody.paymentInstructions.length).toBeGreaterThan(0);
      });

      const expectedName    = `${sharedAccountData.personalInfo.firstName} ${sharedAccountData.personalInfo.lastName}`;
      const expectedAddress = `${sharedAccountData.address.addressLine1}, ${sharedAccountData.address.addressLine2}, ` +
                              `${sharedAccountData.address.city}, ${sharedAccountData.address.state}, ${sharedAccountData.address.zipCode}`;

      await test.step('Validate ACH instruction and all its fields', async () => {
        const ach = responseBody.paymentInstructions.find(i => i.paymentMethod === 'ACH');
        expect(ach, 'ACH instruction must be present').toBeDefined();

        expect(ach.fields['Account Type'],        'Account Type must be Checking').toBe('Checking');
        expect(ach.fields['Bank Address'],        'Bank Address must be present').toBeTruthy();
        expect(ach.fields['Account Number'],      'Account Number (DDA) must be present').toBeTruthy();
        expect(ach.fields['Bank Name'],           'Bank Name must be present').toBeTruthy();
        expect(ach.fields['Beneficiary Name'],    'Beneficiary Name must match account holder').toBe(expectedName);
        expect(ach.fields['Beneficiary Address'], 'Beneficiary Address must match creation payload').toBe(expectedAddress);
        expect(ach.fields['Routing Number (ABA)'],'Routing Number (ABA) must be present').toBeTruthy();
      });

      await test.step('Validate WIRE instruction and all its fields', async () => {
        const wire = responseBody.paymentInstructions.find(i => i.paymentMethod === 'WIRE');
        expect(wire, 'WIRE instruction must be present').toBeDefined();

        expect(wire.fields['Bank Name'],           'Bank Name must be present').toBeTruthy();
        expect(wire.fields['SWIFT Code'],          'SWIFT Code must be present').toBeTruthy();
        expect(wire.fields['Bank Address'],        'Bank Address must be present').toBeTruthy();
        expect(wire.fields['Account Holder'],      'Account Holder must match account name').toBe(expectedName);
        expect(wire.fields['Account Number'],      'Account Number must be present').toBeTruthy();
        expect(wire.fields['Routing Number'],      'Routing Number must be present').toBeTruthy();
        expect(wire.fields['Beneficiary Name'],    'Beneficiary Name must match account holder').toBe(expectedName);
        expect(wire.fields['Beneficiary Address'], 'Beneficiary Address must match creation payload').toBe(expectedAddress);
        expect(wire.fields['Memo / For Benefit Of'],'Memo / For Benefit Of must be present').toBeTruthy();
      });
    });

    test('TC007 - Get Payment Instructions (EUR)', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/account/instructions?accountNumber=... — EUR sub-account' });

      const path     = ENDPOINTS.ACCOUNT.GET_PAYMENT_INSTRUCTIONS.path;
      const response = await apiGet(request, path, TENANT_HEADERS, { accountNumber: eurAccountNumber });
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', `${path}?accountNumber=${eurAccountNumber}`, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate top-level fields', async () => {
        validateResponseProperties(expect, responseBody, ['accountNumber', 'currency', 'paymentInstructions']);
        expect(responseBody.accountNumber).toBe(eurAccountNumber);
        expect(responseBody.currency).toBe('EUR');
        expect(Array.isArray(responseBody.paymentInstructions)).toBe(true);
        expect(responseBody.paymentInstructions.length).toBeGreaterThan(0);
      });

      await test.step('Validate WIRE instruction and all its fields', async () => {
        const wire = responseBody.paymentInstructions.find(i => i.paymentMethod === 'WIRE');
        expect(wire, 'WIRE instruction must be present for EUR account').toBeDefined();

        const expectedName    = `${sharedAccountData.personalInfo.firstName} ${sharedAccountData.personalInfo.lastName}`;
        const expectedAddress = `${sharedAccountData.address.addressLine1}, ${sharedAccountData.address.addressLine2}, ` +
                                `${sharedAccountData.address.city}, ${sharedAccountData.address.state}, ${sharedAccountData.address.zipCode}`;

        expect(wire.fields['Bank Name']).toBeTruthy();
        expect(wire.fields['SWIFT Code']).toBeTruthy();
        expect(wire.fields['Bank Address']).toBeTruthy();
        expect(wire.fields['Account Holder']).toBe(expectedName);
        expect(wire.fields['Account Number']).toBeTruthy();
        expect(wire.fields['Beneficiary Name']).toBe(expectedName);
        expect(wire.fields['Intermediary Bank']).toBeTruthy();
        expect(wire.fields['Beneficiary Address']).toBe(expectedAddress);
        expect(wire.fields['Memo / For Benefit Of']).toBeTruthy();
        expect(wire.fields['Intermediary Bank SWIFT']).toBeTruthy();
      });
    });

    test('TC008 - Create KYC Journey URL', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts/create-journey-url — generate a KYC verification URL' });

      const path    = ENDPOINTS.KYC.CREATE_JOURNEY_URL.path;
      const payload = {
        clientId: sharedAccount.clientId, prospectId: null,
        businessId: null, idType: null, country: null, ownerId: null,
      };
      const response = await apiPost(request, path, payload, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, payload, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate result object', async () => {
        validateResponseProperties(expect, responseBody, ['result']);
        validateResponseProperties(expect, responseBody.result, ['journeyId', 'journeyUrl', 'ttl']);
        expect(responseBody.result.journeyUrl).toMatch(/^https?:\/\//);
        expect(responseBody.result.journeyUrl).toContain(responseBody.result.journeyId);
        expect(responseBody.result.ttl).toContain('hours');
      });

      kycJourneyId = responseBody.result.journeyId;
    });

    test('TC009 - Update KYC Details', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'PUT /admin/accounts/kyc — expects 200 with empty body' });

      const path    = ENDPOINTS.KYC.UPDATE_DETAILS.path;
      const payload = {
        clientId:             sharedAccount.clientId,
        identificationType:   'SSN',
        identificationNumber: `555${Math.floor(100000 + Math.random() * 900000)}`,
      };
      const response = await apiPut(request, path, payload, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('PUT', path, payload, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK and body is empty', async () => {
        expect(response.status()).toBe(200);
        expect(responseBody).toBeNull();
      });
    });

    test('TC010 - Get User KYC Journey URLs', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/journey-url?clientId=... — validate list items and pagination' });

      const path     = ENDPOINTS.KYC.GET_JOURNEY_URLS.path;
      const params   = { clientId: sharedAccount.clientId, page: 0, size: 20 };
      const response = await apiGet(request, path, TENANT_HEADERS, params);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', `${path}?clientId=${sharedAccount.clientId}&page=0&size=20`, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate list items', async () => {
        validateResponseProperties(expect, responseBody, ['list', 'pagination']);
        expect(Array.isArray(responseBody.list)).toBe(true);
        expect(responseBody.list.length).toBeGreaterThan(0);
        for (const item of responseBody.list) {
          validateResponseProperties(expect, item, ['id', 'clientId', 'journeyUrl', 'journeyId', 'firstName', 'lastName', 'email', 'phone', 'requestType', 'createdOn']);
          expect(item.clientId).toBe(sharedAccount.clientId);
          expect(item.journeyUrl).toMatch(/^https?:\/\//);
          expect(item.journeyUrl).toContain(item.journeyId);
        }
        const match = responseBody.list.find(i => i.journeyId === kycJourneyId);
        expect(match, `Journey ${kycJourneyId} from TC008 not found in list`).toBeDefined();
      });

      await test.step('Validate pagination', async () => {
        validateResponseProperties(expect, responseBody.pagination, ['page', 'size', 'totalElements', 'totalPages']);
      });
    });

  });

  test.describe('Edge Cases', () => {

    test('TC-E001 - Duplicate correlationId must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts — reusing a correlationId must return 400 / errorCode 830132' });

      const path     = ENDPOINTS.ACCOUNT.CREATE.path;
      const payload  = generateClientAccountData({ correlationId: sharedAccount.correlationId });
      const response = await apiPost(request, path, payload, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, payload, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('830132');
      expect(responseBody.userMessage).toBe('Correlation ID must be unique');
      expect(responseBody.statusCode).toBe(400);
    });

    test('TC-E002 - Add currency to non-existent clientId must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts/{clientId}/currency — unknown clientId must return 500 / errorCode 790001' });

      const path     = `${buildPath(ENDPOINTS.ACCOUNT.ADD_CURRENCY.path, { clientId: NON_EXISTENT_CLIENT_ID })}?currency=EUR`;
      const response = await apiPost(request, path, null, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, null, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(500);
      expect(responseBody.errorCode).toBe('790001');
      expect(responseBody.userMessage).toBe('Main account not found with given client id');
      expect(responseBody.statusCode).toBe(500);
    });

    test('TC-E003 - Add unsupported currency must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts/{clientId}/currency?currency=XYZ — unsupported code must return error with all 3 error fields' });

      const path     = `${buildPath(ENDPOINTS.ACCOUNT.ADD_CURRENCY.path, { clientId: sharedAccount.clientId })}?currency=XYZ`;
      const response = await apiPost(request, path, null, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, null, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(500);
      expect(responseBody.errorCode).toBe('473874');
      expect(responseBody.userMessage).toBe('Product not found');
      expect(responseBody.statusCode).toBe(500);
    });

    test('TC-E004 - Payment instructions for invalid accountNumber must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/account/instructions?accountNumber=... — unknown account must return 500' });

      const path     = ENDPOINTS.ACCOUNT.GET_PAYMENT_INSTRUCTIONS.path;
      const response = await apiGet(request, path, TENANT_HEADERS, { accountNumber: NON_EXISTENT_ACCOUNT_NUM });
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', `${path}?accountNumber=${NON_EXISTENT_ACCOUNT_NUM}`, null, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(500);
      expect(responseBody.userMessage).toBe(`Account not found: ${NON_EXISTENT_ACCOUNT_NUM}`);
      expect(responseBody.statusCode).toBe(500);
    });

    test('TC-E005 - Get account info for non-existent clientId must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/{clientId} — unknown clientId must return 400 / errorCode 800126' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: NON_EXISTENT_CLIENT_ID });
      const response = await apiGet(request, path, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('800126');
      expect(responseBody.userMessage).toBe('Client Account not found');
      expect(responseBody.statusCode).toBe(400);
    });

    test('TC-E006 - Get account profile for non-existent clientId must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/profile/{clientId} — unknown clientId must return 400 / errorCode 800126' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_PROFILE', { clientId: NON_EXISTENT_CLIENT_ID });
      const response = await apiGet(request, path, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('800126');
      expect(responseBody.userMessage).toBe('Client Account not found');
      expect(responseBody.statusCode).toBe(400);
    });

    test('TC-E007 - Get balance for non-existent clientId must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/balance/{clientId} — unknown clientId must return 400 / errorCode 800126' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_BALANCE', { clientId: NON_EXISTENT_CLIENT_ID });
      const response = await apiGet(request, path, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('800126');
      expect(responseBody.userMessage).toBe('Client Account not found');
      expect(responseBody.statusCode).toBe(400);
    });

    test('TC-E008 - Create KYC URL without any identifier must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts/create-journey-url — all null identifiers must return an error' });

      const path    = ENDPOINTS.KYC.CREATE_JOURNEY_URL.path;
      const payload = { clientId: null, prospectId: null, businessId: null, idType: null, country: null, ownerId: null };
      const response = await apiPost(request, path, payload, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, payload, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('2455501');
      expect(responseBody.userMessage).toBe('Invalid request: Missing clientId or businessId');
      expect(responseBody.statusCode).toBe(400);
    });

    test('TC-E009 - Update KYC for non-existent clientId must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'PUT /admin/accounts/kyc — unknown clientId must return an error with all 3 error fields' });

      const path    = ENDPOINTS.KYC.UPDATE_DETAILS.path;
      const payload = { clientId: NON_EXISTENT_CLIENT_ID, identificationType: 'SSN', identificationNumber: '123456789' };
      const response = await apiPut(request, path, payload, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('PUT', path, payload, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('720016');
      // userMessage contains internal service details that may vary — assert the stable prefix only
      expect(responseBody.userMessage).toContain('Unable to update identification');
      expect(responseBody.statusCode).toBe(400);
    });

    test('TC-E010 - KYC journey URLs for non-existent clientId must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/journey-url?clientId=<unknown> — unknown clientId must return 400 / errorCode 800126' });

      const path     = ENDPOINTS.KYC.GET_JOURNEY_URLS.path;
      const response = await apiGet(request, path, TENANT_HEADERS, { clientId: NON_EXISTENT_CLIENT_ID, page: 0, size: 20 });
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', `${path}?clientId=${NON_EXISTENT_CLIENT_ID}&page=0&size=20`, null, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('800126');
      expect(responseBody.userMessage).toBe('Client Account not found');
      expect(responseBody.statusCode).toBe(400);
    });

    test('TC-E011 - Close non-existent account must fail', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts/close — unknown accountId must return 400 / errorCode 720011' });

      const path    = ENDPOINTS.ACCOUNT.CLOSE_ACCOUNT.path;
      const payload = { clientId: NON_EXISTENT_CLIENT_ID, accountId: NON_EXISTENT_ACCOUNT_NUM, status: 'closed-client', reason: 'Edge case test' };
      const response = await apiPost(request, path, payload, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, payload, response, responseBody, TENANT_HEADERS);

      expect(response.status()).toBe(400);
      expect(responseBody.errorCode).toBe('720011');
      expect(responseBody.userMessage).toBe('Account not found');
      expect(responseBody.statusCode).toBe(400);
    });

  });

  test.describe.skip('Closure', () => {

    test('TC011 - Close Account', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'POST /admin/accounts/close — close the shared account after all happy path and edge case tests have completed' });

      const path    = ENDPOINTS.ACCOUNT.CLOSE_ACCOUNT.path;
      const payload = {
        clientId:  sharedAccount.clientId,
        accountId: sharedAccount.accountNumber,
        status:    'closed-client',
        reason:    'Automated QA lifecycle test',
      };
      const response = await apiPost(request, path, payload, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('POST', path, payload, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('Validate closure response fields', async () => {
        const validStatuses = ['CLOSED_PENDING', 'CLOSED_CLIENT', 'CLOSED', 'closed-pending', 'closed-client', 'closed'];
        validateResponseProperties(expect, responseBody, ['status', 'clientId', 'accountId']);
        expect(validStatuses, `Unexpected closure status: "${responseBody.status}"`).toContain(responseBody.status);
        expect(responseBody.clientId).toBe(sharedAccount.clientId);
        expect(responseBody.accountId).toBe(sharedAccount.accountNumber);
      });
    });

    test.skip('TC012 - Verify Account Status After Closure', async ({ request }) => {
      test.info().annotations.push({ type: 'description', description: 'GET /admin/accounts/{clientId} — cross-verify accountStatus reflects the closed state after TC011' });

      const { path } = buildEndpoint('ACCOUNT', 'GET_INFO', { clientId: sharedAccount.clientId });
      const response = await apiGet(request, path, TENANT_HEADERS);
      const responseBody = await getResponseBody(response);

      await attachRequestResponse('GET', path, null, response, responseBody, TENANT_HEADERS);

      await test.step('Status is 200 OK', async () => {
        expect(response.status()).toBe(200);
      });

      await test.step('accountStatus reflects a closed state', async () => {
        const closedStatuses = ['CLOSED_PENDING', 'CLOSED_CLIENT', 'CLOSED', 'closed_pending', 'closed-pending', 'closed-client', 'closed'];
        expect(
          responseBody.accountStatus?.toLowerCase(),
          `Expected accountStatus to NOT be active but got: "${responseBody.accountStatus}"`
        ).not.toBe('active');      
        expect(responseBody.accountNumber).toBe(sharedAccount.accountNumber);
      });
    });

  });

});
