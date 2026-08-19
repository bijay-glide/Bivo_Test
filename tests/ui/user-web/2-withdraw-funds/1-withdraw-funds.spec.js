require('../state-suite-env');
const { test, expect } = require('../../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../../utils/ui-login-helper');
const WirePaymentPage = require('../../../../pages/WirePaymentPage');
const UserWebWithdrawFundsPage = require('../../../../pages/UserWebWithdrawFundsPage');
const { generateWireFormData, generateWirePaymentSchedule } = require('../../../../utils/test-data-generator');
const { toCentsInput } = require('../../../../utils/amount-input');

const WITHDRAW_AMOUNT_USD = '90.00';
const WITHDRAW_AMOUNT     = toCentsInput(WITHDRAW_AMOUNT_USD);
const WITHDRAW_DISPLAY    = '$90.00';

test.describe('User-web — Withdraw Funds', () => {
  test.describe.configure({ retries: 1 });

  // ── 1. Wire payment ───────────────────────────────────────────────────────

  test('Wire payment: add recipient and execute transfer', async ({ page, request }) => {
    test.setTimeout(180000);

    const wireFormData     = generateWireFormData();
    const paymentSchedule  = generateWirePaymentSchedule();
    const wirePage         = new WirePaymentPage(page);
    const userData         = resolveUserDataForLogin();

    let bivoAccountNumber = userData.accountNumber || '';

    await test.step('Step 1 | Login to user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      expect(bivoAccountNumber, 'bivo_account_number should be available from account API').toBeTruthy();
    });

    await test.step('Step 2 | Navigate to Wire section', async () => {
      await wirePage.navigateToWireSection();
    });

    await test.step('Step 3 | Fill wire recipient details form', async () => {
      await wirePage.fillWireDetailsForm(wireFormData);
    });

    await test.step('Step 4 | Fill payment schedule (amount, frequency, message)', async () => {
      await wirePage.fillPaymentSchedule(paymentSchedule);
    });

    await test.step('Step 5 | Verify review screen shows all submitted values', async () => {
      await wirePage.verifyReviewScreen(wireFormData, paymentSchedule);
    });

    await test.step('Step 6 | Submit transfer and verify transactions API response', async () => {
      await wirePage.submitTransfer(wireFormData.firstName, {
        accountId: bivoAccountNumber,
      });
    });

    await test.step('Step 7 | Verify transaction appears in ledger history', async () => {
      await wirePage.verifyTransactionHistory(wireFormData.firstName, paymentSchedule.amount);
    });
  });

  // ── 2. ACH Withdraw Funds ─────────────────────────────────────────────────

  test('ACH withdraw: send funds to linked bank account and verify DEBIT transaction', async ({ page, request }) => {
    test.setTimeout(180000);

    const withdrawPage = new UserWebWithdrawFundsPage(page);
    const userData     = resolveUserDataForLogin();

    let bivoAccountNumber = userData.accountNumber || '';
    let bivoLast4         = '';
    let achAccount        = null;
    let requestId         = null;

    await test.step('Step 1 | Login to user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      const bivoDda     = loginResult?.bivo_dda_number     || userData.ddaNumber || '';
      bivoLast4         = String(bivoDda).slice(-4);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    await test.step('Step 2 | Discover linked ACH account for API assertion', async () => {
      achAccount = await withdrawPage.discoverLinkedAchAccount();
      console.log(
        `[withdraw-funds] ACH account: "${achAccount.accountName}"` +
        ` (${achAccount.accountNumber}), last4: ${achAccount.last4}`,
      );
    });

    await test.step('Step 3 | Navigate to Move Money → Withdraw Funds', async () => {
      await withdrawPage.navigateToWithdrawFunds();
    });

    await test.step('Step 4 | Assert pre-selected From (Bivo) and To (linked ACH) accounts', async () => {
      await withdrawPage.assertFromAccountPreSelectedAsBivo();
      await withdrawPage.assertToAccountPreSelected();
    });

    await test.step(`Step 5 | Enter amount (${WITHDRAW_DISPLAY}) and proceed to review`, async () => {
      await withdrawPage.enterAmountAndContinue(WITHDRAW_AMOUNT);
    });

    await test.step('Step 6 | Verify review screen shows amount and ACH timing', async () => {
      await withdrawPage.assertReviewScreen({ amountDisplay: WITHDRAW_DISPLAY });
    });

    await test.step('Step 7 | Submit transfer and verify move-fund API', async () => {
      const captured = await withdrawPage.submitAndCaptureMoveFundApi();
      requestId = captured.requestId;
      withdrawPage.assertMoveFundApiCaptured(captured, {
        fromAccountNumber: bivoAccountNumber,
        toAccountNumber:   achAccount.accountNumber,
        amountUsd:         WITHDRAW_AMOUNT_USD,
      });
    });

    await test.step('Step 8 | Verify transfer initiated success screen', async () => {
      await withdrawPage.assertTransferCompleteScreen({ amountDisplay: WITHDRAW_DISPLAY });
    });

    await test.step('Step 9 | Navigate to Bivo account and verify DEBIT transaction', async () => {
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
