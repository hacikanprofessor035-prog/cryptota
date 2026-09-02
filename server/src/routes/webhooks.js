// /api/webhooks/nowpayments — receives IPN callbacks from NOWPayments.
// Critical security properties:
//   - HMAC-SHA512 signature verified against IPN secret
//   - Idempotent: duplicate event_id is silently ignored
//   - Provider is the source of truth (we trust their status field)
import { Router } from 'express';
import { getDb } from '../lib/db.js';
import { nowpayments } from '../lib/nowpayments.js';
import { config } from '../config.js';
import { PRICING } from './payments.js';

export const webhooksRouter = Router();

// Map NOWPayments status → our internal status.
const STATUS_MAP = {
    waiting: 'waiting',
    confirming: 'confirming',
    confirmed: 'confirmed',
    sending: 'sending',
    partially_paid: 'partially_paid',
    finished: 'finished',
    failed: 'failed',
    refunded: 'refunded',
    expired: 'expired',
};

function activateLicense(db, userId, tier) {
    const pricing = PRICING[tier];
    if (!pricing) throw new Error(`Unknown tier: ${tier}`);
    const now = new Date();
    const expiresAt = pricing.durationDays
        ? new Date(now.getTime() + pricing.durationDays * 86400_000).toISOString()
        : null;
    db.prepare(`
        INSERT INTO licenses (user_id, tier, activated_at, expires_at, source)
        VALUES (?, ?, ?, ?, 'nowpayments')
    `).run(userId, tier, now.toISOString(), expiresAt);
    return { activatedAt: now.toISOString(), expiresAt };
}

// Read raw body as a Buffer. We don't use express.raw because supertest
// serialises Buffers as JSON; instead we read the stream ourselves and
// stash both a Buffer and the original string for HMAC verification.
function rawJsonMiddleware(req, res, next) {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
        req.rawBody = Buffer.concat(chunks);
        try {
            req.parsedBody = req.rawBody.length > 0 ? JSON.parse(req.rawBody.toString('utf8')) : {};
        } catch (e) {
            req.parsedBody = null;
        }
        next();
    });
    req.on('error', next);
}

webhooksRouter.post(
    '/nowpayments',
    rawJsonMiddleware,
    async (req, res) => {
        const rawBody = req.rawBody;
        const signature = req.headers['x-nowpayments-sig'];
        const eventId = String(req.headers['x-nowpayments-event-id'] || '');

        // 1. Verify signature first — fail closed.
        if (!signature || !nowpayments.verifyIpnSignature(rawBody, signature)) {
            const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
            console.warn('[webhook] Invalid or missing signature', {
                hasSignature: !!signature,
                hasSecret: !!config.nowpayments.ipnSecret,
                bodyLength: rawBody?.length,
                bodyPreview: bodyStr.slice(0, 200),
                sigLength: signature?.length,
            });
            return res.status(401).send('invalid signature');
        }

        const payload = req.parsedBody;
        if (!payload) {
            return res.status(400).send('invalid json');
        }

        const db = getDb();

        // 2. Idempotency — if we've seen this event_id, ACK and skip.
        if (eventId) {
            const existing = db.prepare(
                'SELECT id FROM webhook_events WHERE provider = ? AND event_id = ?'
            ).get('nowpayments', eventId);
            if (existing) {
                return res.status(200).send('ok (duplicate)');
            }
        }

        // 3. Find the payment. NOWPayments sends provider_payment_id; our
        //    internal id is in order_id.
        const internalId = Number(payload.order_id);
        if (!internalId) {
            console.warn('[webhook] Missing order_id in payload', payload);
            return res.status(400).send('missing order_id');
        }

        const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(internalId);
        if (!payment) {
            console.warn(`[webhook] No payment with id ${internalId}`);
            return res.status(404).send('unknown payment');
        }

        // 4. Persist the event (idempotency record) inside a transaction with
        //    the status update so we never lose an event.
        const now = new Date().toISOString();
        const newStatus = STATUS_MAP[payload.payment_status] || payment.status;

        try {
            db.transaction(() => {
                if (eventId) {
                    db.prepare(`
                        INSERT INTO webhook_events (provider, event_id, payload, received_at, processed_at)
                        VALUES ('nowpayments', ?, ?, ?, ?)
                    `).run(eventId, JSON.stringify(payload), now, now);
                }
                db.prepare('UPDATE payments SET status = ?, updated_at = ? WHERE id = ?')
                    .run(newStatus, now, internalId);

                // 5. Activate license on successful payment
                if (newStatus === 'finished' && payment.status !== 'finished') {
                    if (!payment.user_id) {
                        throw new Error('Payment has no user_id — cannot activate');
                    }
                    activateLicense(db, payment.user_id, payment.tier);
                    console.log(`[webhook] Activated ${payment.tier} for user ${payment.user_id}`);
                }
            })();
        } catch (e) {
            console.error('[webhook] Processing error:', e);
            if (eventId) {
                db.prepare(`
                    INSERT OR REPLACE INTO webhook_events
                        (provider, event_id, payload, received_at, error)
                    VALUES ('nowpayments', ?, ?, ?, ?)
                `).run(eventId, JSON.stringify(payload), now, String(e));
            }
            return res.status(500).send('processing error');
        }

        // Always 200 to NOWPayments (anything else triggers retries)
        res.status(200).send('ok');
    }
);
