/**
 * Exploratory test suite — user-web surface
 *
 * Purpose: Navigate every section of the user-web app that the automated suite
 * does NOT cover, take a screenshot at each stop, and record API observations.
 *
 * Sections explored:
 *  A. Dashboard overview (balance, accounts tile, recent transactions)
 *  B. Wire payment (Withdraw Funds → Wire full form + review)
 *  C. Profile / settings page
 *  D. Transaction history (Accounts → all transactions, detail drill-in)
 *  E. Payee management — list view after add-payee runs
 *  F. FX countries NOT in TOP_FX_COUNTRIES: DE, NZ, KR (Germany, New Zealand, South Korea)
 *  G. Create FX — country picker scroll / search UX
 *  H. Error / edge states: empty submit on wire form, zero amount move-money
 *  I. Add funds — bank picker when no ACH linked (if applicable)
 *  J. Logout flow
 */

process.env.BIVO_UI_STATE_SUITE = 'userweb';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { generateFxTransactionData, generateBankingDetails } = require('../../../utils/test-data-generator');
const { COUNTRY_BANKING_CONFIGS } = require('../../../utils/fx-country-configs');
const { toCentsInput } = require('../../../utils/amount-input');

const SCREENSHOT_DIR = path.join(process.cwd(), 'test-results', 'exploratory-screenshots');

function screenshotPath(name) {
  return path.join(SCREENSHOT_DIR, `${name}.png`);
}

