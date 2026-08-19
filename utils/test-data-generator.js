/**
 * Test Data Generator for User Registration
 */

const { faker } = require('@faker-js/faker');
const { toCentsInput, formatUsdDisplay } = require('./amount-input');

// Allowed US area codes for signup tests.
const ALLOWED_SIGNUP_AREA_CODES = ['212', '415', '646'];
const generatedPhoneNumbers = new Set();

/**
 * Generates a random numeric string of the given length
 */
function generateRandomDigits(length) {
  return Math.floor(Math.random() * Math.pow(10, length))
    .toString()
    .padStart(length, '0');
}

function generateSignupEmail(firstName, lastName) {
  const safeFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const safeLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
  return `automation.${safeFirst}.${safeLast}.${generateRandomDigits(4)}@example.com`;
}

/**
 * NANP exchange code (NXX): first digit 2-9; excludes reserved N11 patterns.
 * @returns {string}
 */
function generateValidExchangeCode() {
  let exchange;
  do {
    exchange = (Math.floor(Math.random() * 800) + 200).toString(); // 200-999
  } while (exchange[1] === '1' && exchange[2] === '1');
  return exchange;
}

/**
 * Generates a unique phone number for the current run, using approved area codes.
 * Format: AAAXXXYYYY where AAA is in ALLOWED_SIGNUP_AREA_CODES.
 *
 * @param {string[]} areaCodes
 * @returns {string}
 */
function generateUniqueSignupPhoneNumber(areaCodes = ALLOWED_SIGNUP_AREA_CODES) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];
    const exchange = generateValidExchangeCode();
    const lineNumber = generateRandomDigits(4);
    const phoneNumber = `${areaCode}${exchange}${lineNumber}`;

    if (!generatedPhoneNumbers.has(phoneNumber)) {
      generatedPhoneNumbers.add(phoneNumber);
      return phoneNumber;
    }
  }

  throw new Error('Unable to generate a unique signup phone number');
}

// Beneficiary/business address forms only accept letters, numbers, and spaces — faker
// sometimes builds street/city names from surnames (e.g. "348 O'Conner Neck"), which trips
// that validation and leaves Continue disabled. Strip everything else out.
const sanitizeAddressText = (value) => value.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function generateRandomStreetAddress() {
  return sanitizeAddressText(faker.location.streetAddress());
}

function generateRandomCity() {
  return sanitizeAddressText(faker.location.city());
}

function generateRandomBirthYear() {
  return faker.date.birthdate({ min: 24, max: 55, mode: 'age' }).getFullYear().toString();
}

/**
 * Random fake SSN-shaped value using the 555-xx-xxxx test range (full XXX-XX-XXXX string).
 * Needed so UI validation enables Next on both masked and full-format fields.
 * @returns {string}
 */
function generateRandomSSN() {
  const mid = generateRandomDigits(2);
  const last = generateRandomDigits(4);
  return `555-${mid}-${last}`;
}

/**
 * Generates complete test data for user registration
 * @param {object} [options]
 * @param {string} [options.firstName] - Override the randomized first name.
 * @returns {object} Test data object
 */
function generateUserTestData(options = {}) {
  const firstName = options.firstName || faker.person.firstName();
  // faker ~5% of the time returns compound surnames (e.g. "Hackett-Reynolds");
  // strip spaces/dashes/apostrophes so the name stays a single clean word.
  const lastName = faker.person.lastName().replace(/[ '-]/g, '');
  const phoneNumber = generateUniqueSignupPhoneNumber();
  const email = generateSignupEmail(firstName, lastName);

  return {
    // 10-digit US — no +1 prefix (UI and OTP use this as-is)
    phoneNumber,

    // Personal Info (randomized)
    firstName: firstName,
    lastName: lastName,
    email: email,

    // Address (randomized except state, aptSuite, zipCode)
    streetAddress: generateRandomStreetAddress(),
    aptSuite: 'three', // Fixed
    city: generateRandomCity(),
    state: 'MA', // Fixed
    zipCode: '70112', // Fixed

    // Date of Birth (randomized)
    birthYear: generateRandomBirthYear(),
    dayIndex: Math.floor(Math.random() * 3), // Random day index 0-2

    // SSN (randomized)
    ssnFirst: generateRandomSSN(),
    ssnSecond: generateRandomSSN(),

    // Employment & Investment (fixed)
    employmentStatus: 'Employed',
    investmentGoal: 'Income'
  };
}

/**
 * Generates incoming wire transfer data
 * @param {string} accountNumber - The account number to receive funds
 * @param {object} options - Optional overrides for default values
 * @returns {object} Incoming wire transfer data
 */
function generateIncomingWireData(accountNumber, options = {}) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);

  return {
    accountNumber: options.accountNumber || accountNumber,
    amount: options.amount || 10000,
    description: options.description || 'Test incoming wire transfer',
    correlationId: options.correlationId || `QA-test-txn-${timestamp}-${randomSuffix}`,
    traceId: options.traceId || null,
    provider: options.provider || 'SVB'
  };
}

