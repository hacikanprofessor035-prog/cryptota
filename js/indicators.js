/* === CryptoTA — Indicators library ===
 * Each indicator is an object with metadata and a calc function.
 * Type "overlay" draws on the main chart.
 * Type "pane"   draws in a separate sub-area at the bottom.
 */

const Indicators = {
    /* ============ TREND (overlay on price) ============ */
    sma: {
        name: 'SMA', full: 'Simple Moving Average', category: 'Trend', type: 'overlay',
        desc: 'Simple moving average',
        params: { period: { type: 'number', def: 20, min: 2, max: 500, label: 'Period' } },
        color: '#5cc8c0',
        calc: (candles, p) => sma(candles.map(c => c.close), p.period)
    },
    ema: {
        name: 'EMA', full: 'Exponential Moving Average', category: 'Trend', type: 'overlay',
        desc: 'Exponential moving average',
        params: { period: { type: 'number', def: 20, min: 2, max: 500, label: 'Period' } },
        color: '#c9a857',
        calc: (candles, p) => ema(candles.map(c => c.close), p.period)
    },
    wma: {
        name: 'WMA', full: 'Weighted Moving Average', category: 'Trend', type: 'overlay',
        desc: 'Weighted moving average',
        params: { period: { type: 'number', def: 20, min: 2, max: 500, label: 'Period' } },
        color: '#9b8ec9',
        calc: (candles, p) => wma(candles.map(c => c.close), p.period)
    },
    vwap: {
        name: 'VWAP', full: 'Volume Weighted Average Price', category: 'Trend', type: 'overlay',
        desc: 'Volume-weighted average price',
        params: {},
        color: '#e8ecf4',
        calc: (candles) => vwap(candles)
    },
    bb: {
        name: 'BB', full: 'Bollinger Bands', category: 'Trend', type: 'overlay',
        desc: 'Bollinger Bands',
        params: {
            period: { type: 'number', def: 20, min: 2, max: 200, label: 'Period' },
            mult:   { type: 'number', def: 2,  min: 0.5, max: 5, step: 0.1, label: 'Multiplier' }
        },
        color: '#7a8a9e',
        multi: true,
        calc: (candles, p) => bollinger(candles.map(c => c.close), p.period, p.mult)
    },
    keltner: {
        name: 'KC', full: 'Keltner Channel', category: 'Trend', type: 'overlay',
        desc: 'Keltner Channel',
        params: {
            period: { type: 'number', def: 20, min: 2, max: 200, label: 'EMA period' },
            mult:   { type: 'number', def: 2,  min: 0.5, max: 5, step: 0.1, label: 'ATR multiplier' }
        },
        color: '#a87a5c',
        multi: true,
        calc: (candles, p) => keltner(candles, p.period, p.mult)
    },
    ichimoku: {
        name: 'ICH', full: 'Ichimoku Cloud', category: 'Trend', type: 'overlay',
        desc: 'Ichimoku Cloud',
        params: {},
        color: '#8b9bb3',
        multi: true,
        calc: (candles) => ichimoku(candles)
    },
    supertrend: {
        name: 'ST', full: 'Supertrend', category: 'Trend', type: 'overlay',
        desc: 'ATR-based trend filter',
        params: {
            period: { type: 'number', def: 10, min: 2, max: 100, label: 'ATR period' },
            mult:   { type: 'number', def: 3,  min: 0.5, max: 10, step: 0.1, label: 'Multiplier' }
        },
        color: '#5cc8c0',
        multi: true,
        calc: (candles, p) => supertrend(candles, p.period, p.mult)
    },
    psar: {
        name: 'PSAR', full: 'Parabolic SAR', category: 'Trend', type: 'overlay',
        desc: 'Parabolic SAR system',
        params: {
            step: { type: 'number', def: 0.02, min: 0.001, max: 0.5, step: 0.001, label: 'Step' },
            max:  { type: 'number', def: 0.2,  min: 0.05,  max: 1,   step: 0.01,  label: 'Max' }
        },
        color: '#ea3943',
        calc: (candles, p) => psar(candles, p.step, p.max)
    },

    /* ============ LEVELS / MARKUP (overlay, no sub-area) ============ */

    // Volume Profile — horizontal volumes by price levels
    vprofile: {
        name: 'VP', full: 'Volume Profile', category: 'Trend', type: 'overlay',
        desc: 'Horizontal volumes by price levels',
        params: {
            bins:   { type: 'number', def: 50, min: 10, max: 200, label: 'Number of levels' },
            lookback: { type: 'number', def: 200, min: 20, max: 1000, label: 'Window (candles)' }
        },
        color: '#5cc8c0',
        multi: true,
        calc: (candles, p) => volumeProfile(candles, p.bins, p.lookback)
    },

    // Fibonacci Retracement
    fib: {
        name: 'FIB', full: 'Fibonacci Retracement', category: 'Trend', type: 'overlay',
        desc: 'Fibonacci retracement levels',
        params: {
            lookback: { type: 'number', def: 200, min: 20, max: 1000, label: 'Window (candles)' }
        },
        color: '#c9a857',
        multi: true,
        calc: (candles, p) => fibonacci(candles, p.lookback)
    },

    // Pivot Points
    pivots: {
        name: 'PIV', full: 'Pivot Points', category: 'Trend', type: 'overlay',
        desc: 'Pivot levels from extremes',
        params: {
            method: { type: 'select', def: 'classic', options: ['classic','camarilla','fibonacci','woodie'], label: 'Method' }
        },
        color: '#9b8ec9',
        multi: true,
        calc: (candles, p) => pivotPoints(candles, p.method)
    },

    /* ============ MOMENTUM (oscillators in sub-area) ============ */
    rsi: {
        name: 'RSI', full: 'Relative Strength Index', category: 'Oscillators', type: 'pane',
        desc: 'Relative Strength Index',
        params: { period: { type: 'number', def: 14, min: 2, max: 100, label: 'Period' } },
        color: '#c9a857',
        fixedMin: 0, fixedMax: 100,
        levels: [30, 50, 70],
        calc: (candles, p) => rsi(candles.map(c => c.close), p.period)
    },
    macd: {
        name: 'MACD', full: 'Moving Average Convergence Divergence', category: 'Oscillators', type: 'pane',
        desc: 'Convergence/divergence of moving averages',
        params: {
            fast:   { type: 'number', def: 12, min: 2, max: 100, label: 'Fast' },
            slow:   { type: 'number', def: 26, min: 2, max: 200, label: 'Slow' },
            signal: { type: 'number', def: 9,  min: 2, max: 50,  label: 'Signal' }
        },
        color: '#5cc8c0',
        multi: true,
        calc: (candles, p) => macd(candles.map(c => c.close), p.fast, p.slow, p.signal)
    },
    stoch: {
        name: 'Stoch', full: 'Stochastic Oscillator', category: 'Oscillators', type: 'pane',
        desc: 'Stochastic Oscillator',
        params: {
            k: { type: 'number', def: 14, min: 2, max: 100, label: '%K' },
            d: { type: 'number', def: 3,  min: 1, max: 50,  label: '%D' },
            smooth: { type: 'number', def: 3, min: 1, max: 50, label: 'Smoothing' }
        },
        color: '#9b8ec9',
        fixedMin: 0, fixedMax: 100,
        levels: [20, 80],
        calc: (candles, p) => stochastic(candles, p.k, p.d, p.smooth)
    },
    cci: {
        name: 'CCI', full: 'Commodity Channel Index', category: 'Oscillators', type: 'pane',
        desc: 'Commodity Channel Index',
        params: { period: { type: 'number', def: 20, min: 2, max: 100, label: 'Period' } },
        color: '#a87a5c',
        levels: [-100, 0, 100],
        calc: (candles, p) => cci(candles, p.period)
    },
    momentum: {
        name: 'MOM', full: 'Momentum', category: 'Oscillators', type: 'pane',
        desc: 'Momentum',
        params: { period: { type: 'number', def: 10, min: 1, max: 100, label: 'Period' } },
        color: '#7a8a9e',
        calc: (candles, p) => momentum(candles.map(c => c.close), p.period)
    },
    roc: {
        name: 'ROC', full: 'Rate of Change', category: 'Oscillators', type: 'pane',
        desc: 'Rate of Change (%)',
        params: { period: { type: 'number', def: 10, min: 1, max: 100, label: 'Period' } },
        color: '#e8ecf4',
        calc: (candles, p) => roc(candles.map(c => c.close), p.period)
    },
    williams: {
        name: 'WR', full: 'Williams %R', category: 'Oscillators', type: 'pane',
        desc: 'Williams Percent Range',
        params: { period: { type: 'number', def: 14, min: 2, max: 100, label: 'Period' } },
        color: '#c97a8a',
        fixedMin: -100, fixedMax: 0,
        levels: [-80, -20],
        calc: (candles, p) => williams(candles, p.period)
    },
    ao: {
        name: 'AO', full: 'Awesome Oscillator', category: 'Oscillators', type: 'pane',
        desc: 'Bill Williams Awesome Oscillator',
        params: {},
        color: '#5cc8c0',
        multi: true,
        calc: (candles) => awesomeOscillator(candles)
    },

    /* ============ VOLATILITY ============ */
    atr: {
        name: 'ATR', full: 'Average True Range', category: 'Volatility', type: 'pane',
        desc: 'Average True Range',
        params: { period: { type: 'number', def: 14, min: 2, max: 100, label: 'Period' } },
        color: '#ea3943',
        calc: (candles, p) => atr(candles, p.period)
    },

    /* ============ VOLUME ============ */
    obv: {
        name: 'OBV', full: 'On Balance Volume', category: 'Volume', type: 'pane',
        desc: 'On Balance Volume',
        params: {},
        color: '#5cc8c0',
        calc: (candles) => obv(candles)
    },
    vroc: {
        name: 'VROC', full: 'Volume Rate of Change', category: 'Volume', type: 'pane',
        desc: 'Volume Rate of Change (%)',
        params: { period: { type: 'number', def: 10, min: 1, max: 100, label: 'Period' } },
        color: '#c9a857',
        calc: (candles, p) => vroc(candles, p.period)
    },
    cmf: {
        name: 'CMF', full: 'Chaikin Money Flow', category: 'Volume', type: 'pane',
        desc: 'Chaikin Money Flow',
        params: { period: { type: 'number', def: 20, min: 2, max: 100, label: 'Period' } },
        color: '#9b8ec9',
        fixedMin: -1, fixedMax: 1,
        levels: [-0.1, 0, 0.1],
        calc: (candles, p) => cmf(candles, p.period)
    }
};

