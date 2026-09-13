/* Compare pairs — overlay a second pair as a normalized % line.
 *
 * UX: "⇄ Compare" button in the topbar → symbol input (datalist of top
 * pairs) → second series fetched from Binance, aligned by candle TIME
 * (not index) and drawn as a % change line relative to the first visible
 * candle. The main pair stays candles; the compare series is an overlay
 * line in its own subtle color. Removes cleanly (✕ or pair switch).
 *
 * Why normalized %: BTC at $95k and ETH at $3.2k cannot share a price
 * axis. Percent-scale from a common start is how pro terminals do
 * "compare" (TradingView does exactly this).
 */
window.Compare = (function () {
    const COMPARE_COLOR = '#b39ddb';   // soft purple, fits palette
    const COMPARE_DIM = 'rgba(179,157,219,0.55)';

    const state = {
        symbol: null,        // compare pair symbol, e.g. 'ETHUSDT'
        candles: [],         // its own candle array (time, close, ...)
        lastPrice: null,     // live last price (for the Y-axis pill)
        enabled: false,
        offset: 0,           // vertical centering offset (px), drag on pill
    };

    const el = {};   // DOM refs

    function init() {
        buildUI();
    }

    /* ---------- UI: button + input popover ---------- */

    function buildUI() {
        const btn = document.createElement('button');
        btn.id = 'compareButton';
        btn.className = 'indicator-btn compare-btn';
        btn.title = 'Compare pairs — overlay a second pair as normalized %';
        btn.innerHTML = '<span>⇄</span> Compare';
        const anchor = document.getElementById('addIndicatorBtn');
        anchor.parentNode.insertBefore(btn, anchor);

        const pop = document.createElement('div');
        pop.id = 'comparePopover';
        pop.className = 'compare-popover';
        pop.style.display = 'none';
        pop.innerHTML = `
            <div class="compare-row">
                <input id="compareInput" list="compareSymbols" class="compare-input"
                       placeholder="Pair, e.g. ETHUSDT" autocomplete="off" spellcheck="false">
                <datalist id="compareSymbols">
                    <option value="BTCUSDT"><option value="ETHUSDT">
                    <option value="TONUSDT"><option value="SOLUSDT">
                    <option value="BNBUSDT"><option value="XRPUSDT">
                </datalist>
                <button id="compareGo" class="compare-go">Compare</button>
            </div>
            <div class="compare-row compare-note" style="display:none" id="compareNote">
                <span>Normalized % scale · first visible candle = 100</span>
            </div>`;
        document.querySelector('.topbar-controls').appendChild(pop);

        btn.addEventListener('click', () => {
            const on = pop.style.display === 'none';
            pop.style.display = on ? '' : 'none';
            if (on) el.input.focus();
        });

        el.btn = btn; el.pop = pop;
        el.input = pop.querySelector('#compareInput');
        el.go = pop.querySelector('#compareGo');
        el.note = pop.querySelector('#compareNote');

        el.go.addEventListener('click', applyCompare);
        el.input.addEventListener('keydown', e => {
            if (e.key === 'Enter') applyCompare();
            if (e.key === 'Escape') { pop.style.display = 'none'; }
        });
    }

    /* ---------- data ---------- */

    function norm(sym) {
        return String(sym || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    async function applyCompare() {
        const sym = norm(el.input.value);
        if (!sym) { remove(); return; }
        const mainSym = (location.hash.match(/^#\/([A-Z0-9]+)/) || [])[1] || 'BTCUSDT';
        if (sym === mainSym) {
            el.note.textContent = 'Same pair as main chart';
            el.note.style.display = '';
            return;
        }
        el.go.disabled = true;
        el.go.textContent = '…';
        try {
            const tf = (location.hash.match(/^#\/[A-Z0-9]+\/([a-z0-9]+)/) || [])[1] || '4h';
            const candles = await window.BinanceAPI.getKlines(sym, tf, 500);
            state.symbol = sym;
            state.candles = candles;
            state.enabled = true;
            el.note.textContent = `${sym} overlay active — normalized % from first visible candle`;
            el.note.style.display = '';
            el.btn.classList.add('active');
            ChartEngine.render();
        } catch (e) {
            el.note.textContent = `Load error: ${e.message}`;
            el.note.style.display = '';
        } finally {
            el.go.disabled = false;
            el.go.textContent = 'Compare';
        }
    }

    function remove() {
        state.enabled = false;
        state.symbol = null;
        state.candles = [];
        el.note.style.display = 'none';
        el.btn.classList.remove('compare-active');
        if (el.btn.classList.contains('active')) el.btn.classList.remove('active');
        ChartEngine.render();
    }

    /* ---------- rendering: called from chart.js ---------- */

    /* Draw the normalized % line for the compare pair, aligned to the
     * main candles by TIME (matching candle timestamps when the pair
     * trades on the same schedule — true for all Binance USDT pairs). */
    function draw(ctx, range, helpers) {
        if (!state.enabled || !state.candles.length) return;
        const { xForIndex, yForPrice, priceArea } = helpers;
        const main = helpers.getCandles();

        // Map: time → index in the main visible window
        const viewStart = helpers.getViewStart && helpers.getViewStart();
        const viewCount = helpers.getViewCount && helpers.getViewCount();
        if (viewStart == null) return;

        // Build aligned array: for each visible main candle, find the
        // compare candle with the same close time (binary search).
        const times = state.candles.map(c => c.time);
        const aligned = [];
        for (let i = viewStart; i < viewStart + viewCount && i < main.length; i++) {
            const t = main[i].time;
            let lo = 0, hi = times.length - 1, idx = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (times[mid] === t) { idx = mid; break; }
                else if (times[mid] < t) lo = mid + 1;
                else hi = mid - 1;
            }
            if (idx >= 0) aligned.push({ i, c: state.candles[idx] });
        }
        if (aligned.length < 2) return;

        // Normalize: first aligned close = 0%, others = % change
        const base = aligned[0].c.close;
        if (!base) return;

        // Map %-change → Y pixel: use the main price range for scale
        // reference, then scale both series to the same visual band.
        const { top, height } = priceArea();
        const mainPct = pctSeries(main, viewStart, viewCount);
        const cmpPct = aligned.map(a => ({ i: a.i, pct: (a.c.close / base - 1) * 100 }));

        // Combined % range across both series → normalized placement
        const all = mainPct.concat(cmpPct.map(p => p.pct));
        let minPct = Math.min(...all), maxPct = Math.max(...all);
        if (!isFinite(minPct) || !isFinite(maxPct) || maxPct - minPct < 1e-9) { minPct = -1; maxPct = 1; }

        const yForPct = (pct) => {
            const t = (pct - minPct) / (maxPct - minPct);
            return top + (1 - t) * height;   // top = maxPct
        };

        // Main pair % line (subtle reference line) — only when compare is on
        ctx.strokeStyle = 'rgba(255,255,255,0.30)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        let started = false;
        for (const p of mainPct) {
            const x = xForIndex(p.i), y = yForPct(p.pct);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Compare pair line
        ctx.strokeStyle = COMPARE_COLOR;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        started = false;
        for (const p of cmpPct) {
            const x = xForIndex(p.i), y = yForPct(p.pct);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Label at the right edge: SYMBOL +spct%
        const lastP = cmpPct[cmpPct.length - 1];
        const lx = xForIndex(lastP.i), ly = yForPct(lastP.pct);
        const pctStr = (lastP.pct >= 0 ? '+' : '') + lastP.pct.toFixed(2) + '%';
        const label = `${state.symbol} ${pctStr}`;
        ctx.font = '10px JetBrains Mono, monospace';
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(20,24,38,0.92)';
        ctx.fillRect(lx - w, ly - 8, w, 16);
        ctx.fillStyle = COMPARE_COLOR;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx - 5, ly);
    }

    function pctSeries(candles, viewStart, viewCount) {
        // % change of closes over the visible window (main pair)
        const out = [];
        const base = candles[viewStart]?.close;
        if (!base) return out;
        for (let i = viewStart; i < viewStart + viewCount && i < candles.length; i++) {
            out.push({ i, pct: (candles[i].close / base - 1) * 100 });
        }
        return out;
    }

    /* ---------- public API ---------- */

    init();

    return {
        draw,           // (ctx, range, helpers) — called by chart.js after drawSeries
        remove,         // drop the overlay
        isActive: () => state.enabled,
        getSymbol: () => state.symbol,
        isPair: (s) => state.symbol === s,
    };
})();