/**
 * Generates wire instruction data
 * @param {number|string} clientId - The client ID
 * @param {object} options - Optional overrides for default values
 * @returns {object} Wire instruction data
 */
function generateWireInstructionData(clientId, options = {}) {
  const randomDigits = generateRandomDigits(8);
  const businessName = options.businessName || `${faker.person.firstName()} Corp`;

  return {
    clientId: options.clientId || clientId,
    businessName: businessName,
    accountNickname: options.accountNickname || businessName.split(' ')[0],
    streetAddress: options.streetAddress || generateRandomStreetAddress(),
    city: options.city || generateRandomCity(),
    state: options.state || 'NY',
    zipCode: options.zipCode || '10011',
    accountNumber: options.accountNumber || `498493${randomDigits}`,
    wireRoutingNumber: options.wireRoutingNumber || '021000089'
  };
}

/**
 * Generates withdraw fund data
 * @param {number|string} clientId - The client ID
 * @param {string} wireInstructionsId - The wire instruction identifier
 * @param {object} options - Optional overrides for default values
 * @returns {object} Withdraw fund data
 */
function generateWithdrawFundData(clientId, wireInstructionsId, options = {}) {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(7);

  return {
    businessId: options.businessId || null,
    clientId: options.clientId || clientId,
    fromAccount: options.fromAccount || null,
    wireInstructionsId: options.wireInstructionsId || wireInstructionsId,
    amount: options.amount || 1000,
    description: options.description || 'Move fund to other bank own account',
    correlationId: options.correlationId || `QA-withdraw-${timestamp}-${randomSuffix}`
  };
}

/**
 * Generates fresh wire recipient form data for UI tests.
 * Every call produces a unique recipient so parallel/repeated runs don't clash.
 *
 * @param {object} options - Optional field overrides
 * @returns {object} Wire form data
 */
function generateWireFormData(options = {}) {
  const firstName = options.firstName || faker.person.firstName();
  const lastName  = options.lastName  || faker.person.lastName();
  const digits    = generateRandomDigits(10);

  return {
    firstName,
    lastName,
    nickname:      options.nickname      || `${firstName} ${lastName[0]}`,
    streetAddress: options.streetAddress || generateRandomStreetAddress(),
    city:          options.city          || generateRandomCity(),
    state:         options.state         || 'NY',
    zipCode:       options.zipCode       || '10011',
    accountNumber: options.accountNumber || `498493${digits}`,
    routingNumber: options.routingNumber || '021000021',
  };
}

/**
 * Generates wire payment schedule data.
 * requestedDate is computed at call-time so it always matches today's date
 * and never needs manual updating in the test file.
 *
 * @param {object} options - Optional field overrides
 * @returns {object} Payment schedule data
 */
function generateWirePaymentSchedule(options = {}) {
  const requestedDate = new Date().toLocaleDateString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
  });

  return {
    frequency:    options.frequency    || 'One Time Only',
    message:      options.message      || 'Wire transfer test',
    requestedDate: options.requestedDate || requestedDate,
    amountInput:  options.amountInput  || '9000',   // digits typed into field — app formats as $90.00
    amount:       options.amount       || '$90.00',
  };
}

/** Random send amount in USD for user-web FX (keeps run-to-run variation; stay in a safe band for balance). */
function generateRandomSendAmountUsd() {
  const whole = 52 + Math.floor(Math.random() * 34);
  const cents = Math.floor(Math.random() * 100);
  return `${whole}.${String(cents).padStart(2, '0')}`;
}