/* ============ FORMULAS ============ */

// SMA
function sma(data, period) {
    const out = new Array(data.length).fill(null);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
        if (i >= period) sum -= data[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

// EMA
function ema(data, period) {
    const out = new Array(data.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) continue;
        if (prev === null) {
            let s = 0;
            for (let j = 0; j < period; j++) s += data[i - j];
            prev = s / period;
            out[i] = prev;
        } else {
            prev = data[i] * k + prev * (1 - k);
            out[i] = prev;
        }
    }
    return out;
}

// WMA
function wma(data, period) {
    const out = new Array(data.length).fill(null);
    const denom = (period * (period + 1)) / 2;
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j] * (period - j);
        }
        out[i] = sum / denom;
    }
    return out;
}

// VWAP — cumulative
function vwap(candles) {
    const out = new Array(candles.length).fill(null);
    let cumPV = 0, cumV = 0;
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const tp = (c.high + c.low + c.close) / 3;
        cumPV += tp * c.volume;
        cumV += c.volume;
        out[i] = cumV > 0 ? cumPV / cumV : null;
    }
    return out;
}

// Bollinger Bands
function bollinger(data, period, mult) {
    const basis = sma(data, period);
    const upper = new Array(data.length).fill(null);
    const lower = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sumSq = 0;
        for (let j = 0; j < period; j++) {
            const d = data[i - j] - basis[i];
            sumSq += d * d;
        }
        const sd = Math.sqrt(sumSq / period);
        upper[i] = basis[i] + sd * mult;
        lower[i] = basis[i] - sd * mult;
    }
    return { basis, upper, lower };
}

