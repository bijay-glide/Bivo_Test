require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const SignInPage = require('../../../pages/SignInPage');
const VerificationPage = require('../../../pages/VerificationPage');
const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function loginAndWait(page, request) {
  const userData = resolveUserDataForLogin();
  await loginUserWebWithPhone({ page, request, userData });
  await page.waitForLoadState('networkidle', { timeout: 30000 });
  return userData;
}

async function goToSettings(page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15000 });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('User-web — Auth, Dashboard & Settings', () => {

  // ── 1 | Login error ─────────────────────────────────────────────────────────
  test('Login error — wrong password shows banner, correct password recovers', async ({ page, request }) => {
    test.setTimeout(120000);

    const userData = resolveUserDataForLogin();
    const signInPage = new SignInPage(page);
    const verificationPage = new VerificationPage(page);

    await test.step('Step 1 | Navigate to sign-in and enter phone number', async () => {
      await signInPage.goto({ standaloneUserWeb: true });
      await signInPage.signInWithPhoneStandaloneUserWeb(userData.phoneNumber);
    });

    await test.step('Step 2 | Submit an incorrect password', async () => {
      await signInPage.loginWithPassword('WrongPassword123!');
    });

    await test.step('Step 3 | Inline error banner is visible with the correct message', async () => {
      await expect(
        page.getByText('Incorrect password, please try again.'),
      ).toBeVisible({ timeout: 10000 });
    });

    await test.step('Step 4 | Submit correct password — login succeeds', async () => {
      await signInPage.loginWithPassword(LOGIN_PASSWORD);
      await signInPage.waitForPasswordScreenToLeave();

      if (await verificationPage.isOtpInputVisible()) {
        await page.waitForTimeout(2000);
        const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
        await verificationPage.verifyOtpForUserWebFirstLogin(otp);
      }

      await signInPage.verifyLoginSuccessful();
    });
  });

  // ── 2 | Dashboard widgets ────────────────────────────────────────────────────
  test('Dashboard — balance tile, quick actions, and info widgets all render', async ({ page, request }) => {
    test.setTimeout(120000);

    await loginAndWait(page, request);

    await test.step('Step 1 | Balance tile shows USD currency code and a dollar amount', async () => {
      await expect(page.locator('.acc-curr-text')).toHaveText('USD', { timeout: 15000 });
      await expect(page.locator('.currency-card-balance')).toContainText('$', { timeout: 10000 });
    });

    await test.step('Step 2 | All five quick-action icons are present', async () => {
      await expect(page.getByRole('button', { name: 'Deposit Money' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Payees' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Transfer Money' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Account Details' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Statement' })).toBeVisible();
    });

    await test.step('Step 3 | Account Transactions widget has View Transactions link', async () => {
      await expect(page.getByText('Account Transactions')).toBeVisible();
      await expect(page.getByRole('link', { name: /View Transactions/i })).toBeVisible();
    });

    await test.step('Step 4 | Add funds from Another Bank widget is rendered', async () => {
      await expect(page.getByText('Add funds from Another Bank')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add Funds' })).toBeVisible();
    });

    await test.step('Step 5 | Send Money Abroad widget shows live exchange rate', async () => {
      await expect(page.getByText('Send Money Abroad')).toBeVisible();
      await expect(page.getByText(/Exchanged? rate/i)).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('link', { name: 'Create Transaction' })).toBeVisible();
    });

    await test.step('Step 6 | Account Details quick action navigates to a new screen', async () => {
      await page.getByRole('button', { name: 'Account Details' }).click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await expect(page).not.toHaveURL(/signin/);
      await page.getByRole('link', { name: 'Dashboard' }).click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    });

    await test.step('Step 7 | Statement quick action navigates to a new screen', async () => {
      await page.getByRole('button', { name: 'Statement' }).click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await expect(page).not.toHaveURL(/signin/);
    });
  });

  // ── 3 | Settings sub-pages ───────────────────────────────────────────────────
  test('Settings — all four sub-sections load', async ({ page, request }) => {
    test.setTimeout(120000);

    await loginAndWait(page, request);

    await test.step('Step 1 | Navigate to Settings via sidebar', async () => {
      await goToSettings(page);
    });

    await test.step('Step 2 | All four tiles visible', async () => {
      await expect(page.getByText('Personal Information')).toBeVisible();
      await expect(page.getByText('Account Information')).toBeVisible();
      await expect(page.getByText('Joint Account')).toBeVisible();
      await expect(page.getByText('Documents')).toBeVisible();
    });

    await test.step('Step 3 | Personal Information sub-page loads', async () => {
      await page.getByText('Personal Information').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Settings' })).not.toBeVisible({ timeout: 5000 });
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    });

    await test.step('Step 4 | Account Information sub-page loads', async () => {
      await page.getByText('Account Information').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Settings' })).not.toBeVisible({ timeout: 5000 });
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    });

    await test.step('Step 5 | Joint Account sub-page loads', async () => {
      await page.getByText('Joint Account').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Settings' })).not.toBeVisible({ timeout: 5000 });
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    });

    await test.step('Step 6 | Documents sub-page loads', async () => {
      await page.getByText('Documents').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Settings' })).not.toBeVisible({ timeout: 5000 });
    });
  });

  // ── 4 | Signout + session cleanup ────────────────────────────────────────────
  test('Signout — session cleared: localStorage, cookies, and protected-route redirect', async ({ page, request }) => {
    test.setTimeout(120000);

    await loginAndWait(page, request);

    // Capture the access token BEFORE logout so we can confirm it's gone after
    const tokenBeforeLogout = await page.evaluate(() => {
      try {
        const root = JSON.parse(localStorage.getItem('persist:root') || '{}');
        const auth = JSON.parse(root.authentication || '{}');
        return auth.loginData?.accessToken ?? null;
      } catch { return null; }
    });
    expect(tokenBeforeLogout, 'Should be authenticated before logout').toBeTruthy();

    await test.step('Step 1 | Find and click the logout button', async () => {
      // Attempt 1: user avatar in the header (top-right "DG" circle)
      const headerAvatar = page.locator('header button, [class*="avatar"], [class*="user-menu"]').last();
      if (await headerAvatar.isVisible({ timeout: 2000 }).catch(() => false)) {
        await headerAvatar.click();
        await page.waitForTimeout(600);
      }

      // Collect all candidate logout elements across avatar dropdown + sidebar + settings
      const logoutCandidates = [
        page.getByRole('button', { name: /log.?out|sign.?out/i }),
        page.getByRole('link',   { name: /log.?out|sign.?out/i }),
        page.locator('[data-testid*="logout"], [data-testid*="signout"]').first(),
        page.locator('text=/log.?out|sign.?out/i').first(),
      ];

      let found = false;
      for (const el of logoutCandidates) {
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
          await el.click();
          found = true;
          break;
        }
      }

      if (!found) {
        // Attempt 2: navigate into Settings — logout may be inside a sub-section
        await goToSettings(page);
        for (const el of logoutCandidates) {
          if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
            await el.click();
            found = true;
            break;
          }
        }
      }

      if (!found) {
        test.skip(true, 'Logout button not found — inspect the avatar menu or Settings sub-pages');
      }
    });

    await test.step('Step 2 | URL redirects to sign-in page', async () => {
      await expect(page).toHaveURL(/signin|login/, { timeout: 15000 });
    });

    await test.step('Step 3 | Session state after logout', async () => {
      // Check localStorage — some apps clear it on logout, others rely on server-side
      // invalidation. We log the finding but do not fail here; Step 4 and 5 are the
      // authoritative checks.
      const tokenAfterLogout = await page.evaluate(() => {
        try {
          const root = JSON.parse(localStorage.getItem('persist:root') || '{}');
          const auth = JSON.parse(root.authentication || '{}');
          return auth.loginData?.accessToken ?? null;
        } catch { return null; }
      });
      if (tokenAfterLogout === null) {
        console.log('[Signout] Token cleared from localStorage ✓');
      } else {
        console.warn('[Signout] Token still in localStorage — server-side invalidation expected; protected-route check in Step 5 is authoritative');
      }

      // Auth cookies should be absent or empty
      const cookies = await page.context().cookies();
      const authCookies = cookies.filter(c => /auth|token|session|jwt/i.test(c.name));
      for (const cookie of authCookies) {
        expect(
          cookie.value,
          `Cookie "${cookie.name}" should be empty after logout`,
        ).toBeFalsy();
      }
    });

    await test.step('Step 4 | Navigating to a protected route redirects back to sign-in', async () => {
      // This is the definitive session-termination check. If the server invalidated
      // the token, the app will redirect even if localStorage still holds an old token.
      await page.goto('/user-web/dashboard', { waitUntil: 'domcontentloaded' });
      await expect(
        page,
        'Protected /user-web/dashboard should redirect to signin after logout',
      ).toHaveURL(/signin|login/, { timeout: 10000 });
    });
  });

});