/**
 * Returns faker-generated extra payee fields for countries that need them,
 * or null for countries whose payee form only asks for name.
 * Add a new case here whenever a new country recording reveals extra fields.
 *
 * @param {string} countryCode
 * @returns {object|null}
 */
function generatePayeeExtraFields(countryCode) {
  switch (countryCode) {
    case 'AU':
      return {
        streetAddress: generateRandomStreetAddress(),
        city: generateRandomCity(),
      };

    case 'NZ':
      return {
        streetAddress: generateRandomStreetAddress(),
        city: generateRandomCity(),
        zipCode: faker.string.numeric(4),  // NZ 4-digit postal code
      };

    case 'CN':
      return {
        streetAddress: generateRandomStreetAddress(),
        city: generateRandomCity(),
        zipCode: faker.string.numeric(6),       // 6-digit Chinese postal code
      };
    case 'IN':
      return {
        streetAddress: generateRandomStreetAddress(),
        city: generateRandomCity(),
        zipCode: faker.string.numeric(6),       // 6-digit Indian PIN code
        phone: IN_TEST_PHONE,
      };
    case 'JP':
      return {
        streetAddress: generateRandomStreetAddress(),
        city: generateRandomCity(),
        zipCode: faker.string.numeric(7),       // 7-digit Japanese postal code
        // The phone field is a country-flag-masked input that defaults to US and only
        // switches once it sees a "+81" prefix in the typed value — a bare local number
        // (no prefix) left it stuck on the US mask ("Invalid phone number for US"),
        // confirmed live. First group must not lead with 0 or the FE's phone validator
        // rejects it ("Invalid phone number for JP").
        phone: `+81 90 ${faker.string.numeric({ length: 4, allowLeadingZeros: false })} ${faker.string.numeric(4)}`,
      };
    default:
      return null;
  }
}

/**
 * Generates extra payee fields for the BUSINESS payee form.
 *
 * The business form always has "Business Name" (handled separately) and may also
 * show Street Address, City, and Zip/Postal Code depending on the country.
 * Fields not present on the form are silently skipped by addBusinessPayee().
 *
 * @param {string} countryCode
 * @returns {{ streetAddress: string, city: string, zipCode: string }}
 */
function generateBusinessPayeeExtraFields(countryCode) {
  // GB confirmed from screenshot; assume all countries follow the same address pattern.
  // addBusinessPayee() uses isVisible() checks so extra fields are skipped when absent.
  const base = {
    streetAddress: generateRandomStreetAddress(),
    city: generateRandomCity(),
  };

  switch (countryCode) {
    case 'IN':
      return {
        ...base,
        zipCode: faker.string.numeric(6),
        phone: IN_TEST_PHONE, // same fixed value used by the individual payee flow
      };
    case 'JP':
      return {
        ...base,
        zipCode: faker.string.numeric(7),
        // The business payee phone field defaults to a US country-code mask and doesn't
        // auto-switch — it needs the full international format (+81 prefix included),
        // unlike the individual payee flow's plain-text phone field. Using the bare
        // JP_TEST_PHONE local number here left the field showing "+1 (323) 456-78" /
        // "Invalid phone number for US" and Continue disabled. First group must not
        // lead with 0 or the FE's phone validator rejects it ("Invalid phone number
        // for JP").
        phone: `+81 90 ${faker.string.numeric({ length: 4, allowLeadingZeros: false })} ${faker.string.numeric(4)}`,
      };
    case 'CN':
      return { ...base, zipCode: faker.string.numeric(6) };
    case 'NZ':
      return { ...base, zipCode: faker.string.numeric(4) };
    default:
      // GB, AU, HK, MX — provide zip; page object skips fields not shown on the form
      return { ...base, zipCode: faker.string.numeric(5) };
  }
}

