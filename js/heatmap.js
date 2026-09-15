/* === CryptoTA — Market Heatmap ===
 * Grid of pairs grouped by quote asset (USDT, USDC, BTC, ETH ...).
 * Cell color = 24h change, font size scales with quote volume.
 * Data comes from the ticker map already in memory — no extra requests.
 *
 * Public API:
 *   Heatmap.open()   — show modal
 *   Heatmap.close()  — hide modal
 *   Heatmap.toggle() — open/close
 *   Heatmap.render(pairs, tickers, activeSymbol, opts) — (re)draw grid
 *   Heatmap.onSelect(cb) — register pair selection callback
 */
const Heatmap = (() => {

    let el = null;          // overlay container
    let gridEl = null;      // grid element
    let tabsEl = null;      // quote tabs
    let stateQuote = null;  // selected quote asset
    let selectCb = null;
    let lastRows = [];
    let sortMode = 'volume'; // 'volume' | 'change'

    const QUOTE_ORDER = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'BNB', 'TUSD', 'TRY', 'EUR', 'BRL'];

    /* ---------- color scale ---------- */
    // -10%..+10% maps to red -> bg -> green, clamped
    function changeColor(chg) {
        if (chg == null || isNaN(chg)) return 'rgba(155,164,184,0.10)';
        const c = Math.max(-10, Math.min(10, chg));
        if (c >= 0) {
            // teal-green scale
            const a = 0.06 + (c / 10) * 0.34;
            return `rgba(22, 199, 132, ${a.toFixed(2)})`;
        }
        const a = 0.06 + (-c / 10) * 0.34;
        return `rgba(234, 57, 67, ${a.toFixed(2)})`;
    }

    function textColor(chg) {
        if (chg == null || isNaN(chg)) return 'var(--text-2)';
        if (chg > 0.05) return 'var(--up)';
        if (chg < -0.05) return 'var(--down)';
        return 'var(--text-1)';
    }

    /* ---------- build ---------- */

    function ensureDOM() {
        if (el) return;
        el = document.createElement('div');
        el.className = 'modal-overlay heatmap-overlay';
        el.id = 'heatmapModal';
        el.style.display = 'none';
        el.innerHTML = `
            <div class="modal heatmap-modal">
                <div class="modal-head">
                    <h2>Market heatmap</h2>
                    <div class="hm-tabs" id="hmTabs"></div>
                    <button class="icon-btn" id="closeHeatmap" title="Close">✕</button>
                </div>
                <div class="hm-sub">
                    <span class="hm-sub-text" id="hmHint">Color = 24h change · size = volume · click a pair to open</span>
                    <button class="hm-sort-btn" id="hmSort" title="Toggle sort order">sort: volume</button>
                </div>
                <div class="hm-grid" id="hmGrid"></div>
            </div>
        `;
        document.body.appendChild(el);
        gridEl = el.querySelector('#hmGrid');
        tabsEl = el.querySelector('#hmTabs');
        el.querySelector('#closeHeatmap').addEventListener('click', close);
        el.querySelector('#hmSort').addEventListener('click', () => {
            sortMode = sortMode === 'volume' ? 'change' : 'volume';
            el.querySelector('#hmSort').textContent = 'sort: ' + sortMode;
            if (lastRows.length) draw(lastRows);
        });
        el.addEventListener('click', (e) => { if (e.target === el) close(); });
    }

    function render(pairs, tickers, activeSymbol, opts = {}) {
        ensureDOM();
        if (!pairs || !pairs.length) return;

        // group by quote
        const byQuote = new Map();
        for (const p of pairs) {
            if (!byQuote.has(p.quote)) byQuote.set(p.quote, []);
            byQuote.get(p.quote).push(p);
        }

        // choose quote tab
        const quotes = Array.from(byQuote.keys())
            .sort((a, b) => (QUOTE_ORDER.indexOf(a) + 1 || 99) - (QUOTE_ORDER.indexOf(b) + 1 || 99));
        if (!quotes.includes(stateQuote)) {
            stateQuote = opts.quote && quotes.includes(opts.quote) ? opts.quote : (quotes[0] || 'USDT');
        }

        // tabs
        tabsEl.innerHTML = quotes.map(q => {
            const n = byQuote.get(q).length;
            return `<button class="hm-tab ${q === stateQuote ? 'active' : ''}" data-quote="${q}">${q} <span class="hm-tab-n">${n}</span></button>`;
        }).join('');
        tabsEl.querySelectorAll('.hm-tab').forEach(b => {
            b.addEventListener('click', () => {
                stateQuote = b.dataset.quote;
                render(pairs, tickers, activeSymbol, { quote: stateQuote });
            });
        });

        // rows for this quote, enriched with ticker
        let rows = byQuote.get(stateQuote).map(p => {
            const t = tickers && tickers[p.symbol] ? tickers[p.symbol] : {};
            return {
                symbol: p.symbol,
                base: p.base,
                quote: p.quote,
                last: t.last ?? null,
                change: t.change ?? null,
                quoteVolume: t.quoteVolume ?? 0,
            };
        });

        // filter + sort
        if (opts.query) {
            const q = String(opts.query).toLowerCase();
            rows = rows.filter(r => r.symbol.toLowerCase().includes(q) || r.base.toLowerCase().includes(q));
        }
        rows = rows.filter(r => r.change !== null);
        rows.sort((a, b) => sortMode === 'volume' ? (b.quoteVolume - a.quoteVolume) : (b.change - a.change));
        // cap grid for perf (USDT has 400+ pairs)
        const CAP = 60;
        const capped = rows.slice(0, CAP);

        lastRows = rows;
        draw(capped, activeSymbol);
    }

    function draw(rows, activeSymbol) {
        // font-size scale by volume rank
        const maxV = rows.length ? Math.max(...rows.map(r => r.quoteVolume)) : 1;
        gridEl.innerHTML = rows.map(r => {
            const volRank = maxV > 0 ? r.quoteVolume / maxV : 0;
            const fs = (11 + volRank * 8).toFixed(1); // 11px..19px
            const sign = (r.change ?? 0) > 0 ? '+' : '';
            const chgTxt = r.change !== null ? `${sign}${r.change.toFixed(2)}%` : '—';
            return `<button class="hm-cell" data-symbol="${r.symbol}"
                style="background:${changeColor(r.change)}; font-size:${fs}px;"
                title="${r.base}/${r.quote} — ${chgTxt} · vol ${fmtVol(r.quoteVolume)} ${r.quote}">
                <span class="hm-cell-base">${r.base}</span>
                <span class="hm-cell-chg" style="color:${textColor(r.change)}">${chgTxt}</span>
            </button>`;
        }).join('') || '<div class="empty-state">No pairs with ticker data</div>';

        gridEl.querySelectorAll('.hm-cell').forEach(c => {
            c.addEventListener('click', () => {
                if (selectCb) selectCb(c.dataset.symbol);
                close();
            });
        });
    }

    function fmtVol(v) {
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return (v || 0).toFixed(0);
    }

    function open() { ensureDOM(); el.style.display = 'flex'; }
    function close() { if (el) el.style.display = 'none'; }
    function toggle() { if (!el || el.style.display === 'none') open(); else close(); }
    function isOpen() { return !!el && el.style.display !== 'none'; }
    function getQuote() { return stateQuote; }
    function onSelect(cb) { selectCb = cb; }

    return { render, open, close, toggle, isOpen, getQuote, onSelect };
})();

window.Heatmap = Heatmap;
