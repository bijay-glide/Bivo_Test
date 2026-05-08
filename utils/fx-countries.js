// All destination country codes supported by the FX transaction flow.
// Each maps to a data-testid of the form "country-select-{CODE}" on the country picker screen.
const FX_COUNTRIES = [
  'GB', 'AL', 'DZ', 'AD', 'AR', 'AU', 'AT', 'GG', 'BD', 'BE',
  'BJ', 'BA', 'BW', 'BR', 'BG', 'BF', 'CM', 'CA', 'TD', 'CL',
  'CN', 'CO', 'CG', 'CK', 'CR', 'HR', 'CZ', 'CY', 'DK', 'EC',
  'EG', 'SV', 'GQ', 'EE', 'FO', 'FI', 'FR', 'GF', 'PF', 'TF',
  'GA', 'GM', 'DE', 'GH', 'GI', 'GR', 'GL', 'GP', 'GT', 'GN',
  'VA', 'HU', 'HK', 'IS', 'IN', 'ID', 'IE', 'IM', 'IL', 'IT',
  'CI', 'JM', 'JP', 'JE', 'JO', 'KE', 'KI', 'XK', 'LV', 'LI',
  'LT', 'LU', 'MY', 'MT', 'MQ', 'YT', 'MX', 'MC', 'ME', 'MA',
  'NP', 'NL', 'NC', 'NZ', 'NG', 'NO', 'PK', 'PE', 'PH', 'PL',
  'PT', 'RE', 'RO', 'BL', 'MF', 'PM', 'SM', 'SN', 'RS', 'SG',
  'SK', 'SI', 'ZA', 'KR', 'ES', 'LK', 'SE', 'CH', 'TW', 'TZ',
  'TH', 'TG', 'TN', 'TR', 'TV', 'UG', 'AE', 'UY', 'VN', 'WF', 'ZM',
];

// Active countries for the parallel smoke run — only countries with a full config
// in utils/fx-country-configs.js should be listed here.
// Add DE, FR, CA once their recordings are wired up in fx-country-configs.js.
const TOP_FX_COUNTRIES = ['GB', 'AU', 'SV', 'IN', 'JP', 'HK', 'CN', 'MX'];

module.exports = { FX_COUNTRIES, TOP_FX_COUNTRIES };
