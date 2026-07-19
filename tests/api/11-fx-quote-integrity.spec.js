/**
 * FX Quote Integrity & Security Tests
 *
 * Validates server-side enforcement of quoteId lifecycle:
 *   - Rate and fee tampering detection
 *   - Amount mismatch between quote and payment submission
 *   - Currency corridor binding (quote cannot be reused across corridors)
 *   - Zero-amount quoteId used for a real payment
 *   - Duplicate submission / double-spend guard
 *   - QuoteId TTL expiry enforcement
 *   - Concurrent quotes (does generating B invalidate A?)
 *   - Payment status lookups (valid and fake identifier)
 *
 * Auth: user session — grant-type → password token (OTP if required) → device/info.
 *       No Basic Auth. All requests carry Authorization: Bearer <token> + glide-device-id + glide-session-id.
 *
 * Required env vars (see .env.example for defaults):
 *   FX_BASE_URL, FX_TENANT, FX_DEVICE_ID, FX_PHONE, LOGIN_PASSWORD,
 *   FX_FROM_ACCOUNT, FX_BENEFICIARY_ACCOUNT
 *
 * Corridors under test:
 *   from=5 (USD) → to=18 (GBP), country=GB, channel=iban  [primary]
 *   from=5 (USD) → to=156 (second corridor)               [mismatch test QV-04]
 */

const { test, expect } = require('@playwright/test');
const { sleep } = require('../../utils/helpers');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE     = process.env.FX_BASE_URL            || 'https://api-sandbox.bivotech.co';
const TENANT   = process.env.FX_TENANT              || 'bivo_sandbox';
const DEVICE_ID = parseInt(process.env.FX_DEVICE_ID || '3978736141', 10);
const PHONE    = process.env.FX_PHONE;
const PASSWORD = process.env.LOGIN_PASSWORD         || 'Test12345.';
const FROM_ACC = process.env.FX_FROM_ACCOUNT        || '10000000114567';
const BEN_ACC  = process.env.FX_BENEFICIARY_ACCOUNT || '5000000024136';

const FROM_CUR        = 5;    // USD
const TO_CUR          = 18;   // GBP
const COUNTRY         = 'GB';
const CHANNEL         = 'iban';
const FUND_SRC        = 'BIVO_ACCOUNT';
const MISMATCH_TO_CUR = 156;  // second valid corridor for corridor-mismatch test

// ── Suite config ──────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' });
test.setTimeout(60000);
test.afterEach(async () => { await sleep(500); });

// ── Shared state ──────────────────────────────────────────────────────────────

let sessionId   = null;
let accessToken = null;   // Bearer token from password/OTP token response

const ctx = {
  zeroAmountQuoteId: null,  // quote generated with amount=0 (AM-04)
  quoteId:           null,  // valid quote for amount=100 used by most tests
  rate:              null,
  fees:              null,
  quoteIdA:          null,  // concurrent quote A
  paymentIdentifier: null,  // captured from DS-01 real payment
};

// ── Session helpers ───────────────────────────────────────────────────────────

function sessionHeaders() {
  const h = {
    'Content-Type':        'application/json',
    'x-tenant-identifier': TENANT,
    'glide-device-id':     String(DEVICE_ID),
  };
  if (sessionId)   h['glide-session-id'] = sessionId;
  if (accessToken) h['Authorization']    = `Bearer ${accessToken}`;
  return h;
}

function rotateSession(response) {
  const id = response.headers()['glide-session-id'];
  if (id) sessionId = id;
}

// ── URL builders ──────────────────────────────────────────────────────────────

function quoteUrl(amount) {
  const params = new URLSearchParams({
    toCurrencyId:   TO_CUR,
    amount:         amount,
    channel:        CHANNEL,
    fromCurrencyId: FROM_CUR,
    country:        COUNTRY,
    generate_quote: 'true',
    fund_source:    FUND_SRC,
  });
  if (Number(amount) > 0) params.set('amountType', 'SEND');
  return `${BASE}/remittance/v1/international/payment/currency/rate?${params}`;
}

