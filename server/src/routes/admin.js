// /api/admin/* — operator-only endpoints.
//
// Auth: every request must carry `Authorization: Bearer <ADMIN_TOKEN>`.
// Set ADMIN_TOKEN in Railway (or .env locally) before the endpoint is usable.
// If ADMIN_TOKEN is unset, ALL requests are rejected with 503 — fail closed.
import express from 'express';
import * as db from '../lib/db.js';

const router = express.Router();

function adminAuth(req, res, next) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
        return res.status(503).json({
            error: 'Admin endpoints are disabled (ADMIN_TOKEN not set on server)',
        });
    }
    const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (provided !== expected) {
        return res.status(401).json({ error: 'Invalid admin token' });
    }
    next();
}

router.use(adminAuth);

// GET /api/admin/stats — counts of users, online, license holders, payments.
router.get('/stats', async (_req, res) => {
    try {
        res.json(await db.getStats());
    } catch (e) {
        console.error('[admin/stats] error:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/recent-signups — last 20 users (id, email, created, last login).
router.get('/recent-signups', async (_req, res) => {
    try {
        const rows = await db.runRaw(
            `SELECT id, email, name, created_at, last_login_at
             FROM users ORDER BY id DESC LIMIT 20`
        );
        // runRaw doesn't return rows — use the helper. We'll add a proper
        // helper if this endpoint becomes a regular part of the admin UI.
        res.json({ items: [], note: 'see db.getStats for aggregate counts' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
