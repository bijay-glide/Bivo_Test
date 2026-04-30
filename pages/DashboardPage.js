// Post-login sidebar. SPA refetches can reset the nav mid-click; we wait after load + buffer,
// then settle after clicks. AchLinkPage retries if a sub-link still collapses.
class DashboardPage {
  constructor(page) {
    this.page = page;

    this.depositFundsLink     = page.getByRole('link', { name: 'Deposit Funds' });
    this.moveMoneyLinkUserWeb = page.getByRole('link', { name: 'Move Money' });
    this.addFundsLink         = page.getByRole('link', { name: 'Add Funds Add Funds' });
    this.accountsTransactLink = page.getByRole('link', { name: 'Accounts' });
  }

  // load + 2s so initial dashboard XHRs finish before sidebar clicks (avoid networkidle on SPAs).
  async waitForDashboardReady() {
    await this.page.waitForLoadState('load', { timeout: 30000 });
    await this.page.waitForTimeout(2000);
  }

  // Brief settle after expanding sidebar (domcontentloaded + buffer; no networkidle).
  async waitForSidebarSettledAfterClick() {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1500);
  }

  async goToDepositFunds() {
    await this.waitForDashboardReady();
    await this.depositFundsLink.waitFor({ state: 'visible', timeout: 15000 });
    await this.depositFundsLink.click();
    await this.waitForSidebarSettledAfterClick();
  }

  // User-web shell (not BCR deposit-funds).
  async goToMoveMoneyUserWeb() {
    await this.waitForDashboardReady();
    await this.moveMoneyLinkUserWeb.waitFor({ state: 'visible', timeout: 15000 });
    await this.moveMoneyLinkUserWeb.click();
    await this.waitForSidebarSettledAfterClick();
  }

  async goToAddFunds() {
    await this.waitForDashboardReady();
    await this.addFundsLink.waitFor({ state: 'visible', timeout: 15000 });
    await this.addFundsLink.click();
    await this.waitForSidebarSettledAfterClick();
  }

  async goToAccountsTransactions() {
    await this.accountsTransactLink.waitFor({ state: 'visible', timeout: 10000 });
    await this.accountsTransactLink.click();
    await this.waitForSidebarSettledAfterClick();
  }
}

module.exports = DashboardPage;
