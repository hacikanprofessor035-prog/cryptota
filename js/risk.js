/* Position-size / risk calculator.
 *
 * Enter account balance, risk % per trade, entry price, stop-loss price and
 * optional take-profit targets — the module computes position size (base +
 * quote), risk amount, and P&L per target with R:R ratio. The "Draw levels"
 * button paints entry / stop / TP lines on the chart through Drawing API
 * (horizontal lines), so the trade plan is visible directly on the chart.
 *
 * Everything is client-side math; nothing is sent anywhere.
 */
window.Risk = (() => {
    const LS_KEY = 'cryptota.risk.settings';
    let panelEl = null, buttonEl = null, open = false;

    const defaults = {
        balance: '1000',
        riskPct: '1',
        entry: '',
        stop: '',
        tp1: '',
        tp2: '',
        tif: 'GTC'
    };

    function load() {
        try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; }
        catch (_) { return { ...defaults }; }
    }
    function save(s) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (_) {}
    }

    let settings = load();

    function num(id) {
        const v = parseFloat(settings[id]);
        return Number.isFinite(v) ? v : null;
    }

    function activeSymbol() {
        const m = location.hash.match(/^#\/([A-Z0-9]+)\/\d+[a-z]/);
        return (m && m[1]) || (window.state && state.activePair) || 'BTCUSDT';
    }

    function currentPrice() {
        const el = document.getElementById('symbolPrice') || document.getElementById('headerPrice');
        const txt = el && el.textContent || '';
        const n = parseFloat(txt.replace(/[^0-9.]/g, ''));
        return Number.isFinite(n) ? n : null;
    }

    /* ---------- core math ---------- */
    function compute() {
        const balance = num('balance');
        const riskPct = num('riskPct');
        const entry = num('entry');
        const stop = num('stop');
        const tp1 = num('tp1');
        const tp2 = num('tp2');
        if (balance === null || riskPct === null || entry === null || stop === null) return null;
        if (entry <= 0 || stop <= 0 || balance <= 0) return null;
        if (entry === stop) return null;

        const riskAmount = balance * (riskPct / 100);
        const stopDist = Math.abs(entry - stop);
        const stopPct = (stopDist / entry) * 100;
        const side = stop < entry ? 'long' : 'short';
        // position size in base currency so that hitting stop = riskAmount
        const sizeBase = riskAmount / stopDist;
        const sizeQuote = sizeBase * entry;
        const leverage = sizeQuote / balance;

        const out = {
            riskAmount, stopDist, stopPct, side, sizeBase, sizeQuote,
            leverage: Number.isFinite(leverage) ? leverage : null,
            tps: []
        };
        for (const id of ['tp1', 'tp2']) {
            const tp = num(id);
            if (tp === null || tp <= 0 || tp === entry) continue;
            const favorable = side === 'long' ? tp > entry : tp < entry;
            const pnlPerUnit = side === 'long' ? tp - entry : entry - tp;
            const pnl = pnlPerUnit * sizeBase;
            const rr = Math.abs(pnl) / riskAmount;
            out.tps.push({
                id, price: tp, favorable,
                pnl: favorable ? pnl : (entry - tp) * sizeBase * -1,
                pnlPct: (favorable ? pnl / balance : (tp - entry) * sizeBase / balance) * 100,
                rr: favorable ? rr : -rr,
                distPct: (Math.abs(tp - entry) / entry) * 100
            });
        }
        return out;
    }

    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    function fmtUsd(v) {
        if (v === null || v === undefined) return '—';
        if (Math.abs(v) >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
        return '$' + v.toFixed(2);
    }

    function fmtPrice(v) {
        if (v === null || v === undefined) return '—';
        if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
        if (v >= 1) return v.toFixed(3);
        return v.toFixed(6);
    }

    /* ---------- render ---------- */
    function renderResults() {
        const box = panelEl.querySelector('#riskResults');
        const r = compute();
        if (!r) {
            box.innerHTML = '<div class="risk-hint">Fill balance, risk %, entry and stop to compute.</div>';
            return;
        }
        const sideLbl = r.side === 'long' ? 'Long ▲' : 'Short ▼';
        const sideCls = r.side === 'long' ? 'risk-up' : 'risk-down';
        box.innerHTML = `
            <div class="risk-row"><span>Direction</span><b class="${sideCls}">${sideLbl}</b></div>
            <div class="risk-row"><span>Risk amount</span><b>${fmtUsd(r.riskAmount)}</b></div>
            <div class="risk-row"><span>Stop distance</span><b>${fmtPrice(r.stopDist)} (${r.stopPct.toFixed(2)}%)</b></div>
            <div class="risk-row"><span>Position size</span><b>${fmtPrice(r.sizeBase)} <span class="risk-mut">${activeSymbol().replace(/USDT$/, '')}</span></b></div>
            <div class="risk-row"><span>Notional</span><b>${fmtUsd(r.sizeQuote)}</b></div>
            ${r.leverage !== null ? `<div class="risk-row"><span>Leverage</span><b class="${r.leverage > 5 ? 'risk-warn' : ''}">${r.leverage.toFixed(2)}x</b></div>` : ''}
            ${r.tps.length ? '<div class="risk-sep">Take profits</div>' : ''}
            ${r.tps.map(t => `
                <div class="risk-row">
                    <span>${t.id.toUpperCase()} @ ${fmtPrice(t.price)} <span class="risk-mut">(${t.distPct.toFixed(1)}%)</span></span>
                    <b class="${t.pnl >= 0 ? 'risk-up' : 'risk-down'}">
                        ${t.pnl >= 0 ? '+' : '-'}${fmtUsd(Math.abs(t.pnl))} · ${t.rr >= 0 ? '' : '-'}${Math.abs(t.rr).toFixed(2)}R
                    </b>
                </div>`).join('')}
        `;
        const drawBtn = panelEl.querySelector('#riskDraw');
        if (drawBtn) drawBtn.disabled = false;
    }

    /* ---------- draw levels on chart ---------- */
    function drawLevels() {
        const r = compute();
        if (!r) return;
        const sym = activeSymbol();
        const lines = [];
        const entry = num('entry'), stop = num('stop');
        lines.push({ type: 'hline', price: entry, color: '#5cc8c0', label: 'ENTRY ' + fmtPrice(entry) });
        lines.push({ type: 'hline', price: stop, color: '#ea3943', label: 'SL ' + fmtPrice(stop) });
        for (const t of r.tps) {
            lines.push({ type: 'hline', price: t.price, color: '#3d8b58', label: t.id.toUpperCase() + ' ' + fmtPrice(t.price) });
        }
        if (window.Drawing && Drawing.addProgrammatic) {
            // Replace any previous risk levels for this pair (avoid stacking)
            Drawing.clearProgrammatic && Drawing.clearProgrammatic();
            Drawing.addProgrammatic(sym, lines);
        }
        if (window.appShowToast) appShowToast(`Drew ${lines.length} levels on ${sym}`);
    }

    /* ---------- UI ---------- */
    function buildUI() {
        if (buttonEl) return;
        buttonEl = document.createElement('button');
        buttonEl.id = 'riskButton';
        buttonEl.className = 'ct-icon-btn';
        buttonEl.title = 'Risk calculator — position size, R:R, stop/take-profit levels';
        buttonEl.innerHTML = '⚖';
        const anchor = document.getElementById('mtfButton') || document.getElementById('summaryButton');
        if (anchor) anchor.parentNode.insertBefore(buttonEl, anchor);
        buttonEl.addEventListener('click', togglePanel);

        panelEl = document.createElement('div');
        panelEl.id = 'riskPanel';
        panelEl.className = 'risk-panel';
        panelEl.style.display = 'none';
        const fields = [
            ['balance', 'Account balance ($)', 'text'],
            ['riskPct', 'Risk per trade (%)', 'text'],
            ['entry', 'Entry price', 'text'],
            ['stop', 'Stop loss', 'text'],
            ['tp1', 'Take profit 1', 'text'],
            ['tp2', 'Take profit 2', 'text']
        ];
        panelEl.innerHTML = `
            <div class="risk-title">
                <span>⚖ Risk calculator — <b>${esc(activeSymbol())}</b></span>
                <button id="riskClose" class="risk-mini" title="Close (Esc)">✕</button>
            </div>
            <div class="risk-grid">
                ${fields.map(([id, label]) => `
                    <label class="risk-field">
                        <span>${label}</span>
                        <input id="risk_${id}" data-f="${id}" inputmode="decimal"
                               value="${esc(settings[id] || '')}" placeholder="0">
                    </label>`).join('')}
            </div>
            <div class="risk-actions">
                <button id="riskFill" class="risk-mini" title="Use current price">Use price</button>
                <button id="riskDraw" class="risk-mini" disabled>Draw levels</button>
            </div>
            <div id="riskResults"></div>
            <div class="risk-foot">Position sized so stop-loss = risk amount. Not financial advice.</div>`;
        document.body.appendChild(panelEl);

        panelEl.querySelectorAll('input[data-f]').forEach(inp => {
            inp.addEventListener('input', () => {
                settings[inp.dataset.f] = inp.value;
                save(settings);
                renderResults();
            });
        });
        panelEl.querySelector('#riskClose').addEventListener('click', () => togglePanel(false));
        panelEl.querySelector('#riskFill').addEventListener('click', () => {
            const p = currentPrice();
            if (p === null) return;
            const stop = num('stop');
            settings.entry = String(p);
            if (stop === null) settings.stop = String(+(p * 0.97).toFixed(p > 100 ? 2 : 6));
            if (num('tp1') === null) settings.tp1 = String(+(p * 1.06).toFixed(p > 100 ? 2 : 6));
            syncInputs();
            save(settings);
            renderResults();
        });
        panelEl.querySelector('#riskDraw').addEventListener('click', drawLevels);
    }

    function syncInputs() {
        panelEl.querySelectorAll('input[data-f]').forEach(inp => {
            inp.value = settings[inp.dataset.f] || '';
        });
    }

    function togglePanel(force) {
        buildUI();
        open = (typeof force === 'boolean') ? force : !open;
        panelEl.style.display = open ? 'block' : 'none';
        buttonEl.classList.toggle('active', open);
        if (open) {
            panelEl.querySelector('.risk-title b').textContent = activeSymbol();
            syncInputs();
            renderResults();
        }
    }

    function isOpen() { return open; }

    return { init: buildUI, togglePanel, isOpen };
})();