async function snap(page, name) {
  await page.screenshot({ path: screenshotPath(name), fullPage: true });
  console.log(`[snap] ${name}.png`);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Dashboard overview
// ─────────────────────────────────────────────────────────────────────────────
test('A | Dashboard overview — balance tiles, sidebar nav, and accounts widget', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  await snap(page, 'A-01-dashboard-full');

  // Sidebar — expand Move Money and capture sub-items
  const moveMoneyNav = page.getByTestId('Sidebar-nav-moveMoney');
  if (await moveMoneyNav.isVisible().catch(() => false)) {
    await moveMoneyNav.click();
    await page.waitForTimeout(800);
    await snap(page, 'A-02-sidebar-movemoney-expanded');
  }

  // Sidebar — Accounts
  const accountsNav = page.getByTestId('Sidebar-nav-accounts');
  if (await accountsNav.isVisible().catch(() => false)) {
    await accountsNav.click();
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await snap(page, 'A-03-accounts-section');
  }

  // Sidebar — Payees
  const payeesNav = page.getByTestId('Sidebar-nav-payees');
  if (await payeesNav.isVisible().catch(() => false)) {
    await payeesNav.click();
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await snap(page, 'A-04-payees-list');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Wire payment — full form + review screen
// ─────────────────────────────────────────────────────────────────────────────
test('B | Wire payment — navigate form, fill details, and capture review screen', async ({ page, request }) => {
  test.setTimeout(180000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  // Navigate to Move Money → Withdraw Funds → Wire
  const moveMoneyNav = page.getByTestId('Sidebar-nav-moveMoney');
  await moveMoneyNav.waitFor({ state: 'visible', timeout: 15000 });
  await moveMoneyNav.click();

  const withdrawLink = page.getByTestId('Sidebar-moveMoney-withdrawFunds');
  const appeared = await withdrawLink.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  if (!appeared) {
    await moveMoneyNav.click();
    await withdrawLink.waitFor({ state: 'visible', timeout: 10000 });
  }
  await withdrawLink.click();

  await snap(page, 'B-01-withdraw-funds-landing');

  // Click Wire option
  const wireOption = page.getByText('Wire', { exact: true });
  if (await wireOption.isVisible().catch(() => false)) {
    await wireOption.click();
    await page.waitForTimeout(1000);
    await snap(page, 'B-02-wire-selected');
  }

  // Click "Add Wire Details" if present
  const addWireBtn = page.getByRole('button', { name: 'Add Wire Details' });
  if (await addWireBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await addWireBtn.click();
    await page.waitForTimeout(1000);
    await snap(page, 'B-03-add-wire-details-form-empty');

    // Fill the form
    await page.getByRole('textbox', { name: 'First name' }).fill('Exploratory');
    await page.getByRole('textbox', { name: 'Last name' }).fill('Test');
    await page.getByRole('textbox', { name: 'Enter account nickname' }).fill('Explore Wire');

    const streetInput = page.getByRole('textbox', { name: 'Street Address (No PO Box)' });
    await streetInput.fill('123 Main Street');
    await streetInput.press('Enter');
    await page.locator('.dashboard-main-container').click().catch(() => {});

    await page.getByRole('textbox', { name: 'City' }).fill('New York');
    await page.getByRole('textbox', { name: 'Zip Code' }).fill('10001');

    await page.getByRole('button', { name: 'Enter state' }).click().catch(() => {});
    await page.getByRole('button', { name: 'NY' }).click().catch(() => {});

    await page.getByRole('textbox', { name: 'Enter account number' }).fill('123456789012');
    await page.getByRole('textbox', { name: 'Routing number (wire)' }).fill('021000021');

    await snap(page, 'B-04-add-wire-details-form-filled');

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(2000);
    await snap(page, 'B-05-wire-payment-schedule');
  } else {
    // Wire details already saved — go to payment schedule directly
    await snap(page, 'B-03-wire-existing-accounts');

    // Pick first listed account if any
    const firstAccount = page.locator('.d-flex.flex-column.pl-12').first();
    if (await firstAccount.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstAccount.click();
      await page.waitForTimeout(1000);
      await snap(page, 'B-04-wire-account-selected');
    }
  }

  // Payment schedule — fill amount
  const scheduleHeading = page.getByRole('heading').filter({ hasText: /schedule|payment/i });
  if (await scheduleHeading.isVisible({ timeout: 5000 }).catch(() => false)) {
    await snap(page, 'B-05-wire-payment-schedule');

    const amountInput = page.locator('input.form-control');
    if (await amountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await amountInput.click();
      await amountInput.selectText();
      await amountInput.pressSequentially('7500', { delay: 50 });

      const freqButton = page.getByRole('button', { name: 'Select frequency' });
      if (await freqButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await freqButton.click();
        await page.getByText('One Time Only', { exact: true }).click();
      }

      const msgInput = page.getByRole('textbox', { name: 'Enter a message' });
      if (await msgInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await msgInput.fill('Exploratory wire test');
      }

      await page.getByText('Now').click().catch(() => {});
      await snap(page, 'B-06-wire-schedule-filled');
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Profile / settings page
// ─────────────────────────────────────────────────────────────────────────────
test('C | Profile and settings — all sub-pages', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  // Try common profile/settings navigation patterns
  const profileLinks = [
    page.getByTestId('Sidebar-nav-profile'),
    page.getByTestId('Sidebar-nav-settings'),
    page.getByRole('link', { name: /profile/i }),
    page.getByRole('link', { name: /settings/i }),
    page.getByRole('link', { name: /account settings/i }),
  ];

  let profileFound = false;
  for (const link of profileLinks) {
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
      await page.waitForLoadState('networkidle', { timeout: 20000 });
      await snap(page, 'C-01-profile-or-settings-main');
      profileFound = true;
      break;
    }
  }

  if (!profileFound) {
    // Try avatar/user menu in top bar
    const avatar = page.locator('[data-testid*="avatar"], [data-testid*="user-menu"], .user-avatar, .profile-btn').first();
    if (await avatar.isVisible({ timeout: 3000 }).catch(() => false)) {
      await avatar.click();
      await page.waitForTimeout(1000);
      await snap(page, 'C-01-user-menu-opened');
    } else {
      await snap(page, 'C-01-no-profile-nav-found');
    }
  }

  // Look for sub-sections: personal info, security, notifications
  const subSections = [
    { testId: 'profile-personal-info', label: 'personal-info' },
    { role: 'link', name: /personal info/i, label: 'personal-info' },
    { role: 'link', name: /security/i, label: 'security' },
    { role: 'link', name: /notification/i, label: 'notifications' },
    { role: 'link', name: /document/i, label: 'documents' },
  ];

  for (const section of subSections) {
    let el;
    if (section.testId) {
      el = page.getByTestId(section.testId);
    } else {
      el = page.getByRole(section.role, { name: section.name });
    }
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await snap(page, `C-02-profile-${section.label}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Transaction history — drill into details
// ─────────────────────────────────────────────────────────────────────────────
test('D | Transaction history — list and detail drill-in', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });

  // Navigate to Accounts
  const accountsNav = page.getByTestId('Sidebar-nav-accounts');
  await accountsNav.waitFor({ state: 'visible', timeout: 15000 });
  await accountsNav.click();
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await snap(page, 'D-01-accounts-section');

  // Click first wallet/account link to see transactions
  const walletLink = page.locator('a.list-item div span.sub-item').first();
  if (await walletLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await walletLink.click();
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await snap(page, 'D-02-account-transactions-list');

    // Drill into first transaction row
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstRow.click();
      await page.waitForTimeout(1500);
      await snap(page, 'D-03-transaction-detail');

      // Check for any modal/drawer with details
      const modal = page.locator('[role="dialog"], .modal, .drawer, .transaction-detail').first();
      if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
        await snap(page, 'D-04-transaction-detail-modal');
      }
    }
  }

  // Navigate Accounts → view all / pagination if present
  const viewAll = page.getByRole('link', { name: /view all|see all/i });
  if (await viewAll.isVisible({ timeout: 3000 }).catch(() => false)) {
    await viewAll.click();
    await page.waitForLoadState('networkidle', { timeout: 20000 });
    await snap(page, 'D-05-transactions-view-all');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Payees list — existing payees after add-payee spec ran
// ─────────────────────────────────────────────────────────────────────────────
test('E | Payees — browse list and open a payee detail', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });

  const payeesNav = page.getByTestId('Sidebar-nav-payees');
  await payeesNav.waitFor({ state: 'visible', timeout: 15000 });
  await payeesNav.click();
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await snap(page, 'E-01-payees-list');

  // Click first payee to see detail
  const firstPayee = page.locator('[data-testid^="payee-list-item-"]').first();
  if (await firstPayee.isVisible({ timeout: 5000 }).catch(() => false)) {
    await firstPayee.click();
    await page.waitForTimeout(1500);
    await snap(page, 'E-02-payee-detail');

    // Check for edit/delete options
    const editBtn = page.getByRole('button', { name: /edit/i });
    const deleteBtn = page.getByRole('button', { name: /delete|remove/i });
    if (await editBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await snap(page, 'E-03-payee-edit-option-visible');
    }
    if (await deleteBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await snap(page, 'E-04-payee-delete-option-visible');
    }
  } else {
    await snap(page, 'E-02-payees-empty-or-no-testid');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// F. FX — countries NOT in TOP_FX_COUNTRIES: discover banking form fields
//    Goal: screenshot each step to learn what fields each country requires
//    (does NOT submit — exploratory only)
// ─────────────────────────────────────────────────────────────────────────────
const EXTRA_FX_COUNTRIES = ['DE', 'NZ', 'KR'];

for (const code of EXTRA_FX_COUNTRIES) {
  test(`F | FX discovery — ${code} banking form fields`, async ({ page, request }) => {
    test.setTimeout(180000);
    const userData = resolveUserDataForLogin();

    await loginUserWebWithPhone({ page, request, userData });
    await page.waitForLoadState('networkidle', { timeout: 20000 });

    const fxLink = page.getByRole('link', { name: 'Create FX Transaction' });
    await fxLink.waitFor({ state: 'visible', timeout: 15000 });
    await fxLink.click();
    await page.waitForTimeout(1000);
    await snap(page, `F-01-fx-picker-${code}`);

    const countryBtn = page.getByTestId(`country-select-${code}`);
    if (!(await countryBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      await snap(page, `F-02-country-not-found-${code}`);
      console.log(`[FX] ${code} not found in picker — likely not supported`);
      return;
    }

    await countryBtn.click();
    await page.waitForTimeout(1500);
    await snap(page, `F-02-amount-screen-${code}`);

    // Enter amount
    const youSend = page.locator('div').filter({ hasText: /^You send$/ });
    if (await youSend.isVisible({ timeout: 5000 }).catch(() => false)) await youSend.click();
    const sendInput = page.locator('div').filter({ hasText: /^You send$/ }).locator('input').first();
    if (await sendInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sendInput.click();
      await sendInput.selectText();
      await sendInput.pressSequentially('5500', { delay: 50 });
      await page.waitForTimeout(1200);
    }
    await snap(page, `F-03-amount-entered-${code}`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForTimeout(1500);
    await snap(page, `F-04-payee-step-${code}`);

    // Fill payee name (simple — no extra fields needed for discovery)
    const fxData = generateFxTransactionData({ countryCode: code });
    const firstNameInput = page.getByRole('textbox', { name: "Enter beneficiary's first name" });
    if (await firstNameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstNameInput.fill(fxData.beneficiaryFirstName);
      await page.getByRole('textbox', { name: "Enter beneficiary's last name" }).fill(fxData.beneficiaryLastName);
      // Optional extra fields if visible
      await page.getByRole('textbox', { name: 'Enter street address' }).fill('123 Test St').catch(() => {});
      await page.getByRole('textbox', { name: "Enter beneficiary's city" }).fill('Berlin').catch(() => {});
      await page.getByRole('textbox', { name: 'Enter zip/postal code' }).fill('10115').catch(() => {});
      const phoneInput = page.getByRole('textbox', { name: /Enter your (mobile|phone) number/i });
      if (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await phoneInput.click();
        await phoneInput.selectText();
        await phoneInput.pressSequentially('81312345678', { delay: 50 });
      }
      await snap(page, `F-05-payee-filled-${code}`);
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForTimeout(1500);
      // Screenshot banking form — this is the key discovery step
      await snap(page, `F-06-BANKING-FORM-DISCOVERED-${code}`);
      console.log(`[FX Discovery ${code}] Banking form screenshot taken — check F-06-BANKING-FORM-DISCOVERED-${code}.png`);
      // Capture all visible input labels to log required fields
      const inputLabels = await page.locator('label, [placeholder]').allTextContents().catch(() => []);
      console.log(`[FX Discovery ${code}] Visible form labels: ${inputLabels.filter(t => t.trim()).join(' | ')}`);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// G. FX country picker — search / scroll UX
// ─────────────────────────────────────────────────────────────────────────────
test('G | FX country picker — search box and full list scroll', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });

  const fxLink = page.getByRole('link', { name: 'Create FX Transaction' });
  await fxLink.waitFor({ state: 'visible', timeout: 15000 });
  await fxLink.click();
  await page.waitForTimeout(1500);
  await snap(page, 'G-01-fx-country-picker-full');

  // Try search field
  const searchInput = page.getByRole('searchbox').or(
    page.getByPlaceholder(/search|filter/i)
  ).or(
    page.locator('input[type="search"]')
  ).first();

  if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchInput.fill('Germany');
    await page.waitForTimeout(1000);
    await snap(page, 'G-02-fx-country-search-germany');

    await searchInput.clear();
    await searchInput.fill('Aus');
    await page.waitForTimeout(1000);
    await snap(page, 'G-03-fx-country-search-aus');

    await searchInput.clear();
  } else {
    await snap(page, 'G-02-fx-no-search-box');
  }

  // Scroll to bottom of country list
  const countryList = page.locator('[class*="country-list"], [class*="countries"], .country-picker, [data-testid*="country"]').first();
  if (await countryList.isVisible({ timeout: 3000 }).catch(() => false)) {
    await countryList.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(500);
    await snap(page, 'G-04-fx-country-list-bottom');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Error / edge states
// ─────────────────────────────────────────────────────────────────────────────
test('H | Error states — empty wire form submit, zero move-money, and login with wrong password', async ({ page, request }) => {
  test.setTimeout(180000);
  const userData = resolveUserDataForLogin();

  // ── H1: Wrong password attempt ──────────────────────────────────────────────
  const signInPage = new (require('../../../pages/SignInPage'))(page);
  await signInPage.goto({ standaloneUserWeb: true });
  await signInPage.signInWithPhoneStandaloneUserWeb(userData.phoneNumber);
  await signInPage.loginWithPassword('WrongPassword123!');
  await page.waitForTimeout(2000);
  await snap(page, 'H-01-wrong-password-error');

  // Now do the real login
  await signInPage.loginWithPassword(process.env.LOGIN_PASSWORD || process.env.FIRST_LOGIN_PASSWORD || 'Test12345.');
  await signInPage.waitForPasswordScreenToLeave();

  const VerificationPage = require('../../../pages/VerificationPage');
  const verificationPage = new VerificationPage(page);
  if (await verificationPage.isOtpInputVisible()) {
    const { getOtpForPhoneNumber } = require('../../../utils/otp-helper');
    await page.waitForTimeout(2000);
    const otp = await getOtpForPhoneNumber(request, userData.phoneNumber);
    await verificationPage.verifyOtpForUserWebFirstLogin(otp);
  }
  await signInPage.verifyLoginSuccessful();
  await page.waitForLoadState('networkidle', { timeout: 20000 });

  // ── H2: Zero / empty amount in Move Money ──────────────────────────────────
  const moveMoneyNav = page.getByTestId('Sidebar-nav-moveMoney');
  if (await moveMoneyNav.isVisible({ timeout: 5000 }).catch(() => false)) {
    await moveMoneyNav.click();
    const withdrawLink = page.getByTestId('Sidebar-moveMoney-withdrawFunds');
    const appeared = await withdrawLink.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (!appeared) {
      await moveMoneyNav.click();
      await withdrawLink.waitFor({ state: 'visible', timeout: 8000 });
    }
    await withdrawLink.click();
    await page.waitForTimeout(1000);
    await snap(page, 'H-02-withdraw-page-reached');

    // Look for internal transfer / ACH
    const internalOption = page.getByText(/ACH|internal transfer|move money internally/i).first();
    if (await internalOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await internalOption.click();
      await page.waitForTimeout(1000);
    }

    // Try to continue with no amount
    const nextBtn = page.getByRole('button', { name: 'Next' });
    if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(1000);
      await snap(page, 'H-03-empty-amount-error');
    }

    // Enter 0 as amount
    const amountInput = page.getByTestId('amount-input-ui');
    if (await amountInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await amountInput.click();
      await amountInput.pressSequentially('0', { delay: 50 });
      await nextBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
      await snap(page, 'H-04-zero-amount-error');
    }
  }

  // ── H3: Wire form validation ────────────────────────────────────────────────
  // Re-navigate to wire
  await page.goto('/user-web/auth/signin', { waitUntil: 'networkidle' }).catch(() => {});
  await loginUserWebWithPhone({ page, request, userData });

  const moveMoney2 = page.getByTestId('Sidebar-nav-moveMoney');
  if (await moveMoney2.isVisible({ timeout: 10000 }).catch(() => false)) {
    await moveMoney2.click();
    const withdraw2 = page.getByTestId('Sidebar-moveMoney-withdrawFunds');
    const ok2 = await withdraw2.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (!ok2) {
      await moveMoney2.click();
      await withdraw2.waitFor({ state: 'visible', timeout: 8000 });
    }
    await withdraw2.click();

    const wireText = page.getByText('Wire', { exact: true });
    if (await wireText.isVisible({ timeout: 5000 }).catch(() => false)) {
      await wireText.click();
      await page.waitForTimeout(1000);

      const addWireBtn2 = page.getByRole('button', { name: 'Add Wire Details' });
      if (await addWireBtn2.isVisible({ timeout: 5000 }).catch(() => false)) {
        await addWireBtn2.click();
        // Submit empty form
        await page.getByRole('button', { name: 'Continue' }).click();
        await page.waitForTimeout(1000);
        await snap(page, 'H-05-wire-form-empty-validation-errors');
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// I. Move Money → Link Account (ACH already linked — no-link state)
// ─────────────────────────────────────────────────────────────────────────────
test('I | Move Money — ACH link landing, existing linked account visible', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });
  await page.waitForLoadState('networkidle', { timeout: 20000 });

  const moveMoneyNav = page.getByTestId('Sidebar-nav-moveMoney');
  await moveMoneyNav.waitFor({ state: 'visible', timeout: 15000 });
  await moveMoneyNav.click();

  const linkAccountLink = page.getByRole('link', { name: 'Link Account' });
  if (await linkAccountLink.isVisible({ timeout: 8000 }).catch(() => false)) {
    await linkAccountLink.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    await snap(page, 'I-01-link-account-landing');

    // Check Add Funds sub-nav
    const addFundsLink = page.getByRole('link', { name: 'Add Funds Add Funds' });
    if (await addFundsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addFundsLink.click();
      await page.waitForLoadState('networkidle', { timeout: 15000 });
      await snap(page, 'I-02-add-funds-bank-picker');
    }
  } else {
    await snap(page, 'I-01-link-account-not-visible');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// K. Existing-payee discovery — Payees list detail (edit affordance) AND the
//    FX transaction Payee step (is there a saved-payee picker before "Add Payee"?)
// ─────────────────────────────────────────────────────────────────────────────
test('K | Existing payee — payees list detail + FX payee-step picker discovery', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();
  const AddPayeePage = require('../../../pages/AddPayeePage');
  const FxTransactionPage = require('../../../pages/FxTransactionPage');

  await loginUserWebWithPhone({ page, request, userData });

  const addPayeePage = new AddPayeePage(page);
  await addPayeePage.navigateToPayees();
  await page.waitForTimeout(1500);
  await snap(page, 'K-01-payees-list');

  const firstPayee = page.locator('[data-testid^="payee-list-item-"]').first();
  const hasPayee = await firstPayee.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[K] payee-list-item found: ${hasPayee}`);
  if (hasPayee) {
    await firstPayee.click();
    await page.waitForTimeout(1500);
    await snap(page, 'K-02-payee-detail');
    const allButtons = await page.getByRole('button').allTextContents().catch(() => []);
    console.log(`[K] Buttons on payee detail: ${allButtons.filter(Boolean).join(' | ')}`);
  }

  // FX transaction — Payee step, GB, before touching "Add Payee"
  const fxPage = new FxTransactionPage(page);
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await page.waitForTimeout(1000);
  await snap(page, 'K-03-fx-amount-step-gb');

  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: '5500' });
  await fxPage.continue();
  await page.waitForTimeout(1500);
  await snap(page, 'K-04-fx-payee-step-gb');

  const pageText = await page.locator('#root').innerText().catch(() => '');
  console.log(`[K] Payee-step page text:\n${pageText.slice(0, 1500)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// L. Existing payee — full discovery with a REAL saved payee: Select Payee
//    screen populated, click-to-select behavior, Review screen edit affordance,
//    and the standalone Payees-list detail edit affordance.
// ─────────────────────────────────────────────────────────────────────────────
test('L | Existing payee — create one payee, then discover select/edit UI', async ({ page, request }) => {
  test.setTimeout(180000);
  const userData = resolveUserDataForLogin();
  const AddPayeePage = require('../../../pages/AddPayeePage');
  const FxTransactionPage = require('../../../pages/FxTransactionPage');
  const { generateFxTransactionData } = require('../../../utils/test-data-generator');

  await loginUserWebWithPhone({ page, request, userData });

  const fxPage = new FxTransactionPage(page);
  const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });

  // ── Step 1: create ONE real payee via the simplest GB channel (IBAN powered by Visa Direct, default) ──
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();
  await snap(page, 'L-01-payee-step-before-add');

  await fxPage.addPayee(fxData.beneficiaryFirstName, fxData.beneficiaryLastName);
  await fxPage.enterIban(fxData.iban);
  await fxPage.handleIdentityStepIfPresent(fxData.identityType, fxData.identityNumber);
  await snap(page, 'L-02-review-transfer-new-payee');
  console.log(`[L] Created payee: ${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`);

  // Look for an edit affordance on the Review Transfer screen right now (last-moment edit).
  const editIcons = page.locator('[data-testid*="edit"], button:has-text("Edit"), [aria-label*="dit"], svg[class*="edit"], [class*="pencil"]');
  const editCount = await editIcons.count().catch(() => 0);
  console.log(`[L] Review screen — elements matching an "edit"-like selector: ${editCount}`);
  for (let i = 0; i < Math.min(editCount, 8); i++) {
    const el = editIcons.nth(i);
    const outer = await el.evaluate((n) => n.outerHTML?.slice(0, 200)).catch(() => '');
    console.log(`[L]   edit-candidate[${i}]: ${outer}`);
  }

  await fxPage.fillFxPaymentNote(fxData.note);
  const { paymentIdentifier } = await fxPage.confirmFxTransactionAndCaptureInternationalPaymentApi();
  console.log(`[L] paymentIdentifier: ${paymentIdentifier}`);
  await fxPage.verifyProcessingOrWaysToFundAndDismiss();

  // ── Step 2: revisit Create FX Transaction — Select Payee screen should now be populated ──
  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();
  await page.waitForTimeout(1000);
  await snap(page, 'L-03-select-payee-populated');

  const pageText2 = await page.locator('#root').innerText().catch(() => '');
  console.log(`[L] Select-Payee (populated) page text:\n${pageText2.slice(0, 1500)}`);

  // Try clicking the saved payee entry (name-based locator, since testid is unconfirmed here).
  const savedPayeeEntry = page.getByText(`${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}`, { exact: false }).first();
  const savedPayeeVisible = await savedPayeeEntry.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[L] Saved payee entry visible on Select Payee screen: ${savedPayeeVisible}`);
  if (savedPayeeVisible) {
    // Log any icon/button near the payee row BEFORE clicking (edit affordance in the list itself).
    const row = page.locator('div,li').filter({ hasText: `${fxData.beneficiaryFirstName} ${fxData.beneficiaryLastName}` }).last();
    const rowHtml = await row.evaluate((n) => n.outerHTML?.slice(0, 800)).catch(() => '');
    console.log(`[L] Saved-payee row HTML:\n${rowHtml}`);

    await savedPayeeEntry.click();
    await page.waitForTimeout(1500);
    await snap(page, 'L-04-after-selecting-saved-payee');
    const pageText3 = await page.locator('#root').innerText().catch(() => '');
    console.log(`[L] Page text after selecting saved payee:\n${pageText3.slice(0, 1500)}`);
  }

  // ── Step 3: standalone Payees list — open the new payee's detail, look for Edit ──
  const addPayeePage = new AddPayeePage(page);
  await addPayeePage.navigateToPayees();
  await page.waitForTimeout(1500);
  await snap(page, 'L-05-payees-list-with-entry');

  const listItem = page.locator('[data-testid^="payee-list-item-"]').first();
  if (await listItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await listItem.click();
    await page.waitForTimeout(1500);
    await snap(page, 'L-06-payee-detail');
    const detailButtons = await page.getByRole('button').allTextContents().catch(() => []);
    console.log(`[L] Payee-detail buttons: ${detailButtons.filter(Boolean).join(' | ')}`);
    const detailIcons = page.locator('[data-testid*="edit"], [aria-label*="dit"], svg[class*="edit"], [class*="pencil"]');
    const detailIconCount = await detailIcons.count().catch(() => 0);
    console.log(`[L] Payee-detail — edit-like elements: ${detailIconCount}`);
  } else {
    console.log('[L] No payee-list-item-* testid found on Payees list.');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// M. Existing payee — eye icon on Choose Payee list, and pencil icon on Review
//    Transfer (the "edit at the last moment" affordance found in test L).
// ─────────────────────────────────────────────────────────────────────────────
test('M | Existing payee — eye-icon view + pencil-icon edit-at-review discovery', async ({ page, request }) => {
  test.setTimeout(180000);
  const userData = resolveUserDataForLogin();
  const AddPayeePage = require('../../../pages/AddPayeePage');
  const FxTransactionPage = require('../../../pages/FxTransactionPage');
  const { generateFxTransactionData } = require('../../../utils/test-data-generator');

  await loginUserWebWithPhone({ page, request, userData });

  // ── Part 1: standalone Payees ("Choose Payee") — eye icon ──
  const addPayeePage = new AddPayeePage(page);
  await addPayeePage.navigateToPayees();
  await page.waitForTimeout(1500);
  await snap(page, 'M-01-choose-payee-list');

  const eyeIcon = page.locator('svg, [data-testid*="eye"], [aria-label*="view" i]').filter({ hasText: '' }).last();
  // Click the whole row's trailing icon button — target via the row container's last button/icon.
  const firstRow = page.locator('div').filter({ hasText: /GBP|USD|EUR/ }).filter({ has: page.locator('img, svg') }).first();
  const iconButtons = page.locator('button, [role="button"]');
  const iconCount = await iconButtons.count().catch(() => 0);
  console.log(`[M] Clickable button/role=button count on Choose-Payee list: ${iconCount}`);

  // Try clicking the last icon-shaped element within the payee card specifically (rightmost element).
  const payeeCard = page.locator('div').filter({ hasText: 'GBP' }).filter({ hasText: 'Mattie Dare' }).last();
  const cardVisible = await payeeCard.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[M] Payee card (Mattie Dare) visible: ${cardVisible}`);
  if (cardVisible) {
    const trailingIcon = payeeCard.locator('svg, img').last();
    if (await trailingIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
      await trailingIcon.click({ force: true });
      await page.waitForTimeout(1500);
      await snap(page, 'M-02-after-eye-icon-click');
      const text = await page.locator('#root').innerText().catch(() => '');
      console.log(`[M] Page text after eye-icon click:\n${text.slice(0, 1500)}`);
      console.log(`[M] URL after eye-icon click: ${page.url()}`);
    }
  }

  // ── Part 2: Create FX Transaction with existing payee → Review Transfer → pencil icon ──
  await page.goto('/user-web/dashboard', { waitUntil: 'networkidle' }).catch(() => {});
  const fxPage = new FxTransactionPage(page);
  const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });

  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();
  await page.waitForTimeout(1000);

  const savedPayeeEntry = page.getByText(/./).filter({ hasText: /^(?!Select Payee|Add Payee).+$/ });
  // Simpler: click first payee-ish row (we know at least "Mattie Dare" exists from test L).
  const mattieRow = page.getByText('Mattie Dare', { exact: false }).first();
  const mattieVisible = await mattieRow.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[M] Existing payee row visible on Select Payee screen: ${mattieVisible}`);
  if (!mattieVisible) {
    console.log('[M] No existing payee found — skipping Part 2 (run test L first to seed one).');
    return;
  }
  await mattieRow.click();
  await page.waitForTimeout(1500);
  await snap(page, 'M-03-review-transfer-before-edit');

  // Click the pencil/edit icon next to the payee name.
  const pencilBtn = page.locator('button svg, button img').last();
  const pencilButton = page.locator('button').filter({ has: page.locator('svg') }).last();
  const pencilVisible = await pencilButton.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[M] Pencil-like button visible on Review Transfer: ${pencilVisible}`);
  if (pencilVisible) {
    await pencilButton.click();
    await page.waitForTimeout(1500);
    await snap(page, 'M-04-after-pencil-click');
    const editText = await page.locator('#root').innerText().catch(() => '');
    console.log(`[M] Page text after pencil click:\n${editText.slice(0, 2000)}`);
    console.log(`[M] URL after pencil click: ${page.url()}`);

    // Log all input fields present on whatever screen we landed on.
    const inputs = await page.locator('input').all();
    for (const input of inputs) {
      const label = await input.getAttribute('placeholder').catch(() => null);
      const value = await input.inputValue().catch(() => null);
      console.log(`[M]   input placeholder="${label}" value="${value}"`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// N. Existing payee — click "Edit Payee", inspect the edit form, save, and see
//    whether we return to the in-flight Review Transfer or exit the flow.
// ─────────────────────────────────────────────────────────────────────────────
test('N | Existing payee — Edit Payee form + post-save navigation', async ({ page, request }) => {
  test.setTimeout(180000);
  const userData = resolveUserDataForLogin();
  const FxTransactionPage = require('../../../pages/FxTransactionPage');
  const { generateFxTransactionData } = require('../../../utils/test-data-generator');

  await loginUserWebWithPhone({ page, request, userData });

  const fxPage = new FxTransactionPage(page);
  const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });

  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();
  await page.waitForTimeout(1000);

  // Dynamic — don't hardcode a name, a prior exploratory run may have renamed it.
  const mattieRow = page.getByText('GBP', { exact: false }).locator('..').locator('..').first();
  const anyPayeeRow = page.locator('div.d-flex.flex-column.pl-12').first();
  const mattieVisible = await anyPayeeRow.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[N] Existing payee row visible: ${mattieVisible}`);
  if (!mattieVisible) {
    console.log('[N] No existing payee found — run test L first to seed one.');
    return;
  }
  const rowNameBefore = await anyPayeeRow.innerText().catch(() => '');
  console.log(`[N] Existing payee row text: ${rowNameBefore}`);
  await anyPayeeRow.click();
  await page.waitForTimeout(1500);
  console.log(`[N] URL at Review Transfer: ${page.url()}`);

  const pencilButton = page.locator('button').filter({ has: page.locator('svg') }).last();
  await pencilButton.click();
  await page.waitForTimeout(1500);
  console.log(`[N] URL at Payee Details: ${page.url()}`);
  await snap(page, 'N-01-payee-details-view');

  const editPayeeBtn = page.getByRole('button', { name: 'Edit Payee' });
  const editBtnVisible = await editPayeeBtn.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[N] "Edit Payee" button visible: ${editBtnVisible}`);
  if (!editBtnVisible) return;

  await editPayeeBtn.click();
  await page.waitForTimeout(1500);
  console.log(`[N] URL after clicking Edit Payee: ${page.url()}`);
  await snap(page, 'N-02-edit-payee-form');

  const editFormText = await page.locator('#root').innerText().catch(() => '');
  console.log(`[N] Edit-form page text:\n${editFormText.slice(0, 2000)}`);

  // Log every input on the edit form (name, value, editable state).
  const inputs = await page.locator('input').all();
  for (const input of inputs) {
    const placeholder = await input.getAttribute('placeholder').catch(() => null);
    const value = await input.inputValue().catch(() => null);
    const disabled = await input.isDisabled().catch(() => null);
    console.log(`[N]   input placeholder="${placeholder}" value="${value}" disabled=${disabled}`);
  }
  const buttons = await page.getByRole('button').allTextContents().catch(() => []);
  console.log(`[N] Buttons on edit form: ${buttons.filter(Boolean).join(' | ')}`);

  // Target the LAST NAME field specifically by placeholder — avoid ambiguous value-matching.
  const lastNameInput = page.getByPlaceholder("Enter beneficiary's last name");
  const canEditLastName = await lastNameInput.isEditable({ timeout: 2000 }).catch(() => false);
  console.log(`[N] Last-name field editable: ${canEditLastName}`);
  if (canEditLastName) {
    const lastNameBefore = await lastNameInput.inputValue().catch(() => '');
    await lastNameInput.fill(`${lastNameBefore}X`);
    await snap(page, 'N-03-edit-form-modified');

    const saveBtn = page.getByRole('button', { name: /save|update|continue|next/i });
    if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await saveBtn.click();
      await page.waitForTimeout(2000);
      console.log(`[N] URL after save: ${page.url()}`);
      await snap(page, 'N-04-after-save');
      const afterSaveText = await page.locator('#root').innerText().catch(() => '');
      console.log(`[N] Page text after save:\n${afterSaveText.slice(0, 2000)}`);

      // Continue past the account-details (IBAN) screen to see final landing point.
      const continueBtn = page.getByRole('button', { name: 'Continue' });
      if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await continueBtn.click();
        await page.waitForTimeout(2000);
        console.log(`[N] URL after final Continue: ${page.url()}`);
        await snap(page, 'N-05-final-landing-after-edit');
        const finalText = await page.locator('#root').innerText().catch(() => '');
        console.log(`[N] Final landing page text:\n${finalText.slice(0, 2000)}`);
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// J. Logout flow
// ─────────────────────────────────────────────────────────────────────────────
test('J | Logout — find logout button and confirm redirect to signin', async ({ page, request }) => {
  test.setTimeout(120000);
  const userData = resolveUserDataForLogin();

  await loginUserWebWithPhone({ page, request, userData });
  await page.waitForLoadState('networkidle', { timeout: 20000 });
  await snap(page, 'J-01-pre-logout-dashboard');

  // Try common logout patterns
  const logoutCandidates = [
    page.getByTestId('Sidebar-nav-logout'),
    page.getByRole('button', { name: /log.?out|sign.?out/i }),
    page.getByRole('link', { name: /log.?out|sign.?out/i }),
    page.locator('[data-testid*="logout"], [data-testid*="signout"]'),
  ];

  let loggedOut = false;
  for (const el of logoutCandidates) {
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await snap(page, 'J-02-logout-button-visible');
      await el.click();
      await page.waitForTimeout(2000);
      await snap(page, 'J-03-after-logout');
      loggedOut = true;

      // Confirm we're on sign-in
      const onSignIn = page.url().includes('signin') || page.url().includes('login');
      console.log(`[Logout] Redirected to: ${page.url()} | onSignIn: ${onSignIn}`);
      break;
    }
  }

  if (!loggedOut) {
    // Check bottom of sidebar / user avatar
    const bottomItems = page.locator('.sidebar-bottom, [class*="sidebar"] button').last();
    if (await bottomItems.isVisible({ timeout: 3000 }).catch(() => false)) {
      await bottomItems.click();
      await page.waitForTimeout(1500);
      await snap(page, 'J-02-sidebar-bottom-clicked');
    } else {
      await snap(page, 'J-02-logout-not-found');
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// P. TEMP PROBE — dynamically find whatever existing payee is on the Select Payee
//    screen (don't hardcode a name), select it, inspect the pencil-edit button on
//    Review Transfer, click it, and log the resulting screen + editable fields.
// ─────────────────────────────────────────────────────────────────────────────
test('P | TEMP — pencil-edit affordance on Review Transfer, dynamic payee', async ({ page, request }) => {
  test.setTimeout(180000);
  const userData = resolveUserDataForLogin();
  const FxTransactionPage = require('../../../pages/FxTransactionPage');
  const { generateFxTransactionData } = require('../../../utils/test-data-generator');

  page.on('response', (r) => {
    const url = r.url();
    if ((url.includes('/beneficiary/') || url.includes('/personal-info') || url.includes('/international/')) && r.request().method() !== 'GET') {
      console.log(`[P][net] ${r.request().method()} ${r.status()} ${url}`);
    }
  });

  await loginUserWebWithPhone({ page, request, userData });

  const fxPage = new FxTransactionPage(page);
  const fxData = generateFxTransactionData({ note: 'Sent from Bivo', countryCode: 'GB' });

  await fxPage.navigateToCreateFxTransactionUserWeb();
  await fxPage.selectDestinationCountryByTestId('GB');
  await fxPage.userWebFocusYouSendSection();
  await fxPage.enterSendAmountForBusiness({ amountInput: fxData.amountInput });
  await fxPage.continue();
  await page.waitForTimeout(1200);
  await snap(page, 'P-01-select-payee-screen');

  const heading = await page.locator('#root').innerText().catch(() => '');
  console.log(`[P] Screen text:\n${heading.slice(0, 800)}`);

  // Existing payee rows render as div.d-flex.flex-column.pl-12 (confirmed in test L).
  const payeeRow = page.locator('div.d-flex.flex-column.pl-12').first();
  const rowVisible = await payeeRow.isVisible({ timeout: 5000 }).catch(() => false);
  console.log(`[P] Existing payee row visible: ${rowVisible}`);
  if (!rowVisible) {
    console.log('[P] No existing payee — run test L first to seed one.');
    return;
  }
  const rowName = await payeeRow.innerText().catch(() => '');
  console.log(`[P] Selecting payee: ${rowName}`);
  await payeeRow.click();
  await page.waitForTimeout(1200);
  console.log(`[P] URL at Review Transfer: ${page.url()}`);
  await snap(page, 'P-02-review-transfer');

  // Dump every button's class attribute on Review Transfer to find a robust,
  // unique-enough selector for the pencil-edit button (no data-testid present).
  const allBtns = await page.locator('button').all();
  for (const b of allBtns) {
    const cls = await b.getAttribute('class').catch(() => null);
    const text = (await b.textContent().catch(() => '') || '').trim();
    console.log(`[P] all-buttons: class="${cls}" text="${text}"`);
  }

  // Inspect the pencil-edit button next to the payee name (visually confirmed in
  // L-04 screenshot — bordered square button with a pencil icon, right of the name).
  const editBtn = page.locator('button').filter({ has: page.locator('svg') });
  const editBtnCount = await editBtn.count().catch(() => 0);
  console.log(`[P] button-with-svg count on Review Transfer: ${editBtnCount}`);
  for (let i = 0; i < editBtnCount; i++) {
    const el = editBtn.nth(i);
    const outer = await el.evaluate((n) => n.outerHTML?.slice(0, 300)).catch(() => '');
    const testid = await el.getAttribute('data-testid').catch(() => null);
    console.log(`[P]   btn[${i}] testid="${testid}" html=${outer}`);
  }

  // Click the last one (rightmost/most-specific in DOM order, per prior probes).
  const pencilButton = editBtn.last();
  await pencilButton.click();
  await page.waitForTimeout(1500);
  console.log(`[P] URL after pencil click: ${page.url()}`);
  await snap(page, 'P-03-after-pencil-click');
  const afterText = await page.locator('#root').innerText().catch(() => '');
  console.log(`[P] Page text after pencil click:\n${afterText.slice(0, 1500)}`);

  // Log every input + its testid/placeholder/value/disabled state on whatever screen we land on.
  const inputs = await page.locator('input').all();
  for (const input of inputs) {
    const testid = await input.getAttribute('data-testid').catch(() => null);
    const placeholder = await input.getAttribute('placeholder').catch(() => null);
    const value = await input.inputValue().catch(() => null);
    const disabled = await input.isDisabled().catch(() => null);
    console.log(`[P]   input testid="${testid}" placeholder="${placeholder}" value="${value}" disabled=${disabled}`);
  }
  const buttons = await page.getByRole('button').allTextContents().catch(() => []);
  console.log(`[P] Buttons visible: ${buttons.filter(Boolean).join(' | ')}`);

  // ── Click Edit Payee, inspect the edit form, change last name, save ──
  const editPayeeBtn = page.getByRole('button', { name: 'Edit Payee' });
  await editPayeeBtn.click();
  await page.waitForTimeout(1500);
  console.log(`[P] URL after Edit Payee click: ${page.url()}`);
  await snap(page, 'P-04-edit-payee-form');

  const editFormText = await page.locator('#root').innerText().catch(() => '');
  console.log(`[P] Edit-form text:\n${editFormText.slice(0, 1500)}`);

  const editInputs = await page.locator('input').all();
  for (const input of editInputs) {
    const testid = await input.getAttribute('data-testid').catch(() => null);
    const placeholder = await input.getAttribute('placeholder').catch(() => null);
    const value = await input.inputValue().catch(() => null);
    const disabled = await input.isDisabled().catch(() => null);
    console.log(`[P]   edit-input testid="${testid}" placeholder="${placeholder}" value="${value}" disabled=${disabled}`);
  }
  const editButtons = await page.getByRole('button').allTextContents().catch(() => []);
  console.log(`[P] Edit-form buttons: ${editButtons.filter(Boolean).join(' | ')}`);

  const lastNameInput = page.getByPlaceholder("Enter beneficiary's last name").or(page.getByRole('textbox', { name: "Enter beneficiary's last name" }));
  const canEdit = await lastNameInput.isEditable({ timeout: 2000 }).catch(() => false);
  console.log(`[P] Last-name field editable: ${canEdit}`);
  if (canEdit) {
    const before = await lastNameInput.inputValue().catch(() => '');
    const newVal = before.endsWith('Y') ? before.slice(0, -1) : `${before}Y`;
    await lastNameInput.fill(newVal);
    console.log(`[P] Changed last name "${before}" -> "${newVal}"`);
    await snap(page, 'P-05-edit-form-modified');

    const continueBtn = page.getByRole('button', { name: 'Continue' });
    const saveBtn = page.getByRole('button', { name: /^(Save|Update)/i });
    const target = (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) ? saveBtn : continueBtn;
    await target.click();
    await page.waitForTimeout(1000);

    // Also change the IBAN on the account-details step (if present) to check whether
    // a separate PUT /beneficiary/account fires only when the value actually changes.
    const ibanCandidate = page.locator('input').first();
    if (await ibanCandidate.isVisible({ timeout: 2000 }).catch(() => false)) {
      const ibanTestId = await ibanCandidate.getAttribute('data-testid').catch(() => null);
      const ibanPlaceholder = await ibanCandidate.getAttribute('placeholder').catch(() => null);
      console.log(`[P] IBAN edit-input testid="${ibanTestId}" placeholder="${ibanPlaceholder}"`);
      const beforeIban = await ibanCandidate.inputValue().catch(() => '');
      if (/^GB[0-9A-Z]/i.test(beforeIban)) {
        await ibanCandidate.fill('GB26542316456541239999');
        console.log(`[P] Changed IBAN "${beforeIban}" -> GB26542316456541239999`);
        await snap(page, 'P-05b-iban-modified');
      }
    }
    await page.waitForTimeout(1500);
    console.log(`[P] URL after save click: ${page.url()}`);
    await snap(page, 'P-06-after-save');
    const afterSaveText = await page.locator('#root').innerText().catch(() => '');
    console.log(`[P] Text after save:\n${afterSaveText.slice(0, 1500)}`);

    // If the flow asks to re-confirm banking details, walk through generically.
    // Button label can be "Continue" (unchanged) or "Save" (dirty/changed field).
    for (let i = 0; i < 3; i++) {
      const stillContinue = page.getByRole('button', { name: /^(Continue|Save)$/ });
      const visible = await stillContinue.isVisible({ timeout: 3000 }).catch(() => false);
      if (!visible) break;
      const label = await stillContinue.textContent().catch(() => '');
      const enabled = await stillContinue.isEnabled({ timeout: 2000 }).catch(() => false);
      console.log(`[P] Step ${i}: button="${label}" enabled=${enabled}, url=${page.url()}`);
      if (!enabled) break;
      await stillContinue.click();
      await page.waitForTimeout(1500);
      await snap(page, `P-07-post-save-step-${i}`);
      const stepText = await page.locator('#root').innerText().catch(() => '');
      console.log(`[P] Step ${i} text:\n${stepText.slice(0, 1000)}`);
    }
    console.log(`[P] Final URL: ${page.url()}`);
  }
});
