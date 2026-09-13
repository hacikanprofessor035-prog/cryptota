// CryptoTA — Price Alerts (Web Push) module.
// Depends on: window.Session (auth state), window.CONFIG (api paths).
// Exposes: AlertsUI.init(container) — renders bell button + panel.
//
// Flow:
//   1. Bell button shows in the topbar (next to auth button).
//   2. Panel: list of user alerts + "add alert" form (symbol prefilled
//      with the current pair, price with the current price).
//   3. "Enable notifications" — asks Notification permission, subscribes
//      via PushManager with the server's VAPID public key, POSTs to
//      /api/alerts/subscribe.
//   4. Test push button — server sends a real notification.
const AlertsUI = (() => {
    let visible = false;
    let lastData = { alerts: [], vapidPublicKey: null };
    let container = null;

    const $ = (sel) => container ? container.querySelector(sel) : null;

    async function api(path, opts = {}) {
        const token = window.Session?.token?.();   // Session.token() is a function
        const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        if (token) headers.Authorization = 'Bearer ' + token;
        const res = await fetch(path, { ...opts, headers });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(j.error || ('HTTP ' + res.status));
            err.status = res.status;
            err.upgrade = !!j.upgrade;
            throw err;
        }
        return j;
    }

    async function loadAlerts() {
        try {
            lastData = await api('/api/alerts');
            renderList();
        } catch (e) {
            if (e.status === 401) {
                renderAuthNeeded();
            } else {
                renderError(e.message);
            }
        }
    }

    function currentSymbol() {
        // app.js keeps the URL hash in sync with the active pair (e.g. #/BTCUSDT/4h)
        const m = location.hash.match(/^#\/([A-Z0-9]+)\/\d+[a-z]/);
        if (m) return m[1];
        return 'BTCUSDT';
    }

    function currentPrice() {
        // Sidebar tickers are public state in app.js — not exported; but the
        // header price element is rendered from the live ticker.
        const el = document.getElementById('headerPrice');
        const txt = el && el.textContent || '';
        const num = parseFloat(txt.replace(/[^0-9.]/g, ''));
        return Number.isFinite(num) ? num : null;
    }

    async function addAlert(symbol, direction, targetPrice) {
        return api('/api/alerts', {
            method: 'POST',
            body: JSON.stringify({ symbol, direction, targetPrice }),
        });
    }

    async function removeAlert(id) {
        return api('/api/alerts/' + id, { method: 'DELETE' });
    }

    async function subscribePush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            throw new Error('This browser does not support push notifications');
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission denied');

        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        const key = lastData.vapidPublicKey;
        if (!key) throw new Error('Server push is not configured');

        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64ToUint8Array(key),
        });
        const j = sub.toJSON();
        await api('/api/alerts/subscribe', {
            method: 'POST',
            body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
        });
    }

    function urlB64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    // ===== rendering =====

    function renderAuthNeeded() {
        if (!$('#alertsList')) return;
        $('#alertsList').innerHTML =
            '<div class="alerts-empty">Sign in to create price alerts.<br>' +
            '<span class="muted">Alerts are a Pro feature — they watch prices for you, 24/7.</span></div>';
    }

    function renderError(msg) {
        if (!$('#alertsList')) return;
        $('#alertsList').innerHTML = '<div class="alerts-error">⚠ ' + esc(msg) + '</div>';
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
    }

    function fmtPrice(p) {
        const n = Number(p);
        if (!Number.isFinite(n)) return String(p);
        return n >= 100 ? n.toFixed(2) : n.toPrecision(6).replace(/0+$/, '').replace(/\.$/, '');
    }

    function renderList() {
        const listEl = $('#alertsList');
        if (!listEl) return;
        const alerts = lastData.alerts || [];
        if (!alerts.length) {
            listEl.innerHTML = '<div class="alerts-empty">No alerts yet.<br><span class="muted">Add one below — the server checks prices every minute.</span></div>';
            return;
        }
        listEl.innerHTML = alerts.map(a => {
            const arrow = a.direction === 'above' ? '↑ above' : '↓ below';
            const status = a.status === 'triggered'
                ? `<span class="alert-status triggered">✓ triggered ${a.triggered_at ? new Date(a.triggered_at).toLocaleDateString() : ''}</span>`
                : '<span class="alert-status active">active</span>';
            return `<div class="alert-row" data-id="${a.id}">
                <div class="alert-main">
                    <span class="alert-symbol">${esc(a.symbol)}</span>
                    <span class="alert-arrow ${a.direction}">${arrow} $${fmtPrice(a.target_price)}</span>
                    ${status}
                </div>
                <button class="alert-del" title="Delete">✕</button>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.alert-del').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const row = e.target.closest('.alert-row');
                const id = row?.dataset.id;
                if (!id) return;
                try {
                    await removeAlert(id);
                    loadAlerts();
                } catch (err) {
                    renderError(err.message);
                }
            });
        });
    }

    function buildPanel() {
        container = document.createElement('div');
        container.id = 'alertsPanel';
        container.className = 'alerts-panel';
        container.style.display = 'none';
        container.innerHTML = `
            <div class="alerts-head">
                <span>🔔 Price alerts</span>
                <button id="alertsClose" title="Close">✕</button>
            </div>
            <div id="alertsList" class="alerts-list"></div>
            <form id="alertForm" class="alert-form">
                <select id="alertDir" class="alert-input">
                    <option value="above">above</option>
                    <option value="below">below</option>
                </select>
                <input id="alertPrice" class="alert-input" type="number" step="any"
                    placeholder="price" inputmode="decimal">
                <button type="submit" class="alert-add-btn" title="Add alert">Add</button>
            </form>
            <div class="alerts-push">
                <button id="enablePush" class="push-btn"><svg class="icon-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Enable notifications</button>
                <button id="testPush" class="push-btn ghost" style="display:none">Test push</button>
            </div>
        `;
        document.body.appendChild(container);

        $('#alertsClose').addEventListener('click', togglePanel);
        $('#alertForm').addEventListener('submit', onAdd);
        $('#enablePush').addEventListener('click', onEnablePush);
        $('#testPush').addEventListener('click', onTestPush);
    }

    async function onAdd(e) {
        e.preventDefault();
        const price = $('#alertPrice').value;
        const dir = $('#alertDir').value;
        if (!price) return;
        try {
            await addAlert(currentSymbol(), dir, Number(price));
            $('#alertPrice').value = '';
            await loadAlerts();
        } catch (err) {
            if (err.upgrade) {
                $('#alertsList').innerHTML =
                    '<div class="alerts-empty">Price alerts are a <b>Pro</b> feature.<br>' +
                    'Upgrade to get price watches with push notifications.</div>';
            } else {
                renderError(err.message);
            }
        }
    }

    async function onEnablePush() {
        const btn = $('#enablePush');
        btn.disabled = true;
        btn.textContent = '…';
        try {
            await subscribePush();
            btn.textContent = '✓ Notifications enabled';   // plain text ok — transient state
            $('#testPush').style.display = '';
        } catch (e) {
            btn.innerHTML = BELL_S + ' Enable notifications';
            btn.disabled = false;
            renderError(e.message);
        }
    }

    async function onTestPush() {
        const btn = $('#testPush');
        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
            const r = await api('/api/alerts/test-push', { method: 'POST' });
            btn.textContent = r.sent > 0 ? '✓ Sent — check your device' : 'No registered devices';
            if (r.skipped === 'not-configured') btn.textContent = 'Push not configured on server';
        } catch (e) {
            btn.textContent = 'Test push';
            renderError(e.message);
        }
        setTimeout(() => { btn.textContent = 'Test push'; btn.disabled = false; }, 4000);
    }

    function togglePanel() {
        if (!container) buildPanel();
        visible = !visible;
        container.style.display = visible ? '' : 'none';
        const btn = document.getElementById('alertsBell');
        if (btn) btn.classList.toggle('active', visible);
        if (visible) loadAlerts();
    }

    const BELL_S = '<svg class="icon-svg" width="13" height="13" style="vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    const BELL_ICON = '<svg class="icon-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

    function buildBell() {
        const btn = document.createElement('button');
        btn.id = 'alertsBell';
        btn.className = 'ct-icon-btn';
        btn.title = 'Price alerts (Pro)';
        btn.innerHTML = BELL_ICON;
        const anchor = document.getElementById('tierBadge') || document.getElementById('authButton');
        anchor.parentNode.insertBefore(btn, anchor);
        btn.addEventListener('click', togglePanel);
    }

    async function init() {
        if (!window.Session) return;
        buildBell();
        // Register the SW early so push subscription works even before
        // the panel is ever opened.
        if ('serviceWorker' in navigator) {
            try { await navigator.serviceWorker.register('/sw.js'); } catch (_) {}
        }
    }

    return { init, togglePanel };
})();

window.AlertsUI = AlertsUI;
