/**
 * OTP Trust Device Script
 *
 * Runs a full OTP login flow for a phone number multiple times with the same
 * deviceId so the server learns to trust the device and stops requiring OTP.
 *
 * Usage:
 *   node scripts/otp-trust-device.js
 *   node scripts/otp-trust-device.js --phone 4155790001 --runs 3
 *
 * After RUNS successful OTP logins with the same deviceId, do a plain
 * password login and check whether forceOtpAuth is now false.
 */

require('dotenv').config();
const https = require('https');
const http  = require('http');
const { URL } = require('url');

// ── Config ────────────────────────────────────────────────────────────────────
const phoneIdx  = process.argv.indexOf('--phone');
const runsIdx   = process.argv.indexOf('--runs');
const PHONE     = (phoneIdx !== -1 ? process.argv[phoneIdx + 1] : null) || '4155790001';
const RUNS      = parseInt((runsIdx  !== -1 ? process.argv[runsIdx  + 1] : null) || '3', 10);
const DEVICE_ID = 352734849;
const PASSWORD  = 'Test12345.';
const HOST      = process.env.HOST             || 'https://api-sandbox.bivotech.co';
const TENANT    = process.env.TENANT_IDENTIFIER || 'bivo_sandbox';

const KC_HOST       = process.env.KEYCLOAK_HOST      || 'http://dk-int.bivotech.co';
const KC_AUTH_URI   = process.env.KEYCLOAK_AUTH_URI  || 'realms/master/protocol/openid-connect/token';
const KC_URI        = process.env.KEYCLOAK_URI       || 'admin';
const KC_REALM      = process.env.KEYCLOAK_REALM     || 'glidecash';
const KC_CLIENT_ID  = process.env.KEYCLOAK_CLIENT_ID || 'admin-cli';
const KC_USERNAME   = process.env.KEYCLOAK_USERNAME  || 'glide';
const KC_PASSWORD   = process.env.KEYCLOAK_PASSWORD  || 'Index@123$';
const KC_GRANT_TYPE = process.env.KEYCLOAK_GRANT_TYPE || 'password';

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function request(method, rawUrl, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(rawUrl);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;

    const payload = body
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : null;

    const defaultHeaders = { 'Content-Type': 'application/json', ...extraHeaders };
    if (payload) defaultHeaders['Content-Length'] = Buffer.byteLength(payload);

    const opts = {
      hostname: u.hostname,
      port:     u.port || (isHttps ? 443 : 80),
      path:     u.pathname + u.search,
      method,
      headers:  defaultHeaders,
      rejectUnauthorized: false,
    };

    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function post(url, body, headers = {}) { return request('POST', url, body, headers); }
function get(url, headers = {})        { return request('GET',  url, null, headers); }

function apiHeaders(token, sessionId) {
  const h = { 'Content-Type': 'application/json', 'X-Tenant-Identifier': TENANT };
  if (token)     h['Authorization']    = `Bearer ${token}`;
  if (sessionId) h['glide-session-id'] = sessionId;
  return h;
}

function getSessionId(res) {
  return res.headers['glide-session-id'] || res.headers['Glide-Session-Id'] || null;
}

// ── OTP retrieval via Keycloak admin ─────────────────────────────────────────
async function fetchOtp(phone) {
  // 1. Keycloak admin token
  const formData = new URLSearchParams({
    client_id:  KC_CLIENT_ID,
    username:   KC_USERNAME,
    password:   KC_PASSWORD,
    grant_type: KC_GRANT_TYPE,
  }).toString();

  const authRes = await request(
    'POST',
    `${KC_HOST}/${KC_AUTH_URI}`,
    formData,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );
  if (authRes.status !== 200) throw new Error(`Keycloak auth failed ${authRes.status}: ${authRes.text}`);
  const kcToken = authRes.json().access_token;

  // 2. Look up user
  const userRes = await get(
    `${KC_HOST}/${KC_URI}/realms/${KC_REALM}/users?username=${phone}&exact=true`,
    { Authorization: `Bearer ${kcToken}` },
  );
  if (userRes.status !== 200) throw new Error(`Keycloak user lookup failed ${userRes.status}: ${userRes.text}`);
  const users = userRes.json();
  if (!users.length) throw new Error(`No Keycloak user found for ${phone}`);

  const attrs = users[0].attributes;
  if (!attrs?.otp?.[0]) throw new Error(`OTP attribute not found for ${phone}`);

  return Buffer.from(attrs.otp[0], 'base64').toString('utf-8');
}

// ── Full OTP login for one run ────────────────────────────────────────────────
async function runOtpLogin(runNum) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Run ${runNum}/${RUNS}  (phone: ${PHONE})`);
  console.log('─'.repeat(60));

  // 1. Grant-type
  const grantRes = await post(`${HOST}/identity/v1/grant-type`, {
    phoneCountryCode: '1', phoneNumber: PHONE,
  }, apiHeaders(null, null));
  console.log(`  [1] grant-type       → ${grantRes.status}`);
  if (grantRes.status !== 200) throw new Error(`grant-type failed: ${grantRes.text}`);

  // 2. Password token
  const tokenRes = await post(`${HOST}/identity/v1/token`, {
    username: PHONE, grantType: 'password', deviceId: DEVICE_ID, password: PASSWORD,
  }, apiHeaders(null, null));
  console.log(`  [2] token (password) → ${tokenRes.status}`);
  if (tokenRes.status !== 200) throw new Error(`token (password) failed: ${tokenRes.text}`);

  const tokenBody      = tokenRes.json();
  const initToken      = tokenBody.accessToken;
  let   sessionId      = getSessionId(tokenRes);
  const forceOtp       = tokenBody.forceOtpAuth;

  console.log(`      forceOtpAuth=${forceOtp}   sessionId=${sessionId ? 'present' : 'MISSING'}`);

  if (!forceOtp) {
    console.log(`  ✓ forceOtpAuth is already false — device is trusted!`);
    return { trusted: true, token: initToken, sessionId };
  }

  // 3. Invitations (rotates session)
  const invRes = await get(`${HOST}/clientaccount/v1/invitations`, apiHeaders(initToken, sessionId));
  sessionId = getSessionId(invRes) || sessionId;
  console.log(`  [3] invitations      → ${invRes.status}  (new sessionId: ${sessionId ? 'present' : 'MISSING'})`);

  // 4. Trigger OTP
  const otpTriggerRes = await post(`${HOST}/identity/v1/otp`, { phoneNumber: PHONE }, {
    'Content-Type': 'application/json',
    'X-Tenant-Identifier': TENANT,
  });
  console.log(`  [4] trigger OTP      → ${otpTriggerRes.status}`);
  if (otpTriggerRes.status !== 200 && otpTriggerRes.status !== 202) {
    throw new Error(`OTP trigger failed ${otpTriggerRes.status}: ${otpTriggerRes.text}`);
  }

  // 5. Retrieve OTP from Keycloak
  console.log(`  [5] fetching OTP from Keycloak...`);
  await new Promise(r => setTimeout(r, 1500)); // small wait for Keycloak to update
  const otp = await fetchOtp(PHONE);
  console.log(`  [5] OTP retrieved (value hidden)`);

  // 6. Submit OTP → get fully authorized token
  const otpTokenRes = await post(`${HOST}/identity/v1/token`, {
    username: PHONE, grantType: 'otp', otp, deviceId: DEVICE_ID,
  }, apiHeaders(null, sessionId));
  console.log(`  [6] token (otp)      → ${otpTokenRes.status}`);
  if (otpTokenRes.status !== 200) throw new Error(`OTP token failed ${otpTokenRes.status}: ${otpTokenRes.text}`);

  const otpTokenBody = otpTokenRes.json();
  const fullToken    = otpTokenBody.accessToken;
  sessionId          = getSessionId(otpTokenRes) || sessionId;

  console.log(`  [6] OTP token ok  forceOtpAuth=${otpTokenBody.forceOtpAuth ?? 'not in body'}`);

  // 7. Invitations (first authenticated call after full token)
  const invRes2 = await get(`${HOST}/clientaccount/v1/invitations`, apiHeaders(fullToken, sessionId));
  sessionId = getSessionId(invRes2) || sessionId;
  console.log(`  [7] invitations      → ${invRes2.status}`);

  // 8. Register device — this is what persists device trust on the server
  const deviceRes = await post(`${HOST}/client/v1/client/device/info`, {
    brand: 'MacIntel', model: 'Chrome/145.0.0.0', timezone: 'Asia/Katmandu',
    deviceLocale: 'en-US', userAgent: 'Mozilla/5.0 Chrome/145.0.0.0', language: 'en-US',
    browserData: {
      ua: 'Mozilla/5.0', browser: { name: 'Chrome', version: '145.0.0.0', major: '145' },
      engine: { name: 'Blink', version: '145.0.0.0' },
      os: { name: 'Mac OS', version: '10.15.7' }, device: {}, cpu: {},
    },
    deviceId: DEVICE_ID, customFingerprint: 1164980575, timeZone: '+75',
    systemLanguage: 'en-US', device: 'undefined', os: 'Mac OS', osVersion: '10.15.7',
    engine: 'Blink', engineVersion: '145.0.0.0', deviceUUID: DEVICE_ID,
  }, apiHeaders(fullToken, sessionId));
  sessionId = getSessionId(deviceRes) || sessionId;
  console.log(`  [8] device/info      → ${deviceRes.status}`);

  if (deviceRes.status !== 200) {
    console.log(`      response: ${deviceRes.text.slice(0, 200)}`);
  }

  console.log(`  ✓ Run ${runNum} complete`);
  return { trusted: false, token: fullToken, sessionId };
}

// ── Verify device trust with a plain password login ───────────────────────────
async function checkTrust() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Verification: password login without OTP`);
  console.log('═'.repeat(60));

  const grantRes = await post(`${HOST}/identity/v1/grant-type`, {
    phoneCountryCode: '1', phoneNumber: PHONE,
  }, apiHeaders(null, null));
  console.log(`  [1] grant-type → ${grantRes.status}`);

  const tokenRes = await post(`${HOST}/identity/v1/token`, {
    username: PHONE, grantType: 'password', deviceId: DEVICE_ID, password: PASSWORD,
  }, apiHeaders(null, null));
  console.log(`  [2] token      → ${tokenRes.status}`);

  const body = tokenRes.json();
  const forceOtp = body.forceOtpAuth;
  console.log(`\n  forceOtpAuth = ${forceOtp}`);

  if (!forceOtp) {
    console.log(`\n  ✓ Device is TRUSTED — ${PHONE} no longer requires OTP with deviceId ${DEVICE_ID}`);
    console.log(`    You can now add this phone as a 3rd parallel VU in k6/load-test.js`);
  } else {
    console.log(`\n  ✗ Device still requires OTP. Try running more iterations, or check backend config.`);
  }

  return !forceOtp;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  OTP Trust Device Script`);
  console.log(`  Phone:    ${PHONE}`);
  console.log(`  DeviceId: ${DEVICE_ID}`);
  console.log(`  Runs:     ${RUNS}`);
  console.log('═'.repeat(60));

  let alreadyTrusted = false;
  for (let i = 1; i <= RUNS; i++) {
    try {
      const result = await runOtpLogin(i);
      if (result.trusted) { alreadyTrusted = true; break; }
    } catch (err) {
      console.error(`\n  ✗ Run ${i} failed: ${err.message}`);
      process.exit(1);
    }
    // Brief pause between runs so session state settles
    if (i < RUNS) await new Promise(r => setTimeout(r, 2000));
  }

  if (!alreadyTrusted) {
    await checkTrust();
  }
})();
