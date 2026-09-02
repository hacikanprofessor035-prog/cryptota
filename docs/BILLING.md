# CryptoTA — Billing Architecture

> **Status:** Phase 1 (foundation, all free) — no actual payments yet, but architecture is in place.
>
> **To enable payments:** see "How to turn on billing" below.

This document describes how CryptoTA is architected so that monetisation can be turned on later without rewriting the app.

---

## TL;DR

- Three new modules: `js/config.js`, `js/license.js`, `js/session.js`
- Two config flags: `CryptoTA_CONFIG.billingEnabled` and `CryptoTA_CONFIG.apiBase`
- Currently **both are `false` / `null`** → all gates pass through → app behaves exactly as before
- Feature gates are wired into `addIndicator()` and `addStrategy()` but only enforce when billing is on

## Tier model

| Tier     | Price            | Indicators | Strategies | Watchlists | Cloud sync | Custom alerts |
|----------|------------------|-----------:|-----------:|-----------:|:----------:|--------------:|
| Free     | $0               | 3          | 2          | 1          | ❌         | 0             |
| Pro      | $3/yr            | ∞          | ∞          | ∞          | ✓          | ∞             |
| Lifetime | $39 one-time     | ∞          | ∞          | ∞          | ✓          | ∞             |

Pricing is in USD; converted to crypto at checkout via payment provider (NOWPayments default).

## File layout

```
crypto-ta/
├── js/
│   ├── config.js     # Feature flags, tier limits, pricing, payment provider
│   ├── license.js    # LicenseManager — current tier, gates, refresh()
│   ├── session.js    # JWT stub — login/logout/register/social-login (stubs in phase 1)
│   ├── app.js        # Calls License.canAddX() in addIndicator/addStrategy
│   └── ...           # existing modules
├── docs/
│   └── BILLING.md    # ← you are here
```

## How to turn on billing (Phase 2 checklist)

1. **Stand up a backend** (Node/Express, Python/FastAPI, Go, whatever)
   - POST `/auth/register` { email, password } → { token, user }
   - POST `/auth/login` { email, password } → { token, user }
   - GET `/auth/google` and `/auth/apple` for OAuth flow
   - GET `/license/me` → { tier, expiresAt, userId }
   - POST `/payments/create` { tier, currency } → { invoiceId, address, amount, qrCode }
   - POST `/webhooks/nowpayments` (HMAC-signed) — upgrades tier

2. **Set config in `js/config.js`:**
   ```js
   window.CryptoTA_CONFIG = {
       billingEnabled: true,
       socialLoginEnabled: true,
       apiBase: 'https://api.cryptota.app/v1',
       paymentProvider: 'nowpayments'
   };
   ```

3. **Wire UI for login + upgrade:**
   - Add login button (topbar) → modal with email/password + Google + Apple buttons
   - Add tier badge (topbar) → shows FREE / PRO / LIFETIME
   - Add upgrade button → opens checkout modal with QR + countdown

4. **Implement payment provider integration:**
   - Sign up at NOWPayments.io → get API key + IPN secret
   - Set IPN callback URL to `https://api.cryptota.app/webhooks/nowpayments`
   - Sandbox mode for testing: `https://api-sandbox.nowpayments.io`

5. **Test flow:**
   - User clicks "Upgrade to Pro" → backend creates invoice → returns BTC address
   - User sends testnet BTC to address
   - NOWPayments calls webhook → backend upgrades user in DB
   - On next app refresh, `License.refresh()` picks up new tier

## Why phase 1 ships with no UI

To keep this PR minimal and non-invasive. Right now there are no buttons, no badges, no modals — only the JS modules. UI for tier display, login, and upgrade can be added later without touching existing code.

## Local testing without backend

To exercise the gating logic without standing up a backend:

