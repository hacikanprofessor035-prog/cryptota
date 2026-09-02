// /api/auth/* — register, login, me
import { Router } from 'express';
import { z } from 'zod';
import * as db from '../lib/db.js';
import { hashPassword, verifyPassword, signToken, authMiddleware } from '../lib/auth.js';

export const authRouter = Router();

const credsSchema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(200)
});

const registerSchema = credsSchema.extend({
    name: z.string().min(1).max(100).optional()
});

authRouter.post('/register', async (req, res, next) => {
    try {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Invalid input',
                details: parsed.error.issues.map(i => i.message)
            });
        }
        const { email, password, name } = parsed.data;
        if (await db.getByEmail(email)) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const hash = await hashPassword(password);
        const user = await db.createUser({ email, passwordHash: hash, name });
        res.json({ token: signToken(user), user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) { next(err); }
});

authRouter.post('/login', async (req, res, next) => {
    try {
        const parsed = credsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }
        const { email, password } = parsed.data;
        const row = await db.getByEmail(email);
        if (!row) return res.status(401).json({ error: 'Invalid email or password' });
        const ok = await verifyPassword(password, row.password_hash);
        if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
        await db.updateLastLogin(row.id);
        const user = { id: row.id, email: row.email, name: row.name };
        res.json({ token: signToken(user), user });
    } catch (err) { next(err); }
});

authRouter.get('/me', authMiddleware(), async (req, res, next) => {
    try {
        const user = await db.get(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const { password_hash, ...safe } = user;
        res.json({ user: safe });
    } catch (err) { next(err); }
});