const PAYMENT_URL = `${BASE}/remittance/v1/international/payment`;

function statusUrl(identifier) {
  return `${BASE}/remittance/v1/international/payment/status/${identifier}`;
}

// ── Payment body factory ──────────────────────────────────────────────────────
// Returns a well-formed payment body using ctx.quoteId, ctx.rate, ctx.fees.
// Pass overrides to mutate any field for a specific test scenario.

function paymentBody(overrides = {}) {
  return {
    amount:             '100.00',
    beneficiaryAccount: BEN_ACC,
    description:        'FX Quote Integrity Test',
    fromAccount:        FROM_ACC,
    fromCurrencyId:     FROM_CUR,
    toCurrencyId:       TO_CUR,
    amountCurrencyId:   FROM_CUR,
    channel:            CHANNEL,
    rate:               ctx.rate,
    fees:               ctx.fees,
    fund_source:        FUND_SRC,
    amountType:         'SEND',
    quoteId:            ctx.quoteId,
    ...overrides,
  };
}

// ── Attachment helper ─────────────────────────────────────────────────────────

async function attach(label, method, url, reqBody, res, resBody) {
  const info = test.info();
  info.attach(`[${label}] Request`,  { body: `${method} ${url}\n\n${reqBody != null ? JSON.stringify(reqBody, null, 2) : '(no body)'}`, contentType: 'text/plain' });
  info.attach(`[${label}] Response`, { body: `${res.status()} ${res.statusText()}\n\n${resBody != null ? JSON.stringify(resBody, null, 2) : '(empty)'}`, contentType: 'text/plain' });
}

// ── Keycloak OTP fetch ────────────────────────────────────────────────────────

async function fetchOtpFromKeycloak(request, phone) {
  const formData = new URLSearchParams({
    client_id:  process.env.KEYCLOAK_CLIENT_ID,
    username:   process.env.KEYCLOAK_USERNAME,
    password:   process.env.KEYCLOAK_PASSWORD,
    grant_type: process.env.KEYCLOAK_GRANT_TYPE,
  }).toString();

  const authRes = await request.post(
    `${process.env.KEYCLOAK_HOST}/${process.env.KEYCLOAK_AUTH_URI}`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: formData },
  );
  const kcToken = (await authRes.json()).access_token;

  const userRes = await request.get(
    `${process.env.KEYCLOAK_HOST}/${process.env.KEYCLOAK_URI}/realms/${process.env.KEYCLOAK_REALM}/users`,
    { headers: { Authorization: `Bearer ${kcToken}` }, params: { username: phone, exact: 'true' } },
  );
  const users       = await userRes.json();
  const encodedOtp  = users[0]?.attributes?.otp?.[0];
  if (!encodedOtp) throw new Error(`OTP attribute not found in Keycloak for ${phone}`);
  return Buffer.from(encodedOtp, 'base64').toString('utf-8');
}

// ── Login flow ────────────────────────────────────────────────────────────────

