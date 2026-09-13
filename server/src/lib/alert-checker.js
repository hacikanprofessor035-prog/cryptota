// Price alert checker — in-process worker, same pattern as the TON
// payments polling worker (startAlertChecker / graceful stop on SIGTERM).
//
// Every ALERT_CHECK_INTERVAL_MS:
//   1. SELECT DISTINCT symbols from active alerts
//   2. One Binance ticker call per symbol (24h ticker gives lastPrice)
//   3. For each matching alert: mark triggered + Web Push to the owner
//
// Uses fetch (undici) — no extra deps. Backs off on network errors.
import * as db from './db.js';
import * as push from './push.js';

const ALERT_CHECK_INTERVAL_MS = 60_000; // 1 min
const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/price';
const MAX_SYMBOLS_PER_TICK = 50;

let _timer = null;
let _running = false;

async function fetchPrice(symbol) {
    const res = await fetch(`${BINANCE_TICKER_URL}?symbol=${encodeURIComponent(symbol)}`, {
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol}`);
    const j = await res.json();
    const price = Number(j.price);
    if (!Number.isFinite(price)) throw new Error(`Binance bad price for ${symbol}`);
    return price;
}

async function checkTick() {
    if (_running) return; // avoid overlap if a tick runs long
    _running = true;
    try {
        const alerts = await db.listPendingAlerts();
        if (alerts.length === 0) return;

        // Group by symbol, cap the work per tick.
        const bySymbol = new Map();
        for (const a of alerts) {
            if (!bySymbol.has(a.symbol)) bySymbol.set(a.symbol, []);
            bySymbol.get(a.symbol).push(a);
        }

        let checked = 0;
        for (const [symbol, list] of bySymbol) {
            if (checked >= MAX_SYMBOLS_PER_TICK) break;
            checked++;
            let price;
            try {
                price = await fetchPrice(symbol);
            } catch (e) {
                console.error(`[alerts] price fetch failed for ${symbol}: ${e.message}`);
                continue; // try again next tick
            }

            for (const a of list) {
                const target = Number(a.target_price);
                const hit =
                    (a.direction === 'above' && price >= target) ||
                    (a.direction === 'below' && price <= target);
                if (!hit) continue;

                await db.markAlertTriggered(a.id, price);

                const arrow = a.direction === 'above' ? '↑' : '↓';
                const r = await push.sendPushToUser(a.user_id, {
                    title: `CryptoTA — ${symbol} ${arrow} $${target}`,
                    body: `${symbol} is now $${price}. Your ${a.direction}-alert triggered.`,
                    icon: '/apple-touch-icon.png',
                    tag: `cryptota-alert-${a.id}`,
                });
                console.log(`[alerts] triggered #${a.id} (${symbol} ${a.direction} ${target}, now ${price}); push: ${r.sent ?? 0} sent`);
            }
        }
    } catch (e) {
        console.error('[alerts] tick error:', e);
    } finally {
        _running = false;
    }
}

export function startAlertChecker() {
    if (_timer) return;
    // Only run the checker when the push keys exist? No — alerts are
    // useful even without push (status shows on next visit). Always run.
    _timer = setInterval(() => { checkTick().catch(() => {}); }, ALERT_CHECK_INTERVAL_MS);
    // Don't hold the event loop open just for the checker.
    _timer.unref?.();
    console.log(`[alerts] price checker started (every ${ALERT_CHECK_INTERVAL_MS / 1000}s)`);
}

export function stopAlertChecker() {
    if (_timer) clearInterval(_timer);
    _timer = null;
}