```js
// In browser console (after page loads):

// 1. Turn billing on
CryptoTA_CONFIG.billingEnabled = true;

// 2. Pretend user is on free tier (already default)
await License.load();
License.tier();                       // 'free'

// 3. Try to add 4 indicators → toast "Free tier limit reached"
document.getElementById('addIndicatorBtn').click();
// click 4 different indicators → 4th one fails

// 4. Pretend user upgraded to Pro
License.apply({ tier: 'pro', userId: 1, expiresAt: Date.now() + 30*86400e3 });
License.tier();                       // 'pro'

// 5. Now adding works without limit
document.getElementById('addIndicatorBtn').click();
// can add as many as you want

// 6. Revert
CryptoTA_CONFIG.billingEnabled = false;
License.apply({ tier: 'free', userId: null, expiresAt: null });
```

## API reference

### `CryptoTA_CONFIG`
```js
{
    billingEnabled:       false,           // master switch
    socialLoginEnabled:   false,
    apiBase:              null,            // backend URL when ready
    tiers:                { free, pro, lifetime },   // tier limits
    pricing:              { pro_yearly_usd, lifetime_usd },
    paymentProvider:      'nowpayments',
    onChange(cb):         subscribe to flag changes
}
```

### `License`
```js
License.load()                 // → license (loads from localStorage)
License.refresh()              // pull from backend (no-op if apiBase is null)
License.tier()                 // → 'free' | 'pro' | 'lifetime'
License.isPro()                // → boolean
License.isLifetime()           // → boolean
License.limits()               // → { indicators, strategies, watchlists, ... }
License.expiresAt()            // → epoch ms | null
License.isExpired()            // → boolean
License.canAddIndicator(count) // → boolean (passes if !billingEnabled)
License.canAddStrategy(count)  // → boolean
License.canAddWatchlist(count) // → boolean
License.canUseCloudSync()      // → boolean
License.apply(license)         // set new license (local + dispatches event)
License.reset()                // reset to free
License.upgradeUrl()           // URL to upgrade page (when backend ready)
License.onChange(cb)           // subscribe to license changes
```

### `Session`
```js
Session.load()                         // → session (loads from localStorage)
Session.isAuthenticated()             // → boolean
Session.user()                         // → { id, email, name } | null
Session.token()                        // → JWT | null
Session.userId()                       // → number | null
Session.email()                        // → string | null
Session.displayName()                  // → name or email
Session.login(token, user, opts?)      // store session
Session.logout()                       // clear session
Session.updateUser(patch)              // patch user fields

// Phase 2 stubs (throw "not available" until apiBase is set):
Session.loginWithEmail(email, pw)
Session.registerWithEmail(email, pw)
Session.loginWithGoogle()
Session.loginWithApple()

Session.onChange(cb)                   // subscribe to login/logout events
```

## Why NOWPayments?

- **200+ coins** (BTC, ETH, USDT, SOL, BNB, DOGE, …) — users pay in whatever they have
- Hosted payment page → no PCI / KYC overhead
- Webhook for payment confirmation with HMAC signature verification
- Has sandbox environment for testing without real money
- ~1% fee (vs Coinbase Commerce ~1% but only 4 coins)

Alternatives:
- **Coinbase Commerce** — fewer coins, but cleaner API
- **BTCPay Server** — self-hosted, zero fees, but requires server setup + Lightning node

## Security notes

- Never store the JWT in `localStorage` long-term if you can avoid it — prefer httpOnly cookie issued by backend. Phase 1 uses localStorage because there's no backend yet.
- License object in localStorage is **not signed** in phase 1 — anyone can flip their tier via DevTools. Acceptable while there's no server-side check; phase 2 must always verify tier from backend, never trust localStorage.
- HMAC verification on the payment webhook is mandatory. NOWPayments sends `x-nowpayments-sig` header — verify before processing.

## Future roadmap

- [ ] Trial period (14 days Pro on first login)
- [ ] Discount for paying in BTC vs card
- [ ] Tier comparison modal
- [ ] Email receipts via Resend
- [ ] Promo codes
- [ ] Affiliate / referral program