// Keltner Channel
function keltner(candles, period, mult) {
    const basis = ema(candles.map(c => c.close), period);
    const a = atr(candles, period);
    const upper = new Array(candles.length).fill(null);
    const lower = new Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
        if (basis[i] !== null && a[i] !== null) {
            upper[i] = basis[i] + a[i] * mult;
            lower[i] = basis[i] - a[i] * mult;
        }
    }
    return { basis, upper, lower };
}

// Ichimoku
function ichimoku(candles) {
    const n = candles.length;
    const high = candles.map(c => c.high);
    const low = candles.map(c => c.low);
    const tenkanArr = new Array(n).fill(null);
    const kijunArr = new Array(n).fill(null);
    const senkouA = new Array(n).fill(null);
    const senkouB = new Array(n).fill(null);
    const chikou = new Array(n).fill(null);

    const donchian = (arr, period, i) => {
        let h = -Infinity, l = Infinity;
        for (let j = 0; j < period; j++) {
            const v = arr[i - j];
            if (v === undefined) return null;
            if (v > h) h = v;
            if (v < l) l = v;
        }
        return (h + l) / 2;
    };

    for (let i = 0; i < n; i++) {
        if (i >= 8) tenkanArr[i] = donchian(high, 9, i);
        if (i >= 25) kijunArr[i] = donchian(high, 26, i);
    }
    for (let i = 0; i < n; i++) {
        if (tenkanArr[i] !== null && kijunArr[i] !== null) {
            senkouA[i + 26] = (tenkanArr[i] + kijunArr[i]) / 2;
        }
        if (i >= 51) senkouB[i + 26] = donchian(high, 52, i);
    }
    for (let i = 26; i < n; i++) {
        chikou[i - 26] = candles[i].close;
    }
    return { tenkan: tenkanArr, kijun: kijunArr, senkouA, senkouB, chikou };
}

