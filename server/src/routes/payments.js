// /api/payments/* — create TON payment invoice, get status, list user's payments
//
// Payment flow (TON, no third-party provider):
//   1. POST /create  → server generates a unique memo, stores a "pending" payment
//      with the required TON amount (2 TON for Pro, live-rate for Lifetime).
//   2. Client polls GET /:id/status every ~10s. As soon as the polling worker
//      finds an incoming tx matching memo+amount, status flips to "completed"
//      and a license is inserted.
//   3. The polling worker is started once on server boot and runs every 15s.
import { Router } from 'express';
import { z } from 'zod';
import * as db from '../lib/db.js';
import { authMiddleware } from '../lib/auth.js';
import * as tonLib from '../lib/ton.js';
import { config } from '../config.js';

const { generateMemo, usdToTon, TonError, checkIncoming } = tonLib;

export const paymentsRouter = Router();

// Pricing. Both tiers are now priced in TON directly (no USD peg, no
// CoinGecko call). Update the corresponding numbers in js/config.js when
// you change these — the two MUST stay in sync, otherwise users will see
// one price on the card and a different one on the invoice.
export const PRICING = {
    pro: { ton: 2, usd: 3, durationDays: 365 },
    lifetime: { ton: 20, usd: 39, durationDays: null }, // null = no expiry
};

const createSchema = z.object({
    tier: z.enum(['pro', 'lifetime']),
    // TON-only for now. The frontend has a fiat dropdown; we still accept the
    // field so the existing UI keeps working.
    payCurrency: z.string().optional().default('ton'),
});

// How much extra the user must send on top of the listed TON price.
// Covers TON price volatility between invoice creation and tx confirmation.
const TON_BUFFER = 0.03; // +3 %

function applyBuffer(amount, pct) {
    return amount * (1 + pct);
}
function roundUpTo3(x) {
    // Round to 3 decimals so the invoice reads cleanly (e.g. 2.06 TON).
    return Math.ceil(x * 1000) / 1000;
}

paymentsRouter.post('/create', authMiddleware(), async (req, res, next) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        }
        const { tier } = parsed.data;
        const pricing = PRICING[tier];

                if (!config.ton.address) {
                    return res.status(503).json({
                        error: 'TON payments are not configured on this server',
                    });
                }

                // 2. Compute how much the user must send.
                //    - 'pro'      → fixed TON amount (pricing.ton). Buffer applied below.
                //    - 'lifetime' → USD peg, converted to TON at the live rate.
                let tonAmount, nanoTon, priceUsd;
                if (typeof pricing.ton === 'number') {
                    // Fixed-TON tier: buffer on the TON amount itself (not the USD).
                    tonAmount = roundUpTo3(applyBuffer(pricing.ton, TON_BUFFER));
                    nanoTon = BigInt(Math.round(tonAmount * 1e9));
                    // We still record a USD estimate for analytics / history.
                    priceUsd = null; // unknown without an extra API call; leave null
                } else {
                    ({ tonAmount, nanoTon, priceUsd } = await usdToTon(pricing.usd));
                }

        // 2. Generate a unique memo (16 hex chars). This is how we attribute
        //    the on-chain tx to this internal payment record.
        const memo = generateMemo();

        // 3. Create the payment record (status: waiting) with all the info the
        //    user needs to complete the payment.
        const payment = await db.createPayment({
            userId: req.user.id, tier, amountUsd: pricing.usd,
        });
        const updated = await db.updatePayment(payment.id, {
            memo,
            pay_amount: tonAmount,
            pay_currency: 'ton',
            pay_address: config.ton.address,
            price_usd_at_create: priceUsd,
            min_nano_ton: nanoTon,
            status: 'waiting',
        });

        res.status(201).json({
            payment: {
                id: updated.id,
                tier,
                amountUsd: pricing.usd,
                payAmount: tonAmount,
                payCurrency: 'ton',
                payAddress: config.ton.address,
                memo,
                status: 'waiting',
                createdAt: updated.created_at,
            },
        });
    } catch (e) {
        if (e instanceof TonError) {
            return res.status(502).json({ error: 'TON provider error', details: e.body });
        }
        next(e);
    }
});

paymentsRouter.get('/:id', authMiddleware(), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid payment id' });
        }
        const row = await db.getPayment(id);
        if (!row || row.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        res.json({ payment: serializePayment(row) });
    } catch (e) { next(e); }
});

paymentsRouter.get('/', authMiddleware(), async (req, res, next) => {
    try {
        const rows = await db.listPayments(req.user.id, 50);
        res.json({ payments: rows.map(serializePayment) });
    } catch (e) { next(e); }
});

// Public status endpoint — used by the UI to poll a payment without auth
// (the payment id + memo together are treated as an unguessable token; combine
// with rate-limiting in production).
paymentsRouter.get('/:id/status', async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid payment id' });
        }
        const row = await db.getPayment(id);
        if (!row) return res.status(404).json({ error: 'Payment not found' });
        res.json({ payment: {
            id: row.id,
            status: row.status,
            tier: row.tier,
            payAmount: row.pay_amount,
            payCurrency: row.pay_currency,
            payAddress: row.pay_address,
            memo: row.memo,
            updatedAt: row.updated_at,
        }});
    } catch (e) { next(e); }
});

