// /api/admin/* — operator-only endpoints.
//
// Auth: every request must carry `Authorization: Bearer <ADMIN_TOKEN>`.
// Set ADMIN_TOKEN in Railway (or .env locally) before the endpoint is usable.
// If ADMIN_TOKEN is unset, ALL requests are rejected with 503 — fail closed.
//
// The comparison uses timingSafeEqual to prevent a remote timing attack
// that could leak the token one byte at a time.
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
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
    // Compare lengths first; timingSafeEqual requires equal-length buffers.
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
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
        const rows = await db.query(
            `SELECT id, email, name, created_at, last_login_at
             FROM users ORDER BY id DESC LIMIT 20`
        );
        res.json({
            items: rows.map(r => ({
                id: r.id,
                email: r.email,
                name: r.name,
                createdAt: r.created_at,
                lastLoginAt: r.last_login_at,
            })),
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
