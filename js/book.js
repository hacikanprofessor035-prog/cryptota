/* === CryptoTA — Order Book (market depth) ===
 * Top N bids/asks via Binance partial depth stream. Renders a compact
 * two-sided ladder with cumulative depth bars, spread and mid price.
 *
 * Public API:
 *   Book.open(symbol)  — connect stream for symbol, show panel
 *   Book.close()       — disconnect, hide panel
 *   Book.toggle(symbol)
 *   Book.isOpen()
 *   Book.setSymbol(symbol) — swap stream when pair changes
 */
const Book = (() => {

    const LEVELS = 12;           // rows per side
    const DEPTH_STEPS = 6;       // cumulative depth markers (% from mid)

    let el = null;
    let stream = null;
    let curSymbol = null;
    let lastSnap = null;
    let rafPending = false;      // throttle renders to one per frame
    let quote = '';
    let pricePrecision = 2;

    /* ---------- formatting ---------- */
    // Trim trailing zeros, adapt precision to the asset's price scale.
    function fmtP(p) {
        if (p == null || isNaN(p)) return '—';
        let digits;
        if (p >= 1000) digits = 2;
        else if (p >= 1) digits = 4;
        else if (p >= 0.01) digits = 6;
        else if (p >= 0.0001) digits = 8;
        else digits = 10;
        const s = p.toFixed(digits);
        // keep at least 2 significant decimals, trim the rest
        const [intPart, dec] = s.split('.');
        if (!dec) return intPart;
        let trimmed = dec.replace(/0+$/, '');
        if (trimmed.length < 2) trimmed = (dec + '00').slice(0, 2);
        return trimmed ? `${intPart}.${trimmed}` : intPart;
    }
    function fmtQ(q) {
        if (q == null || isNaN(q)) return '—';
        if (q >= 1e9) return (q / 1e9).toFixed(2) + 'B';
        if (q >= 1e6) return (q / 1e6).toFixed(2) + 'M';
        if (q >= 1e3) return (q / 1e3).toFixed(2) + 'K';
        return q.toFixed(3);
    }

    /* ---------- DOM ---------- */
    function ensureDOM() {
        if (el) return;
        el = document.createElement('div');
        el.className = 'strategy-panel book-panel';
        el.id = 'bookPanel';
        el.style.display = 'none';
        el.innerHTML = `
            <div class="strategy-panel-head" title="Drag to move">
                <span class="strategy-panel-title">▤ Order book <span class="book-symbol" id="bookSymbol"></span></span>
                <button class="icon-btn small" id="hideBookPanel" title="Hide panel">−</button>
            </div>
            <div class="book-body" id="bookBody">
                <div class="book-cols">
                    <div class="book-col book-asks" id="bookAsks"></div>
                    <div class="book-col book-bids" id="bookBids"></div>
                </div>
                <div class="book-spread" id="bookSpread"></div>
            </div>
        `;
        document.body.appendChild(el);
        el.querySelector('#hideBookPanel').addEventListener('click', close);
    }

    /* ---------- render ---------- */
    function render(snap) {
        if (!el || !snap) return;
        const asksEl = el.querySelector('#bookAsks');
        const bidsEl = el.querySelector('#bookBids');
        if (!asksEl || !bidsEl) return;

        // asks arrive ascending by price; display top (cheapest) LEVELS reversed
        const asks = snap.asks.slice(0, LEVELS);
        const bids = snap.bids.slice(0, LEVELS);
        if (!asks.length || !bids.length) return;

        // cumulative quantities for bar widths
        let cumA = 0, cumB = 0;
        const askRows = asks.map(([p, q]) => { cumA += q; return { p, q, cum: cumA }; });
        const bidRows = bids.map(([p, q]) => { cumB += q; return { p, q, cum: cumB }; });
        const maxCum = Math.max(cumA, cumB) || 1;

        // depth markers: cumulative quote value at fixed % steps from mid
        const bestAsk = asks[0][0];
        const bestBid = bids[0][0];
        const mid = (bestAsk + bestBid) / 2;

        asksEl.innerHTML = askRows.slice().reverse().map(r =>
            `<div class="book-row" title="${fmtP(r.p)} — size ${fmtQ(r.q)} · cum ${fmtQ(r.cum)}">
                <span class="book-price down">${fmtP(r.p)}</span>
                <span class="book-size">${fmtQ(r.q)}</span>
                <span class="book-bar" style="width:${(r.cum / maxCum * 100).toFixed(1)}%"></span>
            </div>`
        ).join('');

        bidsEl.innerHTML = bidRows.map(r =>
            `<div class="book-row" title="${fmtP(r.p)} — size ${fmtQ(r.q)} · cum ${fmtQ(r.cum)}">
                <span class="book-price up">${fmtP(r.p)}</span>
                <span class="book-size">${fmtQ(r.q)}</span>
                <span class="book-bar" style="width:${(r.cum / maxCum * 100).toFixed(1)}%"></span>
            </div>`
        ).join('');

        // spread block
        const spreadAbs = bestAsk - bestBid;
        const spreadPct = mid > 0 ? (spreadAbs / mid) * 100 : 0;
        el.querySelector('#bookSpread').innerHTML =
            `<span class="book-spread-l">spread</span>
             <span class="book-spread-v">${fmtP(spreadAbs)} <span class="book-spread-pct">(${spreadPct.toFixed(3)}%)</span></span>
             <span class="book-spread-l">mid</span>
             <span class="book-spread-v">${fmtP(mid)}</span>`;
    }

    // Throttle: at most one render per animation frame (updates come at 100ms)
    function scheduleRender(snap) {
        lastSnap = snap;
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            render(lastSnap);
        });
    }

    /* ---------- stream lifecycle ---------- */
    function open(symbol, meta) {
        ensureDOM();
        setSymbol(symbol, meta);
        el.style.display = 'flex';
    }

    function setSymbol(symbol, meta) {
        if (!symbol) return;
        quote = meta?.quote || '';
        curSymbol = symbol;
        el.querySelector('#bookSymbol').textContent = symbol;
        if (stream) { stream.close(); stream = null; }
        stream = new BinanceAPI.DepthStream(symbol, scheduleRender);
        stream.connect();
    }

    function close() {
        if (stream) { stream.close(); stream = null; }
        if (el) el.style.display = 'none';
    }

    function toggle(symbol, meta) {
        if (isOpen() && curSymbol === symbol) { close(); return; }
        open(symbol, meta);
    }

    function isOpen() { return !!el && el.style.display !== 'none'; }

    return { open, close, toggle, isOpen, setSymbol };
})();

window.Book = Book;