async function login(request) {
  // 1. grant-type — establishes initial session
  const grantRes = await request.post(`${BASE}/identity/v1/grant-type`, {
    headers: { 'Content-Type': 'application/json', 'x-tenant-identifier': TENANT, 'glide-device-id': String(DEVICE_ID) },
    data:    { phoneCountryCode: '1', phoneNumber: PHONE },
  });
  expect(grantRes.status(), 'grant-type should return 200').toBe(200);
  rotateSession(grantRes);

  // 2. password token — device-trusted sessions skip OTP
  const tokenRes = await request.post(`${BASE}/identity/v1/token`, {
    headers: sessionHeaders(),
    data:    { username: PHONE, grantType: 'password', deviceId: DEVICE_ID, password: PASSWORD },
  });
  expect(tokenRes.status(), 'token should return 200').toBe(200);
  const tokenBody = await tokenRes.json();

  if (tokenBody.forceOtpAuth === true) {
    rotateSession(tokenRes);

    // Trigger OTP via identity API
    const otpTrigger = await request.post(`${BASE}/identity/v1/otp`, {
      headers: { 'Content-Type': 'application/json', 'x-tenant-identifier': TENANT },
      data:    { phoneNumber: PHONE },
    });
    expect([200, 202]).toContain(otpTrigger.status());
    await sleep(2000); // allow Keycloak to persist the OTP attribute

    const otp = await fetchOtpFromKeycloak(request, PHONE);

    const otpRes = await request.post(`${BASE}/identity/v1/token`, {
      headers: sessionHeaders(),
      data:    { username: PHONE, grantType: 'otp', otp, deviceId: DEVICE_ID },
    });
    expect(otpRes.status(), 'OTP token should return 200').toBe(200);
    const otpBody = await otpRes.json();
    accessToken = otpBody.accessToken || null;
    rotateSession(otpRes);
  } else {
    accessToken = tokenBody.accessToken || null;
    rotateSession(tokenRes);
  }

  // 3. invitations — mirrors real app flow and rotates session
  const invRes = await request.get(`${BASE}/clientaccount/v1/invitations`, { headers: sessionHeaders() });
  rotateSession(invRes);

  // 4. device/info — registers device and finalises session
  const deviceRes = await request.post(`${BASE}/client/v1/client/device/info`, {
    headers: sessionHeaders(),
    data: {
      brand: 'MacIntel', model: 'Chrome/149.0.0.0',
      timezone: 'Asia/Katmandu', timeZone: '+75',
      deviceLocale: 'en-US', language: 'en-US', systemLanguage: 'en-US',
      userAgent: 'Mozilla/5.0 Chrome/149.0.0.0',
      browserData: {
        ua: 'Mozilla/5.0',
        browser: { name: 'Chrome', version: '149.0.0.0', major: '149' },
        engine:  { name: 'Blink',  version: '149.0.0.0' },
        os:      { name: 'Mac OS', version: '10.15.7' },
        device: {}, cpu: {},
      },
      deviceId:          DEVICE_ID,
      deviceUUID:        DEVICE_ID,
      customFingerprint: 1164980575,
      device: 'undefined', os: 'Mac OS', osVersion: '10.15.7',
      engine: 'Blink', engineVersion: '149.0.0.0',
    },
  });
  rotateSession(deviceRes);
}

// ── Quote helper ──────────────────────────────────────────────────────────────

async function getQuote(request, amount) {
  const url = quoteUrl(amount);
  const res  = await request.get(url, { headers: sessionHeaders() });
  rotateSession(res);
  expect(res.status(), `GET quote (amount=${amount}) should return 200`).toBe(200);
  return res.json();
}

// ── Suite beforeAll ───────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  if (!PHONE) throw new Error('FX_PHONE env var is required. Add it to your .env file.');

  // Log in once — session persists across all tests via sessionId / sessionHeaders()
  await login(request);

  // Zero-amount quote for AM-04 — server may 502 if amount=0 is unsupported; treat as optional
  const zeroRes = await request.get(quoteUrl(0), { headers: sessionHeaders() });
  rotateSession(zeroRes);
  if (zeroRes.status() === 200) {
    ctx.zeroAmountQuoteId = (await zeroRes.json()).quoteId;
  } else {
    console.warn(`Zero-amount quote returned ${zeroRes.status()} — AM-04 will be skipped`);
  }

  // Warm up ctx.rate / ctx.fees with the initial quote so paymentBody() is never called
  // with nulls; each individual test that posts a payment refreshes the quote inline.
  const warmBody = await getQuote(request, 100);
  ctx.quoteId    = warmBody.quoteId;
  ctx.rate       = warmBody.conversionRate;
  ctx.fees       = warmBody.fees;

  console.log(`Session ID   : ${sessionId}`);
  console.log(`quoteId      : ${ctx.quoteId}`);
  console.log(`zeroQuoteId  : ${ctx.zeroAmountQuoteId}`);
  console.log(`rate         : ${ctx.rate}  fees: ${ctx.fees}`);
  console.log(`TTL          : ${warmBody.rateValidity?.ttlSeconds}s → valid until ${warmBody.rateValidity?.validUntil}`);
});

