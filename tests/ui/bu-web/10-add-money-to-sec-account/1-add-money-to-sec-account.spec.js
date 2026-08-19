require('./state-suite-env');

const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../utils/ui-login-helper');
const { toCentsInput, formatUsdDisplay } = require('../../../utils/amount-input');
const { loadSignupData } = require('../../../utils/shared-state');
const UserWebInternalTransferPage = require('../../../pages/UserWebInternalTransferPage');

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

    await test.step('Step 1 | Login to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
    });

    // Guard: spec 9.1 must have run and persisted the secondary account flag.
    let sharedState = {};
    try { sharedState = loadSignupData(); } catch { /* state file missing */ }
    if (!sharedState.secondaryUsdAccountCreated) {
      test.skip(true, 'Secondary USD account not found in shared state — run spec 9.1 (add account) first');
    }

    await test.step('Step 2 | Discover secondary USD wallet account', async () => {
      secondaryAccount = await transferPage.discoverSecondaryUsdWallet(bivoAccountNumber);
      console.log(
        `[internal-transfer] secondary account: "${secondaryAccount.accountName}"` +
        ` (${secondaryAccount.accountNumber}), last4: ${secondaryAccount.last4}`,
      );
      expect(secondaryAccount.accountNumber, 'secondary USD wallet account number should be found').toBeTruthy();
    });

    await test.step('Step 3 | Navigate to Move Money — Internal Transfer', async () => {
      await transferPage.navigateToInternalTransfer();
    });

    await test.step('Step 4 | Select secondary USD wallet as "To" account', async () => {
      await transferPage.selectToAccount(secondaryAccount.last4);
    });

    await test.step(`Step 5 | Enter transfer amount (${amountDisplay}) and proceed to review`, async () => {
      await transferPage.enterAmountAndContinue(amountInput);
    });

    await test.step('Step 6 | Verify review screen', async () => {
      await transferPage.assertReviewScreen({
        fromName:      'Bivo',
        toName:        secondaryAccount.accountName,
        amountDisplay,
      });
    });

    await test.step('Step 7 | Submit transfer and verify move-fund API', async () => {
      const captured = await transferPage.submitAndCaptureMoveFundApi();
      paymentIdentifier = captured.paymentIdentifier;
      transferPage.assertMoveFundApiCaptured(captured, {
        fromAccountNumber: bivoAccountNumber,
        toAccountNumber:   secondaryAccount.accountNumber,
        amountUsd:         TRANSFER_AMOUNT_USD,
      });
    });

    await test.step('Step 8 | Verify transfer complete screen', async () => {
      await transferPage.assertTransferCompleteScreen({
        toAccountName: secondaryAccount.accountName,
        amountDisplay,
      });
    });

    await test.step('Step 9 | Navigate to secondary account and verify CREDIT transaction in API', async () => {
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

  // ── Error path: cross-currency transfer rejection ─────────────────────────

  test('Internal Transfer to non-USD account returns cross-currency error', async ({ page }) => {
    test.setTimeout(90000);

    const transferPage  = new UserWebInternalTransferPage(page);
    const userData      = resolveBuWebUserDataForLogin();
    const amountInput   = toCentsInput(TRANSFER_AMOUNT_USD);
    const amountDisplay = formatUsdDisplay(TRANSFER_AMOUNT_USD);

    let nonUsdAccount = null;

    await test.step('Step 1 | Login to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
    });

    // Guard: spec 9.2 must have run and persisted the multicurrency accounts flag.
    let sharedState2 = {};
    try { sharedState2 = loadSignupData(); } catch { /* state file missing */ }
    if (!sharedState2.multicurrencyAccountsCreated) {
      test.skip(true, 'Multicurrency accounts not found in shared state — run spec 9.2 first');
    }

    await test.step('Step 2 | Discover a non-USD fiat wallet to use as destination', async () => {
      nonUsdAccount = await transferPage.discoverNonUsdFiatWallet();
      console.log(
        `[cross-currency] destination: "${nonUsdAccount.accountName}"` +
        ` (${nonUsdAccount.currency}), last4: ${nonUsdAccount.last4}`,
      );
    });

    await test.step('Step 3 | Navigate to Move Money — Internal Transfer', async () => {
      await transferPage.navigateToInternalTransfer();
    });

    await test.step('Step 4 | Assert dropdowns show only fiat wallet options', async () => {
      await transferPage.assertFromAccountDropdownContainsBivo();
      await transferPage.assertToAccountDropdownShowsOnlyFiatWallets({ nonUsdLast4: nonUsdAccount.last4 });
    });

    await test.step('Step 5 | Select non-USD fiat wallet as "To" account', async () => {
      await transferPage.selectToAccount(nonUsdAccount.last4);
    });

    await test.step(`Step 6 | Enter transfer amount (${amountDisplay}) and proceed to review`, async () => {
      await transferPage.enterAmountAndContinue(amountInput);
    });

    await test.step('Step 7 | Submit transfer and assert 400 cross-currency API error', async () => {
      const errorBody = await transferPage.submitAndCaptureTransferErrorApi();
      transferPage.assertCrossAccountApiError(errorBody);
    });

    await test.step('Step 8 | Verify UI error message', async () => {
      await transferPage.assertCrossAccountTransferUiError();
    });
  });
});
