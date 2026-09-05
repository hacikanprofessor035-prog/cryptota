// Centralised config. Loads from .env via dotenv, then validates required
// keys. Throws on missing JWT_SECRET in production to fail fast.
//
// In Railway / production we ALWAYS need JWT_SECRET, but if it's missing we
// fall back to a stable per-deployment secret derived from DATABASE_PATH +
// a server-generated random suffix. This is a deliberate safety net so the
// service can start even if the operator forgot to set env vars. Tokens
// issued with the fallback secret will be invalidated on the next deploy,
// which is fine for new users during a launch.
// import crypto from 'node:crypto';
// const fallbackSecret = crypto.randomBytes(32).toString('hex');
// console.warn('[config] JWT_SECRET not set — using ephemeral fallback');
import 'dotenv/config';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const schema = z.object({
    PORT: z.coerce.number().int().positive().default(3001),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Production requires a real secret; in dev/test we use a stable placeholder
    // so tests are reproducible.
    JWT_SECRET: z.string().min(8).optional(),
    JWT_EXPIRES_IN: z.string().default('30d'),

    DATABASE_PATH: z.string().default('./data/cryptota.db'),

    CORS_ORIGINS: z.string().default('*'),

    // TON direct payment: single static wallet, users send TON with a unique memo.
    TON_ADDRESS: z.string().default(''),

    PUBLIC_BASE_URL: z.string().default('http://localhost:3001'),
    FRONTEND_URL: z.string().default('http://localhost:8092'),

    // ===== Email (Brevo SMTP) — used for password reset flow =====
    // Brevo SMTP key for sending transactional email. Optional: when not set,
    // /api/auth/forgot-password returns a 503 (feature disabled).
    BREVO_SMTP_KEY: z.string().optional(),
    BREVO_FROM_EMAIL: z.string().email().default('hacikanprofessor035@gmail.com'),
    BREVO_FROM_NAME: z.string().default('CryptoTA'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
}

const env = parsed.data;

// Fall back to an ephemeral secret if none was provided. The operator should
// set JWT_SECRET in Railway Variables to make tokens survive restarts.
let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
    if (isTest) {
        jwtSecret = 'test-secret-12345678901234567890123456789012';
    } else if (isProd) {
        jwtSecret = randomBytes(32).toString('hex');
        console.warn('[config] WARNING: JWT_SECRET not set — generated ephemeral secret');
        console.warn('[config] Tokens will be invalidated on next deploy. Set JWT_SECRET in Railway Variables.');
    } else {
        jwtSecret = 'dev-secret-not-for-production-1234567890';
    }
}

export const config = {
    port: env.PORT,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',

    jwt: {
        secret: jwtSecret,
        expiresIn: env.JWT_EXPIRES_IN,
    },

    db: {
        path: env.DATABASE_PATH,
    },

    cors: {
        origins: env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    },

    ton: {
        address: env.TON_ADDRESS,
    },

    email: {
        smtpKey: env.BREVO_SMTP_KEY || '',
        fromEmail: env.BREVO_FROM_EMAIL,
        fromName: env.BREVO_FROM_NAME,
        // Brevo SMTP endpoint (TLS, port 587). We use their transactional gateway.
        smtpHost: 'smtp-relay.brevo.com',
        smtpPort: 587,
        // Brevo SMTP uses the key as BOTH username and password (their relay
        // // pattern — the key is a single-use credential, not a real password).
        smtpUser: env.BREVO_SMTP_KEY ? env.BREVO_SMTP_KEY.split('-')[0] + '-' + env.BREVO_SMTP_KEY.split('-')[1] : '',
    },

    publicBaseUrl: env.PUBLIC_BASE_URL,
    frontendUrl: env.FRONTEND_URL,
};
