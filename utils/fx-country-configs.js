/**
 * Per-country banking configs for FX transaction UI tests.
 *
 * Each entry carries everything the test needs for that destination:
 *   currencyId   — POST /beneficiary/personal-info body field (null = not yet confirmed)
 *   currencyCode — display / assertion use
 *   country      — ISO alpha-2, matches personal-info POST body
 *   channel      — 'iban' | 'bsb' | 'bank' | ... (drives enterBankingDetailsByChannel)
 *   bankingDetails — field-shape reference only (NOT used directly in tests).
 *                    Tests call generateBankingDetails(countryCode) from test-data-generator.js
 *                    to get fresh random values on every run.
 *
 * Add a new country here + record its payee/banking steps → 1.8 picks it up automatically.
 */
const COUNTRY_BANKING_CONFIGS = {
  GB: {
    currencyId: 18,
    currencyCode: 'GBP',
    country: 'GB',
    channel: 'iban',
    bankingDetails: {
      iban: 'GB26542316456541232134',
    },
  },

  AU: {
    currencyId: null, // TODO: populate from GET /beneficiary/currencies
    currencyCode: 'AUD',
    country: 'AU',
    channel: 'bsb',
    bankingDetails: {
      bankName: 'Bank of Australia',
      accountNumber: '123412346667',
      bsbCode: '123111',
    },
  },

  SV: {
    currencyId: null, // TODO: populate from GET /beneficiary/currencies
    currencyCode: 'USD', // El Salvador uses USD
    country: 'SV',
    channel: 'bcr_pay', // "Deliver to BCR Pay" — single DUI field
    bankingDetails: {
      dui: '198273471',
    },
  },

  IN: {
    currencyId: 4,
    currencyCode: 'INR',
    country: 'IN',
    channel: 'ifsc', // "Deliver to Bank Deposit" — account number + IFSC code
    bankingDetails: {
      accountNumber: '917253478651234',
      ifscCode: 'IDIB000N044',
    },
  },

  JP: {
    currencyId: null, // TODO: populate from GET /beneficiary/currencies
    currencyCode: 'JPY',
    country: 'JP',
    channel: 'swift', // "Deliver to Bank Deposit" — account + SWIFT + bank code + branch code + account type
    bankingDetails: {
      accountNumber: '12341234',
      swiftCode: '12343321',
      bankCode: '111',
      branchCode: '664',
      accountType: 'Savings',
    },
  },

  HK: {
    currencyId: null, // TODO: populate from GET /beneficiary/currencies
    currencyCode: 'HKD',
    country: 'HK',
    channel: 'hk_bank', // "Deliver to Bank Deposit" — account + bank name + Bank code + Branch code + SWIFT
    bankingDetails: {
      accountNumber: '12341211',
      bankName: 'Bank of hongkong',
      bankCode: '222',
      branchCode: '111',
      swiftCode: '21341234',
    },
  },

  MX: {
    currencyId: null, // TODO: populate from GET /beneficiary/currencies
    currencyCode: 'MXN',
    country: 'MX',
    channel: 'rtp', // "Deliver to Bank Deposit - RTP" — account number only
    bankingDetails: {
      accountNumber: '234523452345',
    },
  },

  CN: {
    currencyId: null, // TODO: populate from GET /beneficiary/currencies
    currencyCode: 'CNY',
    country: 'CN',
    channel: 'alipay', // "Deliver to Alipay" — mobile + wallet provider dropdown + SWIFT + bank name
    bankingDetails: {
      phone: '13812345678',        // 11 digits, no prefix — system adds +86
      walletProvider: 'Alipay',
      swiftCode: '21005366',       // 8 digits
      bankName: 'Bank of china',
    },
  },

  // ── Coming soon — add after recording each country ──────────────────────────
  // DE: { currencyId: null, currencyCode: 'EUR', country: 'DE', channel: 'iban', bankingDetails: { iban: '...' } },
  // FR: { currencyId: null, currencyCode: 'EUR', country: 'FR', channel: 'iban', bankingDetails: { iban: '...' } },
  // CA: { currencyId: 3,    currencyCode: 'CAD', country: 'CA', channel: 'bank', bankingDetails: { ... } },
};

module.exports = { COUNTRY_BANKING_CONFIGS };