// Parabolic SAR
function psar(candles, step, max) {
    const out = new Array(candles.length).fill(null);
    if (candles.length < 2) return out;
    let isLong = candles[1].close > candles[0].close;
    let af = step;
    let ep = isLong ? candles[0].high : candles[0].low;
    let sar = isLong ? candles[0].low : candles[0].high;
    out[0] = sar;
    for (let i = 1; i < candles.length; i++) {
        sar = sar + af * (ep - sar);
        const c = candles[i];
        if (isLong) {
            if (c.low < sar) {
                isLong = false;
                sar = ep;
                ep = c.low;
                af = step;
            } else {
                if (c.high > ep) { ep = c.high; af = Math.min(af + step, max); }
            }
        } else {
            if (c.high > sar) {
                isLong = true;
                sar = ep;
                ep = c.high;
                af = step;
            } else {
                if (c.low < ep) { ep = c.low; af = Math.min(af + step, max); }
            }
        }
        out[i] = sar;
    }
    return out;
}

// RSI
function rsi(data, period) {
    const out = new Array(data.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) avgGain += diff;
        else avgLoss -= diff;
    }
    avgGain /= period;
    avgLoss /= period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
}

// MACD
function macd(data, fast, slow, signal) {
    const emaFast = ema(data, fast);
    const emaSlow = ema(data, slow);
    const macdLine = new Array(data.length).fill(null);
    for (let i = 0; i < data.length; i++) {
        if (emaFast[i] !== null && emaSlow[i] !== null) {
            macdLine[i] = emaFast[i] - emaSlow[i];
        }
    }
    // signal — EMA of macdLine (valid values only)
    const valid = macdLine.map(v => v === null ? 0 : v);
    const sig = ema(valid, signal);
    const signalLine = sig.map((v, i) => macdLine[i] === null ? null : v);
    const histogram = new Array(data.length).fill(null);
    for (let i = 0; i < data.length; i++) {
        if (macdLine[i] !== null && signalLine[i] !== null) {
            histogram[i] = macdLine[i] - signalLine[i];
        }
    }
    return { macd: macdLine, signal: signalLine, histogram };
}

