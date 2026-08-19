require('../state-suite-env');
const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const { depositFundsViaWire } = require('../../../../utils/transaction-helper');
const UserWebWithdrawFundsPage = require('../../../../pages/UserWebWithdrawFundsPage');
const { toCentsInput } = require('../../../../utils/amount-input');

// Ported from user-web's 2-withdraw-funds ACH-withdraw scenario. This is a stricter,
// API-verified version of the shallow ACH-withdraw check already in
// "6 ui_buweb_move_money.spec.js" (which only asserts the move-fund POST returns ok()).
// Both files are left in place — this one adds request-body and ledger-row verification
// on top of what "6" already covers.
const WITHDRAW_AMOUNT_USD = '90.00';
const WITHDRAW_AMOUNT     = toCentsInput(WITHDRAW_AMOUNT_USD);
const WITHDRAW_DISPLAY    = '$90.00';

test.describe('Bu-web — Withdraw Funds', () => {
  test.describe.configure({ retries: 1 });

  test('ACH withdraw: send funds to linked bank account and verify DEBIT transaction', async ({ page, request }) => {
    test.setTimeout(180000);

    const withdrawPage = new UserWebWithdrawFundsPage(page);
    const userData      = resolveBuWebUserDataForLogin();

    const bivoAccountNumber = userData.accountNumber || '';
    let bivoLast4    = '';
    let achAccount   = null;
    let requestId    = null;

    await test.step('Step 1 | Sign in to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
      bivoLast4 = await withdrawPage.discoverBivoPrimaryLast4(bivoAccountNumber);
      expect(bivoLast4, 'Bivo primary account last4 should be derivable via accountbalance API').toBeTruthy();
    });

    await test.step('Step 2 | Pre-fund account via wire API', async () => {
      await depositFundsViaWire(request, bivoAccountNumber, { amount: 50000 }); // $500
    });

    await test.step('Step 3 | Discover linked ACH account for API assertion', async () => {
      achAccount = await withdrawPage.discoverLinkedAchAccount();
      console.log(
        `[withdraw-funds] ACH account: "${achAccount.accountName}"` +
        ` (${achAccount.accountNumber}), last4: ${achAccount.last4}`,
      );
    });

    await test.step('Step 4 | Navigate to Move Money → Withdraw Funds', async () => {
      await withdrawPage.navigateToWithdrawFunds();
    });

    await test.step('Step 5 | Assert pre-selected From (Bivo) and To (linked ACH) accounts', async () => {
      await withdrawPage.assertFromAccountPreSelectedAsBivo();
      await withdrawPage.assertToAccountPreSelected();
    });

    await test.step(`Step 6 | Enter amount (${WITHDRAW_DISPLAY}) and proceed to review`, async () => {
      await withdrawPage.enterAmountAndContinue(WITHDRAW_AMOUNT);
    });

    await test.step('Step 7 | Verify review screen shows amount and ACH timing', async () => {
      await withdrawPage.assertReviewScreen({ amountDisplay: WITHDRAW_DISPLAY });
    });

    await test.step('Step 8 | Submit transfer and verify move-fund API', async () => {
      const captured = await withdrawPage.submitAndCaptureMoveFundApi();
      requestId = captured.requestId;
      withdrawPage.assertMoveFundApiCaptured(captured, {
        fromAccountNumber: bivoAccountNumber,
        toAccountNumber:   achAccount.accountNumber,
        amountUsd:         WITHDRAW_AMOUNT_USD,
      });
    });

    await test.step('Step 9 | Verify transfer initiated success screen', async () => {
      await withdrawPage.assertTransferCompleteScreen({ amountDisplay: WITHDRAW_DISPLAY });
    });

    await test.step('Step 10 | Navigate to Bivo account and verify DEBIT transaction', async () => {
      const { transactions } = await withdrawPage.navigateToBivoAccountAndCaptureTransactions({
        bivoLast4,
        bivoAccountNumber,
      });
      await withdrawPage.assertDebitTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        requestId,
        amountUsd: WITHDRAW_AMOUNT_USD,
      });
    });
  });
});
