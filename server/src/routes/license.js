// /api/license/* — get current license, list payments, activation history
import { Router } from 'express';
import * as db from '../lib/db.js';
import { authMiddleware } from '../lib/auth.js';

export const licenseRouter = Router();

licenseRouter.get('/me', authMiddleware(false), async (req, res, next) => {
    try {
        if (!req.user) {
            return res.json({ tier: 'free', userId: null, expiresAt: null, source: 'unauthenticated' });
        }
        const license = await db.getActiveLicense(req.user.id);
        if (!license) {
            return res.json({ tier: 'free', userId: req.user.id, expiresAt: null, source: 'default' });
        }
        res.json({
            tier: license.tier,
            userId: req.user.id,
            expiresAt: license.expires_at,
            activatedAt: license.activated_at,
            source: license.source
        });
    } catch (err) { next(err); }
});

licenseRouter.get('/history', authMiddleware(), async (req, res, next) => {
    try {
        const licenses = await db.listLicenses(req.user.id, 20);
        const payments = await db.listPayments(req.user.id, 20);
        res.json({
            licenses: licenses.map(l => ({
                tier: l.tier,
                activatedAt: l.activated_at,
                expiresAt: l.expires_at,
                source: l.source
            })),
            payments: payments.map(p => ({
                id: p.id,
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
    } catch (err) { next(err); }
});
