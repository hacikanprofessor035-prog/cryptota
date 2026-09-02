/* === CryptoTA — Global config ===
 *
 * Single source of truth for feature flags, API endpoints, and tier limits.
 *
 * CURRENT STATE (Phase 1):
 *   - billingEnabled = false  → everything is free, no UI gates are enforced
 *   - socialLoginEnabled = false → session.js stub only, no actual OAuth yet
 *
 * FUTURE PHASE (when ready to monetize):
 *   - Flip billingEnabled = true
 *   - Implement backend /auth + /payments endpoints
 *   - Build a checkout modal in UI (see docs/BILLING.md)
 *
 * To test gates locally WITHOUT backend:
 *   In browser console: CryptoTA_CONFIG.billingEnabled = true;
 *                      License.apply({ tier: 'free', userId: null, expiresAt: null });
 *                      License.apply({ tier: 'pro',  userId: 1, expiresAt: Date.now() + 30*86400e3 });
 *   Then try to add 4 indicators → toast appears.
 */

// Sentinel for "unlimited" in tier limits.
// JSON has no Infinity literal (would serialize as null), so we use a large number
// that's only compared via `<`, so any sufficiently large value works.
const UNLIMITED = 9999;

window.CryptoTA_CONFIG = {
    // ===== Billing / monetization =====
    billingEnabled: true,            // Master switch. When true → tier limits enforced.
    socialLoginEnabled: false,       // When true → social login buttons enabled in auth UI.

    // ===== Temporary "Free = everything" mode =====
    // While testing the full UX without a billing system in place, give Free
    // users the same limits as Pro (unlimited indicators/strategies/etc).
    // Only takes effect when billingEnabled === true AND the user has no paid
    // license; once they have an active Pro/Lifetime license this flag is
    // ignored. Flip to false (or remove) when you want to gate Free features.
    freeUnlimitedOverride: true,

    // ===== Backend (Phase 2) =====
    // Set to your backend's public URL. With null, the UI runs in phase-1
    // mode (no auth, no payments, no license sync).
    apiBase: 'http://localhost:3001',  // server/index.js runs on 3001 by default

    // ===== Payment provider endpoint paths (relative to apiBase) =====
    endpoints: {
        authRegister: '/api/auth/register',
        authLogin:    '/api/auth/login',
        authMe:       '/api/auth/me',
        authLogout:   '/api/auth/logout',
        licenseMe:    '/api/license/me',
        paymentsCreate: '/api/payments/create',
        paymentsList:   '/api/payments',
        paymentStatus:  (id) => `/api/payments/${id}/status`,
    },

    // ===== Tier limits =====
    // Used only when billingEnabled === true.
    // "unlimited" is represented by UNLIMITED = 9999 (defined above).
    tiers: {
        free: {
            label: 'Free',
            limits: {
                indicators: 3,
                strategies: 2,
                watchlists: 1,
                customAlerts: 0,
                cloudSync: false
            }
        },
        pro: {
            label: 'Pro',
            limits: {
                indicators: UNLIMITED,
                strategies: UNLIMITED,
                watchlists: UNLIMITED,
                customAlerts: UNLIMITED,
                cloudSync: true
            }
        },
        lifetime: {
            label: 'Lifetime',
            limits: {
                indicators: UNLIMITED,
                strategies: UNLIMITED,
                watchlists: UNLIMITED,
                customAlerts: UNLIMITED,
                cloudSync: true
            }
        }
    },

    // ===== Pricing (USD; converted to crypto at checkout via NOWPayments) =====
    // Pro is a single annual plan ($3/yr). Lifetime is a one-time payment
    // discounted vs ~13 years of Pro — encourages long-term commitment.
    pricing: {
        pro_yearly_usd: 3,
        lifetime_usd: 39
    },

    // ===== Future payment provider =====
    // NOWPayments recommended (200+ coins). Coinbase Commerce alternative.
    paymentProvider: 'nowpayments'    // 'nowpayments' | 'coinbase-commerce' | 'btcpay'
};

/* === Helpers === */

// Subscribe to config changes (when phase 2 flips a flag, UI re-renders accordingly)
(function() {
    const listeners = new Set();
    let snapshot = JSON.parse(JSON.stringify(window.CryptoTA_CONFIG));

    // Detect changes via Object.defineProperty traps for top-level keys
    const handler = {
        get(target, key) {
            const v = target[key];
            if (typeof v === 'object' && v !== null) return new Proxy(v, handler);
            return v;
        },
        set(target, key, value) {
            const old = target[key];
            target[key] = value;
            if (old !== value) {
                for (const cb of listeners) cb(key, value, old);
            }
            return true;
        }
    };

    window.CryptoTA_CONFIG = new Proxy(snapshot, handler);
    window.CryptoTA_CONFIG.onChange = (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
    };
})();