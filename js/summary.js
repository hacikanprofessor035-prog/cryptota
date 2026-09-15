/* === CryptoTA — Technical Summary (auto-analysis) ===
 * Reads candles + tickers (already in memory) and produces a concise
 * human-readable market snapshot. No external requests — pure functions
 * over the same buffers the chart uses.
 *
 * Public API:
 *   Summary.build(candles, ticker, meta)  -> sections[] for rendering
 *   Summary.toText(sections)              -> plain text (for sharing/notes)
 */
const Summary = (() => {

    /* ---------- helpers ---------- */

    const last = (arr) => arr[arr.length - 1];
    const lastValid = (arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i] !== null && arr[i] !== undefined && !isNaN(arr[i])) return arr[i];
        }
        return null;
    };

    // Swing high/low over a lookback (excludes the last forming candle)
    function swings(candles, lookback = 60) {
        const n = Math.min(candles.length - 1, lookback);
        let hi = -Infinity, lo = Infinity, hiI = -1, loI = -1;
        const start = candles.length - 1 - n;
        for (let i = start; i < candles.length - 1; i++) {
            if (candles[i].high > hi) { hi = candles[i].high; hiI = i; }
            if (candles[i].low < lo) { lo = candles[i].low; loI = i; }
        }
        return { high: hiI >= 0 ? hi : null, low: loI >= 0 ? lo : null, barsAgoHigh: hiI >= 0 ? (candles.length - 1 - hiI) : null, barsAgoLow: loI >= 0 ? (candles.length - 1 - loI) : null };
    }

    // Volume profile — simplest POC by price bucket
    function poc(candles, bins = 30) {
        let hi = -Infinity, lo = Infinity;
        for (const c of candles) {
            if (c.high > hi) hi = c.high;
            if (c.low < lo) lo = c.low;
        }
        if (hi <= lo) return null;
        const step = (hi - lo) / bins;
        const vol = new Array(bins).fill(0);
        for (const c of candles) {
            const tp = (c.high + c.low + c.close) / 3;
            let b = Math.floor((tp - lo) / step);
            if (b < 0) b = 0;
            if (b >= bins) b = bins - 1;
            vol[b] += c.volume;
        }
        let maxB = 0;
        for (let i = 1; i < bins; i++) if (vol[i] > vol[maxB]) maxB = i;
        return lo + (maxB + 0.5) * step;
    }

    function pct(a, b) { return b ? ((a - b) / b) * 100 : null; }

    function fmtPrice(p, quote) {
        if (p == null || isNaN(p)) return '—';
        const s = p >= 1000 ? p.toFixed(2) : p >= 1 ? p.toFixed(4) : p.toFixed(8);
        return quote ? `${s} ${quote}` : s;
    }

    function signedPct(v, digits = 2) {
        if (v == null || isNaN(v)) return '—';
        return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
    }

    /* ---------- core: build sections ---------- */

    // candles: [{open,high,low,close,volume,...}], ticker: {last,change,quoteVolume,...}
    function build(candles, ticker, meta = {}) {
        const sections = [];
        if (!candles || candles.length < 30) {
            sections.push({ title: 'Not enough data', rows: [{ text: 'Need at least 30 candles on this timeframe' }] });
            return sections;
        }

        const closes = candles.map(c => c.close);
        const price = ticker?.last ?? last(candles).close;
        const quote = meta.quote || '';

        /* --- Trend --- */
        const ema20 = lastValid(ema(closes, 20));
        const ema50 = lastValid(ema(closes, 50));
        const sma200 = lastValid(sma(closes, Math.min(200, closes.length)));
        const ema100 = lastValid(ema(closes, Math.min(100, closes.length)));
        let trendScore = 0, trendNotes = [];
        if (ema20 !== null && ema50 !== null) {
            if (price > ema20) trendScore++; else trendScore--;
            if (ema20 > ema50) trendScore++; else trendScore--;
            trendNotes.push(`price ${price > ema20 ? 'above' : 'below'} EMA20 (${fmtPrice(ema20, quote)})`);
            trendNotes.push(`EMA20 ${ema20 > ema50 ? 'above' : 'below'} EMA50 (${fmtPrice(ema50, quote)})`);
        }
        if (sma200 !== null && closes.length >= 100) {
            if (price > sma200) { trendScore++; trendNotes.push(`above SMA200 (${fmtPrice(sma200, quote)})`); }
            else { trendScore--; trendNotes.push(`below SMA200 (${fmtPrice(sma200, quote)})`); }
        }
        // ADX-lite proxy: distance between EMA20 and EMA50 relative to price
        let strength = null;
        if (ema20 !== null && ema50 !== null) {
            strength = Math.abs(ema20 - ema50) / price * 100;
        }
        const trendLabel = trendScore >= 2 ? 'Uptrend' : trendScore <= -2 ? 'Downtrend' : (trendScore > 0 ? 'Bullish bias' : trendScore < 0 ? 'Bearish bias' : 'Sideways / mixed');
        sections.push({
            title: 'Trend',
            badge: { text: trendLabel, cls: trendScore >= 2 ? 'up' : trendScore <= -2 ? 'down' : 'flat' },
            rows: [
                { label: 'Structure', text: trendNotes.join(' · ') },
                ...(strength !== null ? [{ label: 'Trend strength (EMA gap)', text: `${strength.toFixed(2)}% of price — ${strength > 3 ? 'strong' : strength > 1 ? 'moderate' : 'weak'}` }] : []),
            ],
        });

        /* --- Momentum --- */
        const rsiArr = rsi(closes, 14);
        const r = lastValid(rsiArr);
        const macdRes = macd(closes, 12, 26, 9);
        const m = lastValid(macdRes.macd);
        const s = lastValid(macdRes.signal);
        const momRows = [];
        if (r !== null) {
            const state = r > 70 ? 'overbought' : r < 30 ? 'oversold' : 'neutral';
            momRows.push({ label: 'RSI (14)', text: `${r.toFixed(1)} — ${state}` });
        }
        if (m !== null && s !== null) {
            const cross = m > s ? 'MACD above signal (bullish)' : m < s ? 'MACD below signal (bearish)' : 'MACD at signal';
            momRows.push({ label: 'MACD', text: `${cross} · hist ${(m - s).toFixed(6)}` });
        }
        const stochRes = stochastic(candles, 14, 3, 3);
        const k = lastValid(stochRes.k);
        if (k !== null) momRows.push({ label: 'Stoch %K', text: `${k.toFixed(1)} — ${k > 80 ? 'overbought' : k < 20 ? 'oversold' : 'mid-range'}` });
        sections.push({ title: 'Momentum', rows: momRows });

        /* --- Volatility --- */
        const atrArr = atr(candles, 14);
        const a = lastValid(atrArr);
        const volRows = [];
        if (a !== null) {
            const atrPct = a / price * 100;
            const tfLabel = meta.timeframe || '';
            volRows.push({ label: 'ATR (14)', text: `${fmtPrice(a, quote)} ≈ ${atrPct.toFixed(2)}% of price${tfLabel ? ` per ${tfLabel}` : ''}` });
            const yearMult = annualize(meta.timeframe);
            if (yearMult) volRows.push({ label: 'Annualized vol (rough)', text: `${(atrPct * Math.sqrt(yearMult)).toFixed(1)}%` });
        }
        const bbRes = bollinger(closes, 20, 2);
        const bbU = lastValid(bbRes.upper);
        const bbL = lastValid(bbRes.lower);
        if (bbU !== null && bbL !== null) {
            const width = (bbU - bbL) / price * 100;
            let pos = (price - bbL) / (bbU - bbL) * 100;
            const outside = pos < 0 || pos > 100;
            pos = Math.max(0, Math.min(100, pos));
            volRows.push({ label: 'Bollinger width', text: `${width.toFixed(2)}% — ${width < 2 ? 'squeeze (breakout watch)' : width > 8 ? 'wide (elevated)' : 'normal'}` });
            volRows.push({ label: 'Position in bands', text: `${pos.toFixed(0)}% (${outside ? (price > bbU ? 'above upper band' : 'below lower band') : pos > 90 ? 'at upper band' : pos < 10 ? 'at lower band' : 'mid'})` });
        }
        sections.push({ title: 'Volatility', rows: volRows });

        /* --- Volume --- */
        const last20 = candles.slice(-21, -1).map(c => c.volume);
        const avgVol = last20.reduce((a, b) => a + b, 0) / Math.max(1, last20.length);
        const curVol = last(candles).volume;
        const volRatio = avgVol ? curVol / avgVol : null;
        const obvArr = obv(candles);
        const obvNow = lastValid(obvArr);
        const obvPrev = obvArr.length > 6 ? obvArr[obvArr.length - 6] : null;
        const volRows2 = [];
        if (ticker?.quoteVolume != null) {
            volRows2.push({ label: '24h volume', text: `${formatQuoteVolume(ticker.quoteVolume)} ${quote}` });
        }
        if (volRatio !== null) {
            volRows2.push({ label: 'Current candle vs avg', text: `${volRatio.toFixed(2)}× — ${volRatio > 1.8 ? 'high activity' : volRatio < 0.5 ? 'quiet' : 'normal'}` });
        }
        if (obvNow !== null && obvPrev !== null && obvPrev !== 0) {
            const obvChg = (obvNow - obvPrev) / Math.abs(obvPrev) * 100;
            volRows2.push({ label: 'OBV (5 bars)', text: `${signedPct(obvChg, 1)} — ${obvChg > 5 ? 'accumulation' : obvChg < -5 ? 'distribution' : 'balanced'}` });
        }
        sections.push({ title: 'Volume', rows: volRows2 });

        /* --- Key levels --- */
        const sw = swings(candles, 60);
        const pocPrice = poc(candles, 30);
        const lvlRows = [];
        if (sw.high !== null) lvlRows.push({ label: 'Swing high (60 bars)', text: `${fmtPrice(sw.high, quote)} · ${sw.barsAgoHigh} bars ago` });
        if (sw.low !== null) lvlRows.push({ label: 'Swing low (60 bars)', text: `${fmtPrice(sw.low, quote)} · ${sw.barsAgoLow} bars ago` });
        if (pocPrice !== null) {
            const d = pct(price, pocPrice);
            lvlRows.push({ label: 'Volume POC (30 bins)', text: `${fmtPrice(pocPrice, quote)} · price ${signedPct(d)} from POC` });
        }
        if (sw.high !== null && sw.low !== null) {
            const denom = sw.high - sw.low;
            let rangePos = denom > 0 ? (price - sw.low) / denom * 100 : 50;
            rangePos = Math.max(0, Math.min(100, rangePos));
            lvlRows.push({ label: 'Position in 60-bar range', text: `${rangePos.toFixed(0)}%` });
        }
        sections.push({ title: 'Key levels', rows: lvlRows });

        return sections;
    }

    function annualize(tf) {
        const m = { '1m': 1440, '3m': 480, '5m': 288, '15m': 96, '30m': 48, '1h': 24, '2h': 12, '4h': 6, '6h': 4, '8h': 3, '12h': 2, '1d': 1, '3d': 1 / 3, '1w': 1 / 7, '1M': 1 / 30 };
        return m[tf] || null;
    }

    function formatQuoteVolume(v) {
        if (v == null || isNaN(v)) return '—';
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return v.toFixed(0);
    }

    function toText(sections, header = '') {
        const lines = [];
        if (header) lines.push(header, '');
        for (const s of sections) {
            lines.push(`■ ${s.title}${s.badge ? ` — ${s.badge.text}` : ''}`);
            for (const r of s.rows) lines.push(`  ${r.label ? r.label + ': ' : ''}${r.text}`);
            lines.push('');
        }
        return lines.join('\n').trim();
    }

    return { build, toText };
})();

window.Summary = Summary;