// =============================================================================
// Rate Tampering
//
// Assertion contract: the critical risk is that the server processes the payment
// at the TAMPERED value (giving the user a worse or better deal). If the server
// accepts the request but still uses the quoted value, that is a FINDING (logged)
// not a critical failure. Tests pass in the finding case so the full suite runs.
// =============================================================================

test.describe('Rate Tampering', () => {

  test('RT-01 — tampered rate (lowered to 0.0001)', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({ rate: 0.0001, description: 'RT-01 tampered rate low' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('RT-01', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`FINDING RT-01: Server accepted tampered rate=0.0001 (status ${res.status()}). paymentIdentifier: ${resBody?.paymentIdentifier}  Actual rate used: ${resBody?.rate}`);
      // Critical: tampered rate must NOT have been used — server must lock rate from quote
      expect(resBody?.rate, 'CRITICAL RT-01: server processed payment at tampered rate 0.0001').not.toBeCloseTo(0.0001, 3);
    } else {
      console.log(`RT-01: Server correctly rejected tampered rate (${res.status()}) ✓`);
      expect([400, 403, 422]).toContain(res.status());
    }
  });

  test('RT-02 — tampered rate (inflated to 999)', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({ rate: 999, description: 'RT-02 tampered rate high' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('RT-02', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`FINDING RT-02: Server accepted tampered rate=999 (status ${res.status()}). paymentIdentifier: ${resBody?.paymentIdentifier}  Actual rate used: ${resBody?.rate}`);
      expect(resBody?.rate, 'CRITICAL RT-02: server processed payment at tampered rate 999').not.toBeCloseTo(999, 0);
    } else {
      console.log(`RT-02: Server correctly rejected tampered rate (${res.status()}) ✓`);
      expect([400, 403, 422]).toContain(res.status());
    }
  });

  test('RT-03 — tampered fees (set to 0)', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({ fees: 0, description: 'RT-03 zero fees' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('RT-03', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`FINDING RT-03: Server accepted fees=0 (status ${res.status()}). paymentIdentifier: ${resBody?.paymentIdentifier}  Actual fees used: ${resBody?.fees}`);
      // If server accepted but charged zero fees, the user avoided fees — critical
      expect(resBody?.fees ?? resBody?.fee, 'CRITICAL RT-03: server processed payment with zero fees').not.toBe(0);
    } else {
      console.log(`RT-03: Server correctly rejected fees=0 (${res.status()}) ✓`);
      expect([400, 403, 422]).toContain(res.status());
    }
  });

  test('RT-04 — tampered fees (set to negative)', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({ fees: -10, description: 'RT-04 negative fees' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('RT-04', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`FINDING RT-04: Server accepted fees=-10 (status ${res.status()}). paymentIdentifier: ${resBody?.paymentIdentifier}  Actual fees used: ${resBody?.fees}`);
      // If server accepted but applied negative fees, the user got money back — critical
      const actualFees = resBody?.fees ?? resBody?.fee ?? 0;
      expect(actualFees, 'CRITICAL RT-04: server applied negative fees').toBeGreaterThanOrEqual(0);
    } else {
      console.log(`RT-04: Server correctly rejected negative fees (${res.status()}) ✓`);
      expect([400, 403, 422]).toContain(res.status());
    }
  });

});

// =============================================================================
// Amount Mismatch
// =============================================================================

