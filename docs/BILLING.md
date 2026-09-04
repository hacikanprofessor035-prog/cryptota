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

Pricing is in TON (Toncoin); the on-chain USD value is informational only. Users pay TON from their wallet directly to the project's static wallet address with a unique per-invoice memo; the server's polling worker matches incoming transactions to invoices.

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

1. **Stand up a backend** (Node/Express)
   - POST `/auth/register` { email, password } → { token, user }
   - POST `/auth/login` { email, password } → { token, user }
   - GET `/license/me` → { tier, expiresAt, userId }
   - POST `/payments/create` { tier, payCurrency: 'ton' } → { payment: { id, memo, payAddress, payAmount, ... } }
   - GET `/payments/:id/status` → poll until `status === 'completed'`
   - **No third-party webhook.** Payment confirmation is done by our own polling worker (`src/routes/payments.js`) that scans the TON blockchain every 15s for incoming txs matching `memo + amount`.

2. **Set config in `js/config.js`:**
   ```js
   window.CryptoTA_CONFIG = {
       billingEnabled: true,
       apiBase: 'https://api.cryptota.app',
       paymentProvider: 'ton'
   };
   ```

3. **Wire UI for login + upgrade:**
   - Add login button (topbar) → modal with email/password form
   - Add tier badge (topbar) → shows FREE / PRO / LIFETIME
   - Add upgrade button → opens checkout modal with QR + memo

4. **Configure TON wallet:**
   - Get a TON address from any wallet app (Tonkeeper, MyTonWallet, OpenMask)
   - Set `TON_ADDRESS=<your mainnet wallet>` in server `.env`
   - That's it — no third-party API keys, no KYC, no sandbox flags

5. **Test flow:**
   - User clicks "Upgrade to Pro" → backend generates a unique memo → returns TON address + amount
   - User sends TON from their wallet to that address WITH the memo as comment
   - Polling worker detects the on-chain tx → marks payment completed → inserts license
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
    paymentProvider:      'ton',
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

## Why direct TON wallet (and not a payment provider)?

- **No third-party fees.** Providers like NOWPayments / Coinbase Commerce charge 0.4–1% per payment. For a $3 Pro tier that adds up to nothing, but at scale (and philosophically) we want to keep the money flow crypto-native.
- **No KYC.** TON direct → no identity verification until TON itself requires it.
- **Crypto-native UX.** CryptoTA is a crypto tool, our users already hold TON. Charging in USD via a card would feel weird.
- **Single dependency.** One wallet address + one polling loop. No API keys to rotate, no sandbox flags, no provider downtime.
- **Trade-off accepted:** users MUST include the memo (16 hex chars) when sending. We surface this prominently in the UI and are planning a `ton://` deep-link so wallets can pre-fill it.

Alternatives we considered:
- **NOWPayments** — 200+ coins, hosted page, but ~0.5% fee + KYC after $1–3k.
- **Coinbase Commerce** — fewer coins, cleaner API, but US-centric and KYC-heavy.
- **BTCPay Server** — self-hosted, zero fees, but requires running a Lightning node + server maintenance.

## Security notes

- Never store the JWT in `localStorage` long-term if you can avoid it — prefer httpOnly cookie issued by backend. Phase 1 uses localStorage because there's no backend yet.
- License object in localStorage is **not signed** in phase 1 — anyone can flip their tier via DevTools. Acceptable while there's no server-side check; phase 2 must always verify tier from backend, never trust localStorage.
- TON payments are attributed by a unique 16-hex-char memo. If the user sends TON WITHOUT the memo, the payment is unrecoverable — the polling worker cannot match it to any invoice. Keep the memo visible and easy to copy.

## Future roadmap

- [ ] Trial period (14 days Pro on first login)
- [ ] Discount for paying in BTC vs card
- [ ] Tier comparison modal
- [ ] Email receipts via Resend
- [ ] Promo codes
- [ ] Affiliate / referral program