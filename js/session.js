/* === CryptoTA — User Session ===
 *
 * Holds JWT token + user info. Phase 1: localStorage-only stub.
 * Phase 2: wired to backend /auth/login, /auth/register, /auth/me.
 *
 * Auth methods to be implemented in phase 2:
 *   - Email + password (POST /auth/login)
 *   - Google OAuth (GET /auth/google)
 *   - Apple Sign-In (GET /auth/apple)
 *
 * Phase 1 (now):
 *   - Session.isAuthenticated() returns true if a session exists in localStorage
 *   - Session.login(token, user) stores it
 *   - Session.logout() clears it
 *
 * For testing without backend, manually inject a session:
 *   Session.login('fake-token', { id: 1, email: 'me@test.com', name: 'Test' });
 *   Session.logout();
 */

const Session = (() => {
    const STORAGE_KEY = 'cryptota:session';
    const listeners = new Set();

    let _session = null;

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) _session = JSON.parse(raw);
        } catch (e) {}
        if (!_session) _session = { token: null, user: null };
        return _session;
    }

    function saveLocal() {
        try {
            if (_session.token) localStorage.setItem(STORAGE_KEY, JSON.stringify(_session));
            else localStorage.removeItem(STORAGE_KEY);
        } catch {}
    }

    /* ============ Queries ============ */

    function isAuthenticated() { return !!(_session?.token); }
    function user() { return _session?.user; }
    function token() { return _session?.token; }
    function userId() { return _session?.user?.id; }
    function email() { return _session?.user?.email; }
    function displayName() { return _session?.user?.name || _session?.user?.email; }

    /* ============ Mutations ============ */

    function login(token, user, opts = {}) {
        _session = {
            token,
            user: { ...user },
            loginAt: Date.now(),
            provider: opts.provider || 'email'  // 'email' | 'google' | 'apple'
        };
        saveLocal();
        // Pull the latest license for this user from backend
        if (window.License?.refresh) {
            window.License.refresh().catch(() => {});
        } else if (window.License?.apply) {
            window.License.apply({ userId: user.id });
        }
        for (const cb of listeners) {
            try { cb(_session); } catch {}
        }
        document.dispatchEvent(new CustomEvent('cryptota:login', { detail: _session }));
    }

    function logout() {
        _session = { token: null, user: null };
        saveLocal();
        // Drop license to free when user logs out
        if (window.License?.reset) window.License.reset();
        for (const cb of listeners) {
            try { cb(_session); } catch {}
        }
        document.dispatchEvent(new CustomEvent('cryptota:logout'));
    }

    function updateUser(patch) {
        if (!_session.user) return;
        _session.user = { ..._session.user, ...patch };
        saveLocal();
    }

    /* ============ Phase 2: Backend calls (stubs for now) ============ */

    async function loginWithEmail(email, password) {
        const r = await fetch(`${CryptoTA_CONFIG.apiBase}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (!r.ok) throw new Error((await r.json()).message || 'Login failed');
        const { token, user } = await r.json();
        login(token, user, { provider: 'email' });
        return _session;
    }

    async function registerWithEmail(email, password) {
        const r = await fetch(`${CryptoTA_CONFIG.apiBase}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (!r.ok) {
            let errMsg = 'Registration failed';
            try {
                const data = await r.json();
                errMsg = data.message || data.error || errMsg;
            } catch {
                errMsg = `Server returned ${r.status} ${r.statusText} (not JSON)`;
            }
            throw new Error(errMsg);
        }
        const { token, user } = await r.json();
        login(token, user, { provider: 'email' });
        return _session;
    }

    function loginWithGoogle() {
        if (!CryptoTA_CONFIG.socialLoginEnabled) {
            throw new Error('Google login is not yet available (phase 1).');
        }
        // Phase 2: window.location = `${CryptoTA_CONFIG.apiBase}/auth/google`;
        throw new Error('Google OAuth coming soon');
    }

    function loginWithApple() {
        if (!CryptoTA_CONFIG.socialLoginEnabled) {
            throw new Error('Apple login is not yet available (phase 1).');
        }
        throw new Error('Apple Sign-In coming soon');
    }

    /* ============ Events ============ */

    function onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
    }

    return {
        load,
        isAuthenticated, user, token, userId, email, displayName,
        login, logout, updateUser,
        loginWithEmail, registerWithEmail,
        loginWithGoogle, loginWithApple,
        onChange
    };
})();

window.Session = Session;