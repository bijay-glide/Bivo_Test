const { expect } = require('@playwright/test');

/**
 * Shared "Review" screen — external/beneficiary payment flows (Wire Payment,
 * US ACH beneficiary payment) render the same otherinternal-review-* component.
 */
class OtherInternalReviewPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByTestId('otherinternal-review-title');

    this.recipientLabel     = page.getByTestId('otherinternal-review-label-recipient');
    this.recipientValue     = page.getByTestId('otherinternal-review-value-recipient');
    this.accountNumberLabel = page.getByTestId('otherinternal-review-label-acc-number');
    this.accountNumberValue = page.getByTestId('otherinternal-review-value-acc-number');
    this.routingNumberLabel = page.getByTestId('otherinternal-review-label-routing-number');
    this.routingNumberValue = page.getByTestId('otherinternal-review-value-routing-number');
    this.amountLabel        = page.getByTestId('otherinternal-review-label-amount');
    this.amountValue        = page.getByTestId('otherinternal-review-value-amount');
    this.payViaLabel        = page.getByTestId('otherinternal-review-label-pay-via');
    this.payViaValue        = page.getByTestId('otherinternal-review-value-pay-via');
    this.requestedDateLabel = page.getByTestId('otherinternal-review-label-req-date');
    this.requestedDateValue = page.getByTestId('otherinternal-review-value-req-date');
  }

  async verifyHeading() {
    await expect(this.heading).toContainText('Review');
  }

  /** Each field is optional — pass only what the calling flow needs asserted. */
  async verifyFields({ recipient, accountNumber, routingNumber, amount, paymentVia, requestedDate } = {}) {
    if (recipient != null) {
      await expect(this.recipientLabel).toContainText('Recipient');
      await expect(this.recipientValue).toContainText(recipient);
    }
    if (accountNumber != null) {
      await expect(this.accountNumberLabel).toContainText('Account number');
      await expect(this.accountNumberValue).toContainText(accountNumber);
    }
    if (routingNumber != null) {
      await expect(this.routingNumberLabel).toContainText('Routing number');
      await expect(this.routingNumberValue).toContainText(routingNumber);
    }
    if (amount != null) {
      await expect(this.amountLabel).toContainText('Amount');
      await expect(this.amountValue).toContainText(amount);
    }
    if (paymentVia != null) {
      await expect(this.payViaLabel).toContainText('Payment via');
      await expect(this.payViaValue).toContainText(paymentVia);
    }
    if (requestedDate != null) {
      await expect(this.requestedDateLabel).toContainText('Requested date');
      await expect(this.requestedDateValue).toContainText(requestedDate);
    }
  }

  async verify(fields = {}) {
    await this.verifyHeading();
    await this.verifyFields(fields);
  }
}

module.exports = OtherInternalReviewPage;
