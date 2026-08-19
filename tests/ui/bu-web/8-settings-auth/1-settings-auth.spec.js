require('../state-suite-env');
const { test, expect } = require('../../../../fixtures/ui-fixtures');
const BuWebSignInPage = require('../../../../pages/BuWebSignInPage');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function loginAndWait(page, userData) {
  await loginBuWebWithEmail({ page, userData });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
}

async function goToSettings(page) {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15000 });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('Bu-web — Auth, Dashboard & Settings', () => {

  // ── 1 | Login error ─────────────────────────────────────────────────────────
  test('Login error — wrong password is rejected, correct password recovers', async ({ page }) => {
    test.setTimeout(120000);

    const userData = resolveBuWebUserDataForLogin();
    const signInPage = new BuWebSignInPage(page);

    await test.step('Step 1 | Navigate to sign-in and enter email', async () => {
      await signInPage.goto();
      await signInPage.enterEmail(userData.email);
    });

    await test.step('Step 2 | Submit an incorrect password', async () => {
      await signInPage.loginWithPassword('WrongPassword123!');
    });

    await test.step('Step 3 | Login is rejected — stays on auth screen', async () => {
      // Don't depend on an exact banner string: assert we did NOT reach the app.
      await page.waitForTimeout(3000);
      await expect(page, 'wrong password should not navigate into the app').toHaveURL(/auth/);
      const errorBanner = page.getByText(/incorrect|invalid|wrong|try again|do not match/i).first();
      if (await errorBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('[Login error] banner:', (await errorBanner.textContent())?.trim());
      }
    });

    await test.step('Step 4 | Submit correct password — login succeeds', async () => {
      await loginBuWebWithEmail({ page, userData });
      await expect(page).toHaveURL(/bu-web\/(?!auth)/, { timeout: 30000 });
    });
  });

  // ── 2 | Dashboard widgets ────────────────────────────────────────────────────
  test('Dashboard — quick actions and info widgets all render', async ({ page }) => {
    test.setTimeout(120000);

    const userData = resolveBuWebUserDataForLogin();
    await loginAndWait(page, userData);

    await test.step('Step 1 | All five quick-action icons are present', async () => {
      await expect(page.getByRole('button', { name: 'Deposit Money' })).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('button', { name: 'Payees' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Transfer Money' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Account Details' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Statement' })).toBeVisible();
    });

    await test.step('Step 2 | Account Transactions widget has View Transactions link', async () => {
      await expect(page.getByRole('link', { name: /View Transactions/i })).toBeVisible();
    });

    await test.step('Step 3 | Send Money Abroad widget shows Create Transaction link', async () => {
      await expect(page.getByRole('link', { name: 'Create Transaction' })).toBeVisible();
    });

    await test.step('Step 4 | Account Details quick action navigates to a new screen', async () => {
      await page.getByRole('button', { name: 'Account Details' }).click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await expect(page).not.toHaveURL(/auth/);
      await page.getByRole('link', { name: 'Dashboard' }).click();
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    });

    await test.step('Step 5 | Statement quick action navigates to a new screen', async () => {
      await page.getByRole('button', { name: 'Statement' }).click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await expect(page).not.toHaveURL(/auth/);
    });
  });

  // ── 3 | Settings sub-pages ───────────────────────────────────────────────────
  test('Settings — sub-sections load', async ({ page }) => {
    test.setTimeout(120000);

    const userData = resolveBuWebUserDataForLogin();
    await loginAndWait(page, userData);

    await test.step('Step 1 | Navigate to Settings via sidebar', async () => {
      await goToSettings(page);
    });

    await test.step('Step 2 | Settings tiles visible', async () => {
      await expect(page.getByText('Personal Information')).toBeVisible();
      await expect(page.getByText('Account Information')).toBeVisible();
      await expect(page.getByText('Documents')).toBeVisible();
    });

    await test.step('Step 3 | Personal Information sub-page loads', async () => {
      await page.getByText('Personal Information').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await expect(page).not.toHaveURL(/auth/);
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    });

    await test.step('Step 4 | Account Information sub-page loads', async () => {
      await page.getByText('Account Information').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await expect(page).not.toHaveURL(/auth/);
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10000 });
    });

    await test.step('Step 5 | Documents sub-page loads', async () => {
      await page.getByText('Documents').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await expect(page).not.toHaveURL(/auth/);
    });
  });

  // ── 4 | Signout + session cleanup ────────────────────────────────────────────
  test('Signout — redirects to sign-in and protected routes are blocked', async ({ page }) => {
    test.setTimeout(120000);

    const userData = resolveBuWebUserDataForLogin();
    await loginAndWait(page, userData);

    await test.step('Step 1 | Open avatar menu and click Log Out', async () => {
      await page.getByRole('button', { name: /^[A-Z]{2}$/ }).click();
      await page.getByRole('button', { name: 'Log Out' }).click();
    });

    await test.step('Step 2 | URL redirects to sign-in page', async () => {
      await expect(page).toHaveURL(/auth\/signin/, { timeout: 15000 });
    });

    await test.step('Step 3 | Navigating to a protected route redirects back to sign-in', async () => {
      await page.goto('/bu-web/dashboard', { waitUntil: 'domcontentloaded' });
      await expect(
        page,
        'Protected /bu-web/dashboard should redirect to signin after logout',
      ).toHaveURL(/auth\/signin|auth/, { timeout: 10000 });
    });
  });

});
