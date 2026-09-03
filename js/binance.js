/* === CryptoTA — Binance API ===
 * REST: klines, 24h tickers, exchange info
 * WebSocket: kline stream + miniTicker stream
 */

const BinanceAPI = (() => {
    const REST_BASE = 'https://api.binance.com';
    const WS_BASE = 'wss://stream.binance.com:9443/ws';

    // --- Utilities ---
    const INTERVALS = {
        '1m': '1m', '5m': '5m', '15m': '15m',
        '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w'
    };

    async function fetchJson(url) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }

    // --- REST: pair list ---
    let exchangeInfoCache = null;
    async function getExchangeInfo() {
        if (exchangeInfoCache) return exchangeInfoCache;
        const data = await fetchJson(`${REST_BASE}/api/v3/exchangeInfo`);
        // Include all trading pairs, not just USDT-quoted. The sidebar
        // filters by quote (USDT / BTC / ETH / BNB) and the rest of the UI
        // also works with any quote.
        exchangeInfoCache = data.symbols
            .filter(s => s.status === 'TRADING')
            .map(s => ({
                symbol: s.symbol,
                base: s.baseAsset,
                quote: s.quoteAsset
            }));
        return exchangeInfoCache;
    }

    // --- REST: 24h tickers (single batch, up to 100 symbols) ---
    let tickersCache = null;
    let tickersCacheTime = 0;
    async function get24hTickers(symbols = null) {
        const now = Date.now();
        if (!symbols && tickersCache && now - tickersCacheTime < 30000) {
            return tickersCache;
        }
        const data = await fetchJson(`${REST_BASE}/api/v3/ticker/24hr`);
        let filtered = data;
        if (symbols) {
            const set = new Set(symbols);
            filtered = data.filter(t => set.has(t.symbol));
        }
        const map = {};
        for (const t of filtered) {
            map[t.symbol] = {
                symbol: t.symbol,
                last: parseFloat(t.lastPrice),
                change: parseFloat(t.priceChangePercent),
                high: parseFloat(t.highPrice),
                low: parseFloat(t.lowPrice),
                volume: parseFloat(t.volume),
                quoteVolume: parseFloat(t.quoteVolume)
            };
        }
        if (!symbols) {
            tickersCache = map;
            tickersCacheTime = now;
        }
        return map;
    }

    // --- REST: candles ---
    async function getKlines(symbol, interval, limit = 500) {
        const url = `${REST_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const data = await fetchJson(url);
        return data.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            closeTime: k[6]
        }));
    }

    // --- WebSocket: kline stream ---
    class KlineStream {
        constructor(symbol, interval, onCandle, onClose) {
            this.symbol = symbol.toLowerCase();
            this.interval = interval;
            this.onCandle = onCandle;
            this.onClose = onClose;
            this.ws = null;
            this.reconnectDelay = 1000;
            this.shouldRun = false;
        }

        connect() {
            this.shouldRun = true;
            this._open();
        }

        _open() {
            const stream = `${this.symbol}@kline_${this.interval}`;
            this.ws = new WebSocket(`${WS_BASE}/${stream}`);
            this.ws.onopen = () => { this.reconnectDelay = 1000; };
            this.ws.onmessage = (e) => {
                try {
                    const m = JSON.parse(e.data);
                    const k = m.k;
                    const candle = {
                        time: k.t,
                        open: parseFloat(k.o),
                        high: parseFloat(k.h),
                        low: parseFloat(k.l),
                        close: parseFloat(k.c),
                        volume: parseFloat(k.v),
                        closeTime: k.T,
                        isClosed: k.x
                    };
                    if (this.onCandle) this.onCandle(candle);
                    if (candle.isClosed && this.onClose) this.onClose(candle);
                } catch (err) { /* ignore parse */ }
            };
            this.ws.onclose = () => {
                if (this.shouldRun) {
                    setTimeout(() => this._open(), this.reconnectDelay);
                    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
                }
            };
            this.ws.onerror = () => { /* let onclose handle */ };
        }

        close() {
            this.shouldRun = false;
            if (this.ws) { this.ws.close(); this.ws = null; }
        }
    }

    // --- WebSocket: mini-ticker stream for the full list ---
    class TickerStream {
        constructor(onUpdate) {
            this.onUpdate = onUpdate;
            this.ws = null;
            this.reconnectDelay = 1000;
            this.shouldRun = false;
        }
        connect() {
            this.shouldRun = true;
            this._open();
        }
        _open() {
            this.ws = new WebSocket(`${WS_BASE}/!miniTicker@arr`);
            this.ws.onopen = () => { this.reconnectDelay = 1000; };
            this.ws.onmessage = (e) => {
                try {
                    const arr = JSON.parse(e.data);
                    const map = {};
                    for (const t of arr) {
                        if (!t.s.endsWith('USDT')) continue;
                        map[t.s] = {
                            symbol: t.s,
                            last: parseFloat(t.c),
                            high: parseFloat(t.h),
                            low: parseFloat(t.l),
                            volume: parseFloat(t.v),
                            quoteVolume: parseFloat(t.q),
                            open: parseFloat(t.o),
                            change: t.o && parseFloat(t.o) > 0 ? ((parseFloat(t.c) - parseFloat(t.o)) / parseFloat(t.o)) * 100 : 0
                        };
                    }
                    if (this.onUpdate) this.onUpdate(map);
                } catch (err) { /* ignore */ }
            };
            this.ws.onclose = () => {
                if (this.shouldRun) {
                    setTimeout(() => this._open(), this.reconnectDelay);
                    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
                }
            };
            this.ws.onerror = () => { /* let onclose handle */ };
        }
        close() {
            this.shouldRun = false;
            if (this.ws) { this.ws.close(); this.ws = null; }
        }
    }

    return {
        INTERVALS,
        getExchangeInfo,
        get24hTickers,
        getKlines,
        KlineStream,
        TickerStream
    };
})();

window.BinanceAPI = BinanceAPI;