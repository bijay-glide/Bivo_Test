// Bu-web FX — Vietnam, business payee. Per a live probe, the Business tab exposes only 2
// deliver-to channels for Vietnam — Bank Deposit (default) and Instant Card Payout — no
// Mobile Wallet, matching the pattern already seen on China's and Philippines' business
// flows dropping channels the individual flow has. Neither channel's full flow has been
// recorded yet, so both are left as test.fixme placeholders with just the shared lead-in
// wired up (business tab switch → select country → verify default channel), same
// convention as 1-individual-vietnam-fx.spec.js's Instant Card Payout placeholder.
//
// To implement either: remove `.fixme`, then follow 2-business-philipines-fx.spec.js as
// the template — switchToBusinessTab, selectBusinessDestinationCountryByTestId, amount,
// addBusinessPayee, banking (fxPage.enterVnBankDepositDetails for Bank Deposit /
// fxPage.linkCardAndCaptureApi for Instant Card Payout), review, confirm, ledger check.
require('../state-suite-env');

const { test } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

test.describe('Bu-web FX — Vietnam, business payee', () => {
  test.fixme('Sends a new FX transaction to a Vietnam business payee via Bank Deposit', async ({ page }) => {
    const fxPage = new FxTransactionPage(page);
    const userData = resolveBuWebUserDataForLogin();
    await loginBuWebWithEmail({ page, userData });
    await fxPage.navigateToCreateFxTransactionUserWeb();
    await fxPage.switchToBusinessTab();
    await fxPage.selectBusinessDestinationCountryByTestId('VN');
    await fxPage.verifyDeliverToSelected('Bank Deposit');
    // TODO(fill later): enter amount → continue → add business payee → enter Bank
    // Deposit banking details → confirm → assert paymentIdentifier → verify Processing →
    // ledger check.
  });

  test.fixme('Sends a new FX transaction to a Vietnam business payee via Instant Card Payout', async ({ page }) => {
    const fxPage = new FxTransactionPage(page);
    const userData = resolveBuWebUserDataForLogin();
    await loginBuWebWithEmail({ page, userData });
    await fxPage.navigateToCreateFxTransactionUserWeb();
    await fxPage.switchToBusinessTab();
    await fxPage.selectBusinessDestinationCountryByTestId('VN');
    await fxPage.verifyDeliverToSelected('Bank Deposit');
    await fxPage.selectDeliverToOption('Instant Card Payout');
    // TODO(fill later): enter amount → continue → add business payee → link card
    // (fxPage.linkCardAndCaptureApi) → confirm → assert paymentIdentifier → verify
    // Processing → ledger check.
  });
});
