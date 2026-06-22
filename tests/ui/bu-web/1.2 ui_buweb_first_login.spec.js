require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { getOtpForBusinessEmail } = require('../../../utils/otp-helper');
const { loadSignupData, saveExtendedState } = require('../../../utils/shared-state');
const { authenticator } = require('otplib');
const VerificationPage = require('../../../pages/VerificationPage');
const BuWebSignInPage = require('../../../pages/BuWebSignInPage');

const FIRST_LOGIN_PASSWORD = process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';

test.describe('Bu-web first login — set password and configure 2FA', () => {
  test('Set password and complete TOTP 2FA setup', async ({ page, request }) => {
    test.setTimeout(120000);

    const state = loadSignupData();
    const { email, firstName, lastName, businessId, clientId, accountNumber } = state;

    const signInPage       = new BuWebSignInPage(page);
    const verificationPage = new VerificationPage(page);

    await test.step('Step 1 | Navigate to sign-in and enter email', async () => {
      await signInPage.goto();
      await signInPage.enterEmail(email);
    });

    await test.step('Step 2 | Retrieve email OTP and verify', async () => {
      await verificationPage.digit1Input.waitFor({ state: 'visible' });
      const otp = await getOtpForBusinessEmail(request, email);
      await verificationPage.verifyAndProceedAsNewUser(otp);
    });

    await test.step('Step 3 | Set new password', async () => {
      await page.getByRole('textbox', { name: 'Enter new password' }).waitFor({ state: 'visible' });

      // Register intercept before clicking Continue — 2fa/generate-code fires when the
      // QR-code setup screen loads immediately after the password is saved.
      const totpSecretPromise = page.waitForResponse(
        res =>
          res.url().includes('/identity/v1/2fa/generate-code') &&
          res.request().method() === 'GET',
        { timeout: 60000 }
      );

      await page.getByRole('textbox', { name: 'Enter new password' }).fill(FIRST_LOGIN_PASSWORD);
      await page.getByRole('textbox', { name: 'Confirm your password' }).fill(FIRST_LOGIN_PASSWORD);
      await page.getByRole('button', { name: 'Continue' }).click();

      const totpSecretRes = await totpSecretPromise;
      expect(totpSecretRes.status(), '2fa/generate-code should return 200').toBe(200);
      const { encodedTotpSecret } = await totpSecretRes.json();
      expect(encodedTotpSecret, 'encodedTotpSecret must be present in 2fa/generate-code response').toBeTruthy();

      // Persist for future specs that need to re-authenticate with TOTP
      saveExtendedState({ encodedTotpSecret });

      console.log('══════════════════════════════════════════════');
      console.log('  Bu-web User Summary');
      console.log('══════════════════════════════════════════════');
      console.log('  email             :', email);
      console.log('  name              :', firstName, lastName);
      console.log('  businessId        :', businessId);
      console.log('  clientId          :', clientId);
      console.log('  accountNumber     :', accountNumber);
      console.log('  encodedTotpSecret :', encodedTotpSecret);
      console.log('══════════════════════════════════════════════');

      const totpCode = authenticator.generate(encodedTotpSecret);

      // Click "Next" to move past the QR-code display to the TOTP verification input
      await page.getByRole('button', { name: 'Next' }).click();

      // The TOTP input may be a single textbox (same name as digit1) or 6 individual digits.
      await verificationPage.digit1Input.waitFor({ state: 'visible' });
      const isMultiDigit = await page.getByRole('textbox', { name: 'Digit 2' }).isVisible();
      if (isMultiDigit) {
        await verificationPage.enterVerificationCode(totpCode);
      } else {
        await verificationPage.digit1Input.fill(totpCode);
      }

      await page.getByRole('button', { name: 'Next' }).click();
    });

    await test.step('Step 4 | Verify successful login', async () => {
      // After TOTP, the user lands on the verification hub or dashboard (not /auth/)
      await expect(page).toHaveURL(/bu-web\/(?!auth)/, { timeout: 30000 });
    });

    await test.step('Step 5 | Sign out', async () => {
      // The profile button shows the user's two-letter initials (varies per generated user)
      await page.getByRole('button', { name: /^[A-Z]{2}$/ }).click();
      await page.getByRole('button', { name: 'Log Out' }).click();
      await expect(page).toHaveURL(/bu-web\/auth\/signin/, { timeout: 15000 });
    });
  });
});
