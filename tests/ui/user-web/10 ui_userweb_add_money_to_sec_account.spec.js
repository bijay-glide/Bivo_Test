require('./state-suite-env');

const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { toCentsInput, formatUsdDisplay } = require('../../../utils/amount-input');
const { loadSignupData } = require('../../../utils/shared-state');
const UserWebInternalTransferPage = require('../../../pages/UserWebInternalTransferPage');

const TRANSFER_AMOUNT_USD = '90.00';

test.describe('User-web — Internal Transfer: Bivo → secondary USD account', () => {
  test.describe.configure({ retries: 1 });

  // ── Happy path: Bivo → secondary USD wallet ───────────────────────────────

  test('Transfer funds from primary to secondary USD account and verify CREDIT transaction', async ({ page, request }) => {
    test.setTimeout(120000);

    const transferPage    = new UserWebInternalTransferPage(page);
    let userData          = resolveUserDataForLogin();
    const amountInput     = toCentsInput(TRANSFER_AMOUNT_USD);
    const amountDisplay   = formatUsdDisplay(TRANSFER_AMOUNT_USD);

    let bivoAccountNumber = userData.accountNumber || '';
    let fromWallet        = null;
    let toWallet          = null;
    let paymentIdentifier = null;

    // Guard: spec 9.1 must have run and persisted the secondary account flag in this
    // session. If missing (e.g. running this spec standalone), fall back to a known-good
    // user that already has a secondary USD account, instead of skipping.
    let sharedState = {};
    try { sharedState = loadSignupData(); } catch { /* state file missing */ }
    if (!sharedState.secondaryUsdAccountCreated) {
      console.warn('[internal-transfer] secondaryUsdAccountCreated not found in shared state — falling back to known-good user 2125340081');
      userData = { phoneNumber: '2125340081' };
      bivoAccountNumber = '';
    }

    await test.step('Step 1 | Login to user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
    });

    await test.step('Step 2 | Discover two USD wallet accounts for the From/To legs', async () => {
      // Don't trust the FE's default "From" preselection — for shared/reused test
      // accounts with several renamed USD wallets it isn't stable (varies between
      // runs). Prefer the primary account (by bivoAccountNumber) as From when it's
      // one of the USD wallets found; otherwise pick any two distinct ones. Both
      // legs are then explicitly selected via the dropdowns below.
      const usdWallets = await transferPage.discoverTwoUsdWallets();
      fromWallet = usdWallets.find((w) => String(w.accountNumber) === String(bivoAccountNumber)) || usdWallets[0];
      toWallet   = usdWallets.find((w) => String(w.accountNumber) !== String(fromWallet.accountNumber));
      console.log(
        `[internal-transfer] from: "${fromWallet.accountName}" (${fromWallet.accountNumber}), last4: ${fromWallet.last4}` +
        ` | to: "${toWallet.accountName}" (${toWallet.accountNumber}), last4: ${toWallet.last4}`,
      );
    });

    await test.step('Step 3 | Navigate to Move Money — Internal Transfer', async () => {
      await transferPage.navigateToInternalTransfer();
    });

    await test.step('Step 4 | Select From/To USD wallet accounts', async () => {
      await transferPage.selectFromAccount(fromWallet.last4);
      await transferPage.selectToAccount(toWallet.last4);
    });

    await test.step(`Step 5 | Enter transfer amount (${amountDisplay}) and proceed to review`, async () => {
      await transferPage.enterAmountAndContinue(amountInput);
    });

    await test.step('Step 6 | Verify review screen', async () => {
      await transferPage.assertReviewScreen({
        fromName:      fromWallet.accountName,
        toName:        toWallet.accountName,
        amountDisplay,
      });
    });

    await test.step('Step 7 | Submit transfer and verify move-fund API', async () => {
      const captured = await transferPage.submitAndCaptureMoveFundApi();
      paymentIdentifier = captured.paymentIdentifier;
      transferPage.assertMoveFundApiCaptured(captured, {
        fromAccountNumber: fromWallet.accountNumber,
        toAccountNumber:   toWallet.accountNumber,
        amountUsd:         TRANSFER_AMOUNT_USD,
      });
    });

    await test.step('Step 8 | Verify transfer complete screen', async () => {
      await transferPage.assertTransferCompleteScreen({
        toAccountName: toWallet.accountName,
        amountDisplay,
      });
    });

    await test.step('Step 9 | Navigate to secondary account and verify CREDIT transaction in API', async () => {
      const { transactions } = await transferPage.navigateToAccountAndCaptureTransactions({
        last4:         toWallet.last4,
        accountNumber: toWallet.accountNumber,
      });
      transferPage.assertCreditTransaction({
        transactions,
        paymentIdentifier,
        amountUsd: TRANSFER_AMOUNT_USD,
      });
    });
  });

  // ── Error path: cross-currency transfer rejection ─────────────────────────

  test('Internal Transfer to non-USD account returns cross-currency error', async ({ page, request }) => {
    test.setTimeout(90000);

    const transferPage  = new UserWebInternalTransferPage(page);
    let userData        = resolveUserDataForLogin();
    const amountInput   = toCentsInput(TRANSFER_AMOUNT_USD);
    const amountDisplay = formatUsdDisplay(TRANSFER_AMOUNT_USD);

    let nonUsdAccount   = null;
    let bivoAccountName = 'Bivo';

    // Guard: spec 9.2 must have run and persisted the multicurrency accounts flag in this
    // session. If missing, fall back to a known-good user that already has multicurrency
    // wallets, instead of skipping.
    let sharedState2 = {};
    try { sharedState2 = loadSignupData(); } catch { /* state file missing */ }
    if (!sharedState2.multicurrencyAccountsCreated) {
      console.warn('[cross-currency] multicurrencyAccountsCreated not found in shared state — falling back to known-good user 2125340081');
      userData = { phoneNumber: '2125340081' };
    }

    await test.step('Step 1 | Login to user-web', async () => {
      await loginUserWebWithPhone({ page, request, userData });
    });

    await test.step('Step 2 | Discover a non-USD fiat wallet to use as destination', async () => {
      nonUsdAccount = await transferPage.discoverNonUsdFiatWallet();
      console.log(
        `[cross-currency] destination: "${nonUsdAccount.accountName}"` +
        ` (${nonUsdAccount.currency}), last4: ${nonUsdAccount.last4}`,
      );
    });

    await test.step('Step 3 | Navigate to Move Money — Internal Transfer', async () => {
      await transferPage.navigateToInternalTransfer();
      // Capture the preselected "From" account's live label — see spec 10's happy-path
      // test for why this can't be predicted via API for shared/renamed test accounts.
      bivoAccountName = await transferPage.getFromAccountLabel();
    });

    await test.step('Step 4 | Assert dropdowns show only fiat wallet options', async () => {
      await transferPage.assertFromAccountDropdownContainsBivo(bivoAccountName);
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
