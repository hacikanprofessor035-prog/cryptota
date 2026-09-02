// /api/payments/* — create crypto invoice, get status, list user's payments
import { Router } from 'express';
import { z } from 'zod';
import * as db from '../lib/db.js';
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

        // 1. Create the payment record first (status: pending) so we have an
        //    internal id for the order_id before we talk to NOWPayments.
        const payment = await db.createPayment({
            userId: req.user.id, tier, amountUsd: pricing.usd
        });
        const internalId = payment.id;

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
            await db.updatePayment(internalId, { status: 'failed' });
            if (e instanceof NowPaymentsError) {
                return res.status(502).json({ error: 'Payment provider error', details: e.body });
            }
            throw e;
        }

        // 3. Update the local record with provider details.
        const updated = await db.updatePayment(internalId, {
            provider_payment_id: String(npResp.payment_id),
            pay_amount: npResp.pay_amount,
            pay_currency: npResp.pay_currency,
            pay_address: npResp.pay_address,
            status: npResp.payment_status || 'waiting',
        });

        res.status(201).json({
            payment: {
                id: internalId,
                providerPaymentId: updated.provider_payment_id,
                tier,
                amountUsd: pricing.usd,
                payAmount: updated.pay_amount,
                payCurrency: updated.pay_currency,
                payAddress: updated.pay_address,
                status: updated.status,
                createdAt: updated.created_at,
            },
        });
    } catch (e) { next(e); }
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
        res.json({
            payment: {
                id: row.id,
                providerPaymentId: row.provider_payment_id,
                tier: row.tier,
                amountUsd: row.amount_usd,
                payAmount: row.pay_amount,
                payCurrency: row.pay_currency,
                payAddress: row.pay_address,
                status: row.status,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            }
        });
    } catch (e) { next(e); }
});

paymentsRouter.get('/', authMiddleware(), async (req, res, next) => {
    try {
        const rows = await db.listPayments(req.user.id, 50);
        res.json({
            payments: rows.map(p => ({
                id: p.id,
                providerPaymentId: p.provider_payment_id,
                tier: p.tier,
                amountUsd: p.amount_usd,
                payAmount: p.pay_amount,
                payCurrency: p.pay_currency,
                payAddress: p.pay_address,
                status: p.status,
                createdAt: p.created_at,
                updatedAt: p.updated_at
            }))
        });
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
        const row = await db.getPayment(id);
        if (!row) return res.status(404).json({ error: 'Payment not found' });
        res.json({
            payment: {
                id: row.id,
                status: row.status,
                tier: row.tier,
                payAmount: row.pay_amount,
                payCurrency: row.pay_currency,
                payAddress: row.pay_address,
                updatedAt: row.updated_at
            }
        });
    } catch (e) { next(e); }
});
