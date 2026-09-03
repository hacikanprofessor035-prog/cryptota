/* === CryptoTA — License Manager ===
 *
 * Single source of truth for the current user's tier and feature access.
 *
 * Phase 1 (now):
 *   - billingEnabled = false  → all gates pass through, no UI changes
 *   - Tier is always 'free' (or whatever stored in localStorage)
 *   - No backend traffic, no network calls
 *
 * Phase 2 (future):
 *   - billingEnabled = true   → enforce tier limits
 *   - License.refresh() queries backend /license/me with JWT
 *   - Upgrade flow via /payments/create
 *
 * API:
 *   await License.load()       — call once at app init, returns license
 *   License.tier()             — 'free' | 'pro' | 'lifetime'
 *   License.isPro()            — true for pro/lifetime
 *   License.isLifetime()       — true for lifetime
 *   License.limits             — { indicators, strategies, ... } for current tier
 *   License.canAddIndicator(currentCount)
 *   License.canAddStrategy(currentCount)
 *   License.apply(license)     — set new license locally (and remotely when wired)
 *   License.refresh()          — fetch from backend (no-op in phase 1)
 *   License.upgradeUrl()       — return URL to upgrade page
 *   License.onChange(cb)       — subscribe to license changes
 *
 * For local testing (no backend):
 *   await License.load();
 *   License.apply({ tier: 'pro', userId: 1, expiresAt: Date.now() + 30*86400e3 });
 *   CryptoTA_CONFIG.billingEnabled = true;
 *   → limits now enforce
 */

const License = (() => {
    const STORAGE_KEY = 'cryptota:license';
    const listeners = new Set();

    let _license = null;

    /* ============ Storage ============ */

    async function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) _license = JSON.parse(raw);
        } catch (e) { /* ignore */ }

        if (!_license || !isValid(_license)) {
            _license = defaultLicense();
            saveLocal();
        }

        // Phase 2: refresh from backend
        if (CryptoTA_CONFIG.apiBase && window.Session?.isAuthenticated?.()) {
            await refresh().catch(() => {});
        }

        return _license;
    }

    function saveLocal() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_license)); } catch {}
    }

    function defaultLicense() {
        return {
            tier: 'free',
            userId: null,
            expiresAt: null,            // epoch ms, null for free or lifetime
            startedAt: Date.now(),
            invoiceId: null,
            provider: 'local'           // 'local' | 'ton'
        };
    }

    function isValid(lic) {
        return lic && typeof lic === 'object' &&
               ['free', 'pro', 'lifetime'].includes(lic.tier);
    }

    /* ============ Backend (no-op in phase 1) ============ */

    async function refresh() {
        if (!CryptoTA_CONFIG.apiBase) return;
        const token = window.Session?.token?.();
        if (!token) return;
        try {
            const r = await fetch(`${CryptoTA_CONFIG.apiBase}/license/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!r.ok) return;
            const data = await r.json();
            // Backend returns { tier, userId, expiresAt (ISO string or null), source }
            // Normalise to our internal format: expiresAt as epoch ms.
            apply({
                tier: data.tier,
                userId: data.userId ?? window.Session?.userId?.() ?? null,
                expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : null,
                source: data.source || 'backend',
                startedAt: data.activatedAt ? new Date(data.activatedAt).getTime() : Date.now(),
            });
        } catch (e) {
            console.warn('[license] refresh failed', e);
        }
    }

    /* ============ Tier queries ============ */

    function tier() { return _license?.tier || 'free'; }
    function isPro() { return tier() === 'pro' || tier() === 'lifetime'; }
    function isLifetime() { return tier() === 'lifetime'; }

    function limits() {
        const baseLimits = CryptoTA_CONFIG.tiers[tier()]?.limits
            || CryptoTA_CONFIG.tiers.free.limits;

        // Temporary override: when billing is ON, but the current tier is still
        // 'free' and freeUnlimitedOverride is on, give Free users the same
        // unlimited limits as Pro. If the user has already paid for Pro or
        // Lifetime, that tier is the active one and this branch is skipped.
        if (tier() === 'free'
            && CryptoTA_CONFIG.billingEnabled
            && CryptoTA_CONFIG.freeUnlimitedOverride) {
            return {
                indicators: 9999,
                strategies: 9999,
                watchlists: 9999,
                customAlerts: 9999,
                cloudSync: true
            };
        }

        return baseLimits;
    }

    function expiresAt() { return _license?.expiresAt || null; }

    function isExpired() {
        const exp = expiresAt();
        if (!exp) return false; // free or lifetime
        return Date.now() > exp;
    }

    /* ============ Feature gates ============ */

    function canAddIndicator(currentCount) {
        if (!CryptoTA_CONFIG.billingEnabled) return true;
        const lim = limits().indicators;
        return currentCount < lim;
    }

    function canAddStrategy(currentCount) {
        if (!CryptoTA_CONFIG.billingEnabled) return true;
        const lim = limits().strategies;
        return currentCount < lim;
    }

    function canAddWatchlist(currentCount) {
        if (!CryptoTA_CONFIG.billingEnabled) return true;
        const lim = limits().watchlists;
        return currentCount < lim;
    }

    function canUseCloudSync() {
        if (!CryptoTA_CONFIG.billingEnabled) return true; // free to use locally
        return !!limits().cloudSync;
    }

    /* ============ Mutations ============ */

    function apply(license) {
        if (!isValid(license)) return;
        _license = { ..._license, ...license };
        saveLocal();
        for (const cb of listeners) {
            try { cb(_license); } catch {}
        }
        document.dispatchEvent(new CustomEvent('cryptota:license-changed', { detail: _license }));
    }

    function reset() {
        _license = defaultLicense();
        saveLocal();
        apply(_license);
    }

    /* ============ Upgrade flow ============ */

    function upgradeUrl() {
        // Phase 2: returns backend-hosted upgrade page
        if (!CryptoTA_CONFIG.apiBase) return '#';
        return `${CryptoTA_CONFIG.apiBase}/upgrade?tier=pro`;
    }

    /* ============ Events ============ */

    function onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
    }

    return {
        load, refresh,
        tier, isPro, isLifetime, limits, expiresAt, isExpired,
        canAddIndicator, canAddStrategy, canAddWatchlist, canUseCloudSync,
        apply, reset,
        upgradeUrl, onChange
    };
})();

window.License = License;