require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const SignInPage = require('../pages/SignInPage');
const BuWebSignInPage = require('../pages/BuWebSignInPage');
const VerificationPage = require('../pages/VerificationPage');
const { authenticator } = require('otplib');
const { getOtpForPhoneNumber } = require('./otp-helper');
const { tryLoadActiveSuiteSignupData } = require('./shared-state');

const DEFAULT_LOGIN_PASSWORD =
  process.env.LOGIN_PASSWORD || process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';

// Stable bu-web device identity. The server decides forceOtpAuth from the `deviceId`
// in POST /identity/v1/token; once a device has cleared OTP a few times it stays trusted.
// Pinning one UUID makes that trust survive across runs AND parallel workers (which each
// get a fresh Chromium profile, so the FE-generated id would otherwise change every time).
// Note: this is intentionally a UUID, not the integer BIVO_DEVICE_ID (which k6 uses for the
// phone-user body flow) — the bu-web FE expects a UUID and bu-web is a different account,
// so reusing the k6 integer would neither validate nor share trust.
const BUWEB_DEVICE_ID =
  process.env.BUWEB_DEVICE_ID || 'd7c1f3e2-9b4a-4c8e-a1f6-2b5e7c9d0a31';

// Per-worker variant of BUWEB_DEVICE_ID: swaps the final hex digit for the worker's
// parallelIndex. All parallel bu-web specs log into the SAME onboarded account, so if
// every worker pinned the identical device id, concurrent logins would race for the
// same TOTP code (same secret + same 30s window) — the backend accepts it once and
// rejects the rest, which then wait a full window and retry, serializing the "parallel"
// run at the login step. Giving each worker its own device id lets each establish (and
// keep) its own trusted-device state independently.
function buWebDeviceIdForWorker() {
  const parallelIndex = test.info().parallelIndex;
  return BUWEB_DEVICE_ID.slice(0, -1) + (parallelIndex % 16).toString(16);
}

// Forces every bu-web login/registration request to carry this worker's pinned device
// id, so the trusted-device decision is deterministic per worker and survives across
// specs/runs on that worker slot.
async function pinBuWebDeviceId(page) {
  const deviceId = buWebDeviceIdForWorker();
  await page.route(
    /\/identity\/v1\/token(\?|$)|\/client\/v1\/client\/device\/info(\?|$)/,
    async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();

      let body;
      try {
        body = request.postDataJSON();
      } catch {
        return route.continue();
      }
      if (!body || typeof body !== 'object') return route.continue();

      if ('deviceId' in body) body.deviceId = deviceId;
      if ('deviceUUID' in body) body.deviceUUID = deviceId;
      if (process.env.PLAYWRIGHT_DEBUG_OTP) {
        console.log('[pinBuWebDeviceId] rewrote deviceId on', request.url(), '→', deviceId);
      }
      return route.continue({ postData: JSON.stringify(body) });
    },
  );
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

// Resolve user data for login-oriented UI tests.
//
// Priority (mirrors bu-web, which always uses its freshly-onboarded user):
//   1. The active suite's fresh shared-state user (written by onboarding 1.1–1.3).
//   2. LOGIN_PHONE_RAW from .env — fallback ONLY, so a --no-deps single-spec run still
//      works when no fresh state exists (or it's gone stale > 8h). See CLAUDE.md.
//
// Previously LOGIN_PHONE_RAW won unconditionally, so the parallel specs logged in as a
// static old user and ignored the user onboarding had just created — unlike bu-web.
// Returns object with phoneNumber and optional accountNumber, ddaNumber.
function resolveUserDataForLogin() {
  const shared = tryLoadActiveSuiteSignupData();
  if (shared?.phoneNumber) return shared;

  const manualPhone = normalizePhone(process.env.LOGIN_PHONE_RAW);
  if (manualPhone) {
    console.log('\n⚠️  No fresh onboarded user — falling back to LOGIN_PHONE_RAW from .env');
    return {
      phoneNumber: manualPhone,
      accountNumber: process.env.STANDALONE_ACCOUNT || '',
      ddaNumber: process.env.STANDALONE_DDA_NUMBER || '',
    };
  }

  throw new Error(
    'No login phone available for user-web test.\n' +
      'Run signup/onboarding tests first to populate shared-state, or provide LOGIN_PHONE_RAW in .env.',
  );
}

