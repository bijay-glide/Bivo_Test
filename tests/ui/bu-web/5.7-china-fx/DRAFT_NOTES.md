# China FX (bu-web) — draft recording breakdown

Source: two raw Playwright codegen recordings the user provided (not yet aligned to the POM/convention used by 5.3–5.6 when first written; now implemented in `1-china-fx.spec.js`):
1. China → UnionPay (default channel) → 4-identity-type payee matrix.
2. China → UnionPay default → switch to Bank Deposit → simpler payee form (no identity type) → account number + SWIFT + bank name banking form.

Both recordings only *clicked* the send-amount field without an explicit `.fill()`/`.pressSequentially()` call — confirmed with the user that the on-screen fee/exchange/rate values in both recordings correspond to a **$25** send amount (typed as `2500` cents), not an unfilled default. The implemented spec explicitly types `$25` via `enterSendAmountForBusiness` and asserts both recorded summaries via `verifySendMoneySummary`.

## Step-by-step

| # | Action | Locator (testid/role) | Validation performed | Where validated |
|---|--------|------------------------|-----------------------|------------------|
| 1 | Open Create Payment | `sidebar-money-transfer-create-payment-menuitem` | — | — |
| 2 | Search + select destination country China | textbox "Search destination country" → `country-select-CN` | `select` testid contains `"You're sending to China"` | inline `expect` |
| 3 | (implicit) Deliver-to defaults to UnionPay | — | `deliver-to-UnionPay` testid contains `"Deliver to UnionPay"` | inline `expect` — **note:** no recipient-currency step is shown before this; UnionPay appears as the *current* channel right after country selection. This conflicts with user-web's 5.7-china-fx, whose header comment says CNY's default channel is **Alipay**, not UnionPay. Flagged as an open question below. |
| 4 | Focus "You send" amount field | `SendMoney-amount-send` | fees `$3.99`, exchange amount `$21.01`, rate `$1 =6.9616` | `sendmoney-fees-value` / `sendmoney-exchange-amount-value` / `sendmoney-exchange-rate-value` |
| 5 | Continue | role button "Continue" | — | — |
| 6 | Click "Add Payee" | role button "Add Payee" | — | — |
| 7 | Fill payee name/address | `addpayeedetails-first-name-input`, `-last-name-input`, `-address-one-input`, `-city-input` | — | — (comment: use faker data here) |
| 8 | Select identity type | `option-select` → `option-select-option-{driver-s-license\|passport\|national-id\|other}` | — | — (comment: this is meant to become **4 separate runs**, one per identity type — the recording just clicked through all 4 options in sequence while exploring, it did not submit 4 payees) |
| 9 | Fill postal code + ID number | `addpayeedetails-postal-code-input`, `addpayeedetails-id-name-input` | — | — (comment: ID number should be a static, realistic-looking value, e.g. `PA9817623`) |
| 10 | Continue | role button "Continue" | — | — |
| 11 | Select banking channel | `option-select` → `option-select-option-unionpay` (only option today) | — | — |
| 12 | Fill card number + SWIFT | `addpayeeaddress-bank-account-number-input` (16-digit card), `addpayeeaddress-swift-code-input` | — | — (comment: both should stay **static** — `1986723547681512` / `BKCHCNBJXXX` — not faker-generated) |
| 13 | Continue | role button "Continue" | — | — |
| 14 | Fill description | textbox "Description" | — | — (comment: description should include the date) |
| 15 | Confirm Transaction | role button "Confirm Transaction" | `success-card` contains `"Processing Transaction"`; `success-card-description` contains the standard processing copy | inline `expect` |
| 16 | *(TODO, not yet coded)* | — | Capture `POST /business/v1/remittance/payment` → `paymentIdentifier`; call `GET /remittance/v1/international/payment/status/{paymentIdentifier}` | comment only |
| 17 | Dismiss | role button "Got it" | — | — |
| 18 | Navigate to account | `sidebar-accounts-menuitem` → `sidebar-account-6336` (hardcoded last-4 in the draft) | — | — (comment: the real last-4 should come from the payment-status API response, not be hardcoded) |
| 19 | *(TODO, not yet coded)* | — | `GET /transactions/v1/transactions?accountId=...` — find the row by `paymentIdentifier`/correlationId, assert its details | comment only |

## What already exists in the codebase that overlaps with this

- `FxTransactionPage.enterUnionPayDetails({ cardNumber, swiftCode })` already fills the UnionPay banking form — but via **role** locators (`getByRole('button', { name: 'Enter bank name' })` → click "UnionPay" text, `addpayeeaddress-bank-account-number-input` for the card, `getByRole('textbox', { name: 'Enter SWIFT code' })`), **not** via an `option-select` testid. The draft file's `option-select` control is a different UI element than what's currently coded for the bank-name dropdown.
- `FxTransactionPage.addPayee(firstName, lastName, extraFields)` already supports an identity-type + identity-number pair, but via `getByRole('button', { name: "Select beneficiary's identity type" })` + `getByText(identityType, { exact: true })` + `getByRole('textbox', { name: "Enter beneficiary's identity number" })` — **not** the `option-select` / `addpayeedetails-id-name-input` testids in this draft.
- `assertFxDebitTransaction` + `navigateToBivoAccountAndCaptureTransactions` already give a working, live-tested way to verify the ledger DEBIT by `correlationId === paymentIdentifier`, using the account number/last4 already known from login — no separate "payment status" API call is currently needed anywhere else in the suite.
- user-web's `tests/ui/user-web/5.7-china-fx/1-china-fx.spec.js` already covers CNH (Instant Card Payout, Bank Deposit) and CNY (Alipay, UnionPay, Bank Deposit, Instant Card Payout) as 6 scenarios, using the *existing* role-based identity-type locators, with `identityType: 'Passport'` only (no 4-way ID-type matrix). None of this has been ported to bu-web yet — `tests/ui/bu-web/5.7-china-fx/` currently contains only this one draft file.
