class BuWebAdditionalInfoPage {
  constructor(page) {
    this.page = page;
    this.continueButton = page.getByRole('button', { name: 'Continue' });
  }

  // Selects yesterday's date in the "date established" calendar picker
  async fillDateEstablished() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const yyyy = yesterday.getFullYear();
    const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const dd = String(yesterday.getDate()).padStart(2, '0');
    await this.page.getByTestId('additionalinfo-dateestablished-input').click();
    await this.page.getByTestId(`additionalinfo-dateestablished-day-${yyyy}-${mm}-${dd}`).click();
    await this.page.getByRole('button', { name: 'OK' }).click();
  }

  // Company details sub-step — fills dropdowns and clicks Continue to next sub-step
  async fillCompanyDetailsAndContinue({ ein, stateOfIncorporation, companyType, annualRevenue, industry, subIndustry, location, employeeRange, fundingSize }) {
    await this.page.getByText('EIN').click();
    //data-testid="additionalinfo-business-id-type-option-EIN"
    await this.page.getByRole('textbox', { name: 'Enter business EIN' }).fill(ein);
    await this.page.getByRole('button', { name: 'Select state of incorporation' }).click();
    await this.page.getByRole('button', { name: stateOfIncorporation }).click();
    await this.page.getByRole('button', { name: 'Select company type' }).click();
    await this.page.getByRole('button', { name: companyType, exact: true }).click();
    await this.page.getByRole('button', { name: 'Select annual revenue' }).click();
    await this.page.getByRole('button', { name: annualRevenue }).click();
    await this.page.getByRole('button', { name: 'Select industry' }).click();
    await this.page.getByRole('button', { name: industry }).click();
    await this.page.getByRole('button', { name: 'Select sub industry' }).click();
    await this.page.getByRole('button', { name: subIndustry }).click();
    await this.page.getByRole('button', { name: 'Select location' }).click();
    await this.page.getByRole('button', { name: location }).click();
    await this.page.getByRole('button', { name: 'Select one' }).first().click();
    await this.page.getByRole('button', { name: employeeRange }).click();
    await this.page.getByRole('button', { name: 'Select one' }).click();
    await this.page.getByRole('button', { name: fundingSize }).click();
    await this.continueButton.click();
  }

  // Funding description sub-step — selects source, fills description, clicks Continue (triggers /additional/info API)
  async fillFundingDescriptionAndContinue({ fundingSource, description }) {
    await this.page.getByText(fundingSource).click();
    await this.page.getByRole('textbox', { name: "Please describe your company'" }).fill(description);
    await this.continueButton.click();
  }
}

module.exports = BuWebAdditionalInfoPage;
