/* === CryptoTA — UI bindings for billing/auth ===
 *
 * Tier badge, auth button, auth modal, upgrade modal.
 * All UI is in the DOM regardless of billingEnabled — but the
 * upgrade modal only shows tier cards, and auth modal is openable
 * any time. The backend actions stay stubs until apiBase is set.
 *
 * Phase 1 (now):
 *   - Tier badge shows current tier (always 'free' by default)
 *   - Auth button shows "Sign in" or user email
 *   - Upgrade modal shows tier comparison (no payment yet)
 *   - Auth modal shows login form (submit fails with "not available")
 *
 * Phase 2 (later):
 *   - Login submits to backend, JWT stored
 *   - Upgrade creates real payment invoice via NOWPayments
 *   - Tier badge updates after payment confirms
 */

const UI = (() => {
    /* ============ Tier badge ============ */

    function renderTierBadge() {
        const badge = document.getElementById('tierBadge');
        if (!badge) return;
        const tier = License.tier();
        const cfg = CryptoTA_CONFIG.tiers[tier];
        badge.dataset.tier = tier;
        badge.textContent = cfg?.label?.toUpperCase() || tier.toUpperCase();

        // While freeUnlimitedOverride is on, surface that fact in the tooltip
        // so the user knows Free is currently "everything-unlocked" (temporary).
        const unlimited = tier === 'free'
            && CryptoTA_CONFIG.billingEnabled
            && CryptoTA_CONFIG.freeUnlimitedOverride;

        if (tier === 'free') {
            badge.title = unlimited
                ? 'Free tier (full access — billing not enforced for free yet)\nClick to see plans'
                : 'Free tier — click to upgrade';
        } else {
            badge.title = `${cfg?.label || tier} — click to manage`;
        }
    }

    /* ============ Auth button ============ */

    function renderAuthButton() {
        const btn = document.getElementById('authButton');
        if (!btn) return;
        if (Session.isAuthenticated()) {
            const name = Session.displayName();
            btn.textContent = name.length > 16 ? name.slice(0, 14) + '…' : name;
            btn.dataset.auth = 'true';
            btn.title = `Signed in as ${name}\nClick to manage account`;
        } else {
            btn.textContent = 'Sign in';
            btn.dataset.auth = 'false';
            btn.title = 'Sign in to sync your settings';
        }
    }

    /* ============ Modals ============ */

    function openModal(id) {
        const m = document.getElementById(id);
        if (!m) return;
        m.style.display = 'flex';
        const firstInput = m.querySelector('input, button');
        if (firstInput) setTimeout(() => firstInput.focus(), 50);
    }

    function closeModal(id) {
        const m = document.getElementById(id);
        if (m) m.style.display = 'none';
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    }

    /* ============ Upgrade modal ============ */

    function renderUpgradeModal() {
        const list = document.getElementById('upgradeTierList');
        if (!list) return;
        const pricing = CryptoTA_CONFIG.pricing;
        const tiers = ['free', 'pro', 'lifetime'];
        const freeUnlimited = CryptoTA_CONFIG.billingEnabled
            && CryptoTA_CONFIG.freeUnlimitedOverride;
        list.innerHTML = tiers.map(key => {
            const t = CryptoTA_CONFIG.tiers[key];
            const isCurrent = key === License.tier();
            const price = key === 'free' ? 'Free forever'
                : key === 'pro' ? `${pricing.pro_yearly_ton} TON/yr`
                : `$${pricing.lifetime_usd} one-time`;
            // For Free, show the *effective* limits (i.e. what the user can
            // actually use right now) so the card matches reality.
            const effectiveLimits = (key === 'free' && freeUnlimited)
                ? License.limits()
                : t.limits;
            const features = formatLimits(effectiveLimits);
            return `
                <div class="tier-card${isCurrent ? ' current' : ''}" data-tier="${key}">
                    <div class="tier-card-head">
                        <span class="tier-card-name">${t.label}${key === 'free' && freeUnlimited ? ' <span class="tier-card-badge">All unlocked</span>' : ''}</span>
                        <span class="tier-card-price">${price}</span>
                    </div>
                    <ul class="tier-card-features">
                        ${features.map(f => `<li>${f}</li>`).join('')}
                    </ul>
                    <button class="tier-card-cta" data-tier="${key}" ${isCurrent ? 'disabled' : ''}>
                        ${isCurrent ? 'Current plan' : key === 'free' ? 'Downgrade' : 'Upgrade'}
                    </button>
                </div>
            `;
        }).join('');

        // Wire buttons
        list.querySelectorAll('.tier-card-cta').forEach(btn => {
            btn.addEventListener('click', () => onUpgradeClick(btn.dataset.tier));
        });
    }

    function formatLimits(limits) {
        const fmt = (n) => n >= 9999 ? 'Unlimited' : n;
        return [
            `Indicators: ${fmt(limits.indicators)}`,
            `Strategies: ${fmt(limits.strategies)}`,
            `Watchlists: ${fmt(limits.watchlists)}`,
            `Custom alerts: ${fmt(limits.customAlerts)}`,
            `Cloud sync: ${limits.cloudSync ? '✓' : '—'}`
        ];
    }

    async function onUpgradeClick(tier) {
        if (tier === License.tier()) return;
        if (tier === 'free') {
            // Downgrade not allowed via UI — just close the modal
            showToast('Contact support to downgrade');
            return;
        }
        if (!CryptoTA_CONFIG.apiBase) {
            showToast('Backend not configured');
            return;
        }
        if (!Session.isAuthenticated()) {
            showToast('Sign in first to upgrade');
            // Open auth modal after a moment
            setTimeout(() => openModal('authModal'), 800);
            return;
        }

        // Show currency picker
        openCheckoutModal(tier);
    }

    /* ============ Checkout flow ============ */

    // Direct TON payments to our static wallet. The user sends TON with a
    // unique memo string so we can attribute the on-chain transaction to
    // their account.
    const SUPPORTED_CURRENCIES = [
        { code: 'ton', name: 'Toncoin',   symbol: '◇' },
    ];

    let _checkoutPollTimer = null;
    let _checkoutPaymentId = null;

    function openCheckoutModal(tier) {
        _checkoutPaymentId = null;
        if (_checkoutPollTimer) { clearInterval(_checkoutPollTimer); _checkoutPollTimer = null; }

        const planName = tier === 'lifetime' ? 'Lifetime' : 'Pro 1-year';
        const titleEl = document.getElementById('checkoutTitle');
        if (titleEl) titleEl.textContent = `Pay for ${planName}`;

        // Render currency picker (TON-only for now).
        const grid = document.getElementById('checkoutCurrencies');
        if (grid) {
            grid.innerHTML = SUPPORTED_CURRENCIES.map(c => `
                <button class="currency-btn" data-currency="${c.code}">
                    <span class="currency-btn-symbol">${c.symbol}</span>
                    ${c.code.toUpperCase()}
                </button>
            `).join('');
            grid.querySelectorAll('.currency-btn').forEach(btn => {
                btn.addEventListener('click', () => startCheckout(tier, btn.dataset.currency));
            });
        }

        document.getElementById('checkoutStepChoose').style.display = 'block';
        document.getElementById('checkoutStepPay').style.display = 'none';
        document.getElementById('checkoutStepDone').style.display = 'none';
        openModal('checkoutModal');
    }

    async function startCheckout(tier, currency) {
        document.getElementById('checkoutStepChoose').style.display = 'none';
        document.getElementById('checkoutStepPay').style.display = 'block';
        document.getElementById('checkoutStepDone').style.display = 'none';
        const planName = tier === 'lifetime' ? 'Lifetime' : 'Pro 1-year';
        document.getElementById('checkoutPlan').textContent = planName;
        document.getElementById('checkoutCurrency').textContent = currency.toUpperCase();
        document.getElementById('checkoutStatus').textContent = 'Creating invoice…';
        document.getElementById('checkoutAmount').textContent = '…';
        document.getElementById('checkoutAddress').textContent = '…';
        document.getElementById('checkoutQr').src = '';

        try {
            const r = await fetch(`${CryptoTA_CONFIG.apiBase}${CryptoTA_CONFIG.endpoints.paymentsCreate}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Session.token()}`
                },
                body: JSON.stringify({ tier, payCurrency: currency })
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${r.status}`);
            }
            const { payment } = await r.json();
            _checkoutPaymentId = payment.id;

            document.getElementById('checkoutAmount').textContent = `${payment.payAmount} ${payment.payCurrency}`.toUpperCase();

            // Address + memo go in separate fields so the user can copy each
            // cleanly into the "address" and "comment/memo" inputs of their wallet.
            document.getElementById('checkoutAddress').textContent = payment.payAddress;
            const memoEl = document.getElementById('checkoutMemo');
            if (memoEl) memoEl.textContent = payment.memo;
            document.getElementById('checkoutStatus').textContent = 'Waiting for payment';

            // QR encodes a TON URI: ton://transfer/<addr>?amount=<x>&text=<memo>
            // Most wallets (Tonkeeper, MyTonWallet, Tonhub) recognise this and
            // pre-fill everything for the user.
            const tonUri = `ton://transfer/${payment.payAddress}` +
                `?amount=${(payment.payAmount * 1e9).toFixed(0)}` +
                `&text=${encodeURIComponent(payment.memo)}`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tonUri)}`;
            document.getElementById('checkoutQr').src = qrUrl;

            // Start polling for status
            startCheckoutPolling(payment.id);
        } catch (e) {
            showToast(`Error: ${e.message}`);
            // Back to currency picker
            document.getElementById('checkoutStepChoose').style.display = 'block';
            document.getElementById('checkoutStepPay').style.display = 'none';
        }
    }

    function startCheckoutPolling(paymentId) {
        if (_checkoutPollTimer) clearInterval(_checkoutPollTimer);
        const poll = async () => {
            try {
                const url = `${CryptoTA_CONFIG.apiBase}${CryptoTA_CONFIG.endpoints.paymentStatus(paymentId)}`;
                const r = await fetch(url);
                if (!r.ok) return;
                const { payment } = await r.json();
                const statusEl = document.getElementById('checkoutStatus');
                if (statusEl) statusEl.textContent = humanStatus(payment.status);
                if (payment.status === 'finished') {
                    clearInterval(_checkoutPollTimer);
                    _checkoutPollTimer = null;
                    // Refresh license from backend (will pick up new tier)
                    await License.refresh();
                    // Show done step
                    document.getElementById('checkoutStepPay').style.display = 'none';
                    document.getElementById('checkoutStepDone').style.display = 'block';
                    document.getElementById('checkoutDonePlan').textContent =
                        payment.tier === 'lifetime' ? 'Lifetime' : 'Pro 1-year';
                } else if (payment.status === 'failed' || payment.status === 'expired') {
                    clearInterval(_checkoutPollTimer);
                    _checkoutPollTimer = null;
                    showToast(`Payment ${payment.status}`);
                }
            } catch (e) {
                // silent — retry next tick
            }
        };
        // First poll after 3s, then every 5s
        setTimeout(poll, 3000);
        _checkoutPollTimer = setInterval(poll, 5000);
    }

    function humanStatus(s) {
        return ({
            waiting: 'Waiting for payment',
            confirming: 'Confirming on blockchain…',
            confirmed: 'Confirmed, processing',
            sending: 'Processing',
            finished: '✓ Complete',
            failed: '✕ Failed',
            expired: '✕ Expired',
            refunded: 'Refunded',
        })[s] || s;
    }

    function closeCheckoutModal() {
        if (_checkoutPollTimer) { clearInterval(_checkoutPollTimer); _checkoutPollTimer = null; }
        _checkoutPaymentId = null;
        closeModal('checkoutModal');
    }

    /* ============ Auth modal ============ */

    function renderAuthModal() {
        // Toggle between login/register view
        const isAuth = Session.isAuthenticated();
        const userBlock = document.getElementById('authUserBlock');
        const formBlock = document.getElementById('authFormBlock');
        const title = document.getElementById('authModalTitle');
        const googleBtn = document.getElementById('googleSignInBtn');
        const appleBtn = document.getElementById('appleSignInBtn');

        if (isAuth) {
            if (title) title.textContent = 'Account';
            if (userBlock) {
                userBlock.style.display = 'block';
                const name = Session.displayName() || '';
                const email = Session.email() || '';
                userBlock.querySelector('[data-user-email]').textContent = email;
                userBlock.querySelector('[data-user-name]').textContent = name;
                // First-letter avatar
                const avatar = userBlock.querySelector('.auth-user-avatar');
                if (avatar) {
                    avatar.textContent = (name[0] || email[0] || '?').toUpperCase();
                }
            }
            if (formBlock) formBlock.style.display = 'none';
        } else {
            if (title) title.textContent = 'Sign in';
            if (userBlock) userBlock.style.display = 'none';
            if (formBlock) formBlock.style.display = 'block';
        }

        // Social buttons hidden if not enabled
        if (googleBtn) googleBtn.style.display = CryptoTA_CONFIG.socialLoginEnabled ? 'flex' : 'none';
        if (appleBtn) appleBtn.style.display = CryptoTA_CONFIG.socialLoginEnabled ? 'flex' : 'none';
    }

    async function onLoginSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const email = form.email.value.trim();
        const password = form.password.value;
        if (!email || !password) return;
        const errEl = document.getElementById('authError');
        errEl.textContent = '';
        try {
            await Session.loginWithEmail(email, password);
            renderAuthButton();
            closeModal('authModal');
            showToast('Signed in');
        } catch (err) {
            errEl.textContent = err.message;
        }
    }

    async function onRegisterSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const email = form.email.value.trim();
        const password = form.password.value;
        if (!email || !password) return;
        const errEl = document.getElementById('authError');
        errEl.textContent = '';
        try {
            await Session.registerWithEmail(email, password);
            renderAuthButton();
            closeModal('authModal');
            showToast('Account created');
        } catch (err) {
            errEl.textContent = err.message;
        }
    }

    function onLogoutClick() {
        Session.logout();
        renderAuthButton();
        renderTierBadge();
        closeModal('authModal');
        showToast('Signed out');
    }

    /* ============ Toast (re-export for UI) ============ */

    function showToast(msg, ms) {
        if (window.appShowToast) {
            window.appShowToast(msg, ms);
        } else {
            // Fallback if app not loaded
            const t = document.getElementById('toast');
            if (t) {
                t.textContent = msg;
                t.style.display = 'block';
                clearTimeout(t._timer);
                t._timer = setTimeout(() => t.style.display = 'none', ms || 2500);
            }
        }
    }

    /* ============ Init ============ */

    function init() {
        renderTierBadge();
        renderAuthButton();
        renderUpgradeModal();
        renderAuthModal();

        // Bindings
        document.getElementById('tierBadge')?.addEventListener('click', () => {
            renderUpgradeModal();
            openModal('upgradeModal');
        });
        document.getElementById('authButton')?.addEventListener('click', () => {
            renderAuthModal();
            openModal('authModal');
        });
        document.getElementById('closeUpgradeModal')?.addEventListener('click', () => closeModal('upgradeModal'));
        document.getElementById('closeAuthModal')?.addEventListener('click', () => closeModal('authModal'));
        document.getElementById('closeCheckoutModal')?.addEventListener('click', closeCheckoutModal);
        document.getElementById('checkoutDoneBtn')?.addEventListener('click', () => {
            closeCheckoutModal();
            // Also close the upgrade modal so the user lands back on the chart
            closeModal('upgradeModal');
        });
        document.getElementById('checkoutCopyBtn')?.addEventListener('click', () => {
            const addr = document.getElementById('checkoutAddress').textContent;
            if (addr && addr !== '—') {
                navigator.clipboard?.writeText(addr).then(
                    () => showToast('Address copied'),
                    () => showToast('Copy failed — select text manually')
                );
            }
        });
        document.getElementById('checkoutCopyMemoBtn')?.addEventListener('click', () => {
            const memo = document.getElementById('checkoutMemo').textContent;
            if (memo && memo !== '—') {
                navigator.clipboard?.writeText(memo).then(
                    () => showToast('Memo copied'),
                    () => showToast('Copy failed — select text manually')
                );
            }
        });

        // Close on overlay click
        document.getElementById('upgradeModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'upgradeModal') closeModal('upgradeModal');
        });
        document.getElementById('authModal')?.addEventListener('click', (e) => {
            if (e.target.id === 'authModal') closeModal('authModal');
        });

        // Auth forms
        document.getElementById('loginForm')?.addEventListener('submit', onLoginSubmit);
        document.getElementById('registerForm')?.addEventListener('submit', onRegisterSubmit);
        document.getElementById('googleSignInBtn')?.addEventListener('click', () => {
            try { Session.loginWithGoogle(); } catch (e) { showToast(e.message); }
        });
        document.getElementById('appleSignInBtn')?.addEventListener('click', () => {
            try { Session.loginWithApple(); } catch (e) { showToast(e.message); }
        });
        document.getElementById('logoutBtn')?.addEventListener('click', onLogoutClick);

        // Toggle login/register
        const toggleToRegister = document.getElementById('toggleToRegister');
        const toggleToLogin = document.getElementById('toggleToLogin');
        toggleToRegister?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('registerForm').style.display = 'block';
            document.getElementById('authToggleText').textContent = 'Already have an account?';
            toggleToRegister.style.display = 'none';
            toggleToLogin.style.display = 'inline';
        });
        toggleToLogin?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('registerForm').style.display = 'none';
            document.getElementById('authToggleText').textContent = "Don't have an account?";
            toggleToRegister.style.display = 'inline';
            toggleToLogin.style.display = 'none';
        });

        // ESC closes any modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllModals();
        });

        // React to license / session changes
        License.onChange(() => {
            renderTierBadge();
            renderUpgradeModal();
        });
        Session.onChange(() => {
            renderAuthButton();
            renderAuthModal();
        });
    }

    return {
        init,
        renderTierBadge,
        renderAuthButton,
        renderUpgradeModal,
        openCheckoutModal,
        closeCheckoutModal,
        openModal,
        closeModal,
        showToast,
    };
})();

window.UI = UI;