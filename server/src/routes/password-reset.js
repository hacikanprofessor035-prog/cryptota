// /api/auth/password-reset — forgot + reset flow.
//
// POST /api/auth/forgot-password  { email }   → 6-digit code emailed (15 min TTL)
// POST /api/auth/reset-password   { email, code, newPassword } → swaps hash
//
// Security notes:
//  - /forgot-password always returns 200 even for unknown emails (prevents
//    user-enumeration).
//  - Codes are 6 digits = ~1M space. Combined with 15-min TTL + 3/hour rate
//    limit per email + bcrypt-verified password on reset, brute force is
//    impractical for a small-user app.
//  - The DB stores SHA-256(code), so a DB dump doesn't yield usable codes.
//  - On successful reset, we mark the code used and invalidate ALL unused
//    codes for that user (defence in depth: a leaked code stops working
//    immediately).
import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomInt } from 'node:crypto';
import * as db from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { sendEmail, isEmailEnabled } from '../lib/email.js';

// Force line-buffered stdout so journald sees the logs immediately.
// Without this, Node's TTY detection delays log lines until the buffer
// fills, which can be tens of seconds.
if (process.stdout._handle?.setBlocking) {
    process.stdout._handle.setBlocking(true);
}
process.stderr._handle?.setBlocking?.(true);

function log(...args) {
    // [password-reset] prefix so the line is greppable
    process.stdout.write('[password-reset] ' + args.join(' ') + '\n');
}
function logErr(...args) {
    process.stderr.write('[password-reset] ' + args.join(' ') + '\n');
}

export const passwordResetRouter = Router();

const RESET_TTL_MINUTES = 15;
const RATE_LIMIT_PER_HOUR = 3;

// ===== POST /forgot-password =====
const forgotSchema = z.object({
    email: z.string().email().max(254),
});

passwordResetRouter.post('/forgot-password', async (req, res, next) => {
    try {
        log('forgot-password called from', req.ip);
        if (!isEmailEnabled()) {
            logErr('email not enabled, returning 503');
            return res.status(503).json({ error: 'Email service not configured on this server' });
        }
        const parsed = forgotSchema.safeParse(req.body);
        if (!parsed.success) {
            log('invalid body, silently ok');
            return res.json({ ok: true });
        }
        const { email } = parsed.data;
        log('looking up user', email);
        const user = await db.getByEmail(email);
        log('user lookup result:', user ? `found id=${user.id}` : 'not found');

        // User not found → silently succeed (no enumeration leak)
        if (!user) {
            return res.json({ ok: true });
        }

        // Rate limit: max 3 codes per email per hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recent = await db.countRecentResetAttempts(email, oneHourAgo);
        log('recent attempts:', recent);
        if (recent >= RATE_LIMIT_PER_HOUR) {
            log('rate limit hit for', email);
            return res.json({ ok: true });
        }

        // Generate 6-digit code (leading zeros preserved — randomInt is inclusive)
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const codeHash = createHash('sha256').update(code).digest('hex');
        const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000).toISOString();

        await db.createPasswordReset({
            userId: user.id,
            email,
            codeHash,
            expiresAt,
            ip: req.ip,
        });
        log('code', code, 'saved for user', user.id);

        // Build the email body
        const subject = 'CryptoTA — Password reset code';
        const html = `
            <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:20px;color:#222">
                <h2 style="color:#5cc8c0;margin:0 0 16px">CryptoTA</h2>
                <p>You (or someone using your email) requested a password reset.</p>
                <p>Your one-time reset code:</p>
                <div style="background:#11151f;color:#e8ecf4;padding:16px 24px;border-radius:8px;text-align:center;margin:20px 0;letter-spacing:6px;font-size:28px;font-family:monospace">
                    ${code}
                </div>
                <p>This code expires in <strong>${RESET_TTL_MINUTES} minutes</strong>.</p>
                <p style="color:#888;font-size:12px;margin-top:24px">
                    If you didn't request this, you can safely ignore the email.
                </p>
            </div>
        `;

        log('calling sendEmail to', email);
        await sendEmail({ to: email, subject, html });
        log('sendEmail returned, code', code, 'emailed to', email);

        // Generic OK — never reveal whether the email exists or was sent.
        res.json({ ok: true });
    } catch (err) {
        logErr('forgot-password failed for', req.body?.email || 'unknown', ':', err.message);
        next(err);
    }
});

// ===== POST /reset-password =====
const resetSchema = z.object({
    email: z.string().email().max(254),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
    newPassword: z.string().min(8).max(200),
});

passwordResetRouter.post('/reset-password', async (req, res, next) => {
    try {
        const parsed = resetSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Invalid input',
                details: parsed.error.issues.map(i => i.message),
            });
        }
        const { email, code, newPassword } = parsed.data;
        const codeHash = createHash('sha256').update(code).digest('hex');

        const row = await db.findValidResetCode({ email, codeHash });
        if (!row) {
            // Same response whether the code was wrong, expired, or used —
            // prevents brute-force probing for valid codes.
            return res.status(400).json({ error: 'Invalid or expired code' });
        }

        // Mark this code used, then invalidate all other unused codes for
        // the same user (a leaked code shouldn't outlive the first use).
        await db.markResetCodeUsed(row.id);

        const user = await db.get(row.user_id);
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }
        const newHash = await hashPassword(newPassword);
        await db.updatePasswordHash(user.id, newHash);

        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});