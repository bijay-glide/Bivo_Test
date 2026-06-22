require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { authenticator } = require('otplib');
const { loadSignupData } = require('../../../utils/shared-state');
const VerificationPage = require('../../../pages/VerificationPage');
const BuWebSignInPage = require('../../../pages/BuWebSignInPage');
const AchLinkPage = require('../../../pages/AchLinkPage');
const AddFundsPage = require('../../../pages/AddFundsPage');
const { depositFundsViaWire } = require('../../../utils/transaction-helper');

const LOGIN_PASSWORD = process.env.FIRST_LOGIN_PASSWORD || 'Test12345.';
const DEPOSIT_AMOUNT = '$90.00';

test.describe('Bu-web payment setup — link bank account and add funds', () => {
  test('Sign in, link Chase ACH, and deposit funds', async ({ page, request }) => {
    test.setTimeout(180000);

    const state = loadSignupData();
    const { email, firstName, lastName, businessId, clientId, accountNumber, encodedTotpSecret } = state;

    console.log('══════════════════════════════════════════════');
    console.log('  1.3 Payment Setup — loaded state');
    console.log('══════════════════════════════════════════════');
    console.log('  email             :', email);
    console.log('  name              :', firstName, lastName);
    console.log('  businessId        :', businessId);
    console.log('  clientId          :', clientId);
    console.log('  accountNumber     :', accountNumber);
    console.log('  encodedTotpSecret :', encodedTotpSecret);
    console.log('══════════════════════════════════════════════');

    const signInPage       = new BuWebSignInPage(page);
    const verificationPage = new VerificationPage(page);
    const achLinkPage      = new AchLinkPage(page);
    const addFundsPage     = new AddFundsPage(page);

    // ── Login ─────────────────────────────────────────────────────────────────

    await test.step('Step 1 | Sign in with email', async () => {
      await signInPage.goto();
      await signInPage.enterEmail(email);
    });

    await test.step('Step 2 | Enter password', async () => {
      await signInPage.loginWithPassword(LOGIN_PASSWORD);
    });

    await test.step('Step 3 | Complete TOTP 2FA (if required)', async () => {
      // Device-trusted sessions skip TOTP and land directly on dashboard.
      // Wait up to 5 s for the TOTP input; if not shown, assume we're already in.
      const totpVisible = await verificationPage.digit1Input
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (totpVisible) {
        const isMultiDigit = await page.getByRole('textbox', { name: 'Digit 2' }).isVisible();

        const enterAndSubmitTotp = async () => {
          const totpCode = authenticator.generate(encodedTotpSecret);
          if (isMultiDigit) {
            await verificationPage.enterVerificationCode(totpCode);
          } else {
            await verificationPage.digit1Input.fill(totpCode);
          }
          await page.getByRole('button', { name: 'Next' }).click();
        };

        // First attempt
        await enterAndSubmitTotp();
        const navigated = await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 10000 })
          .then(() => true).catch(() => false);

        if (!navigated) {
          // Code was likely rejected (same 30-second window already used by 1.2).
          // Wait exactly until the next TOTP window starts, then retry once.
          const msToNextWindow = 30000 - (Date.now() % 30000);
          console.log('[Step 3] TOTP not accepted — waiting', Math.ceil((msToNextWindow + 1000) / 1000), 's for next window');
          await page.waitForTimeout(msToNextWindow + 1000);
          await enterAndSubmitTotp();
          await page.waitForURL(/bu-web\/(?!auth)/, { timeout: 35000 });
        }
      }

      await page.waitForTimeout(1000);
    });

    // ── Link bank account (Plaid / Chase sandbox) ─────────────────────────────

    let bankAlreadyLinked = false;

    await test.step('Step 4 | Navigate to Link Bank Account', async () => {
      await page.getByRole('link', { name: 'Move Money' }).click();
      await page.getByRole('link', { name: 'Link Account' }).click();

      // If Chase is already linked the app shows "Linked Accounts" directly — skip Plaid
      bankAlreadyLinked = await page.getByRole('heading', { name: 'Linked Accounts' })
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (!bankAlreadyLinked) {
        await page.getByText('Link instantly').click();
      }
    });

    await test.step('Step 5 | Complete Plaid / Chase sandbox flow', async () => {
      if (bankAlreadyLinked) return;
      const chasePopup = await achLinkPage.startPlaidChaseFlow();
      await achLinkPage.completeChaseLogin(chasePopup);
    });

    await test.step('Step 6 | Dismiss Plaid save-credentials prompt', async () => {
      if (bankAlreadyLinked) return;
      await achLinkPage.dismissSaveCredentials();
    });

    await test.step('Step 7 | Confirm Chase account linked', async () => {
      if (bankAlreadyLinked) return;
      await achLinkPage.doneButton.waitFor({ state: 'visible', timeout: 15000 });
      await achLinkPage.doneButton.click();
      await expect(page.locator('#root')).toContainText('Chase************0000', { timeout: 15000 });
    });

    // ── Add funds ─────────────────────────────────────────────────────────────

    await test.step('Step 8 | Navigate to Add Funds', async () => {
      await page.getByRole('link', { name: 'Add Funds' }).waitFor({ state: 'visible', timeout: 5000 });
      await page.getByRole('link', { name: 'Add Funds' }).click();
    });

    await test.step('Step 9 | Select Chase account and enter amount', async () => {
      await addFundsPage.selectChaseAccount();
      await addFundsPage.enterAmountAndProceed(DEPOSIT_AMOUNT);
    });

    await test.step('Step 10 | Review and confirm transfer', async () => {
      await addFundsPage.reviewAndConfirmTransfer();
    });

    await test.step('Step 11 | Verify success banner', async () => {
      await addFundsPage.confirmTransferSuccess(DEPOSIT_AMOUNT);
    });

    await test.step('Step 12 | Verify pending transaction in wallet ledger', async () => {
      await page.getByRole('link', { name: 'Business Accounts' }).click();
      await addFundsPage.verifyPendingTransaction(DEPOSIT_AMOUNT);
    });

    await test.step('Step 13 | Pre-fund account via incoming wire API', async () => {
      await depositFundsViaWire(request, accountNumber, { amount: 50000 }); // $500
    });
  });
});
