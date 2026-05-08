const DEFAULT_UI_BASE_URLS = {
  dev: 'https://bivo-dev.bivotech.co',
  local: 'http://localhost:8080',
};

function getUiBaseUrl() {
  if (process.env.UI_BASE_URL) return process.env.UI_BASE_URL;
  const env = (process.env.UI_ENV || 'dev').toLowerCase();
  if (env === 'local') return process.env.UI_BASE_URL_LOCAL || DEFAULT_UI_BASE_URLS.local;
  return process.env.UI_BASE_URL_DEV || DEFAULT_UI_BASE_URLS.dev;
}

module.exports = { getUiBaseUrl };
