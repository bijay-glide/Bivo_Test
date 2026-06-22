require('dotenv').config();
const fs = require('fs');
const path = require('path');
const SignInPage = require('../pages/SignInPage');
const BuWebSignInPage = require('../pages/BuWebSignInPage');
const VerificationPage = require('../pages/VerificationPage');
const { authenticator } = require('otplib');
const { getOtpForPhoneNumber } = require('./otp-helper');
const { tryLoadSignupData } = require('./shared-state');

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

// Forces every bu-web login/registration request to carry the pinned device id, so the
// trusted-device decision is deterministic regardless of profile or worker.
async function pinBuWebDeviceId(page) {
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

      if ('deviceId' in body) body.deviceId = BUWEB_DEVICE_ID;
      if ('deviceUUID' in body) body.deviceUUID = BUWEB_DEVICE_ID;
      if (process.env.PLAYWRIGHT_DEBUG_OTP) {
        console.log('[pinBuWebDeviceId] rewrote deviceId on', request.url());
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

// Resolve user data for login-oriented UI tests (env LOGIN_PHONE_RAW, or shared state from 1.1/1.2).
// Returns object with phoneNumber and optional accountNumber, ddaNumber.
function resolveUserDataForLogin() {
  const manualPhone = normalizePhone(process.env.LOGIN_PHONE_RAW);
  if (manualPhone) {
    return {
      phoneNumber: manualPhone,
      accountNumber: process.env.STANDALONE_ACCOUNT || '',
      ddaNumber: process.env.STANDALONE_DDA_NUMBER || '',
    };
  }

  const shared = tryLoadSignupData();
  if (shared?.phoneNumber) return shared;

  throw new Error(
    'No login phone available for user-web test.\n' +
      'Provide LOGIN_PHONE_RAW in .env (or environment), or run signup/onboarding tests first to populate shared-state.',
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

  await signInPage.loginWithPassword(password);
  await signInPage.waitForPasswordScreenToLeave();

  if (await verificationPage.isOtpInputVisible()) {
    await page.waitForTimeout(2000);
    const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
    await verificationPage.verifyOtpForUserWebFirstLogin(otp);
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

    await enterAndSubmitTotp();
    const navigated = await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 10000 })
      .then(() => true).catch(() => false);

    if (!navigated) {
      // Code was likely from the same 30s window already used by the previous spec.
      const msToNextWindow = 30000 - (Date.now() % 30000);
      console.log('[loginBuWeb] TOTP not accepted — waiting', Math.ceil((msToNextWindow + 1000) / 1000), 's for next window');
      await page.waitForTimeout(msToNextWindow + 1000);
      await enterAndSubmitTotp();
      await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 35000 });
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