// Stochastic
function stochastic(candles, kPeriod, dPeriod, smooth) {
    const n = candles.length;
    const rawK = new Array(n).fill(null);
    for (let i = kPeriod - 1; i < n; i++) {
        let hh = -Infinity, ll = Infinity;
        for (let j = 0; j < kPeriod; j++) {
            if (candles[i - j].high > hh) hh = candles[i - j].high;
            if (candles[i - j].low < ll)  ll = candles[i - j].low;
        }
        rawK[i] = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
    }
    const kLine = sma(rawK, smooth);
    const dLine = sma(kLine, dPeriod);
    return { k: kLine, d: dLine };
}

// CCI
function cci(candles, period) {
    const tp = candles.map(c => (c.high + c.low + c.close) / 3);
    const smaTp = sma(tp, period);
    const out = new Array(candles.length).fill(null);
    for (let i = period - 1; i < candles.length; i++) {
        let md = 0;
        for (let j = 0; j < period; j++) md += Math.abs(tp[i - j] - smaTp[i]);
        md /= period;
        out[i] = md === 0 ? 0 : (tp[i] - smaTp[i]) / (0.015 * md);
    }
    return out;
}

// Momentum
function momentum(data, period) {
    const out = new Array(data.length).fill(null);
    for (let i = period; i < data.length; i++) out[i] = data[i] - data[i - period];
    return out;
}

// ROC
function roc(data, period) {
    const out = new Array(data.length).fill(null);
    for (let i = period; i < data.length; i++) out[i] = ((data[i] - data[i - period]) / data[i - period]) * 100;
    return out;
}

// Williams %R
function williams(candles, period) {
    const out = new Array(candles.length).fill(null);
    for (let i = period - 1; i < candles.length; i++) {
        let hh = -Infinity, ll = Infinity;
        for (let j = 0; j < period; j++) {
            if (candles[i - j].high > hh) hh = candles[i - j].high;
            if (candles[i - j].low < ll)  ll = candles[i - j].low;
        }
        out[i] = hh === ll ? -50 : ((hh - candles[i].close) / (hh - ll)) * -100;
    }
    return out;
}

// Awesome Oscillator
function awesomeOscillator(candles) {
    const n = candles.length;
    const mp = candles.map(c => (c.high + c.low) / 2);
    const sma5 = sma(mp, 5);
    const sma34 = sma(mp, 34);
    const ao = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
        if (sma5[i] !== null && sma34[i] !== null) ao[i] = sma5[i] - sma34[i];
    }
    return { ao };
}

// Supertrend — ATR-based trend indicator
// Returns { line, direction }: direction[i] = 1 (bullish), -1 (bearish), 0 (neutral)
function supertrend(candles, period, mult) {
    const n = candles.length;
    const a = atr(candles, period);
    const line = new Array(n).fill(null);
    const direction = new Array(n).fill(0);

    let prevLine = null;
    let prevDir = 0;

    for (let i = 0; i < n; i++) {
        if (a[i] === null) continue;
        const hl2 = (candles[i].high + candles[i].low) / 2;
        const upper = hl2 + mult * a[i];
        const lower = hl2 - mult * a[i];

        let dir, finalLine;
        if (prevLine === null) {
            // init — direction by close vs hl2
            dir = candles[i].close > hl2 ? 1 : -1;
            finalLine = dir === 1 ? lower : upper;
        } else {
            // Final upper/lower with prev (trend memory)
            const fUpper = (upper < prevLine || candles[i - 1].close > prevLine) ? upper : prevLine;
            const fLower = (lower > prevLine || candles[i - 1].close < prevLine) ? lower : prevLine;
            if (candles[i].close > fUpper) {
                dir = 1;
                finalLine = fLower;
            } else if (candles[i].close < fLower) {
                dir = -1;
                finalLine = fUpper;
            } else {
                dir = prevDir;
                finalLine = dir === 1 ? fLower : fUpper;
            }
        }
        line[i] = finalLine;
        direction[i] = dir;
        prevLine = finalLine;
        prevDir = dir;
    }
    return { line, direction };
}

