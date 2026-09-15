/* Multi-timeframe signal panel.
 *
 * Fetches the active pair on 5 timeframes (15m, 1h, 4h, 1d, 1w) and shows a
 * compact grid: trend (EMA20 vs EMA50 vs SMA200), RSI, MACD, Stoch — one row
 * per timeframe. Lets you see at a glance whether higher and lower
 * timeframes agree, which is the core of "confluence" trading.
 *
 * Cheap: one REST call per TF with limit=250 (only while the panel is open),
 * recalculated on pair change / refresh button. Live last price from the
 * ticker stream is used for the "current candle" signals.
 */
window.MTF = (() => {
    const TIMEFRAMES = ['15m', '1h', '4h', '1d', '1w'];
    const CACHE_TTL = 60_000;   // re-fetch at most once per minute

    const cache = new Map();    // key: symbol -> { at, rows }
    let panelEl = null, buttonEl = null;
    let open = false;
    let symbol = null;
    let rafPending = false;

    function activeSymbol() {
        const m = location.hash.match(/^#\/([A-Z0-9]+)\/\d+[a-z]/);
        return (m && m[1]) || (window.state && state.activeSymbol) || 'BTCUSDT';
    }

    /* ---------- signal math (self-contained, no indicator deps) ---------- */
    function ema(data, period) {
        const out = new Array(data.length).fill(null);
        const k = 2 / (period + 1);
        let prev = null;
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            if (v === null || v === undefined) continue;
            if (prev === null) { prev = v; out[i] = v; continue; }
            prev = v * k + prev * (1 - k);
            out[i] = prev;
        }
        return out;
    }

    function sma(data, period) {
        const out = new Array(data.length).fill(null);
        let sum = 0, count = 0;
        for (let i = 0; i < data.length; i++) {
            sum += data[i]; count++;
            if (count > period) { sum -= data[i - period]; count--; }
            if (count === period) out[i] = sum / period;
        }
        return out;
    }

    function rsiCalc(data, period = 14) {
        const out = new Array(data.length).fill(null);
        let gain = 0, loss = 0;
        for (let i = 1; i <= period && i < data.length; i++) {
            const d = data[i] - data[i - 1];
            if (d >= 0) gain += d; else loss -= d;
        }
        if (data.length <= period) return out;
        let ag = gain / period, al = loss / period;
        out[period] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al));
        for (let i = period + 1; i < data.length; i++) {
            const d = data[i] - data[i - 1];
            const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
            ag = (ag * (period - 1) + g) / period;
            al = (al * (period - 1) + l) / period;
            out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
        }
        return out;
    }

    function macdCalc(data, fast = 12, slow = 26, signal = 9) {
        const ef = ema(data, fast), es = ema(data, slow);
        const macdLine = data.map((_, i) =>
            (ef[i] !== null && es[i] !== null) ? ef[i] - es[i] : null);
        // signal = EMA of macd (treat leading nulls as 0 for seeding)
        const valid = macdLine.map(v => v === null ? 0 : v);
        const sig = ema(valid, signal);
        return { macd: macdLine, signal: sig };
    }

    function stochCalc(candles, kP = 14, dP = 3) {
        const n = candles.length;
        const rawK = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            if (i < kP - 1) continue;
            let hh = -Infinity, ll = Infinity;
            for (let j = i - kP + 1; j <= i; j++) {
                if (candles[j].high > hh) hh = candles[j].high;
                if (candles[j].low < ll) ll = candles[j].low;
            }
            rawK[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
        }
        const k = sma(rawK.map(v => v === null ? 0 : v), dP).map((v, i) => rawK[i] === null ? null : v);
        return { k };
    }

    function lastValid(arr) {
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i];
        return null;
    }

    /* ---------- row computation for one timeframe ---------- */
    function computeRow(tf, candles) {
        const closes = candles.map(c => c.close);
        const e20 = lastValid(ema(closes, 20));
        const e50 = lastValid(ema(closes, 50));
        const s200 = lastValid(sma(closes, 200));
        const price = closes[closes.length - 1];
        const rsi = lastValid(rsiCalc(closes, 14));
        const m = macdCalc(closes);
        const macdNow = lastValid(m.macd), sigNow = lastValid(m.signal);
        const st = stochCalc(candles);
        const kNow = lastValid(st.k);

        // Trend: stacked EMAs + price vs SMA200
        let trendScore = 0;
        if (e20 !== null && e50 !== null) trendScore += (e20 > e50 ? 1 : -1);
        if (s200 !== null) trendScore += (price > s200 ? 1 : -1);
        if (e50 !== null && s200 !== null) trendScore += (e50 > s200 ? 1 : -1);
        const trend = trendScore >= 2 ? 'Bullish' : (trendScore <= -2 ? 'Bearish' : 'Mixed');

        // Momentum: RSI + MACD + Stoch
        let momScore = 0;
        if (rsi !== null) momScore += (rsi > 55 ? 1 : (rsi < 45 ? -1 : 0));
        if (macdNow !== null && sigNow !== null) momScore += (macdNow > sigNow ? 1 : -1);
        if (kNow !== null) momScore += (kNow > 80 ? 1 : (kNow < 20 ? -1 : 0));
        const momentum = momScore >= 2 ? 'Bullish' : (momScore <= -2 ? 'Bearish' : (momScore === 0 ? 'Neutral' : 'Mixed'));

        return { tf, trend, momentum, rsi, macd: macdNow, macdSig: sigNow, stoch: kNow, price, e20, e50, s200,
                 trendScore, momScore };
    }

    /* ---------- fetching ---------- */
    async function loadSymbol(sym) {
        symbol = sym;
        if (panelEl) {
            panelEl.querySelector('.mtf-rows').innerHTML =
                '<div class="mtf-loading">Loading ' + esc(sym) + '…</div>';
        }
        const entry = cache.get(sym);
        const now = Date.now();
        if (entry && now - entry.at < CACHE_TTL) { renderRows(entry.rows); return; }

        const rows = [];
        for (const tf of TIMEFRAMES) {
            try {
                const candles = await (window.BinanceAPI || Binance).getKlines(sym, tf, 250);
                rows.push(computeRow(tf, candles));
            } catch (e) {
                rows.push({ tf, error: true });
            }
        }
        cache.set(sym, { at: now, rows });
        renderRows(rows);
    }

    function refresh() { cache.delete(symbol); loadSymbol(symbol); }

    /* ---------- rendering ---------- */
    function esc(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    function clsFor(v) { return v === 'Bullish' ? 'mtf-up' : (v === 'Bearish' ? 'mtf-down' : 'mtf-mid'); }

    function fmtNum(v, digits = 2) {
        if (v === null || v === undefined || !Number.isFinite(v)) return '—';
        return v.toFixed(digits);
    }

    function renderRows(rows) {
        if (!panelEl) return;
        const body = panelEl.querySelector('.mtf-rows');
        if (!body) return;
        if (!rows.length) { body.innerHTML = '<div class="mtf-loading">No data</div>'; return; }

        body.innerHTML = `
            <div class="mtf-head mtf-row">
                <span>TF</span><span>Trend</span><span>RSI</span><span>MACD</span><span>Stoch</span>
            </div>` + rows.map(r => {
            if (r.error) {
                return `<div class="mtf-row mtf-err"><span>${esc(r.tf)}</span><span colspan="4">failed — check connection</span></div>`;
            }
            const macdState = (r.macd !== null && r.macdSig !== null)
                ? (r.macd > r.macdSig ? '▲' : '▼') : '—';
            return `<div class="mtf-row">
                <span class="mtf-tf">${esc(r.tf)}</span>
                <span class="${clsFor(r.trend)}">${esc(r.trend)}</span>
                <span class="${r.rsi === null ? 'mtf-mid' : (r.rsi > 55 ? 'mtf-up' : (r.rsi < 45 ? 'mtf-down' : 'mtf-mid'))}">${fmtNum(r.rsi, 1)}</span>
                <span class="${r.macd !== null && r.macdSig !== null ? (r.macd > r.macdSig ? 'mtf-up' : 'mtf-down') : 'mtf-mid'}">${macdState}</span>
                <span class="${r.stoch === null ? 'mtf-mid' : (r.stoch > 80 ? 'mtf-up' : (r.stoch < 20 ? 'mtf-down' : 'mtf-mid'))}">${fmtNum(r.stoch, 1)}</span>
            </div>`;
        }).join('');

        // Overall confluence verdict
        const ok = rows.filter(r => !r.error);
        if (ok.length) {
            const bulls = ok.filter(r => r.trend === 'Bullish').length;
            const bears = ok.filter(r => r.trend === 'Bearish').length;
            const verdict = bulls > bears ? 'Bullish confluence'
                : (bears > bulls ? 'Bearish confluence' : 'Mixed — no confluence');
            const vEl = panelEl.querySelector('.mtf-verdict');
            if (vEl) {
                vEl.className = 'mtf-verdict ' + (bulls > bears ? 'mtf-up' : (bears > bulls ? 'mtf-down' : 'mtf-mid'));
                vEl.textContent = `${verdict} — ${Math.max(bulls, bears)}/${ok.length} timeframes aligned`;
            }
        }
    }

    /* ---------- panel ---------- */
    function buildUI() {
        if (buttonEl) return;
        buttonEl = document.createElement('button');
        buttonEl.id = 'mtfButton';
        buttonEl.className = 'ct-icon-btn';
        buttonEl.title = 'Multi-timeframe signals — 15m / 1h / 4h / 1d / 1w';
        buttonEl.innerHTML = '⏱';
        const anchor = document.getElementById('summaryButton') || document.getElementById('bookButton');
        if (anchor) anchor.parentNode.insertBefore(buttonEl, anchor);
        buttonEl.addEventListener('click', togglePanel);

        panelEl = document.createElement('div');
        panelEl.id = 'mtfPanel';
        panelEl.className = 'mtf-panel';
        panelEl.style.display = 'none';
        panelEl.innerHTML = `
            <div class="mtf-title">
                <span>⏱ Multi-timeframe — <b id="mtfSymbol"></b></span>
                <span>
                    <button id="mtfRefresh" class="mtf-mini" title="Re-fetch">⟳</button>
                    <button id="mtfClose" class="mtf-mini" title="Close (Esc)">✕</button>
                </span>
            </div>
            <div class="mtf-rows"></div>
            <div class="mtf-verdict mtf-mid"></div>
            <div class="mtf-foot">Trend: EMA20&gt;EMA50&gt;SMA200 · RSI 14 · MACD 12/26/9 · Stoch 14/3</div>`;
        document.body.appendChild(panelEl);

        panelEl.querySelector('#mtfClose').addEventListener('click', () => togglePanel(false));
        panelEl.querySelector('#mtfRefresh').addEventListener('click', refresh);
    }

    function togglePanel(force) {
        buildUI();
        open = (typeof force === 'boolean') ? force : !open;
        panelEl.style.display = open ? 'block' : 'none';
        buttonEl.classList.toggle('active', open);
        if (open) {
            const sym = activeSymbol();
            panelEl.querySelector('#mtfSymbol').textContent = sym;
            loadSymbol(sym);
        }
    }

    function isOpen() { return open; }

    // Pair changed → refresh visible panel
    function onPairChanged(sym) {
        if (!open) return;
        panelEl.querySelector('#mtfSymbol').textContent = sym;
        const e = cache.get(sym);
        if (e && Date.now() - e.at < CACHE_TTL) renderRows(e.rows);
        else loadSymbol(sym);
    }

    return { init: buildUI, togglePanel, isOpen, onPairChanged, refresh };
})();