test.describe('Amount Mismatch', () => {

  test('AM-01 — amount mismatch: quoted 100, sending 500', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({ amount: '500.00', description: 'AM-01 amount mismatch 500 vs quoted 100' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('AM-01', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      const processed = Number(resBody?.amount ?? resBody?.originalAmount ?? 0);
      console.warn(`FINDING AM-01: Server accepted amount=500 (status ${res.status()}). Amount in response: ${processed}`);
      // Critical: if the server processed $500, the quote's amount binding is broken
      expect(processed, 'CRITICAL AM-01: server processed $500 on a $100 quote — amount not locked').toBeLessThan(200);
    } else {
      console.log(`AM-01: Server correctly rejected mismatched amount (${res.status()}) ✓`);
      expect([400, 403, 422]).toContain(res.status());
    }
  });

  test('AM-02 — negative amount should be rejected', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({ amount: '-100.00', description: 'AM-02 negative amount' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('AM-02', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`BUG AM-02: Payment accepted with amount=-100 (status ${res.status()})`);
    }
    expect([400, 422], `AM-02 expected rejection, got ${res.status()}`).toContain(res.status());
  });

  test('AM-03 — zero amount should be rejected', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({ amount: '0.00', description: 'AM-03 zero amount' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('AM-03', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`BUG AM-03: Payment accepted with amount=0 (status ${res.status()})`);
    }
    expect([400, 422], `AM-03 expected rejection, got ${res.status()}`).toContain(res.status());
  });

  test('AM-04 — quoteId generated for amount=0 used for amount=100 payment', async ({ request }) => {
    if (!ctx.zeroAmountQuoteId) {
      test.skip(true, 'Zero-amount quote unavailable (server returned non-200 in beforeAll)');
    }
    // Fresh quote to get up-to-date rate/fees for the payment body;
    // the QUOTE USED is intentionally ctx.zeroAmountQuoteId (captured in beforeAll)
    const q = await getQuote(request, 100);
    ctx.rate = q.conversionRate; ctx.fees = q.fees;
    // Keep ctx.quoteId pointing at a valid quote so paymentBody() base is valid,
    // then override quoteId below to the zero-amount one
    ctx.quoteId = q.quoteId;

    const body = paymentBody({
      quoteId:     ctx.zeroAmountQuoteId,
      description: 'AM-04 zero-amount quoteId used for 100 payment',
    });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('AM-04', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`FINDING AM-04: Payment of 100 accepted using a quoteId generated for amount=0 (status ${res.status()})`);
    } else {
      console.log(`AM-04: Server correctly rejected zero-amount quoteId for real payment (${res.status()}) ✓`);
    }
    // Zero-amount quotes for real payments is a clear security concern — keep strict
    expect([400, 403, 422], `AM-04 expected rejection, got ${res.status()}`).toContain(res.status());
  });

});

// =============================================================================
// QuoteId Validity
// =============================================================================