// Reusable user-web login helper. params.userData has phoneNumber and optional accountNumber, ddaNumber.
async function loginUserWebWithPhone({
  page,
  request,
  userData,
  password = DEFAULT_LOGIN_PASSWORD,
  standaloneUserWeb = true,
}) {
  const signInPage = new SignInPage(page);
  const verificationPage = new VerificationPage(page);
  const profileResponsePromise = page
    .waitForResponse(
      (response) =>
        response.url().includes('/client/v1/profile') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: 30000 },
    )
    .catch(() => null);
  const accountInfoResponsePromise = page
    .waitForResponse(
      (response) =>
        response.url().includes('/user/v1/account-info') &&
        response.request().method() === 'GET' &&
        response.status() === 200,
      { timeout: 30000 },
    )
    .catch(() => null);

  await signInPage.goto({ standaloneUserWeb });
  await signInPage.signInWithPhoneStandaloneUserWeb(userData.phoneNumber);

  // Some builds/devices route straight to OTP after phone entry instead of the
  // password screen (device-trust re-check) — detect which one actually rendered
  // rather than assuming password always comes first.
  await Promise.race([
    signInPage.passwordInput.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
    verificationPage.digit1Input.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
  ]);
  const otpFirst = await verificationPage.isOtpInputVisible();

  if (otpFirst) {
    const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
    await verificationPage.verifyOtpForUserWebFirstLogin(otp);

    // Password can still follow OTP on some builds.
    if (await signInPage.passwordInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await signInPage.loginWithPassword(password);
      await signInPage.waitForPasswordScreenToLeave();
    }
  } else {
    await signInPage.loginWithPassword(password);
    await signInPage.waitForPasswordScreenToLeave();

    if (await verificationPage.isOtpInputVisible()) {
      await page.waitForTimeout(2000);
      const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
      await verificationPage.verifyOtpForUserWebFirstLogin(otp);
    }
  }

  await signInPage.verifyLoginSuccessful();
  const profileResponse = await profileResponsePromise;
  const accountInfoResponse = await accountInfoResponsePromise;

  let bivo_account_number = userData.accountNumber || '';
  let bivo_dda_number = userData.ddaNumber || '';
  if (accountInfoResponse) {
    try {
      const accountInfoBody = await accountInfoResponse.json();
      const accountInfoList = Array.isArray(accountInfoBody)
        ? accountInfoBody
        : accountInfoBody?.content ?? accountInfoBody?.data ?? [];
      const firstAccount = Array.isArray(accountInfoList) ? accountInfoList[0] : null;
      bivo_account_number =
        firstAccount?.accountNumber ||
        firstAccount?.account ||
        bivo_account_number;
      bivo_dda_number =
        firstAccount?.ddaNumber ||
        firstAccount?.dda ||
        firstAccount?.dda_number ||
        bivo_dda_number;
    } catch {
      // Keep fallback from userData when account-info parsing fails.
    }
  }

  return {
    profileResponse,
    accountInfoResponse,
    bivo_account_number,
    bivo_dda_number,
  };
}

// ── Bu-web login helpers ──────────────────────────────────────────────────────

// All parallel bu-web specs authenticate with one shared TOTP secret (see
// loginBuWebWithEmail below), so an untrusted worker's first login must land in a
// 30s window nobody else is using, or the backend rejects the duplicate code. This
// file-based ticket queue hands out strictly increasing, non-overlapping windows
// across worker processes so logins never collide in the first place instead of
// colliding and retrying. Stale tickets from a previous run are harmless: the
// reservation is clamped to "now" on read, so an old future timestamp left behind
// after a run ends never pushes a later run's first reservation into the past.
const TOTP_WINDOW_MS = 30000;
const totpReservationFile = path.join(process.cwd(), '.bivo-state', 'totp-reservation.json');
const totpReservationLock = `${totpReservationFile}.lock`;

