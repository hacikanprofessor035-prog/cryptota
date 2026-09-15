/* CryptoTA — embeddable mini chart for landing pages.
 *
 * Standalone (no app deps): fetches klines via the public Binance REST API
 * and renders a compact candlestick chart with a live price header. Used on
 * /p/<coin>.html SEO landing pages so they carry real, interactive content
 * instead of being redirect-only stubs.
 */
(function () {
    'use strict';

    const BINANCE_API = 'https://api.binance.com/api/v3';

    function el(id) { return document.getElementById(id); }

    function fmtPrice(v) {
        if (v == null || isNaN(v)) return '—';
        return v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
             : v >= 1 ? v.toFixed(2)
             : v.toFixed(6);
    }

    function fmtPct(v) {
        if (v == null || isNaN(v)) return '—';
        return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    }

    async function fetchKlines(symbol, interval, limit) {
        const url = `${BINANCE_API}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error('klines HTTP ' + r.status);
        return r.json();
    }

    async function fetchTicker(symbol) {
        const url = `${BINANCE_API}/ticker/24hr?symbol=${symbol}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error('ticker HTTP ' + r.status);
        return r.json();
    }

    function drawCandles(canvas, klines) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        const padTop = 8, padBot = 8;
        const ohlc = klines.map(k => ({
            o: +k[1], h: +k[2], l: +k[3], c: +k[4]
        }));
        let hi = -Infinity, lo = Infinity;
        for (const c of ohlc) { if (c.h > hi) hi = c.h; if (c.l < lo) lo = c.l; }
        const range = hi - lo || 1;
        const step = W / ohlc.length;
        const bw = Math.max(1.5, step * 0.62);

        const y = v => padTop + (1 - (v - lo) / range) * (H - padTop - padBot);

        for (let i = 0; i < ohlc.length; i++) {
            const c = ohlc[i];
            const up = c.c >= c.o;
            ctx.strokeStyle = up ? '#16c784' : '#ea3943';
            ctx.fillStyle = up ? '#16c784' : '#ea3943';
            const x = i * step + step / 2;
            ctx.beginPath();
            ctx.moveTo(x, y(c.h));
            ctx.lineTo(x, y(c.l));
            ctx.stroke();
            ctx.fillRect(x - bw / 2, y(Math.max(c.o, c.c)), bw,
                Math.max(1, Math.abs(y(c.o) - y(c.c))));
        }
    }

    window.CryptoTAEmbed = {
        async mount(opts) {
            const { symbol, interval, canvasId, priceId, changeId, quoteId } = opts;
            const canvas = el(canvasId);
            if (!canvas) return;
            try {
                const [klines, ticker] = await Promise.all([
                    fetchKlines(symbol, interval, 96),
                    fetchTicker(symbol)
                ]);
                const last = klines[klines.length - 1];
                const first = klines[0];
                const pct = ((last[4] - first[1]) / first[1]) * 100;
                if (priceId) el(priceId).textContent = '$' + fmtPrice(+last[4]);
                if (changeId) {
                    const c = el(changeId);
                    c.textContent = fmtPct(pct) + ' (' + interval + ')';
                    c.style.color = pct >= 0 ? '#16c784' : '#ea3943';
                }
                if (quoteId) {
                    const q = ticker.quoteVolume;
                    el(quoteId).textContent = '$' + (q >= 1e9 ? (q / 1e9).toFixed(2) + 'B'
                        : q >= 1e6 ? (q / 1e6).toFixed(1) + 'M' : q.toLocaleString('en-US'));
                }
                drawCandles(canvas, klines);
                canvas.setAttribute('aria-label', symbol + ' candlestick chart, ' + interval);
            } catch (e) {
                if (priceId) el(priceId).textContent = 'Chart unavailable';
                console.warn('CryptoTAEmbed:', e.message);
            }
        }
    };
})();
