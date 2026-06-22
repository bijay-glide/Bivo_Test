const DEFAULT_UI_BASE_URLS = {
  local: 'http://localhost:8080',
  sandbox: 'https://sandbox.bivotech.co',
};

function getUiBaseUrl() {
  if (process.env.UI_BASE_URL) return process.env.UI_BASE_URL;
  const env = (process.env.UI_ENV || 'local').toLowerCase();
  if (env === 'local') return process.env.UI_BASE_URL_LOCAL || DEFAULT_UI_BASE_URLS.local;
  return process.env.UI_BASE_URL_SANDBOX || DEFAULT_UI_BASE_URLS.sandbox;
}

module.exports = { getUiBaseUrl };
