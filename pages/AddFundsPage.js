const { expect } = require('@playwright/test');

/**
 * AddFundsPage
 *
 * Covers the "Add Funds" flow from bank selection through to verifying the
 * pending transaction in the wallet ledger:
 *   Select bank → Enter amount → Review → Transfer → Confirm → Ledger check
 */
class AddFundsPage {
  constructor(page) {
    this.page = page;

    // Bank selection
    this.chaseAccountButton = page.getByRole('button', { name: 'Chase ************' });

    // Amount entry
    this.amountInput  = page.getByRole('textbox');
    this.nextButton   = page.getByRole('button', { name: 'Next' });

    // Review screen
    this.reviewHeading    = page.getByRole('heading');
    this.reviewTable      = page.getByRole('table');
    this.transferButton   = page.getByRole('button', { name: 'Transfer' });

    // Success screen
    this.gotItButton = page.getByRole('button', { name: 'Got it' });

    // Wallet ledger — first wallet link regardless of account number suffix
    this.walletLink = page.locator('a.list-item div span.sub-item').first();
    this.ledger     = page.locator('tbody');
  }

  /**
   * Select the Chase linked account from the bank picker.
   * Waits for the button to be visible (the page may still be fetching the
   * list of linked accounts when we arrive here).
   */
  async selectChaseAccount() {
    await this.chaseAccountButton.waitFor({ state: 'visible', timeout: 15000 });
    await this.chaseAccountButton.click();
    await expect(this.page.locator('#root')).toContainText('************0000');
  }

  /**
   * Type the deposit amount and proceed to the review screen.
   *
   * @param {string} amount  e.g. '$90.00'
   */
  async enterAmountAndProceed(amount) {
    await this.amountInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.amountInput.fill(amount);
    await this.nextButton.click();
  }

  /**
   * Assert the review screen content and click Transfer.
   */
  async reviewAndConfirmTransfer() {
    await expect(this.reviewHeading).toContainText("Let’s Review!", { timeout: 10000 });
    await expect(this.reviewTable).toContainText(
      'Next day for investments. In up to 5 business days for withdrawals.'
    );
    await this.transferButton.click();
  }

  /**
   * Assert the success banner and dismiss it.
   *
   * @param {string} amount  Same amount passed to enterAmountAndProceed, e.g. '$90.00'
   */
  async confirmTransferSuccess(amount) {
    await expect(this.page.locator('#root')).toContainText(
      `A transfer of ${amount} has been initiated from your Chase account.`,
      { timeout: 15000 }
    );
    await this.gotItButton.click();
  }

  /**
   * Navigate to the wallet and assert the transaction is listed as PENDING.
   *
   * @param {string} amount  e.g. '$90.00'
   */
  async verifyPendingTransaction(amount) {
    await this.walletLink.waitFor({ state: 'visible', timeout: 10000 });
    await this.walletLink.click();
    await expect(this.ledger).toContainText(amount);
    await expect(this.ledger).toContainText('PENDING');
    await this.page.getByRole('cell', { name: 'PENDING' }).first().click();
  }
}

module.exports = AddFundsPage;
