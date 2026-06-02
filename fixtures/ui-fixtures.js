const fs = require('fs');
const path = require('path');
const { test: baseTest, expect, chromium } = require('@playwright/test');

const STATIC_EXT = /\.(js|css|png|svg|ico|woff2?|ttf|eot|map|jpg|jpeg|gif|webp)(\?|$)/i;
const NOISE_PATTERN = /webpack|hot-update|sockjs|__vite|livereload|favicon/i;

function isApiCall(url) {
  if (STATIC_EXT.test(url) || NOISE_PATTERN.test(url)) return false;
  return url.includes('bivotech') || url.includes('localhost') || url.includes('127.0.0.1');
}

function tryParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return str; }
}

/**
 * UI test fixtures that use a persistent browser context.
 * Cache (and cookies/storage) are kept in .playwright-ui-cache between runs,
 * so the site can load faster after the first run.
 *
 * Set CAPTURE_APIS=1 to record all API calls to test-results/api-capture/*.json.
 */
const test = baseTest.extend({
  context: async ({}, use, testInfo) => {
    const userDataDir = path.join(process.cwd(), '.playwright-ui-cache');
    const context = await chromium.launchPersistentContext(userDataDir, {
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      navigationTimeout: 120000,
      actionTimeout: 15000,
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'retain-on-failure',
    });

    if (process.env.CAPTURE_APIS === '1') {
      const captureLog = [];
      const reqMap = new WeakMap();
      const bodyPromises = [];

      context.on('request', req => {
        if (!isApiCall(req.url())) return;
        const entry = {
          method: req.method(),
          url: req.url(),
          postData: tryParseJson(req.postData()),
          status: null,
          ok: null,
          responseBody: null,
        };
        captureLog.push(entry);
        reqMap.set(req, entry);
      });

      context.on('response', res => {
        const entry = reqMap.get(res.request());
        if (!entry) return;
        entry.status = res.status();
        entry.ok = res.ok();
        const p = res.text().then(t => {
          try { entry.responseBody = JSON.parse(t); }
          catch { entry.responseBody = t.length > 500 ? t.slice(0, 500) + '…' : t; }
        }).catch(() => {});
        bodyPromises.push(p);
      });

      await use(context);

      await Promise.race([
        Promise.allSettled(bodyPromises),
        new Promise(r => setTimeout(r, 4000)),
      ]);

      const capDir = path.join(process.cwd(), 'api-capture');
      fs.mkdirSync(capDir, { recursive: true });
      const safeName = (testInfo.titlePath.join('__') || 'unknown')
        .replace(/[^a-z0-9_]/gi, '_')
        .replace(/_+/g, '_')
        .slice(0, 80);
      fs.writeFileSync(
        path.join(capDir, `${safeName}.json`),
        JSON.stringify({ test: testInfo.title, spec: path.basename(testInfo.file), calls: captureLog }, null, 2),
      );
    } else {
      await use(context);
    }

    await context.close().catch(() => {});
  },
});

module.exports = { test, expect };
