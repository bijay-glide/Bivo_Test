const { expect } = require('@playwright/test');

/**
 * Shared "Let's Review!" screen — internal money-movement flows (Move Money,
 * Withdraw Funds, Link Card / Add Funds via card, Add Funds via ACH deposit)
 * all render the same transfer-review-* component.
 */
class TransferReviewPage {
  constructor(page) {
    this.page = page;

    this.heading = page.getByRole('heading');

    this.amountLabel    = page.getByTestId('transfer-review-amount-label');
    this.amountValue    = page.getByTestId('transfer-review-amount-value');
    this.fromLabel      = page.getByTestId('transfer-review-from-label');
    this.fromValue      = page.getByTestId('transfer-review-from-value');
    this.toLabel        = page.getByTestId('transfer-review-to-label');
    this.toValue        = page.getByTestId('transfer-review-to-value');
    this.availableLabel = page.getByTestId('transfer-review-available-label');
    this.availableValue = page.getByTestId('transfer-review-available-value');
  }

  async verifyHeading() {
    await expect(this.heading).toContainText(/Let.s Review!/);
  }

  /** Each field is optional — pass only what the calling flow needs asserted. */
  async verifyFields({ amount, from, to, available } = {}) {
    if (amount != null) {
      await expect(this.amountLabel).toContainText('Amount:');
      await expect(this.amountValue).toContainText(amount);
    }
    if (from != null) {
      await expect(this.fromLabel).toContainText('From:');
      await expect(this.fromValue).toContainText(from);
    }
    if (to != null) {
      await expect(this.toLabel).toContainText('To:');
      await expect(this.toValue).toContainText(to);
    }
    if (available != null) {
      await expect(this.availableLabel).toContainText('Available:');
      await expect(this.availableValue).toContainText(available);
    }
  }

  async verify(fields = {}) {
    await this.verifyHeading();
    await this.verifyFields(fields);
  }
}

module.exports = TransferReviewPage;
