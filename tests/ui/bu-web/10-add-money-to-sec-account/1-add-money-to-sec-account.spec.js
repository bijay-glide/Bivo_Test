require('../state-suite-env');

const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const { toCentsInput, formatUsdDisplay } = require('../../../../utils/amount-input');
const { loadSignupData } = require('../../../../utils/shared-state');
const UserWebInternalTransferPage = require('../../../../pages/UserWebInternalTransferPage');

const TRANSFER_AMOUNT_USD = '90.00';

test.describe('Bu-web — Internal Transfer: primary → secondary USD account', () => {
  test.describe.configure({ retries: 1 });

  // ── Happy path: primary → secondary USD wallet ────────────────────────────

  test('Transfer funds from primary to secondary USD account and verify CREDIT transaction', async ({ page }) => {
    test.setTimeout(120000);

    const transferPage    = new UserWebInternalTransferPage(page);
    const userData        = resolveBuWebUserDataForLogin();
    const amountInput     = toCentsInput(TRANSFER_AMOUNT_USD);
    const amountDisplay   = formatUsdDisplay(TRANSFER_AMOUNT_USD);

    const bivoAccountNumber = userData.accountNumber || '';
    let secondaryAccount    = null;
    let paymentIdentifier   = null;

    // Gate: ordering against 9.1 is enforced by the "UI bu-web sec-account" project
    // only running after "UI bu-web accounts" (test:ui:buweb:full). This check is a
    // safety net for standalone/out-of-order runs (e.g. --no-deps against this file
    // alone), where 9.1 was skipped entirely rather than just slow.
    await test.step('Step 1 | Verify spec 9.1 (add account) has run', async () => {
      let sharedState = {};
      try { sharedState = loadSignupData(); } catch { /* state file missing */ }
      if (!sharedState.secondaryUsdAccountCreated) {
        throw new Error(
          'secondaryUsdAccountCreated flag not found in shared state — run spec 9.1 (add account) first.'
        );
      }
    });

    await test.step('Step 2 | Login to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 3 | Discover secondary USD wallet account', async () => {
      secondaryAccount = await transferPage.discoverSecondaryUsdWallet(bivoAccountNumber);
      console.log(
        `[internal-transfer] secondary account: "${secondaryAccount.accountName}"` +
        ` (${secondaryAccount.accountNumber}), last4: ${secondaryAccount.last4}`,
      );
      expect(secondaryAccount.accountNumber, 'secondary USD wallet account number should be found').toBeTruthy();
    });

    await test.step('Step 4 | Navigate to Move Money — Internal Transfer', async () => {
      await transferPage.navigateToInternalTransfer();
    });

    await test.step('Step 5 | Select secondary USD wallet as "To" account', async () => {
      await transferPage.selectToAccount(secondaryAccount.last4);
    });

    await test.step(`Step 6 | Enter transfer amount (${amountDisplay}) and proceed to review`, async () => {
      await transferPage.enterAmountAndContinue(amountInput);
    });

    await test.step('Step 7 | Verify review screen', async () => {
      await transferPage.assertReviewScreen({
        // bu-web's primary wallet is named "Primary" (user-web's is "Bivo").
        fromName:      'Primary',
        toName:        secondaryAccount.accountName,
        amountDisplay,
      });
    });

    await test.step('Step 8 | Submit transfer and verify move-fund API', async () => {
      const captured = await transferPage.submitAndCaptureMoveFundApi();
      paymentIdentifier = captured.paymentIdentifier;
      transferPage.assertMoveFundApiCaptured(captured, {
        fromAccountNumber: bivoAccountNumber,
        toAccountNumber:   secondaryAccount.accountNumber,
        amountUsd:         TRANSFER_AMOUNT_USD,
      });
    });

    await test.step('Step 9 | Verify transfer complete screen', async () => {
      await transferPage.assertTransferCompleteScreen({
        toAccountName: secondaryAccount.accountName,
        amountDisplay,
      });
    });

    await test.step('Step 10 | Navigate to secondary account and verify CREDIT transaction in API', async () => {
      const { transactions } = await transferPage.navigateToAccountAndCaptureTransactions({
        last4:         secondaryAccount.last4,
        accountNumber: secondaryAccount.accountNumber,
      });
      transferPage.assertCreditTransaction({
        transactions,
        paymentIdentifier,
        amountUsd: TRANSFER_AMOUNT_USD,
      });
    });
  });

  // ── "To" dropdown scope: USD wallets only, no multicurrency accounts ──────

  test('Internal Transfer "To" dropdown lists only USD wallet accounts', async ({ page }) => {
    test.setTimeout(90000);

    const transferPage = new UserWebInternalTransferPage(page);
    const userData      = resolveBuWebUserDataForLogin();

    // Gate: ordering against 9.1/9.2 is enforced by the "UI bu-web sec-account"
    // project only running after "UI bu-web accounts" (test:ui:buweb:full). This
    // check is a safety net for standalone/out-of-order runs (e.g. --no-deps against
    // this file alone), where 9.1/9.2 were skipped entirely rather than just slow.
    await test.step('Step 1 | Verify spec 9.1/9.2 (accounts) have run', async () => {
      let sharedState = {};
      try { sharedState = loadSignupData(); } catch { /* state file missing */ }
      if (!sharedState.secondaryUsdAccountCreated) {
        throw new Error(
          'secondaryUsdAccountCreated flag not found in shared state — run spec 9.1 (add account) first.'
        );
      }
      if (!sharedState.multicurrencyAccountsCreated) {
        throw new Error(
          'multicurrencyAccountsCreated flag not found in shared state — run spec 9.2 (multicurrency accounts) first.'
        );
      }
    });

    await test.step('Step 2 | Login to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 3 | Navigate to Move Money — Internal Transfer', async () => {
      await transferPage.navigateToInternalTransfer();
    });

    await test.step('Step 4 | Assert "To" dropdown lists only USD wallets (primary + secondary), no multicurrency accounts', async () => {
      // bu-web's primary wallet is named "Primary" (user-web's is "Bivo").
      await transferPage.assertFromAccountDropdownContainsBivo('Primary');
      await transferPage.assertToAccountDropdownShowsOnlyUsdWallets();
    });
  });
});