// ATR
function atr(candles, period) {
    const n = candles.length;
    const tr = new Array(n).fill(0);
    tr[0] = candles[0].high - candles[0].low;
    for (let i = 1; i < n; i++) {
        const c = candles[i];
        tr[i] = Math.max(
            c.high - c.low,
            Math.abs(c.high - candles[i - 1].close),
            Math.abs(c.low - candles[i - 1].close)
        );
    }
    return ema(tr, period);
}

// OBV
function obv(candles) {
    const out = new Array(candles.length).fill(0);
    for (let i = 1; i < candles.length; i++) {
        if (candles[i].close > candles[i - 1].close) out[i] = out[i - 1] + candles[i].volume;
        else if (candles[i].close < candles[i - 1].close) out[i] = out[i - 1] - candles[i].volume;
        else out[i] = out[i - 1];
    }
    return out;
}

// VROC
function vroc(candles, period) {
    const out = new Array(candles.length).fill(null);
    for (let i = period; i < candles.length; i++) {
        const prev = candles[i - period].volume;
        if (prev !== 0) out[i] = ((candles[i].volume - prev) / prev) * 100;
    }
    return out;
}

// CMF
function cmf(candles, period) {
    const mfv = candles.map(c => {
        const range = c.high - c.low;
        const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
        return mfm * c.volume;
    });
    const sumMfv = new Array(candles.length).fill(null);
    const sumV = new Array(candles.length).fill(null);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < candles.length; i++) {
        s1 += mfv[i];
        s2 += candles[i].volume;
        if (i >= period) {
            s1 -= mfv[i - period];
            s2 -= candles[i - period].volume;
        }
        if (i >= period - 1) {
            sumMfv[i] = s1;
            sumV[i] = s2;
        }
    }
    return sumMfv.map((v, i) => (sumV[i] && sumV[i] !== 0) ? v / sumV[i] : 0);
}

/* ============ VOLUME PROFILE ============ */
// Returns { bins: [{price, vol}], minPrice, maxPrice, maxVol }
// Each candle distributes its volume across two bins (high/low).
function volumeProfile(candles, binsCount, lookback) {
    const start = Math.max(0, candles.length - lookback);
    const slice = candles.slice(start);
    if (!slice.length) return { bins: [], minPrice: 0, maxPrice: 0, maxVol: 0 };

    let minPrice = Infinity, maxPrice = -Infinity;
    for (const c of slice) {
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
    }
    if (minPrice === maxPrice) return { bins: [], minPrice, maxPrice, maxVol: 0 };

    const range = maxPrice - minPrice;
    const bins = new Array(binsCount).fill(0).map((_, i) => ({
        price: minPrice + (i + 0.5) * (range / binsCount),
        vol: 0
    }));

    for (const c of slice) {
        const lowIdx = Math.max(0, Math.min(binsCount - 1, Math.floor(((c.low - minPrice) / range) * binsCount)));
        const highIdx = Math.max(0, Math.min(binsCount - 1, Math.floor(((c.high - minPrice) / range) * binsCount)));
        // distribute proportionally — each bin gets a share matching the overlap
        if (lowIdx === highIdx) {
            bins[lowIdx].vol += c.volume;
        } else {
            const span = highIdx - lowIdx;
            for (let i = lowIdx; i <= highIdx; i++) {
                // weight — wick length inside the bin
                const binLow = minPrice + (i / binsCount) * range;
                const binHigh = minPrice + ((i + 1) / binsCount) * range;
                const overlapLo = Math.max(c.low, binLow);
                const overlapHi = Math.min(c.high, binHigh);
                if (overlapHi > overlapLo) {
                    bins[i].vol += c.volume * ((overlapHi - overlapLo) / (c.high - c.low || 1));
                } else {
                    bins[i].vol += c.volume / span;
                }
            }
        }
    }
    let maxVol = 0;
    for (const b of bins) if (b.vol > maxVol) maxVol = b.vol;
    return { bins, minPrice, maxPrice, maxVol };
}