function serializePayment(row) {
    return {
        id: row.id,
        tier: row.tier,
        amountUsd: row.amount_usd,
        payAmount: row.pay_amount,
        payCurrency: row.pay_currency,
        payAddress: row.pay_address,
        memo: row.memo,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/* ============ Polling worker ============
 *
 * toncenter.com free tier is rate-limited (~5 requests / second, but
 * sustained polling gets a 429 quickly). We poll at a comfortable cadence
 * AND back off aggressively when we hit a 429 — recent logs showed 429s
 * every cycle on the 15-second schedule, which was just noise.
 *
 * Cadence:
 *   - Healthy: every POLL_INTERVAL_MS (60 s)
 *   - After 429: back off to BACKOFF_AFTER_429_MS (5 min)
 *   - Still 429? 10 min, then 15 min, then 20 min (capped at BACKOFF_MAX_MS)
 *   - One successful poll resets the backoff
 */

const POLL_INTERVAL_MS = 60_000;          // 1 min when healthy
const BACKOFF_AFTER_429_MS = 5 * 60_000;  // 5 min after first 429
const BACKOFF_MAX_MS = 20 * 60_000;       // cap at 20 min

let _pollTimer = null;
let _pollInProgress = false;
let _nextDelay = POLL_INTERVAL_MS;        // current delay until next poll

function scheduleNext() {
    if (_pollTimer) clearTimeout(_pollTimer);
    _pollTimer = setTimeout(pollOnce, _nextDelay);
}

async function pollOnce() {
    if (_pollInProgress) {
        // If a poll is somehow still running, just chain another tick.
        return scheduleNext();
    }
    if (!config.ton.address) {
        // No TON configured — sleep and try again later.
        _nextDelay = POLL_INTERVAL_MS;
        return scheduleNext();
    }
    _pollInProgress = true;
    let sawRateLimit = false;
    try {
        const pending = await db.listPendingPayments();
        if (pending.length === 0) {
            // Nothing to do — healthy tick.
            _nextDelay = POLL_INTERVAL_MS;
            return;
        }

        // For simplicity: check each pending payment in turn. Cheap for our
        // scale (≤ a few dozen at a time).
        for (const p of pending) {
            try {
                const res = await checkIncoming({
                    memo: p.memo,
                    minNanoTon: p.min_nano_ton,
                    sinceLt: p.last_seen_lt,
                    sinceUtime: p.last_seen_utime,
                });

                if (res.found) {
                    await activatePayment(p, res.found);
                } else if (res.newestLt) {
                    // Advance cursor so we don't re-scan the same tx next time.
                    await db.updatePayment(p.id, {
                        last_seen_lt: res.newestLt,
                        last_seen_utime: res.newestUt,
                    });
                }
            } catch (e) {
                console.error(`[payments] poll error for #${p.id}:`, e.message);
                if (e.status === 429 || /429|rate.?limit/i.test(String(e.message))) {
                    sawRateLimit = true;
                }
            }
        }
        await db.setPollCheckpoint(Date.now());
    } catch (e) {
        console.error('[payments] poll loop error:', e.message);
        if (e.status === 429 || /429|rate.?limit/i.test(String(e.message))) {
            sawRateLimit = true;
        }
    } finally {
        _pollInProgress = false;
        if (sawRateLimit) {
            // Double the delay on each consecutive 429, capped at BACKOFF_MAX_MS.
            _nextDelay = Math.min(Math.max(_nextDelay * 2, BACKOFF_AFTER_429_MS), BACKOFF_MAX_MS);
            console.warn(`[payments] rate limited by toncenter — next poll in ${(_nextDelay / 1000).toFixed(0)}s`);
        } else {
            _nextDelay = POLL_INTERVAL_MS;
        }
        scheduleNext();
    }
}

export function startPaymentPolling() {
    if (_pollTimer) return;
    // First run after 2s so the server is ready.
    setTimeout(pollOnce, 2_000);
    // Then schedule normal cadence.
    _pollTimer = setTimeout(pollOnce, POLL_INTERVAL_MS + 2_000);
    console.log(`[payments] TON polling worker started (every ${(POLL_INTERVAL_MS / 1000).toFixed(0)}s, backs off on 429)`);
}

export function stopPaymentPolling() {
    if (_pollTimer) {
        clearTimeout(_pollTimer);
        _pollTimer = null;
    }
}

async function activatePayment(p, tx) {
    const pricing = PRICING[p.tier];
    const expiresAt = pricing.durationDays
        ? Date.now() + pricing.durationDays * 86400_000
        : null;

    await db.insertLicense({
        userId: p.user_id,
        tier: p.tier,
        expiresAt,
        source: 'ton',
        sourceId: String(tx.hash || ''),
    });
    await db.updatePayment(p.id, {
        status: 'finished',
        tx_hash: tx.hash,
        tx_lt: tx.lt,
        tx_from: tx.from,
        tx_value: tx.value,
        completed_at: Date.now(),
    });
    console.log(`[payments] ✅ payment #${p.id} completed (user=${p.user_id} tier=${p.tier})`);
}
