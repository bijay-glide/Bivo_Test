require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { depositFundsViaWire } = require('../../../utils/transaction-helper');
const { toCentsInput } = require('../../../utils/amount-input');
const MoveFundsPage = require('../../../pages/MoveFundsPage');

const MOVE_FUNDS_DATA = {
  amountUsd: '10.00',
};

test.describe('User-web Move Money', () => {
  test('Move funds internally and verify transactions API', async ({ page, request }) => {
    test.setTimeout(120000);

    const moveFundsPage = new MoveFundsPage(page);
    const userData = resolveUserDataForLogin();
    const amountInput = toCentsInput(MOVE_FUNDS_DATA.amountUsd);

    let bivoAccountNumber = userData.accountNumber || '';
    let paymentIdentifier = null;

    await test.step('Step 1 | Login to standalone user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      expect(bivoAccountNumber, 'bivo_account_number should be available from account API').toBeTruthy();
    });

    await test.step('Step 3 | Navigate to Move Money — Withdraw Funds', async () => {
      await moveFundsPage.navigateToMoveFunds();
    });

    await test.step('Step 4 | Enter transfer amount and continue', async () => {
      await moveFundsPage.enterAmountAndContinue(amountInput);
    });

    await test.step('Step 5 | Submit transfer and verify move-fund API', async () => {
      const captured = await moveFundsPage.submitAndCaptureMoveFundApi();
      paymentIdentifier = captured.paymentIdentifier;
      moveFundsPage.assertMoveFundApiCaptured(captured, {
        bivoAccountNumber,
        amountUsd: MOVE_FUNDS_DATA.amountUsd,
      });
    });

    await test.step('Step 6 | Transactions API — verify move-fund row', async () => {
      await moveFundsPage.assertTransactionsApiMoveFundRow({
        accountNumber: bivoAccountNumber,
        paymentIdentifier,
        amountUsd: MOVE_FUNDS_DATA.amountUsd,
      });
    });
  });
});