async function acquireFileLock(lockPath, { timeoutMs = 20000, pollMs = 50 } = {}) {
  const start = Date.now();
  while (true) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`[loginBuWeb] Timed out acquiring TOTP reservation lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

function releaseFileLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already gone — nothing to release.
  }
}

// Reserves an exclusive 30s TOTP window (returns its start time, ms since epoch)
// so this call's code is guaranteed not to collide with any other reservation.
async function reserveTotpWindow() {
  fs.mkdirSync(path.dirname(totpReservationFile), { recursive: true });
  await acquireFileLock(totpReservationLock);
  try {
    let nextWindowStart = 0;
    try {
      nextWindowStart = JSON.parse(fs.readFileSync(totpReservationFile, 'utf-8')).nextWindowStart || 0;
    } catch {
      // No reservation file yet, or unreadable — treat as "nothing reserved".
    }
    const currentWindowStart = Math.floor(Date.now() / TOTP_WINDOW_MS) * TOTP_WINDOW_MS;
    const reserved = Math.max(currentWindowStart, nextWindowStart);
    fs.writeFileSync(totpReservationFile, JSON.stringify({ nextWindowStart: reserved + TOTP_WINDOW_MS }));
    return reserved;
  } finally {
    releaseFileLock(totpReservationLock);
  }
}

// Reads bu-web user directly from shared-state-buweb.json.
// (Does not use tryLoadSignupData because buweb state is written by saveExtendedState
//  which stores extendedSavedAt rather than savedAt, so the age-filtered finder skips it.)
function resolveBuWebUserDataForLogin() {
  const buwebStatePath = path.join(process.cwd(), '.bivo-state', 'shared-state-buweb.json');
  if (!fs.existsSync(buwebStatePath)) {
    throw new Error('Bu-web shared state not found. Run bu-web onboarding tests first to populate shared-state-buweb.json');
  }
  const data = JSON.parse(fs.readFileSync(buwebStatePath, 'utf-8'));
  if (!data.email) {
    throw new Error('Bu-web shared state is missing email. Run bu-web onboarding tests first.');
  }
  return data;
}

// Reusable bu-web login: email → password → TOTP (with automatic retry on same-window rejection).
async function loginBuWebWithEmail({ page, userData, password = DEFAULT_LOGIN_PASSWORD }) {
  const { email, encodedTotpSecret } = userData;
  const signInPage = new BuWebSignInPage(page);
  const verificationPage = new VerificationPage(page);

  // Pin the device id BEFORE any auth request fires, so the trusted-device check is stable.
  await pinBuWebDeviceId(page);

  await signInPage.goto();
  await signInPage.enterEmail(email);
  await signInPage.loginWithPassword(password);

  // Device-trusted sessions skip TOTP entirely.
  const totpVisible = await verificationPage.digit1Input
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (totpVisible) {
    const isMultiDigit = await page.getByRole('textbox', { name: 'Digit 2' }).isVisible();

    const enterAndSubmitTotp = async () => {
      const code = authenticator.generate(encodedTotpSecret);
      if (isMultiDigit) {
        await verificationPage.enterVerificationCode(code);
      } else {
        await verificationPage.digit1Input.fill(code);
      }
      await page.getByRole('button', { name: 'Next' }).click();
    };

    // Claim an exclusive 30s window before submitting anything, so this worker's
    // first (untrusted-device) login never shares a code with another worker's.
    const reservedWindowStart = await reserveTotpWindow();
    const waitForReservedWindow = reservedWindowStart + 2000 - Date.now();
    if (waitForReservedWindow > 0) {
      await page.waitForTimeout(waitForReservedWindow);
    }

    await enterAndSubmitTotp();
    let navigated = await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 10000 })
      .then(() => true).catch(() => false);

    // The reservation above prevents collisions in the common case, but keep this as a
    // safety net for edge cases (client/server clock skew, a reservation racing a login
    // that was already mid-flight) so a genuinely broken login still fails instead of
    // hanging forever, rather than silently relying on window reservation alone.
    const MAX_TOTP_ATTEMPTS = 5;
    for (let attempt = 2; !navigated && attempt <= MAX_TOTP_ATTEMPTS; attempt++) {
      const msToNextWindow = 30000 - (Date.now() % 30000);
      console.log(`[loginBuWeb] TOTP not accepted (attempt ${attempt - 1}/${MAX_TOTP_ATTEMPTS - 1} retries) — waiting`, Math.ceil((msToNextWindow + 1000) / 1000), 's for next window');
      await page.waitForTimeout(msToNextWindow + 1000);
      await enterAndSubmitTotp();
      navigated = await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 10000 })
        .then(() => true).catch(() => false);
    }

    if (!navigated) {
      throw new Error(`[loginBuWeb] TOTP still not accepted after ${MAX_TOTP_ATTEMPTS} attempts`);
    }
  }

  await page.waitForTimeout(1000);
}

module.exports = {
  loginUserWebWithPhone,
  DEFAULT_LOGIN_PASSWORD,
  resolveUserDataForLogin,
  resolveBuWebUserDataForLogin,
  loginBuWebWithEmail,
  pinBuWebDeviceId,
  BUWEB_DEVICE_ID,
};
