class BuWebGetStartedPage {
  constructor(page) {
    this.page = page;
    this.firstNameInput    = page.getByTestId('getstarted-firstname-input');
    this.lastNameInput     = page.getByTestId('getstarted-lastname-input');
    this.companyInput      = page.getByTestId('getstarted-company-input');
    this.hearAboutSelect   = page.getByTestId('getstarted-hearabout-select');
    this.websiteInput      = page.getByTestId('getstarted-website-input');
    this.socialMediaInput  = page.getByTestId('getstarted-socialmedia-input');
    this.continueButton    = page.getByTestId('getstarted-continue-button');
  }

  async fill({ firstName, lastName, company, hearAbout, website, socialMedia }) {
    await this.firstNameInput.fill(firstName);
    await this.lastNameInput.fill(lastName);
    await this.companyInput.fill(company);
    await this.hearAboutSelect.click();
    await this.page.getByTestId(`getstarted-hearabout-option-${hearAbout}`).click();
    await this.websiteInput.fill(website);
    await this.socialMediaInput.fill(socialMedia);
  }

  async clickContinue() {
    await this.continueButton.click();
  }
}

module.exports = BuWebGetStartedPage;