/**
 * Generates FX transaction form data for UI tests.
 * Beneficiary name, identity number, and country-specific address fields are
 * randomised on every call.
 *
 * @param {object} options
 * @param {string} [options.countryCode]          - ISO alpha-2 destination country (default 'GB'). Drives payeeExtraFields.
 * @param {string} [options.amountUsd]            - Fixed send amount; derives amountInput + amount display.
 * @param {boolean} [options.randomizeSendAmountUsd] - Pick a random amountUsd (ignored if amountUsd is set).
 * @param {string} [options.beneficiaryFirstName] - Alias for firstName.
 * @param {string} [options.beneficiaryLastName]  - Alias for lastName.
 * @returns {object} FX transaction data
 */
function generateFxTransactionData(options = {}) {
  // Strip hyphens, accents, apostrophes — payee name fields accept English letters only.
  const sanitizeName = (n) => n.normalize('NFD').replace(/[^a-zA-Z ]/g, '').trim() || 'Test';
  const firstName =
    options.firstName || options.beneficiaryFirstName || sanitizeName(faker.person.firstName());
  const lastName =
    options.lastName || options.beneficiaryLastName || sanitizeName(faker.person.lastName());

  let amountUsd = null;
  if (options.amountUsd != null && options.amountUsd !== '') {
    amountUsd = Number(options.amountUsd).toFixed(2);
  } else if (options.randomizeSendAmountUsd) {
    amountUsd = generateRandomSendAmountUsd();
  }

  let amountInput;
  let amount;
  if (amountUsd != null) {
    amountInput = options.amountInput ?? toCentsInput(amountUsd);
    amount = options.amount ?? formatUsdDisplay(amountUsd);
  } else {
    amountInput = options.amountInput ?? '5500';
    amount = options.amount ?? '$55.00';
  }

  const countryCode = options.countryCode ?? 'GB';

  return {
    beneficiaryFirstName: firstName,
    beneficiaryLastName: lastName,
    country: options.country ?? 'United Kingdom (GB)',
    iban: options.iban ?? 'GB26542316456541232134',
    identityType: options.identityType ?? 'Passport',
    identityNumber: options.identityNumber ?? generateRandomDigits(7),
    note: options.note !== undefined && options.note !== null ? options.note : 'Sending to the UK',
    amountInput,
    amount,
    amountUsd,
    payeeExtraFields: generatePayeeExtraFields(countryCode),
  };
}

// Static prefix used across all auto-generated numeric banking fields (5 digits).
// Keeps the first digits recognisable as automated test data.
const BIVO_NUMERIC_PREFIX = '98765';

// Fixed, format-valid phone numbers for payee/beneficiary fields (IN, CN). These don't
// need to be unique per run — only the payee's name/account fields do — so a constant
// avoids any chance a random digit trips the FE's phone validator. JP's phone is
// generated fresh per call instead (see generatePayeeExtraFields/
// generateBusinessPayeeExtraFields) — it needs the full "+81 90 ..." international
// format, which a single fixed constant can't represent as cleanly here since the
// leading-zero constraint applies to a randomised middle group, not the whole value.
const IN_TEST_PHONE = '+91 98765 43210';   // 10-digit Indian mobile, starts with 9
const CN_TEST_PHONE = '13812345678';       // 11-digit Chinese mobile, no +86 prefix — system adds it

/**
 * Returns freshly randomised banking-details for the given destination country.
 * Use this in tests instead of the static bankingDetails from COUNTRY_BANKING_CONFIGS.
 *
 * Length rules (all-digit fields):
 *   8 digits  → BIVO_NUMERIC_PREFIX (5) + 3 random
 *   9 digits  → "987" (3) + 6 random
 *  12 digits  → BIVO_NUMERIC_PREFIX (5) + 7 random
 *  15 digits  → BIVO_NUMERIC_PREFIX (5) + 10 random
 *   3 digits  → fully random (too short for a useful prefix)
 *   6 digits  → "987" (3) + 3 random
 *
 * @param {string} countryCode  ISO alpha-2, e.g. 'CN', 'JP', 'HK'
 * @returns {object}
 */
