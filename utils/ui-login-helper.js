require('dotenv').config();
const SignInPage = require('../pages/SignInPage');
const VerificationPage = require('../pages/VerificationPage');
const { getOtpForPhoneNumber } = require('./otp-helper');
const { tryLoadSignupData } = require('./shared-state');

const DEFAULT_LOGIN_PASSWORD =
  process.env.LOGIN_PASSWORD || process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';

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

module.exports = {
  loginUserWebWithPhone,
  DEFAULT_LOGIN_PASSWORD,
  resolveUserDataForLogin,
};
