require('./state-suite-env');
const { test, expect } = require('../../../fixtures/ui-fixtures');
const { loginBuWebWithEmail, resolveBuWebUserDataForLogin } = require('../../../utils/ui-login-helper');
const { depositFundsViaWire } = require('../../../utils/transaction-helper');
const { toCentsInput, formatUsdDisplay } = require('../../../utils/amount-input');
const { generateUsPaymentPayee } = require('../../../utils/test-data-generator');
const UsAchPaymentPage = require('../../../pages/UsAchPaymentPage');

// Amount stays fixed so it lines up with the pre-funded balance and the review assertion.
const AMOUNT_USD = '90.00';
const INSTRUCTION = 'Hello i sent some money';

// Two scenarios — identical flow, only the send method, review label, and the
// settled transactions-API status differ (WIRE → PENDING, ACH → CONFIRMED).
const CHANNELS = [
  { type: 'WIRE', paymentVia: 'Wire Transfer', expectedTxStatus: 'PENDING' },
  { type: 'ACH', paymentVia: 'ACH', expectedTxStatus: 'CONFIRMED' },
];

test.describe('Bu-web US Payment', () => {
  for (const channel of CHANNELS) {
    test(`Create US ${channel.type} payment and verify beneficiary + transfer APIs`, async ({ page, request }) => {
      test.setTimeout(150000);

      const userData = resolveBuWebUserDataForLogin();
      const usPaymentPage = new UsAchPaymentPage(page);
      const expectedToday = UsAchPaymentPage.formatReviewDate();
      const amountInputValue = toCentsInput(AMOUNT_USD);
      const amountDisplay = formatUsdDisplay(AMOUNT_USD);
      // Fresh, unique payee per scenario — keeps the Wire and ACH rows distinct.
      const payee = generateUsPaymentPayee();
      const { firstName, lastName } = payee;

      console.log('══════════════════════════════════════════════');
      console.log(`  1.5 US ${channel.type} Payment — loaded state`);
      console.log('══════════════════════════════════════════════');
      console.log('  email             :', userData.email);
      console.log('  accountNumber     :', userData.accountNumber);
      console.log('  payee             :', `${firstName} ${lastName}`);
      console.log('  bankAccount       :', payee.bankAccountNumber);
      console.log('══════════════════════════════════════════════');

      const bivoAccountNumber = userData.accountNumber || '';

      await test.step('Step 1 | Sign in to bu-web', async () => {
        await loginBuWebWithEmail({ page, userData });
      });

      await test.step('Step 2 | Pre-fund account via wire API', async () => {
        await depositFundsViaWire(request, bivoAccountNumber, { amount: 50000 }); // $500 (covers $90 transfer)
      });

      await test.step('Step 3 | Navigate to Payments → Add Payee', async () => {
        await usPaymentPage.navigateToAddPayeeInternal();
      });

      // ── USPAyment-UserDetails_APICHeck.har ──
      await test.step('Step 4 | Add payee details (verify personal-info API)', async () => {
        const { referenceId } = await usPaymentPage.addPayeeDetailsAndCaptureApi({
          firstName,
          lastName,
          addressOne: payee.addressOne,
          city: payee.city,
          state: payee.state,
          postalCode: payee.postalCode,
        });
        expect(referenceId, 'personal-info should return a referenceId').toBeTruthy();
      });

      // ── USPAyment-AccountDetails_APICHeck.har ──
      // beneficiaryAccountNumber (internal) is reused to assert transfer-fund's toAccount below.
      let beneficiaryAccountNumber = '';
      await test.step('Step 5 | Add bank account details (verify account API)', async () => {
        const { state, beneficiaryAccountNumber: acct } = await usPaymentPage.addBankAccountAndCaptureApi({
          bankAccountNumber: payee.bankAccountNumber,
          routingCode: payee.routingNumber,
        });
        expect(state, 'beneficiary account should be APPROVED').toBe('APPROVED');
        expect(acct, 'beneficiary account API should return an accountNumber').toBeTruthy();
        beneficiaryAccountNumber = acct;
      });

      await test.step(`Step 6 | Select ${channel.type} send method`, async () => {
        await usPaymentPage.selectSendMethodAndContinue(channel.type);
      });

      await test.step('Step 7 | Fill amount, instruction, frequency and continue', async () => {
        await usPaymentPage.fillExecutionDetailsAndContinue({ amountInputValue, instruction: INSTRUCTION });
      });

      await test.step('Step 8 | Verify review screen', async () => {
        await usPaymentPage.verifyUsPaymentReview({
          firstName,
          lastName,
          bankAccountNumber: payee.bankAccountNumber,
          routingNumber: payee.routingNumber,
          amountDisplay,
          paymentVia: channel.paymentVia,
          expectedToday,
        });
      });

      // ── USPAYMENT-transferAPI.har ──
      let transferIdentifier = null;
      await test.step('Step 9 | Submit transfer (verify transfer-fund API)', async () => {
        const { request: req, identifier, status } = await usPaymentPage.submitBusinessTransferAndCaptureApi();
        transferIdentifier = identifier;

        expect(identifier, 'transfer-fund should return an identifier').toBeTruthy();
        expect(status, 'transfer-fund status should be PENDING').toBe('PENDING');
        expect(req.type, `transfer-fund type should be ${channel.type}`).toBe(channel.type);
        expect(String(req.amount), 'transfer-fund amount should match').toBe(Number(AMOUNT_USD).toFixed(2));
        // toAccount === the internal beneficiary account returned by the account API.
        expect(String(req.toAccount), 'transfer-fund toAccount should match beneficiary account').toBe(
          String(beneficiaryAccountNumber),
        );
        if (bivoAccountNumber) {
          expect(String(req.fromAccount), 'transfer-fund fromAccount should be the Bivo account').toBe(
            String(bivoAccountNumber),
          );
        }
      });

      await test.step('Step 10 | Verify the transfer in the account transactions API', async () => {
        await usPaymentPage.assertBusinessTransferInTransactionsApi({
          accountNumber: bivoAccountNumber,
          correlationId: transferIdentifier,
          amountUsd: AMOUNT_USD,
          expectedStatus: channel.expectedTxStatus,
        });
      });
    });
  }
});
