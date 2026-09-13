// /api/alerts/* — price alerts CRUD + Web Push subscription management.
//
// Alerts require auth (they are per-user and Pro-gated: free = 0 active
// alerts — the upgrade prompt shows on the client). Push subscriptions
// are stored per-user as well, but allow anonymous ones too: even a
// non-logged-in visitor may want a browser notification… no. Keep it
// simple: subscriptions require auth as well, so notifications can find
// their user (alerts also require auth, so this is consistent).
import { Router } from 'express';
import * as db from '../lib/db.js';
import { authMiddleware } from '../lib/auth.js';
import * as push from '../lib/push.js';

export const alertsRouter = Router();

const MAX_ALERTS_PRO = 100;

// GET /api/alerts — list current user's alerts (all statuses).
alertsRouter.get('/', authMiddleware(), async (req, res, next) => {
    try {
        const alerts = await db.listUserAlerts(req.user.id);
        res.json({ alerts, vapidPublicKey: push.getVapidPublicKey(), tier: req.user.tier || 'free' });
    } catch (err) { next(err); }
});

// POST /api/alerts — create: { symbol, direction: above|below, targetPrice }
alertsRouter.post('/', authMiddleware(), async (req, res, next) => {
    try {
        const { symbol, direction, targetPrice } = req.body || {};
        const sym = String(symbol || '').toUpperCase().trim();
        const dir = String(direction || '').toLowerCase().trim();
        const price = Number(targetPrice);

        if (!/^[A-Z0-9]{5,20}$/.test(sym)) {
            return res.status(400).json({ error: 'Invalid symbol (e.g. BTCUSDT)' });
        }
        if (dir !== 'above' && dir !== 'below') {
            return res.status(400).json({ error: 'direction must be "above" or "below"' });
        }
        if (!Number.isFinite(price) || price <= 0 || price > 1e15) {
            return res.status(400).json({ error: 'Invalid target price' });
        }

        // Pro gate: only licensed users may have active alerts (frontend
        // shows an upgrade prompt for free users — matches advertised limits).
        const license = await db.getActiveLicense(req.user.id);
        if (!license) {
            return res.status(402).json({
                error: 'Price alerts are a Pro feature. Upgrade to unlock.',
                upgrade: true,
            });
        }

        const activeCount = await db.countActiveAlerts(req.user.id);
        if (activeCount >= MAX_ALERTS_PRO) {
            return res.status(400).json({ error: `Alert limit reached (${MAX_ALERTS_PRO})` });
        }

        const created = await db.createAlert({
            userId: req.user.id, symbol: sym, direction: dir, targetPrice: price,
        });
        res.status(201).json({ ok: true, id: created.id });
    } catch (err) { next(err); }
});

// ===== Web Push subscriptions =====
// NOTE: these literal-path routes MUST come before DELETE /:id —
// otherwise Express matches "subscribe" as an :id param.

// POST /api/alerts/subscribe — store a browser push subscription.
// Body: { endpoint, keys: { p256dh, auth } }
alertsRouter.post('/subscribe', authMiddleware(), async (req, res, next) => {
    try {
        const { endpoint, keys } = req.body || {};
        if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) {
            return res.status(400).json({ error: 'Invalid endpoint' });
        }
        if (!keys?.p256dh || !keys?.auth) {
            return res.status(400).json({ error: 'Missing keys.p256dh / keys.auth' });
        }
        await db.savePushSubscription({
            userId: req.user.id,
            endpoint,
            p256dh: String(keys.p256dh),
            auth: String(keys.auth),
            userAgent: req.headers['user-agent'],
        });
        res.status(201).json({ ok: true });
    } catch (err) { next(err); }
});

// DELETE /api/alerts/subscribe — remove this browser's subscription.
// Body: { endpoint }
alertsRouter.delete('/subscribe', authMiddleware(), async (req, res, next) => {
    try {
        const { endpoint } = req.body || {};
        if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Invalid endpoint' });
        await db.removePushSubscription(endpoint);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// POST /api/alerts/test-push — send a test notification to this user's devices.
alertsRouter.post('/test-push', authMiddleware(), async (req, res, next) => {
    try {
        const r = await push.sendPushToUser(req.user.id, {
            title: 'CryptoTA — test push',
            body: 'Pushes are working! Alerts will arrive like this.',
            icon: '/apple-touch-icon.png',
            tag: 'cryptota-test',
        });
        res.json(r);
    } catch (err) { next(err); }
});

// DELETE /api/alerts/:id — delete own alert.
alertsRouter.delete('/:id', authMiddleware(), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'Invalid alert id' });
        }
        const n = await db.deleteAlert(req.user.id, id);
        if (n === 0) return res.status(404).json({ error: 'Alert not found' });
        res.json({ ok: true });
    } catch (err) { next(err); }
});
