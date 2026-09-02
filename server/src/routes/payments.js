// /api/payments/* — create crypto invoice, get status, list user's payments
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { authMiddleware } from '../lib/auth.js';
import { nowpayments, NowPaymentsError } from '../lib/nowpayments.js';
import { config } from '../config.js';

export const paymentsRouter = Router();

// Pricing must match the frontend config. If you change these, also update
// js/config.js → pricing.
export const PRICING = {
    pro: { usd: 3, durationDays: 365 },
    lifetime: { usd: 39, durationDays: null }, // null = no expiry
};

const createSchema = z.object({
    tier: z.enum(['pro', 'lifetime']),
    payCurrency: z.string().min(2).max(20),
});

paymentsRouter.post('/create', authMiddleware(), async (req, res, next) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        }
        const { tier, payCurrency } = parsed.data;
        const pricing = PRICING[tier];

        const db = getDb();
        const now = new Date().toISOString();
        // 1. Create the payment record first (status: pending) so we have an
        //    internal id for the order_id before we talk to NOWPayments.
        const orderId = `u${req.user.id}-t${tier}-${Date.now()}`;
        const result = db.prepare(`
            INSERT INTO payments (user_id, provider, tier, amount_usd, status, created_at, updated_at)
            VALUES (?, 'nowpayments', ?, ?, 'pending', ?, ?)
        `).run(req.user.id, tier, pricing.usd, now, now);
        const internalId = result.lastInsertRowid;

        // 2. Call NOWPayments to create the actual invoice.
        let npResp;
        try {
            npResp = await nowpayments.createPayment({
                priceAmount: pricing.usd,
                priceCurrency: 'usd',
                payCurrency,
                orderId: String(internalId),
                orderDescription: `CryptoTA ${tier === 'lifetime' ? 'Lifetime' : 'Pro 1yr'}`,
                ipnCallbackUrl: `${config.publicBaseUrl}/api/webhooks/nowpayments`,
            });
        } catch (e) {
            // Roll back the local payment record on NOWPayments failure
            db.prepare('DELETE FROM payments WHERE id = ?').run(internalId);
            if (e instanceof NowPaymentsError) {
                return res.status(502).json({ error: 'Payment provider error', details: e.body });
            }
            throw e;
        }

        // 3. Update the local record with provider details.
        db.prepare(`
            UPDATE payments
            SET provider_payment_id = ?, pay_amount = ?, pay_currency = ?,
                pay_address = ?, status = ?, updated_at = ?
            WHERE id = ?
        `).run(
            String(npResp.payment_id),
            npResp.pay_amount,
            npResp.pay_currency,
            npResp.pay_address,
            npResp.payment_status || 'waiting',
            now,
            internalId
        );

        res.status(201).json({
            payment: {
                id: internalId,
                providerPaymentId: npResp.payment_id,
                tier,
                amountUsd: pricing.usd,
                payAmount: npResp.pay_amount,
                payCurrency: npResp.pay_currency,
                payAddress: npResp.pay_address,
                status: npResp.payment_status || 'waiting',
                createdAt: now,
            },
        });
    } catch (e) { next(e); }
});

paymentsRouter.get('/:id', authMiddleware(), (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid payment id' });
        }
        const db = getDb();
        const row = db.prepare(`
            SELECT id, provider_payment_id, tier, amount_usd, pay_amount, pay_currency,
                   pay_address, status, created_at, updated_at
            FROM payments
            WHERE id = ? AND user_id = ?
        `).get(id, req.user.id);
        if (!row) return res.status(404).json({ error: 'Payment not found' });
        res.json({ payment: row });
    } catch (e) { next(e); }
});

paymentsRouter.get('/', authMiddleware(), (req, res, next) => {
    try {
        const db = getDb();
        const rows = db.prepare(`
            SELECT id, provider_payment_id, tier, amount_usd, pay_amount, pay_currency,
                   pay_address, status, created_at, updated_at
            FROM payments
            WHERE user_id = ?
            ORDER BY datetime(created_at) DESC
            LIMIT 50
        `).all(req.user.id);
        res.json({ payments: rows });
    } catch (e) { next(e); }
});

// Public status endpoint — used by the UI to poll a payment without auth
// (the payment id alone is treated as an unguessable token; combine with
// rate-limiting in production).
paymentsRouter.get('/:id/status', async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid payment id' });
        }
        const db = getDb();
        const row = db.prepare(`
            SELECT id, status, tier, pay_amount, pay_currency, pay_address, updated_at
            FROM payments WHERE id = ?
        `).get(id);
        if (!row) return res.status(404).json({ error: 'Payment not found' });
        res.json({ payment: row });
    } catch (e) { next(e); }
});
