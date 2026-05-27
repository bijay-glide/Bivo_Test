import { DEVICE_ID, TENANT } from './config.js';

// ── Device registration payload ───────────────────────────────────────────────
// Used by both auth (load test) and otp (probe) when registering the device.
export const DEVICE_INFO = {
  brand:          'MacIntel',
  model:          'Chrome/145.0.0.0',
  timezone:       'Asia/Katmandu',
  timeZone:       '+75',
  deviceLocale:   'en-US',
  language:       'en-US',
  systemLanguage: 'en-US',
  userAgent:      'Mozilla/5.0 Chrome/145.0.0.0',
  browserData: {
    ua:      'Mozilla/5.0',
    browser: { name: 'Chrome', version: '145.0.0.0', major: '145' },
    engine:  { name: 'Blink',  version: '145.0.0.0' },
    os:      { name: 'Mac OS', version: '10.15.7' },
    device:  {},
    cpu:     {},
  },
  deviceId:          DEVICE_ID,
  deviceUUID:        DEVICE_ID,
  customFingerprint: 1164980575,
  device:            'undefined',
  os:                'Mac OS',
  osVersion:         '10.15.7',
  engine:            'Blink',
  engineVersion:     '145.0.0.0',
};

// ── HTTP helpers ──────────────────────────────────────────────────────────────

export function buildHeaders(token, sessionId) {
  const h = {
    'Content-Type':        'application/json',
    'X-Tenant-Identifier': TENANT,
  };
  if (token)     h['Authorization']    = `Bearer ${token}`;
  if (sessionId) h['glide-session-id'] = sessionId;
  return h;
}

// Picks the updated session ID from a response, falling back to the current one.
export function rotateSession(res, current) {
  return res.headers['Glide-Session-Id'] || res.headers['glide-session-id'] || current;
}

// ── Step logger ───────────────────────────────────────────────────────────────
// Prints a one-line summary for each request and returns true if it was 2xx.
export function step(vu, num, res, method, path) {
  const ok = res.status >= 200 && res.status < 300;
  console.log(`  VU${vu} [${String(num).padStart(2, '0')}] ${ok ? '✓' : '✗'} ${method.padEnd(5)} ${String(res.status).padEnd(4)}  ${path}`);
  return ok;
}

// ── General utilities ─────────────────────────────────────────────────────────

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randAcctNum() {
  return String(randInt(1_000_000_000, 9_999_999_999));
}