function generateBankingDetails(countryCode) {
  switch (countryCode) {
    case 'GB':
      // Real, checksum-valid IBAN (NatWest, mod-97 verified) — the previous static value
      // actually failed the mod-97 check despite the "known-good" comment; only passed
      // because the server doesn't enforce the full IBAN checksum.
      return { iban: 'GB29NWBK60161331926819' };

    case 'AU':
      // Commonwealth Bank of Australia — real bank name + real BSB (Melbourne, 191 Swanston St).
      return {
        bankName:      'Commonwealth Bank of Australia',
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(7),  // 12 digits
        bsbCode:       '063019',
      };

    case 'SV':
      return { dui: '987' + generateRandomDigits(6) }; // 9 digits

    case 'IN':
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(10), // 15 digits
        // IFSC format is strict (BANK-0-BRANCH) — keep static to pass server validation.
        ifscCode: 'IDIB000N044',
      };

    case 'JP':
      // MUFG Bank — real Zengin bank code (0005) + head-office branch code (001) + SWIFT.
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(3),  // 8 digits
        swiftCode:     'BOTKJPJT',
        bankName:      'MUFG Bank',
        bankCode:      '0005',
        branchCode:    '001',
        accountType:   'Savings',
      };

    case 'HK':
      // HSBC — real HK clearing bank code (004) + Central branch code (770) + SWIFT.
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(3),  // 8 digits
        bankName:      'HSBC',
        bankCode:      '004',
        branchCode:    '770',
        swiftCode:     'HSBCHKHHHKH',
      };

    case 'MX':
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(7),  // 12 digits
      };

    case 'CN':
      return {
        phone:          CN_TEST_PHONE,
        walletProvider: 'Alipay',
        swiftCode:      'BKCHCNBJ', // Bank of China — real SWIFT/BIC
        bankName:       'Bank of China',
      };

    case 'NZ':
      // Westpac New Zealand — real SWIFT (verified), matches generateBankingDetailsForBusiness.
      return {
        accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(7),  // 12 digits
        bankName:      'Westpac New Zealand',
        swiftCode:     'WPACNZ2W',
      };

    default:
      throw new Error(`generateBankingDetails: no config for country "${countryCode}"`);
  }
}

/**
 * Returns banking details for the BUSINESS payee flow.
 *
 * For most countries the business banking form matches the individual form
 * and this delegates to generateBankingDetails(). For CN, the individual flow
 * uses Alipay but the business form shows a standard bank-deposit screen
 * (account number + SWIFT + bank name) instead — same real Bank of China
 * identity as the individual flow, just without the phone/walletProvider fields.
 *
 * @param {string} countryCode
 * @returns {object}
 */
function generateBankingDetailsForBusiness(countryCode) {
  if (countryCode === 'CN') {
    return {
      accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(7),
      swiftCode:     'BKCHCNBJ', // Bank of China — same real SWIFT as the individual flow
      bankName:      'Bank of China',
    };
  }
  if (countryCode === 'NZ') {
    return {
      accountNumber: BIVO_NUMERIC_PREFIX + generateRandomDigits(7),  // 12 digits
      bankName:      'Westpac New Zealand',
      swiftCode:     'WPACNZ2W',
    };
  }
  return generateBankingDetails(countryCode);
}

/**
 * Generates fresh US ACH/Wire payee details for the bu-web / individual US payment flow.
 * Every call yields a unique payee so parallel scenarios (Wire + ACH) and repeated runs
 * never collide on the same transactions-list row.
 *
 * Field constraints (from the personal-info / account-info field configs):
 *   address_one  ^.{0,80}$   city ^.{0,128}$   state ^.{0,64}$
 *   bank_account_number ^[a-zA-Z0-9]{2,80}$   routing_code — no server validation in sandbox
 *
 * @param {object} options - Optional field overrides
 * @returns {object} US payment payee data
 */
function generateUsPaymentPayee(options = {}) {
  const firstName = options.firstName || faker.person.firstName().replace(/[^a-zA-Z]/g, '');
  const lastName = options.lastName || faker.person.lastName().replace(/[^a-zA-Z]/g, '');

  return {
    firstName,
    lastName,
    addressOne: options.addressOne || generateRandomStreetAddress(),
    city: options.city || generateRandomCity(),
    state: options.state || faker.location.state({ abbreviated: true }),
    postalCode: options.postalCode || faker.location.zipCode('#####'),
    bankAccountNumber: options.bankAccountNumber || generateRandomDigits(12),
    routingNumber: options.routingNumber || generateRandomDigits(9),
  };
}