/* ============ FIBONACCI RETRACEMENT ============ */
// Auto-finds high/low in window, returns retracement levels
function fibonacci(candles, lookback) {
    const start = Math.max(0, candles.length - lookback);
    const slice = candles.slice(start);
    if (!slice.length) return { levels: [], high: 0, low: 0, trend: 'up' };

    let high = -Infinity, low = Infinity;
    let highIdx = 0, lowIdx = 0;
    for (let i = 0; i < slice.length; i++) {
        if (slice[i].high > high) { high = slice[i].high; highIdx = i; }
        if (slice[i].low  < low)  { low  = slice[i].low;  lowIdx  = i; }
    }
    // Trend — by where high/low sit relative to each other
    const trend = highIdx > lowIdx ? 'up' : 'down'; // up: low first, then high

    const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const levels = ratios.map(r => ({
        ratio: r,
        price: trend === 'up' ? high - (high - low) * r : low + (high - low) * r
    }));
    return { levels, high, low, trend };
}

/* ============ PIVOT POINTS ============ */
// Returns pivot levels for the current "session" — uses high/low/close of the previous N-candle series
function pivotPoints(candles, method) {
    // Use high/low/close of the PREVIOUS candle as classic pivots
    if (candles.length < 2) return { levels: [] };
    const prev = candles[candles.length - 2];
    const H = prev.high, L = prev.low, C = prev.close;
    const range = H - L;
    const P = (H + L + C) / 3;

    let levels;
    if (method === 'classic') {
        levels = [
            { name: 'R3', price: H + 2 * (P - L) },
            { name: 'R2', price: P + (H - L) },
            { name: 'R1', price: 2 * P - L },
            { name: 'P',  price: P },
            { name: 'S1', price: 2 * P - H },
            { name: 'S2', price: P - (H - L) },
            { name: 'S3', price: L - 2 * (H - P) }
        ];
    } else if (method === 'camarilla') {
        levels = [
            { name: 'R4', price: C + range * 1.1 / 2 },
            { name: 'R3', price: C + range * 1.1 / 4 },
            { name: 'R2', price: C + range * 1.1 / 6 },
            { name: 'R1', price: C + range * 1.1 / 12 },
            { name: 'P',  price: P },
            { name: 'S1', price: C - range * 1.1 / 12 },
            { name: 'S2', price: C - range * 1.1 / 6 },
            { name: 'S3', price: C - range * 1.1 / 4 },
            { name: 'S4', price: C - range * 1.1 / 2 }
        ];
    } else if (method === 'fibonacci') {
        levels = [
            { name: 'R3', price: P + range * 1.000 },
            { name: 'R2', price: P + range * 0.618 },
            { name: 'R1', price: P + range * 0.382 },
            { name: 'P',  price: P },
            { name: 'S1', price: P - range * 0.382 },
            { name: 'S2', price: P - range * 0.618 },
            { name: 'S3', price: P - range * 1.000 }
        ];
    } else if (method === 'woodie') {
        const P2 = (H + L + 2 * C) / 4;
        levels = [
            { name: 'R3', price: H + 2 * (P2 - L) },
            { name: 'R2', price: P2 + (H - L) },
            { name: 'R1', price: 2 * P2 - L },
            { name: 'P',  price: P2 },
            { name: 'S1', price: 2 * P2 - H },
            { name: 'S2', price: P2 - (H - L) },
            { name: 'S3', price: L - 2 * (H - P2) }
        ];
    } else {
        levels = [{ name: 'P', price: P }];
    }
    return { levels };
}

/* Catalog for the modal */
Indicators.getCatalog = function () {
    const groups = {};
    for (const key in Indicators) {
        if (key === 'getCatalog' || key === 'create') continue;
        const ind = Indicators[key];
        if (!ind.category) continue;
        if (!groups[ind.category]) groups[ind.category] = [];
        groups[ind.category].push({ key, ...ind });
    }
    return groups;
};

Indicators.create = function (key, customParams = {}) {
    const def = Indicators[key];
    if (!def) return null;
    const params = {};
    for (const p in def.params) {
        params[p] = customParams[p] !== undefined ? customParams[p] : def.params[p].def;
    }
    return {
        key,
        ...def,
        params,
        instanceId: `${key}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    };
};

window.Indicators = Indicators;