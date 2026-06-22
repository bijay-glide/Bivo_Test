require('./state-suite-env');
const { test } = require('../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../utils/ui-login-helper');
const LinkedCardPage = require('../../../pages/LinkedCardPage');
const { LINK_CARD_SUCCESS } = LinkedCardPage;

test.describe('Bu-web link card', () => {
  test('Link card: PGW success identifier', async ({ page, request }) => {
    test.setTimeout(180000);

    const userData = resolveBuWebUserDataForLogin();
    const linkedCard = new LinkedCardPage(page);

    console.log('══════════════════════════════════════════════');
    console.log('  1.6 Link Card — loaded state');
    console.log('══════════════════════════════════════════════');
    console.log('  email             :', userData.email);
    console.log('  accountNumber     :', userData.accountNumber);
    console.log('  encodedTotpSecret :', userData.encodedTotpSecret);
    console.log('══════════════════════════════════════════════');

    await test.step('Step 1 | Sign in to bu-web', async () => {
      await loginBuWebWithEmail({ page, userData });
    });

    await test.step('Step 2 | Move Money → Link Card landing', async () => {
      await linkedCard.navigateToLinkCardUserWeb();
    });

    await test.step('Step 3 | Link instantly — vault form + POST /pgw/v1/card success', async () => {
      await linkedCard.openLinkCardInstantly();
      const { body } = await linkedCard.fillVaultAndSubmitCapturingPgwCardApi(LINK_CARD_SUCCESS);
      LinkedCardPage.assertPgwCardSuccess(body);
    });
  });
});