const BU_WEB_HEAR_ABOUT_OPTIONS = [
  'Friend / Colleagues', 'Online search', 'Google Ads', 'LinkedIn',
  'Facebook', 'Twitter', 'YouTube', 'Instagram', 'Direct email', 'Other',
];

function generateBusinessSSN() {
  return `555-${generateRandomDigits(2)}-${generateRandomDigits(5)}`;
}

function generateBuWebDescription() {
  let d = faker.lorem.words(35);
  while (d.length < 192) d += ` ${faker.lorem.word()}`;
  return d;
}

/**
 * Generates complete test data for bu-web business onboarding.
 * Data is grouped into nested objects that map 1-to-1 onto page object method signatures.
 * All possible fields are randomised; fixed values are dropdowns with limited options.
 * @returns {object}
 */
function generateBuWebTestData() {
  const firstName = faker.person.firstName().replace(/[^a-zA-Z]/g, '');
  const lastName  = faker.person.lastName().replace(/[^a-zA-Z]/g, '');

  return {
    email: `automation.biz.${firstName.toLowerCase()}.${generateRandomDigits(4)}@example.com`,

    getStarted: {
      firstName,
      lastName,
      company:     faker.company.name().replace(/['"]/g, '').trim(),
      hearAbout:   faker.helpers.arrayElement(BU_WEB_HEAR_ABOUT_OPTIONS),
      website:     faker.internet.domainName(),
      socialMedia: `@${faker.internet.username().toLowerCase().replace(/[^a-z0-9_]/g, '')}`,
    },

    bizAddress: {
      street: generateRandomStreetAddress(),
      suite:  `Suite ${faker.number.int({ min: 1, max: 999 })}`,
      city:   generateRandomCity(),
      state:  'AK',
      zip:    faker.location.zipCode('#####'),
    },

    owner: {
      firstName:    faker.person.firstName().replace(/[^a-zA-Z]/g, ''),
      lastName:     faker.person.lastName().replace(/[^a-zA-Z]/g, ''),
      jobTitle:     faker.person.jobTitle(),
      ownershipPct: '30%',
      citizenship:  'United States of America',
      idType:       'SSN',
      ssn:          generateBusinessSSN(),
      email:        `automation.owner.${generateRandomDigits(4)}@example.com`,
      street:       generateRandomStreetAddress(),
      suite:        `Apt ${faker.number.int({ min: 1, max: 99 })}`,
      city:         generateRandomCity(),
      state:        'AZ',
      zip:          faker.location.zipCode('#####'),
    },

    keyPerson: {
      jobTitle:    faker.person.jobTitle(),
      phone:       '+1 (415) 987-6000',
      citizenship: 'United States of America',
      idType:      'SSN',
      ssn:         generateBusinessSSN(),
    },

    // Dropdowns are fixed to known-valid options; randomised fields are ein and description
    additionalInfo: {
      ein:                  generateRandomDigits(12),
      stateOfIncorporation: 'Alabama',
      companyType:          'Corporation',
      annualRevenue:        'Pre-revenue',
      industry:             'Agriculture & Farming',
      subIndustry:          'Agritech',
      location:             'Primarily U.S.-based',
      employeeRange:        '-15',
      fundingSize:          '$1M-$5M',
      fundingSource:        'Internal funds',
      description:          generateBuWebDescription(),
    },
  };
}

/**
 * Account name for the bu-web "Add an Account" modal.
 * The field validates "No number or special char allowed." — only letters and
 * spaces enable the Add Account button, so strip everything else from faker words.
 *
 * @returns {string}
 */
function generateAccountName() {
  const words = `${faker.word.adjective()} ${faker.word.noun()}`;
  const cleaned = words.replace(/[^a-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return `QA ${cleaned || 'Account'}`;
}

module.exports = {
  generateUserTestData,
  generateAccountName,
  generateBuWebTestData,
  generateUsPaymentPayee,
  generateIncomingWireData,
  generateWireInstructionData,
  generateWithdrawFundData,
  generateWireFormData,
  generateWirePaymentSchedule,
  generateFxTransactionData,
  generateBankingDetails,
  generatePayeeExtraFields,
  generateBusinessPayeeExtraFields,
  generateBankingDetailsForBusiness,
  generateRandomDigits,
  generateRandomSSN,
  generateUniqueSignupPhoneNumber,
};
