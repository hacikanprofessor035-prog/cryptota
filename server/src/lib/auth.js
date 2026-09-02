// JWT + bcrypt helpers. Stateless JWTs (no refresh-token storage) — keep
// it simple. If you need revokation later, add a `revoked_jti` table.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
    return bcrypt.compare(plain, hash);
}

export function signToken(payload) {
    return jwt.sign(payload, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
    });
}

export function verifyToken(token) {
    return jwt.verify(token, config.jwt.secret);
}

export function authMiddleware(required = true) {
    return (req, res, next) => {
        const header = req.headers.authorization || '';
        const match = header.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            if (required) return res.status(401).json({ error: 'Missing or invalid Authorization header' });
            return next();
        }
        try {
            const decoded = verifyToken(match[1]);
            req.user = { id: decoded.sub, email: decoded.email };
            next();
        } catch (e) {
            if (required) return res.status(401).json({ error: 'Invalid or expired token' });
            next();
        }
    };
}
