require('./state-suite-env');
const { test } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const LinkedCardPage = require('../../../pages/LinkedCardPage');
const { LINK_CARD_SUCCESS } = LinkedCardPage;

test.describe('User-web link card', () => {
  test('Link card: PGW success identifier', async ({ page, request }) => {
    test.setTimeout(180000);

    const linkedCard = new LinkedCardPage(page);
    const userData = resolveUserDataForLogin();

    await test.step('Step 1 | Login to user-web', async () => {
      await loginUserWebWithPhone({ page, request, userData });
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
