# Playwright Bivo

End-to-end and API tests for Bivo using [Playwright Test](https://playwright.dev/). UI flows are split into **BCR** (pay-embedded) and **standalone user-web** suites; API specs hit the tenant REST API.

## Quick start

```bash
npm install
cp .env.example .env   # then edit with real values
npm test               # all projects (API + UI)
npm run test:api       # API only
npm run test:ui        # UI only (see below)
```

Open the HTML report after a run: `npm run show:report`.

## Requirements

- Node.js **18+** (LTS recommended)
- npm **9+**

## Environment

Copy **`.env.example`** to **`.env`**. Important variables:

| Variable | Role |
|----------|------|
| `UI_ENV` | UI target selector: `dev` or `local` |
| `UI_BASE_URL_DEV`, `UI_BASE_URL_LOCAL` | UI base URLs used by `UI_ENV` |
| `UI_BASE_URL` | Optional explicit UI override (highest priority) |
| `HOST` | Backend host used by helper API calls (OTP/identity helpers) |
| `API_BASE_URL` | Base URL for API tests (`playwright.config.js`) |
| `TENANT_IDENTIFIER`, `API_USERNAME`, `API_PASSWORD` | API auth |
| Keycloak / `TRANSACTION_*` | OTP helper and permission grants (see `.env.example`) |
| `LOGIN_PHONE_RAW`, `LOGIN_PASSWORD` | Skip onboarding when running parallel UI specs alone |

`.env` is gitignored; never commit secrets. Use `.env.example` as the template only.

Quick switch examples:

```bash
# Dev FE
UI_ENV=dev npm run test:ui

# Local FE (useful while testing local frontend changes)
UI_ENV=local npm run test:ui
```

## Repository layout

```
tests/
  api/                 # REST API specs (*.spec.js)
  ui/
    bcr/               # BCR UI — 1.1 signup … 1.5 FX
    user-web/          # Standalone user-web — 1.1 … 1.6 US ACH, etc.
fixtures/              # Playwright fixtures (e.g. ui-fixtures)
pages/                   # Page objects
utils/                   # OTP, shared state, data generators, helpers
playwright.config.js
```

Legacy: `tests/ui/user-web/ui_legacy_signup_user.js` is not matched by default `*.spec.js` globs unless you pass the path explicitly.

## How UI runs are grouped

`playwright.config.js` defines four UI **projects**:

1. **UI BCR onboarding** — `1.1`, `1.2`, `1.3` (serial, one worker)
2. **UI BCR parallel** — depends on (1); `1.4`, `1.5` with more workers
3. **UI user-web onboarding** — user-web `1.1`–`1.3` serial
4. **UI user-web parallel** — depends on (3); `1.4`–`1.6`

Full UI suite: `npm run test:ui`. Per surface: `npm run test:ui:bcr` or `npm run test:ui:userweb`.

**Running only a parallel file** (e.g. `1.5` FX) without re-running `1.1`–`1.3`: the parallel projects declare a dependency on onboarding. Use **`--no-deps`** when you already have login state. The `npm run test:ui:userweb:fx` (and similar `wire` / `us`, BCR `wire` / `fx`) scripts pass `--no-deps`. You still need fresh **`test-results/shared-state-*.json`** from a prior onboarding run, or `LOGIN_PHONE_RAW` / passwords in `.env`.

Shared state for UI is split by suite (`shared-state-bcr.json` / `shared-state-userweb.json`); see `tests/ui/README.txt`.

## npm scripts (summary)

| Script | Purpose |
|--------|---------|
| `test` | All configured projects |
| `test:api` | API project only |
| `test:ui` | All four UI projects |
| `test:ui:bcr` / `test:ui:userweb` | One UI surface |
| `test:ui:*:signup`, `first-login`, … | Targeted files (see `package.json`) |
| `pw:ui` / `pw:ui:browser` | Interactive UI mode for `tests/ui/` only |
| `pw:ui:all` | UI mode including API (large tree) |
| `pw:ui:api` | UI mode, API project only |
| `show:report` | Open last HTML report |

## CLI examples

```bash
npx playwright test --project="API Tests"
npx playwright test --project="UI user-web onboarding" "tests/ui/user-web/1.1 ui_userweb_signup.spec.js"
npx playwright test --no-deps --project="UI user-web parallel" "tests/ui/user-web/1.5 ui_userweb_fx_transaction.spec.js"
```

## Timeouts (`playwright.config.js`)

- Test: **60s**
- Expect: **10s**
- Action: **15s** (global `use`)
- Navigation: **30s**

CI sets `forbidOnly` and **retries**; local runs use **workers: 1** by default, with higher workers only on UI parallel projects.

## Reports and artifacts

- HTML: `npx playwright show-report` (or `npm run show:report`)
- JUnit: `test-results/junit.xml`
- Traces / screenshots / video: on failure per config; `test-results/` and `playwright-report/` are gitignored

## Debugging

```bash
npm run test:debug
# or
npx playwright test --debug
```

Traces: `npx playwright show-trace path/to/trace.zip`

---

Author: Bijay
