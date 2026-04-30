/**
 * Cent-only digit string for currency inputs that behave like user-web ACH / wire (2.6).
 * e.g. "62.30" → "6230", "63" → "6300"
 */
function toCentsInput(amountUsd) {
  const raw = String(amountUsd).trim().replace(/[$,\s]/g, '');
  if (!raw) throw new Error('amountUsd is required');
  if (!raw.includes('.')) return `${raw}00`;
  const [whole, decimal = ''] = raw.split('.');
  const normalizedWhole = whole || '0';
  const normalizedDecimal = `${decimal}00`.slice(0, 2);
  return `${normalizedWhole}${normalizedDecimal}`;
}

/** Normalized display e.g. 62.3 → "$62.30" */
function formatUsdDisplay(amountUsd) {
  return `$${Number(String(amountUsd).replace(/[$,\s]/g, '')).toFixed(2)}`;
}

module.exports = { toCentsInput, formatUsdDisplay };