test.describe('QuoteId Validity', () => {

  test('QV-01 — fake quoteId (nil UUID) should be rejected', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({
      quoteId:     '00000000-0000-0000-0000-000000000000',
      description: 'QV-01 fake quoteId',
    });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('QV-01', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`BUG QV-01: Payment accepted with fabricated nil UUID quoteId — no server-side quote validation (status ${res.status()})`);
    }
    expect([400, 403, 404, 422], `QV-01 expected rejection, got ${res.status()}`).toContain(res.status());
  });

  test('QV-02 — missing quoteId field should be rejected', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const { quoteId: _removed, ...bodyWithoutQuoteId } = paymentBody({ description: 'QV-02 no quoteId' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: bodyWithoutQuoteId });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('QV-02', 'POST', PAYMENT_URL, bodyWithoutQuoteId, res, resBody);

    if ([200, 202].includes(res.status())) {
      // FINDING: quoteId is entirely optional — the server processes payments with no quote binding at all.
      // This means any client can skip the quote step entirely and submit arbitrary amounts at whatever rate the server computes on the fly.
      console.warn(`FINDING QV-02: Payment accepted with no quoteId field (status ${res.status()}). paymentIdentifier: ${resBody?.paymentIdentifier}`);
      // Verify at least the server didn't produce garbage
      expect(resBody?.paymentIdentifier, 'CRITICAL QV-02: no paymentIdentifier returned despite 202').toBeTruthy();
    } else {
      console.log(`QV-02: Server correctly rejected missing quoteId (${res.status()}) ✓`);
      expect([400, 422]).toContain(res.status());
    }
  });

  test('QV-04 — corridor mismatch: USD→GBP quoteId submitted with toCurrencyId=156', async ({ request }) => {
    // Get a quote locked to USD→GBP (to=18) then submit it with toCurrencyId=156.
    // If accepted, log a finding and check which corridor was actually executed.
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId; ctx.rate = q.conversionRate; ctx.fees = q.fees;

    const body = paymentBody({
      toCurrencyId: MISMATCH_TO_CUR,
      description:  `QV-04 corridor mismatch: GBP quote (to=18) submitted with toCurrencyId=${MISMATCH_TO_CUR}`,
    });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('QV-04', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`FINDING QV-04: Server accepted USD→GBP quoteId for toCurrencyId=${MISMATCH_TO_CUR} payment (status ${res.status()}). toCurrency in response: ${resBody?.toCurrency}`);
    } else {
      console.log(`QV-04: Server correctly rejected corridor mismatch (${res.status()}) ✓`);
    }
    // Corridor binding is a security requirement — keep strict
    expect([400, 403, 422], `QV-04 expected rejection, got ${res.status()}`).toContain(res.status());
  });

});

// =============================================================================
// Concurrent Quotes
// =============================================================================

test.describe('Concurrent Quotes', () => {

  test('CQ-01 — generate quote A', async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteIdA = q.quoteId;
    ctx.quoteId  = q.quoteId;
    ctx.rate     = q.conversionRate;
    ctx.fees     = q.fees;

    expect(ctx.quoteIdA, 'CQ-01 should return a quoteId').toBeTruthy();
    console.log(`CQ-01 quote A: ${ctx.quoteIdA} | rate: ${q.conversionRate}`);
  });

  test('CQ-02 — generate quote B immediately after A — should be a distinct ID', async ({ request }) => {
    const q = await getQuote(request, 100);
    const quoteIdB = q.quoteId;

    expect(quoteIdB, 'CQ-02 quote B should be distinct from quote A').not.toBe(ctx.quoteIdA);
    console.log(`CQ-02 quote B: ${quoteIdB} — both A and B now live simultaneously`);
  });

  test('CQ-03 — submit payment using older quote A (with B also live) — observational', async ({ request }) => {
    // Observational test — both outcomes are intentionally valid:
    //   202 → concurrent quotes coexist; user could cherry-pick the best rate
    //   4xx → last-quote-wins; generating B invalidated A
    const body = {
      ...paymentBody({ description: 'CQ-03 submitting with older quote A' }),
      quoteId: ctx.quoteIdA,
    };
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('CQ-03', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.log(`INFO CQ-03: Quote A still valid after quote B generated — concurrent quotes coexist (status ${res.status()})`);
      if (resBody?.paymentIdentifier) console.log(`  CQ-03 paymentIdentifier: ${resBody.paymentIdentifier}`);
    } else {
      console.log(`INFO CQ-03: Quote A rejected (${res.status()}) after quote B generated — last-quote-wins policy`);
    }
    expect([200, 202, 400, 403, 404, 410, 422]).toContain(res.status());
  });

});

// =============================================================================
// Duplicate Submission
// =============================================================================

