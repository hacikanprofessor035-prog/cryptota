// Rate limiting middleware for auth endpoints.
//
// Design notes:
//  - Behind Caddy (reverse proxy) every request appears to come from
//    127.0.0.1, so index.js sets `trust proxy` — express-rate-limit then
//    sees the real client IP from X-Forwarded-For.
//  - Login is keyed by email+IP: stops both a single IP brute-forcing
//    many accounts and many IPs hammering one account (from one IP).
//  - Disabled when NODE_ENV=test so integration tests (many rapid
//    logins from localhost) keep passing.
import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

const standardHeaders = true; // send RateLimit-* headers per draft spec

// POST /api/auth/login — 10 attempts per 15 min per (email+IP) key.
// After the 10th, respond 429 with Retry-After until the window resets.
export const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders,
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator(req, res) {
        const ip = req.ip || 'unknown';
        const email = String(req.body?.email || '').toLowerCase().trim() || 'no-email';
        return `${ip}:${email}`;
    },
    message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// POST /api/auth/register — 5 per hour per IP (prevents mass account
// creation spamming the users table).
export const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many registrations from this IP. Try again later.' },
});

// POST /api/auth/reset-password — 6 attempts per 15 min per (email+IP).
// The 6-digit code space is 1M; combined with the per-email code request
// limit (3/hour in password-reset.js) this makes brute-force impractical.
export const resetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 6,
    standardHeaders,
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator(req, res) {
        const ip = req.ip || 'unknown';
        const email = String(req.body?.email || '').toLowerCase().trim() || 'no-email';
        return `${ip}:${email}`;
    },
    message: { error: 'Too many reset attempts. Try again in 15 minutes.' },
});

// All /api/auth/* — safety net: 60 requests per minute per IP.
// (A normal user does at most a handful of auth calls per minute.)
export const authGlobalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders,
    legacyHeaders: false,
    skip: () => isTest,
    message: { error: 'Too many requests. Slow down.' },
});
