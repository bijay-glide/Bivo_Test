import http from 'k6/http';
import { sleep } from 'k6';
import encoding from 'k6/encoding';
import {
  HOST, DEVICE_ID,
  KC_HOST, KC_AUTH_URI, KC_ADMIN_URI, KC_REALM,
  KC_CLIENT_ID, KC_USERNAME, KC_PASSWORD,
} from './config.js';
import { buildHeaders, rotateSession, DEVICE_INFO } from './helpers.js';

// ── fetchOtp ──────────────────────────────────────────────────────────────────
// Authenticates against Keycloak admin and reads the OTP attribute for a phone.
// The attribute is base64-encoded; returns the decoded string or null on failure.
export function fetchOtp(phone) {
  const kcAuthRes = http.post(
    `${KC_HOST}/${KC_AUTH_URI}`,
    `client_id=${KC_CLIENT_ID}&username=${KC_USERNAME}&password=${encodeURIComponent(KC_PASSWORD)}&grant_type=password`,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  if (kcAuthRes.status !== 200) {
    console.error(`[otp] Keycloak auth failed: ${kcAuthRes.status} ${kcAuthRes.body}`);
    return null;
  }

  const kcToken = kcAuthRes.json('access_token');
  const userRes = http.get(
    `${KC_HOST}/${KC_ADMIN_URI}/realms/${KC_REALM}/users?username=${phone}&exact=true`,
    { headers: { Authorization: `Bearer ${kcToken}` } },
  );
  if (userRes.status !== 200) {
    console.error(`[otp] Keycloak user lookup failed: ${userRes.status}`);
    return null;
  }

  let encodedOtp = null;
  try {
    const users = userRes.json();
    encodedOtp = users[0]?.attributes?.otp?.[0] || null;
  } catch {}

  if (!encodedOtp) {
    console.error(`[otp] OTP attribute not found for ${phone}`);
    return null;
  }
  return encoding.b64decode(encodedOtp, 'std', 's');
}

// ── fullOtpLogin ──────────────────────────────────────────────────────────────
// Triggers OTP, fetches the code from Keycloak, submits it, then registers the
// device so future logins from the same DEVICE_ID skip OTP entirely.
// Returns true on success, false on any failure.
export function fullOtpLogin(phone, sessionId) {
  const otpTriggerRes = http.post(
    `${HOST}/identity/v1/otp`,
    JSON.stringify({ phoneNumber: phone }),
    { headers: buildHeaders(null) },
  );
  if (otpTriggerRes.status !== 200 && otpTriggerRes.status !== 202) {
    console.error(`[auth] OTP trigger failed: ${otpTriggerRes.status}`);
    return false;
  }

  sleep(1.5); // wait for Keycloak to store the OTP attribute

  const otp = fetchOtp(phone);
  if (!otp) return false;

  const otpTokenRes = http.post(
    `${HOST}/identity/v1/token`,
    JSON.stringify({ username: phone, grantType: 'otp', otp, deviceId: DEVICE_ID }),
    { headers: buildHeaders(null, sessionId) },
  );
  if (otpTokenRes.status !== 200) {
    console.error(`[auth] OTP token failed: ${otpTokenRes.status} ${otpTokenRes.body}`);
    return false;
  }

  const token = otpTokenRes.json('accessToken');
  sessionId   = rotateSession(otpTokenRes, sessionId);

  const invRes = http.get(
    `${HOST}/clientaccount/v1/invitations`,
    { headers: buildHeaders(token, sessionId) },
  );
  sessionId = rotateSession(invRes, sessionId);

  const deviceRes = http.post(
    `${HOST}/client/v1/client/device/info`,
    JSON.stringify(DEVICE_INFO),
    { headers: buildHeaders(token, sessionId) },
  );
  if (deviceRes.status !== 200) {
    console.error(`[auth] device/info failed: ${deviceRes.status}`);
    return false;
  }

  console.log(`[auth] ${phone} — OTP + device registration complete`);
  return true;
}
