# Playwright Bivo

End-to-end and API tests for Bivo using [Playwright Test](https://playwright.dev/). UI flows cover three surfaces — **BCR** (pay-embedded), **standalone user-web**, and **bu-web** (business) — while API specs hit the tenant REST API directly.

## Quick start

```bash
npm install
cp .env.example .env   # then edit with real values
npm test               # all projects (API + UI)
npm run test:api       # API only
npm run test:ui:userweb:full   # user-web onboarding + parallel
npm run test:ui:buweb:full     # bu-web onboarding + parallel
```

Open the HTML report after a run: `npm run show:report`.

## Requirements

- Node.js **18+** (LTS recommended)
- npm **9+**

## Environment

Copy **`.env.example`** to **`.env`**. Important variables:

| Variable | Role |
|----------|------|
| `UI_ENV` | UI target selector: `local` or `sandbox` |
| `UI_BASE_URL_LOCAL`, `UI_BASE_URL_SANDBOX` | UI base URLs used by `UI_ENV` |
| `UI_BASE_URL` | Optional explicit UI override (highest priority) |
| `HOST` | Backend host used by helper API calls (OTP/identity helpers) |
| `API_BASE_URL` | Base URL for API tests (`playwright.config.js`) |
| `TENANT_IDENTIFIER`, `API_USERNAME`, `API_PASSWORD` | API auth |
| Keycloak / `TRANSACTION_*` | OTP helper and permission grants (see `.env.example`) |
| `LOGIN_PHONE_RAW`, `LOGIN_PASSWORD` | Skip onboarding when running parallel UI specs alone |
| `BUWEB_DEVICE_ID` | Pinned UUID so bu-web stays device-trusted (skips TOTP) across runs |

`.env` is gitignored; never commit secrets. Use `.env.example` as the template only.

Quick switch examples:

```bash
# Local FE (useful while testing local frontend changes)
UI_ENV=local npm run test:ui:buweb:full

# Deployed sandbox FE
UI_ENV=sandbox npm run test:ui:buweb:full
```

## Repository layout

```
tests/
  api/                 # REST API specs (*.spec.js)
  ui/
    bcr/               # BCR UI — 1.1 signup … 1.5 FX
    user-web/          # Standalone user-web — onboarding, FX multi-country, US ACH, etc.
    bu-web/            # Business — onboarding (1.1–1.3) + parallel flows 1.4–1.14
fixtures/              # Playwright fixtures (e.g. ui-fixtures)
pages/                 # Page objects
utils/                 # OTP, shared state, data generators, helpers
k6/                    # Load tests (Grafana k6) — see below
playwright.config.js
```

## Test surfaces

- **API** (`tests/api/`) — hit the tenant REST API via Playwright's `request` fixture; independent, run in any order.
- **BCR** (`tests/ui/bcr/`) — pay-embedded flow at `/pay/user-web/`.
- **user-web** (`tests/ui/user-web/`) — standalone flow at `/user-web/`.
- **bu-web** (`tests/ui/bu-web/`) — business flow at `/bu-web/`. Onboarding (`1.1`–`1.3`, merged into `onboarding.spec.js`) creates a business user and configures **TOTP 2FA**; parallel specs `1.4`–`1.14` depend on that state.

## How UI runs are grouped

`playwright.config.js` defines these projects (each "parallel" project declares a `dependencies` on its onboarding project):

| Project | Files |
|---------|-------|
| **UI BCR onboarding** | BCR `1.1`–`1.3` (serial) |
| **UI BCR parallel** | BCR `1.4`, `1.5` |
| **UI user-web onboarding** | merged `onboarding.spec.js` (serial) |
| **UI user-web parallel** | user-web `1.4`, `1.6`, `1.9`, `1.10`, `1.11` |
| **UI user-web link card only** | user-web `1.7` |
| **UI user-web FX multi-country** | user-web `1.8`, `1.8b` |
| **UI bu-web onboarding** | merged `onboarding.spec.js` (serial) |
| **UI bu-web parallel** | bu-web `1.4`–`1.14` |
| **UI user-web exploratory** | `exploratory.spec.js` |

Per surface (onboarding + parallel together): `npm run test:ui:bcr`, `npm run test:ui:userweb:full`, `npm run test:ui:buweb:full`.

**Running only a parallel file** (e.g. bu-web `1.9` UK FX) without re-running onboarding: parallel projects depend on onboarding, so pass **`--no-deps`** when you already have login state. The targeted `test:ui:*:*` scripts pass `--no-deps`. You still need fresh shared state from a prior onboarding run (user-web: `shared-state-userweb.json`; bu-web: `.bivo-state/shared-state-buweb.json`), or `LOGIN_PHONE_RAW` / `LOGIN_PASSWORD` in `.env`.

## npm scripts (summary)

| Script | Purpose |
|--------|---------|
| `test` | All configured projects |
| `test:api` | API project only (`test:api:<name>` for a single spec) |
| `test:ui:bcr` | BCR onboarding + parallel |
| `test:ui:userweb:full` | user-web onboarding + parallel + link-card + FX multi-country |
| `test:ui:buweb:full` | bu-web onboarding + parallel |
| `test:ui:userweb:*`, `test:ui:buweb:*` | Targeted single flows (wire, us, linkcard, fx-multi, uk-fx, movemoney, payee, settings-auth, …) |
| `pw:ui` / `pw:ui:userweb` / `pw:ui:api` | Interactive UI mode |
| `capture:apis*` | Re-run selected specs with `CAPTURE_APIS=1` to record API traffic |
| `api:summary` | Generate API summary (`scripts/api-summary.js`) |
| `show:report` | Open last HTML report |
| `k6:probe` / `k6:load` / `k6:load:dashboard` | Load tests (see below) |

See `package.json` for the full list of targeted `test:ui:*` scripts.

## CLI examples

```bash
npx playwright test --project="API Tests"
npx playwright test --no-deps --project="UI bu-web parallel" "tests/ui/bu-web/1.9 ui_buweb_uk_fx.spec.js"
npx playwright test --no-deps --project="UI user-web parallel" "tests/ui/user-web/1.4 ui_userweb_setup_wire_payment.spec.js"
```

## Timeouts (`playwright.config.js`)

- Test: **60s**
- Expect: **10s**
- Action: **15s** (global `use`)
- Navigation: **30s**

CI sets `forbidOnly` and **retries**; local runs use **workers: 1** by default (overridden via `UI_WORKERS` and per-project parallel settings).

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

## Load Testing (k6)

Performance tests live in `k6/` and use [Grafana k6](https://k6.io/). They hit the sandbox REST API directly — no browser, no Playwright.

### Prerequisites

```bash
brew install k6
```

Add these three variables to your `.env`:

| Variable | Purpose |
|----------|---------|
| `BIVO_DEVICE_ID` | Device ID registered during the probe step |
| `BIVO_ITERATIONS` | How many times each VU runs the full flow |
| `BIVO_PROBE_MAX_RETRIES` | Max OTP attempts per phone during the probe |

Phones under test are listed in `k6/phones.json`. The VU count is derived automatically (`BIVO_VUS` is injected by the npm script from the phone count), so adding a phone there adds a VU on the next run.

### Two-step workflow

**Step 1 — establish device trust** (run once per set of phones):

```bash
npm run k6:probe
```

This iterates through every phone in `phones.json` and performs OTP + device registration so future logins skip the OTP challenge. Each phone shows ✓ or ✗ in the summary. Re-run with a higher retry count if any phones fail:

```bash
BIVO_PROBE_MAX_RETRIES=5 npm run k6:probe
```

**Step 2 — run the load test** (all phones must be trusted first):

```bash
npm run k6:load
```

Or with the live dashboard open at `http://localhost:5665`:

```bash
npm run k6:load:dashboard
```

### What each VU does

One VU is assigned per phone. Each VU runs `BIVO_ITERATIONS` times through the full flow:

| Flow | Endpoints | Steps |
|------|-----------|-------|
| Dashboard | `/dashboard`, `/permissions`, `/profile`, `/accountbalance`, `/transactions`, `/currencies` | 1–6 |
| Wire withdrawal | `POST /beneficiary`, `GET /beneficiary`, `POST /withdraw-fund` | 7–9 |
| Move money | `POST /move-fund` | 10 |
| US ACH | `POST /personal-info`, `POST /account`, `POST /transfer-fund` | 11–13 |

### Thresholds

| Metric | Threshold |
|--------|-----------|
| `http_req_failed` | < 5% |
| `http_req_duration p(95)` | < 5 000 ms |

k6 exits non-zero if either threshold is breached.

### File structure

```
k6/
  lib/
    config.js    — all env var constants (uses BIVO_ prefix to avoid k6 reserved names)
    helpers.js   — buildHeaders, rotateSession, DEVICE_INFO, step logger, utils
    auth.js      — passwordLogin, authenticate
    otp.js       — fetchOtp, fullOtpLogin  (probe only)
    flows.js     — runDashboard, runWire, runMoveFund, runACH  (load test only)
  load-test.js          — options + setup() + default VU entry point
  device-trust-probe.js — options + probe loop
  phones.json           — list of test phone numbers
```

---

Author: Bijay
