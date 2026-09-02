/* === CryptoTA — Trading Strategies ===
 * Each strategy takes candles and returns:
 *   {
 *     signals: [{ i, type: 'BUY'|'SELL', reason }],   // entry/exit points
 *     stats: {
 *       trades, wins, losses, winRate, pnl (%),       // backtest over history
 *       currentSignal: 'BUY'|'SELL'|'NONE',
 *       lastReason: string
 *     }
 *   }
 *
 * Backtest assumes "buy at close → sell at close on next signal".
 * Not real trading — just an orientation for comparing strategies.
 */

const Strategies = {

    /* ===================== 1. EMA CROSSOVER =====================
     * Fast EMA crosses slow EMA upward → BUY
     * Downward → SELL. Simple trend-following.
     */
    emaCross: {
        name: 'EMA Cross', category: 'Trend',
        desc: 'Crossover of fast and slow EMA',
        params: {
            fast: { type: 'number', def: 9,  min: 2, max: 100, label: 'Fast EMA' },
            slow: { type: 'number', def: 21, min: 2, max: 200, label: 'Slow EMA' }
        },
        run: (candles, p) => {
            const close = candles.map(c => c.close);
            const fast = ema(close, p.fast);
            const slow = ema(close, p.slow);
            const signals = [];
            for (let i = 1; i < candles.length; i++) {
                if (fast[i] == null || slow[i] == null) continue;
                if (fast[i - 1] == null || slow[i - 1] == null) continue;
                if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) {
                    signals.push({ i, type: 'BUY', reason: `EMA${p.fast}↑EMA${p.slow}` });
                } else if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) {
                    signals.push({ i, type: 'SELL', reason: `EMA${p.fast}↓EMA${p.slow}` });
                }
            }
            return Strategies._buildResult(candles, signals, 'EMA Cross');
        }
    },

    /* ===================== 2. RSI DIVERGENCE =====================
     * Bullish: price makes new low, RSI does not → BUY
     * Bearish: price makes new high, RSI does not → SELL
     */
    rsiDivergence: {
        name: 'RSI Divergence', category: 'Reversal',
        desc: 'Reversal on RSI(14) divergence',
        params: {
            period:  { type: 'number', def: 14, min: 2, max: 50, label: 'RSI period' },
            lookback:{ type: 'number', def: 20, min: 5, max: 100, label: 'Lookback window' }
        },
        run: (candles, p) => {
            const close = candles.map(c => c.close);
            const r = rsi(close, p.period);
            const signals = [];

            for (let i = p.lookback; i < candles.length; i++) {
                if (r[i] == null || r[i - p.lookback] == null) continue;
                // Local price minimum
                let curLowIdx = i;
                for (let k = i - p.lookback + 1; k < i; k++) {
                    if (candles[k].low < candles[curLowIdx].low) curLowIdx = k;
                }
                // Previous minimum
                let prevLowIdx = curLowIdx - p.lookback;
                if (prevLowIdx < 0) continue;
                for (let k = prevLowIdx - p.lookback + 1; k < prevLowIdx; k++) {
                    if (k < 0) continue;
                    if (candles[k].low < candles[prevLowIdx].low) prevLowIdx = k;
                }
                if (prevLowIdx < 0) continue;

                // Bullish divergence
                if (candles[i].low < candles[curLowIdx].low &&
                    candles[curLowIdx].low < candles[prevLowIdx].low &&
                    r[curLowIdx] > r[prevLowIdx]) {
                    signals.push({ i, type: 'BUY', reason: 'Bullish RSI divergence' });
                }

                // Local price maximum
                let curHighIdx = i;
                for (let k = i - p.lookback + 1; k < i; k++) {
                    if (candles[k].high > candles[curHighIdx].high) curHighIdx = k;
                }
                let prevHighIdx = curHighIdx - p.lookback;
                if (prevHighIdx < 0) continue;
                for (let k = prevHighIdx - p.lookback + 1; k < prevHighIdx; k++) {
                    if (k < 0) continue;
                    if (candles[k].high > candles[prevHighIdx].high) prevHighIdx = k;
                }
                if (prevHighIdx < 0) continue;

                // Bearish divergence
                if (candles[i].high > candles[curHighIdx].high &&
                    candles[curHighIdx].high > candles[prevHighIdx].high &&
                    r[curHighIdx] < r[prevHighIdx]) {
                    signals.push({ i, type: 'SELL', reason: 'Bearish RSI divergence' });
                }
            }
            return Strategies._buildResult(candles, signals, 'RSI Divergence');
        }
    },

    /* ===================== 3. MACD CROSS =====================
     * MACD crosses Signal upward → BUY
     * Downward → SELL. Histogram supports direction.
     */
    macdCross: {
        name: 'MACD Cross', category: 'Trend',
        desc: 'MACD / Signal line crossover',
        params: {
            fast:   { type: 'number', def: 12, min: 2, max: 50, label: 'Fast' },
            slow:   { type: 'number', def: 26, min: 2, max: 100, label: 'Slow' },
            signal: { type: 'number', def: 9,  min: 2, max: 50, label: 'Signal' }
        },
        run: (candles, p) => {
            const close = candles.map(c => c.close);
            const m = macd(close, p.fast, p.slow, p.signal);
            const signals = [];
            for (let i = 1; i < candles.length; i++) {
                if (m.macd[i] == null || m.signal[i] == null) continue;
                if (m.macd[i - 1] == null || m.signal[i - 1] == null) continue;
                if (m.macd[i - 1] <= m.signal[i - 1] && m.macd[i] > m.signal[i]) {
                    signals.push({ i, type: 'BUY', reason: 'MACD↑Signal' });
                } else if (m.macd[i - 1] >= m.signal[i - 1] && m.macd[i] < m.signal[i]) {
                    signals.push({ i, type: 'SELL', reason: 'MACD↓Signal' });
                }
            }
            return Strategies._buildResult(candles, signals, 'MACD Cross');
        }
    },

    /* ===================== 4. BOLLINGER SQUEEZE =====================
     * BB compression (narrow bands) → wait for breakout:
     * Close above upper band → BUY
     * Close below lower band → SELL
     */
    bbSqueeze: {
        name: 'BB Squeeze', category: 'Volatility',
        desc: 'Breakout after Bollinger Bands compression',
        params: {
            period:  { type: 'number', def: 20, min: 5, max: 100, label: 'Period' },
            mult:    { type: 'number', def: 2,  min: 0.5, max: 5, step: 0.1, label: 'Multiplier' },
            squeeze: { type: 'number', def: 20, min: 5, max: 100, label: 'Squeeze window' }
        },
        run: (candles, p) => {
            const close = candles.map(c => c.close);
            const b = bollinger(close, p.period, p.mult);
            const signals = [];

            // BB width per candle
            const width = new Array(candles.length).fill(null);
            for (let i = 0; i < candles.length; i++) {
                if (b.upper[i] == null || b.lower[i] == null) continue;
                width[i] = (b.upper[i] - b.lower[i]) / b.basis[i];
            }
            // Min width over squeeze window
            const minWidth = new Array(candles.length).fill(null);
            for (let i = p.squeeze - 1; i < candles.length; i++) {
                let m = Infinity;
                for (let k = i - p.squeeze + 1; k <= i; k++) {
                    if (width[k] != null && width[k] < m) m = width[k];
                }
                minWidth[i] = m;
            }

            for (let i = 1; i < candles.length; i++) {
                if (width[i] == null || minWidth[i] == null) continue;
                const isSqueeze = width[i] <= minWidth[i] * 1.05;
                if (!isSqueeze) continue;
                if (close[i] > b.upper[i]) {
                    signals.push({ i, type: 'BUY', reason: 'BB breakout up' });
                } else if (close[i] < b.lower[i]) {
                    signals.push({ i, type: 'SELL', reason: 'BB breakout down' });
                }
            }
            return Strategies._buildResult(candles, signals, 'BB Squeeze');
        }
    },

    /* ===================== 5. MEAN REVERSION =====================
     * Price deviation from SMA greater than k·σ → expect reversion:
     * Close below SMA by k·σ → BUY (catch the dip)
     * Close above SMA by k·σ → SELL (catch the top)
     */
    meanReversion: {
        name: 'Mean Reversion', category: 'Counter-trend',
        desc: 'Reversion to SMA at ≥ k·σ deviation',
        params: {
            period: { type: 'number', def: 20, min: 5, max: 100, label: 'SMA period' },
            k:      { type: 'number', def: 2,  min: 0.5, max: 4, step: 0.1, label: 'k · σ' }
        },
        run: (candles, p) => {
            const close = candles.map(c => c.close);
            const s = sma(close, p.period);
            const signals = [];

            // σ over period window
            const stdev = new Array(candles.length).fill(null);
            for (let i = p.period - 1; i < candles.length; i++) {
                let ssq = 0;
                for (let j = 0; j < p.period; j++) ssq += (close[i - j] - s[i]) ** 2;
                stdev[i] = Math.sqrt(ssq / p.period);
            }

            // Cooldown to avoid duplicates
            let lastSignalIdx = -Infinity;
            for (let i = p.period; i < candles.length; i++) {
                if (s[i] == null || stdev[i] == null) continue;
                if (i - lastSignalIdx < 5) continue;
                const dev = (close[i] - s[i]) / stdev[i];
                if (dev < -p.k) {
                    signals.push({ i, type: 'BUY', reason: `Deviation ${dev.toFixed(2)}σ` });
                    lastSignalIdx = i;
                } else if (dev > p.k) {
                    signals.push({ i, type: 'SELL', reason: `Deviation +${dev.toFixed(2)}σ` });
                    lastSignalIdx = i;
                }
            }
            return Strategies._buildResult(candles, signals, 'Mean Reversion');
        }
    },

    /* ===================== 6. SUPERTREND + RSI =====================
     * Supertrend flips up + RSI > threshold → BUY
     * Supertrend flips down + RSI < threshold → SELL
     */
    stRsi: {
        name: 'Supertrend+RSI', category: 'Trend',
        desc: 'Supertrend flip confirmed by RSI',
        params: {
            period: { type: 'number', def: 10, min: 2, max: 50, label: 'ATR period' },
            mult:   { type: 'number', def: 3,  min: 0.5, max: 10, step: 0.1, label: 'ST multiplier' },
            rsi:    { type: 'number', def: 14, min: 2, max: 50, label: 'RSI period' },
            rsiBuy: { type: 'number', def: 50, min: 10, max: 90, label: 'RSI BUY threshold' },
            rsiSell:{ type: 'number', def: 50, min: 10, max: 90, label: 'RSI SELL threshold' }
        },
        run: (candles, p) => {
            const close = candles.map(c => c.close);
            const st = supertrend(candles, p.period, p.mult);
            const r = rsi(close, p.rsi);
            const signals = [];

            for (let i = 1; i < candles.length; i++) {
                if (st.direction[i] === 0 || st.direction[i - 1] === 0) continue;
                if (r[i] == null) continue;
                // Bullish flip: yesterday ↓, today ↑
                if (st.direction[i - 1] === -1 && st.direction[i] === 1 && r[i] > p.rsiBuy) {
                    signals.push({ i, type: 'BUY', reason: `ST↑ + RSI ${r[i].toFixed(0)}` });
                }
                // Bearish flip: yesterday ↑, today ↓
                else if (st.direction[i - 1] === 1 && st.direction[i] === -1 && r[i] < p.rsiSell) {
                    signals.push({ i, type: 'SELL', reason: `ST↓ + RSI ${r[i].toFixed(0)}` });
                }
            }
            return Strategies._buildResult(candles, signals, 'Supertrend+RSI');
        }
    },

    /* ===================== Helper =====================
     * Build backtest metrics from a signal list.
     * Logic: BUY opens a position, next SELL closes it.
     * Counts P&L in % and win rate.
     */
    _buildResult(candles, signals, name) {
        const trades = [];
        let pos = null; // { entryIdx, entryPrice, type: 'LONG'|'SHORT' }
        for (const s of signals) {
            const price = candles[s.i].close;
            if (s.type === 'BUY' && pos === null) {
                pos = { entryIdx: s.i, entryPrice: price, type: 'LONG', entryReason: s.reason };
            } else if (s.type === 'SELL' && pos && pos.type === 'LONG') {
                const pnl = (price - pos.entryPrice) / pos.entryPrice * 100;
                trades.push({
                    entryIdx: pos.entryIdx, exitIdx: s.i,
                    entryPrice: pos.entryPrice, exitPrice: price,
                    type: 'LONG', pnl,
                    entryReason: pos.entryReason, exitReason: s.reason
                });
                pos = null;
            }
        }
        // Open position — close at last candle for stats
        if (pos) {
            const lastPrice = candles[candles.length - 1].close;
            const pnl = (lastPrice - pos.entryPrice) / pos.entryPrice * 100;
            trades.push({
                entryIdx: pos.entryIdx, exitIdx: candles.length - 1,
                entryPrice: pos.entryPrice, exitPrice: lastPrice,
                type: 'LONG', pnl, open: true,
                entryReason: pos.entryReason, exitReason: '—'
            });
        }

        const closed = trades.filter(t => !t.open);
        const wins = closed.filter(t => t.pnl > 0).length;
        const losses = closed.filter(t => t.pnl <= 0).length;
        const winRate = closed.length ? (wins / closed.length) * 100 : 0;
        const pnlTotal = trades.reduce((s, t) => s + t.pnl, 0);

        // Current signal — last unclosed
        let currentSignal = 'NONE';
        let lastReason = 'No active signal';
        if (signals.length) {
            const last = signals[signals.length - 1];
            const hasOpposite = signals.slice(0, -1).some(s => s.type !== last.type && s.i > last.i);
            if (!hasOpposite && last.type === 'BUY') {
                currentSignal = 'BUY';
                lastReason = last.reason;
            } else if (!hasOpposite && last.type === 'SELL') {
                currentSignal = 'SELL';
                lastReason = last.reason;
            } else {
                currentSignal = 'NONE';
                lastReason = 'Signal closed';
            }
        }

        return {
            name,
            signals,
            stats: {
                trades: trades.length,
                closed: closed.length,
                open: trades.length - closed.length,
                wins, losses,
                winRate,
                pnl: pnlTotal,
                currentSignal,
                lastReason
            }
        };
    },

    getCatalog() {
        const groups = {};
        for (const key in Strategies) {
            if (['getCatalog', 'create', '_buildResult'].includes(key)) continue;
            const s = Strategies[key];
            if (!s.category) continue;
            if (!groups[s.category]) groups[s.category] = [];
            groups[s.category].push({ key, ...s });
        }
        return groups;
    },

    create(key, customParams = {}) {
        const def = Strategies[key];
        if (!def) return null;
        const params = {};
        for (const p in def.params) {
            params[p] = customParams[p] !== undefined ? customParams[p] : def.params[p].def;
        }
        return { key, name: def.name, params, result: null, enabled: false };
    }
};

window.Strategies = Strategies;