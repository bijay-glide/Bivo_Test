class BuWebBusinessVerificationPage {
  constructor(page) {
    this.page = page;
    this.verificationLink     = page.getByRole('link', { name: 'Business Verification Business Verification' });
    this.businessRegDocAccordion = page.locator('div').filter({ hasText: /^Business Registration Document$/ }).first();
    this.businessRegDocCloseBtn  = page.getByRole('heading', { name: 'Business Registration Document' }).getByRole('button');
    this.beneficialOwnerSection  = page.getByText('Beneficiary Details / Key');
    this.additionalInfoSection   = page.locator('div').filter({ hasText: /^Additional Information$/ }).first();
    this.agreementsSection       = page.locator('div').filter({ hasText: /^Agreements & Certifications$/ }).first();
  }

  async goto() {
    await this.verificationLink.click();
  }

  async openBusinessRegistrationDoc() {
    await this.businessRegDocAccordion.click();
  }

  async closeBusinessRegistrationDoc() {
    await this.businessRegDocCloseBtn.click();
  }

  async openBeneficialOwnerSection() {
    await this.beneficialOwnerSection.click();
  }

  async openAdditionalInfoSection() {
    await this.additionalInfoSection.click();
  }

  async openAgreementsSection() {
    await this.agreementsSection.click();
  }
}

module.exports = BuWebBusinessVerificationPage;