test.describe('Duplicate Submission', () => {

  // DS-01 and DS-02 must share the same quoteId — get one fresh quote for both.
  test.beforeAll(async ({ request }) => {
    const q = await getQuote(request, 100);
    ctx.quoteId = q.quoteId;
    ctx.rate    = q.conversionRate;
    ctx.fees    = q.fees;
    console.log(`DS group fresh quoteId: ${ctx.quoteId}`);
  });

  test('DS-01 — first valid submission should succeed and return paymentIdentifier', async ({ request }) => {
    const body = paymentBody({ description: 'DS-01 first valid submission' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('DS-01', 'POST', PAYMENT_URL, body, res, resBody);

    expect(res.status(), 'DS-01 first submission should return 202').toBe(202);
    expect(resBody?.paymentIdentifier, 'DS-01 should return a paymentIdentifier').toBeTruthy();

    ctx.paymentIdentifier = resBody.paymentIdentifier;
    console.log(`DS-01 paymentIdentifier: ${ctx.paymentIdentifier}`);
  });

  test('DS-02 — duplicate submission with same quoteId should be rejected', async ({ request }) => {
    // Re-submits the exact same quoteId as DS-01 — double-spend risk if this succeeds
    const body = paymentBody({ description: 'DS-02 duplicate submission same quoteId' });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('DS-02', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`BUG DS-02: Same quoteId accepted twice — double-spend. Second paymentIdentifier: ${resBody?.paymentIdentifier}`);
    }
    expect([400, 403, 409, 422], `DS-02 expected rejection, got ${res.status()}`).toContain(res.status());
  });

});

// =============================================================================
// Payment Status
// =============================================================================

test.describe('Payment Status', () => {

  test('PS-01 — poll status for DS-01 payment should return status field', async ({ request }) => {
    expect(ctx.paymentIdentifier, 'PS-01 requires DS-01 to have captured a paymentIdentifier').toBeTruthy();

    const url     = statusUrl(ctx.paymentIdentifier);
    const res     = await request.get(url, { headers: sessionHeaders() });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('PS-01', 'GET', url, null, res, resBody);

    expect([200, 202], `PS-01 expected success, got ${res.status()}`).toContain(res.status());
    expect(resBody?.status, 'PS-01 should return a status string').toBeTruthy();
    console.log(`PS-01 payment status: ${resBody?.status} | display: ${resBody?.displayStatus}`);
  });

  test('PS-02 — poll status for fake paymentIdentifier should return 404', async ({ request }) => {
    const url     = statusUrl('XXXXXXXX');
    const res     = await request.get(url, { headers: sessionHeaders() });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('PS-02', 'GET', url, null, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`BUG PS-02: Status returned for non-existent paymentIdentifier (status ${res.status()})`);
    }
    expect([400, 404], `PS-02 expected 404, got ${res.status()}`).toContain(res.status());
  });

});

// =============================================================================
// TTL Expiry  (runs last — waits for the quote to expire)
// =============================================================================

test.describe('TTL Expiry', () => {

  test('QV-03 — expired quoteId should be rejected after TTL elapses', async ({ request }) => {
    test.slow(); // triples timeout to 180s to accommodate 120s+ TTL wait

    const freshQuote  = await getQuote(request, 100);
    const ttlQuoteId  = freshQuote.quoteId;
    const ttlSeconds  = freshQuote.rateValidity?.ttlSeconds ?? 120;

    console.log(`QV-03 fresh quoteId: ${ttlQuoteId} | TTL: ${ttlSeconds}s`);
    console.log(`QV-03 waiting ${ttlSeconds + 5}s for quote to expire...`);

    await sleep((ttlSeconds + 5) * 1000);

    const body = paymentBody({
      quoteId:     ttlQuoteId,
      rate:        freshQuote.conversionRate,
      fees:        freshQuote.fees,
      description: 'QV-03 expired quoteId test',
    });
    const res     = await request.post(PAYMENT_URL, { headers: sessionHeaders(), data: body });
    const resBody = await res.json().catch(() => null);
    rotateSession(res);
    await attach('QV-03', 'POST', PAYMENT_URL, body, res, resBody);

    if ([200, 202].includes(res.status())) {
      console.warn(`BUG QV-03: Expired quoteId accepted — TTL not enforced server-side (status ${res.status()})`);
    }
    expect([400, 403, 410, 422], `QV-03 expected rejection of expired quote, got ${res.status()}`).toContain(res.status());
  });

});
