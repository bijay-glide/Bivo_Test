require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginUserWebWithPhone, resolveUserDataForLogin } = require('../../../utils/ui-login-helper');
const { saveExtendedState, loadSignupData } = require('../../../utils/shared-state');
const LinkedCardPage = require('../../../pages/LinkedCardPage');
const UserWebCardFundsPage = require('../../../pages/UserWebCardFundsPage');
const { LINK_CARD_SUCCESS } = LinkedCardPage;

const CARD_FUNDS_AMOUNT     = '$90.00';
const CARD_FUNDS_AMOUNT_USD = '90.00';

// .serial() so Test 2 depends on Test 1 having actually passed: if the PGW card-link
// call fails (e.g. the 500 errors seen from the sandbox), Playwright auto-skips Test 2
// instead of silently running it against a stale/previously-linked card.
test.describe.serial('User-web — Linked card', () => {
  test.describe.configure({ retries: 1 });

  // ── 1. Link card ──────────────────────────────────────────────────────────

  test('Link card: PGW success identifier', async ({ page, request }) => {
    test.setTimeout(180000);

    const linkedCard    = new LinkedCardPage(page);
    const cardFundsPage = new UserWebCardFundsPage(page);
    const userData      = resolveUserDataForLogin();

    await test.step('Step 1 | Login to user-web', async () => {
      await loginUserWebWithPhone({ page, request, userData });
    });

    await test.step('Step 2 | Move Money → Link Card landing', async () => {
      await linkedCard.navigateToLinkCardUserWeb();
    });

    await test.step('Step 3 | Link instantly — vault form + POST /pgw/v1/card success', async () => {
      await linkedCard.openLinkCardInstantly();
      const { response, body } = await linkedCard.fillVaultAndSubmitCapturingPgwCardApi(LINK_CARD_SUCCESS);
      LinkedCardPage.assertPgwCardSuccess(response, body);
    });

    await test.step('Step 4 | Discover linked card via accountbalance API and save to shared state', async () => {
      // The card is now registered — discover its account details and persist
      // so Test 2 can use them without a separate discovery call.
      const card = await cardFundsPage.discoverLinkedCardAccount();
      saveExtendedState({
        linkedCardAccountNumber: card.accountNumber,
        linkedCardLast4:         card.last4,
        linkedCardAccountName:   card.accountName,
      });
      console.log(
        `[link-card] card registered: "${card.accountName}"` +
        ` (${card.accountNumber}), last4: ${card.last4}`,
      );
    });
  });

  // ── 2. Add funds from linked card + verify Card AFT in Bivo ───────────────

  test('Add funds from linked card and verify Card AFT transaction in Bivo', async ({ page, request }) => {
    test.setTimeout(180000);

    const cardFundsPage = new UserWebCardFundsPage(page);
    let userData        = resolveUserDataForLogin();

    let bivoAccountNumber = userData.accountNumber || '';
    let bivoLast4         = '';
    let cardAccount       = null;
    let requestId         = null;

    // Guard: card must have been linked and persisted by Test 1 in this session. If that
    // flag is missing (e.g. running this spec standalone, or Test 1's step 4 didn't
    // complete), discover the linked card live via API instead of trusting the cache —
    // but keep logging in as the SAME onboarded user as Test 1, not a different fixture.
    let sharedState = {};
    try { sharedState = loadSignupData(); } catch { /* state file missing */ }
    const useLiveDiscovery = !sharedState.linkedCardAccountNumber;
    if (useLiveDiscovery) {
      console.warn('[card-funds] linkedCardAccountNumber not found in shared state — discovering linked card live for the current user');
    }

    await test.step('Step 1 | Login to user-web', async () => {
      const loginResult = await loginUserWebWithPhone({ page, request, userData });
      bivoAccountNumber = loginResult?.bivo_account_number || bivoAccountNumber;
      const bivoDda     = loginResult?.bivo_dda_number     || userData.ddaNumber || '';
      bivoLast4         = String(bivoDda).slice(-4);
      expect(bivoAccountNumber, 'Bivo account number should be available after login').toBeTruthy();
      expect(bivoLast4, 'Bivo DDA last4 should be derivable for sidebar navigation').toBeTruthy();
    });

    cardAccount = useLiveDiscovery
      ? await cardFundsPage.discoverLinkedCardAccount()
      : {
          accountNumber: sharedState.linkedCardAccountNumber,
          last4:         sharedState.linkedCardLast4,
          accountName:   sharedState.linkedCardAccountName || 'Card account',
        };

    await test.step('Step 2 | Navigate to Move Money → Add Funds → Card tab', async () => {
      await cardFundsPage.navigateToAddFundsCardTab();
    });

    await test.step('Step 3 | Select linked card as "From" account', async () => {
      await cardFundsPage.selectCardFromAccount(cardAccount.last4);
    });

    await test.step(`Step 4 | Enter amount (${CARD_FUNDS_AMOUNT}) and proceed to review`, async () => {
      await cardFundsPage.enterAmountAndContinue(CARD_FUNDS_AMOUNT);
    });

    await test.step('Step 5 | Verify review screen', async () => {
      await cardFundsPage.assertReviewScreen({ amountDisplay: CARD_FUNDS_AMOUNT });
    });

    await test.step('Step 6 | Submit transfer and verify move-fund API', async () => {
      const captured = await cardFundsPage.submitAndCaptureMoveFundApi();
      requestId = captured.requestId;
      cardFundsPage.assertMoveFundApiCaptured(captured, {
        cardAccountNumber: cardAccount.accountNumber,
        bivoAccountNumber,
        amountUsd: CARD_FUNDS_AMOUNT_USD,
      });
    });

    await test.step('Step 7 | Verify transfer complete screen', async () => {
      await cardFundsPage.assertTransferCompleteScreen({ amountDisplay: CARD_FUNDS_AMOUNT });
    });

    await test.step('Step 8 | Navigate to Bivo account and verify Card AFT transaction', async () => {
      const { transactions } = await cardFundsPage.navigateToBivoAccountAndCaptureTransactions({
        bivoLast4,
        bivoAccountNumber,
      });
      await cardFundsPage.assertCardAftTransaction({
        initialTransactions: transactions,
        bivoAccountNumber,
        requestId,
        amountUsd: CARD_FUNDS_AMOUNT_USD,
      });
    });
  });
});
