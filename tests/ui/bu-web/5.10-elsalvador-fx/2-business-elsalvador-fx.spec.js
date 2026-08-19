// Bu-web FX — El Salvador, business payee. Not recorded at all yet (unlike
// 5.9-vietnam-fx's business file, where a live probe at least confirmed the channel
// list) — the individual-payee draft this suite was built from only noted "same [cause]
// for business tab" with no further detail. Left as a single test.fixme placeholder with
// just the Business-tab switch wired up; the available deliver-to channels still need a
// live probe before the rest of the flow can be filled in.
//
// To implement: remove `.fixme`, probe the deliver-to dropdown for the channel list
// (expect BCR Pay and/or Bank Deposit, mirroring the individual flow — see
// 2-business-philipines-fx.spec.js / 2-china-businesspayee-fx.spec.js for the shape
// other countries' business flows take), then follow the individual file's banking
// methods (fxPage.enterSvBcrPayDetailsByTestId / fxPage.enterSvBankDepositDetails).
require('../state-suite-env');

const { test } = require('../../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../../utils/ui-login-helper');
const FxTransactionPage = require('../../../../pages/FxTransactionPage');

test.describe('Bu-web FX — El Salvador, business payee', () => {
  test.fixme('Sends a new FX transaction to an El Salvador business payee', async ({ page }) => {
    const fxPage = new FxTransactionPage(page);
    const userData = resolveBuWebUserDataForLogin();
    await loginBuWebWithEmail({ page, userData });
    await fxPage.navigateToCreateFxTransactionUserWeb();
    await fxPage.switchToBusinessTab();
    await fxPage.selectBusinessDestinationCountryByTestId('SV');
    // TODO(fill later): probe the deliver-to dropdown for the channel list, verify the
    // default channel, enter amount → continue → add business payee → banking details →
    // confirm → assert paymentIdentifier → verify Processing → ledger check.
  });
});
