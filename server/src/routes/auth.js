// /api/auth/* — register, login, me, logout (stateless, but logged for audit)
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { hashPassword, verifyPassword, signToken, authMiddleware } from '../lib/auth.js';

export const authRouter = Router();

const credsSchema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
    name: z.string().min(1).max(80).optional(),
});

function issueToken(user) {
    return signToken({ sub: user.id, email: user.email });
}

authRouter.post('/register', async (req, res, next) => {
    try {
        const parsed = credsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        }
        const { email, password, name } = parsed.data;
        const db = getDb();
        const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const hash = await hashPassword(password);
        const now = new Date().toISOString();
        const result = db.prepare(`
            INSERT INTO users (email, password_hash, name, created_at)
            VALUES (?, ?, ?, ?)
        `).run(email, hash, name || email.split('@')[0], now);
        const user = { id: result.lastInsertRowid, email, name: name || email.split('@')[0] };
        const token = issueToken(user);
        res.status(201).json({ token, user });
    } catch (e) { next(e); }
});

authRouter.post('/login', async (req, res, next) => {
    try {
        const parsed = credsSchema.pick({ email: true, password: true }).safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const { email, password } = parsed.data;
        const db = getDb();
        const row = db.prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(email);
        if (!row) return res.status(401).json({ error: 'Invalid email or password' });
        const ok = await verifyPassword(password, row.password_hash);
        if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
        db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
        const user = { id: row.id, email: row.email, name: row.name };
        res.json({ token: issueToken(user), user });
    } catch (e) { next(e); }
});

authRouter.get('/me', authMiddleware(), (req, res, next) => {
    try {
        const db = getDb();
        const row = db.prepare('SELECT id, email, name, created_at, last_login_at FROM users WHERE id = ?').get(req.user.id);
        if (!row) return res.status(404).json({ error: 'User not found' });
        res.json({ user: row });
    } catch (e) { next(e); }
});

// Logout is a no-op for stateless JWT. The client discards the token.
// We expose this endpoint so the client can call it for symmetry.
authRouter.post('/logout', authMiddleware(false), (req, res) => {
    res.json({ ok: true });
});
