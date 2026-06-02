import http from 'k6/http';
import { check } from 'k6';
import { HOST, PASSWORD, DEVICE_ID } from './config.js';
import { buildHeaders, rotateSession, DEVICE_INFO } from './helpers.js';

// ── passwordLogin ─────────────────────────────────────────────────────────────
// grant-type + password token only.
// Returns { token, sessionId, needsOtp } on success.
// Returns { noPassword: true } when account has no password set (412).
// Returns null on any other hard failure.
export function passwordLogin(phone) {
  const grantRes = http.post(
    `${HOST}/identity/v1/grant-type`,
    JSON.stringify({ phoneCountryCode: '1', phoneNumber: phone }),
    { headers: buildHeaders(null) },
  );
  if (!check(grantRes, { 'grant-type 200': r => r.status === 200 })) {
    console.error(`[auth] grant-type failed for ${phone}: ${grantRes.status}`);
    return null;
  }

  const tokenRes = http.post(
    `${HOST}/identity/v1/token`,
    JSON.stringify({ username: phone, grantType: 'password', deviceId: DEVICE_ID, password: PASSWORD }),
    { headers: buildHeaders(null) },
  );
  if (tokenRes.status === 412) {
    let msg = 'No password present';
    try { msg = JSON.parse(tokenRes.body).userMessage || msg; } catch {}
    console.error(`[auth] ${phone} — ${msg} (account needs first-login password setup)`);
    return { noPassword: true };
  }
  if (tokenRes.status !== 200) {
    console.error(`[auth] password token failed for ${phone}: ${tokenRes.status} — ${tokenRes.body}`);
    return null;
  }

  const needsOtp  = tokenRes.json('forceOtpAuth') === true;
  const token     = needsOtp ? null : tokenRes.json('accessToken');
  const sessionId = rotateSession(tokenRes, null);

  console.log(needsOtp
    ? `[auth] ${phone} — device not trusted, OTP required`
    : `[auth] ${phone} — device trusted ✓  OTP skipped`,
  );
  return { token, sessionId, needsOtp };
}

// ── authenticate ──────────────────────────────────────────────────────────────
// Full setup flow used by the load test setup():
//   password login → invitations → device registration → discover accounts.
// Returns a session object or null if the phone is not device-trusted.
export function authenticate(phone) {
  const login = passwordLogin(phone);
  if (!login) return null;

  if (login.needsOtp) {
    console.error(`[auth] ${phone} — OTP required. Run device-trust-probe.js first.`);
    return null;
  }

  const { token } = login;
  let   sessionId  = login.sessionId;

  const invRes = http.get(
    `${HOST}/clientaccount/v1/invitations`,
    { headers: buildHeaders(token, sessionId) },
  );
  if (invRes.status !== 200) {
    console.error(`[auth] invitations failed for ${phone}: ${invRes.status}`);
    return null;
  }
  sessionId = rotateSession(invRes, sessionId);

  const deviceRes = http.post(
    `${HOST}/client/v1/client/device/info`,
    JSON.stringify(DEVICE_INFO),
    { headers: buildHeaders(token, sessionId) },
  );
  if (!check(deviceRes, { 'device/info 200': r => r.status === 200 })) {
    console.error(`[auth] device/info failed for ${phone}: ${deviceRes.status}`);
    return null;
  }
  sessionId = rotateSession(deviceRes, sessionId);

  let walletAccount = __ENV.WALLET_ACCOUNT || null;
  const acctRes = http.get(
    `${HOST}/user/v1/account-info`,
    { headers: buildHeaders(token, sessionId) },
  );
  sessionId = rotateSession(acctRes, sessionId);
  if (!walletAccount && acctRes.status === 200) {
    try {
      const list = acctRes.json() || [];
      const arr  = Array.isArray(list) ? list : (list.content || list.data || []);
      walletAccount = arr[0]?.accountNumber || arr[0]?.account || null;
    } catch {}
  }

  let externalAccount = __ENV.EXTERNAL_ACCOUNT || null;
  const extRes = http.get(
    `${HOST}/clientaccount/v1/externalaccount?verified=true`,
    { headers: buildHeaders(token, sessionId) },
  );
  sessionId = rotateSession(extRes, sessionId);
  if (!externalAccount && (extRes.status === 200 || extRes.status === 202)) {
    try {
      const body = extRes.json();
      const list = Array.isArray(body) ? body : (body.content || body.data || []);
      externalAccount = list[0]?.externalAccountId || list[0]?.account || null;
    } catch {}
  }

  console.log(`[auth] ${phone} → wallet=${walletAccount}  external=${externalAccount}`);
  return { phone, token, sessionId, walletAccount, externalAccount };
}
