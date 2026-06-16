class BuWebAgreementsPage {
  constructor(page) {
    this.page = page;
    this.authorizedRepCheckbox    = page.getByTestId('agreementcertification-authorizedrep-checkbox');
    this.accountAgreementCheckbox = page.getByTestId('agreementcertification-accountagreement-checkbox');
    this.privacyPolicyCheckbox    = page.getByTestId('agreementcertification-privacypolicy-checkbox');
    this.certificationCheckbox    = page.getByTestId('businessverification-certification-checkbox');
    this.continueButton           = page.getByRole('button', { name: 'Continue' });
  }

  // Checks all three agreement checkboxes and clicks Continue (triggers /agreement/accepted PUT)
  async acceptAgreementsAndContinue() {
    await this.authorizedRepCheckbox.click();
    await this.accountAgreementCheckbox.click();
    await this.privacyPolicyCheckbox.click();
    await this.continueButton.click();
  }

  // Checks the final certification checkbox and clicks Continue (triggers /document/submitted PUT)
  async acceptFinalCertificationAndContinue() {
    await this.certificationCheckbox.click();
    await this.continueButton.click();
  }
}

module.exports = BuWebAgreementsPage;
