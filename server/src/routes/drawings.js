// /api/drawings/* — cloud sync of chart drawings (Pro feature).
//
// One drawing set per (user, symbol). Drawings are small JSON arrays
// (a few hundred bytes each), so the whole set goes up/down in one shot.
// GET requires auth; PUT additionally requires an active license (Pro).
import { Router } from 'express';
import * as db from '../lib/db.js';
import { authMiddleware } from '../lib/auth.js';

export const drawingsRouter = Router();

const MAX_OBJECTS_JSON = 256 * 1024; // 256 KB per symbol — way more than any sane set
const MAX_SYMBOLS_PER_USER = 500;

function validSymbol(s) {
    return typeof s === 'string' && /^[A-Z0-9]{5,20}$/.test(s);
}

// GET /api/drawings/:symbol — download one symbol's drawings.
drawingsRouter.get('/:symbol', authMiddleware(), async (req, res, next) => {
    try {
        const symbol = String(req.params.symbol || '').toUpperCase();
        if (!validSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
        const row = await db.getDrawing(req.user.id, symbol);
        if (!row) return res.json({ symbol, objects: null, updatedAt: null });
        res.json({ symbol, objects: JSON.parse(row.objects), updatedAt: row.updated_at });
    } catch (err) { next(err); }
});

// GET /api/drawings — list which symbols have cloud drawings.
drawingsRouter.get('/', authMiddleware(), async (req, res, next) => {
    try {
        const rows = await db.listDrawingSymbols(req.user.id);
        res.json({ symbols: rows });
    } catch (err) { next(err); }
});

// PUT /api/drawings/:symbol — upload the drawing set for a symbol.
// Body: { objects: [...] }
drawingsRouter.put('/:symbol', authMiddleware(), async (req, res, next) => {
    try {
        const symbol = String(req.params.symbol || '').toUpperCase();
        if (!validSymbol(symbol)) return res.status(400).json({ error: 'Invalid symbol' });

        // Pro gate — cloudSync is a Pro feature (matches the advertised limits).
        const license = await db.getActiveLicense(req.user.id);
        if (!license) {
            return res.status(402).json({
                error: 'Cloud sync of drawings is a Pro feature. Upgrade to unlock.',
                upgrade: true,
            });
        }

        const objects = req.body?.objects;
        if (!Array.isArray(objects)) {
            return res.status(400).json({ error: 'objects must be an array' });
        }
        const json = JSON.stringify(objects);
        if (json.length > MAX_OBJECTS_JSON) {
            return res.status(400).json({ error: 'Drawing set too large' });
        }
        // Defensive cap on stored symbols (unlikely to ever hit).
        const have = await db.listDrawingSymbols(req.user.id);
        const exists = have.some(r => r.symbol === symbol);
        if (!exists && have.length >= MAX_SYMBOLS_PER_USER) {
            return res.status(400).json({ error: 'Too many symbols with drawings' });
        }

        await db.saveDrawing(req.user.id, symbol, json);
        res.json({ ok: true, updatedAt: new Date().toISOString() });
    } catch (err) { next(err); }
});
