// /api/license/* — get current license, list payments, activation history
import { Router } from 'express';
import { getDb } from '../lib/db.js';
import { authMiddleware } from '../lib/auth.js';

export const licenseRouter = Router();

// Returns the user's current effective license.
// Authenticated: returns DB license if any, otherwise 'free'.
// Unauthenticated: returns 'free' (so the UI can still render).
licenseRouter.get('/me', authMiddleware(false), (req, res, next) => {
    try {
        const db = getDb();
        if (!req.user) {
            return res.json({ tier: 'free', userId: null, expiresAt: null, source: 'unauthenticated' });
        }
        const license = db.prepare(`
            SELECT tier, activated_at, expires_at, source
            FROM licenses
            WHERE user_id = ?
            ORDER BY datetime(activated_at) DESC
            LIMIT 1
        `).get(req.user.id);
        if (!license) {
            return res.json({ tier: 'free', userId: req.user.id, expiresAt: null, source: 'default' });
        }
        // If license expired, treat as free (caller can also choose to ignore)
        if (license.expires_at && new Date(license.expires_at) < new Date()) {
            return res.json({ tier: 'free', userId: req.user.id, expiresAt: license.expires_at, source: license.source, expired: true });
        }
        res.json({
            tier: license.tier,
            userId: req.user.id,
            activatedAt: license.activated_at,
            expiresAt: license.expires_at,
            source: license.source,
        });
    } catch (e) { next(e); }
});

licenseRouter.get('/history', authMiddleware(), (req, res, next) => {
    try {
        const db = getDb();
        const rows = db.prepare(`
            SELECT id, tier, activated_at, expires_at, source
            FROM licenses
            WHERE user_id = ?
            ORDER BY datetime(activated_at) DESC
        `).all(req.user.id);
        res.json({ licenses: rows });
    } catch (e) { next(e); }
});
