// Centralised config. Loads from .env via dotenv, then validates required
// keys. Throws on missing JWT_SECRET in production to fail fast.
import 'dotenv/config';
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
    PORT: z.coerce.number().int().positive().default(3001),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    JWT_SECRET: isProd
        ? z.string().min(32, 'JWT_SECRET must be at least 32 chars in production')
        : z.string().default('dev-secret-do-not-use-in-prod-12345678'),
    JWT_EXPIRES_IN: z.string().default('30d'),

    DATABASE_PATH: z.string().default('./data/cryptota.db'),

    CORS_ORIGINS: z.string().default('http://localhost:8092'),

    NOWPAYMENTS_API_KEY: z.string().default(''),
    NOWPAYMENTS_IPN_SECRET: z.string().default(''),
    NOWPAYMENTS_SANDBOX: z.enum(['true', 'false']).default('true'),

    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3001'),
    FRONTEND_URL: z.string().url().default('http://localhost:8092'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(parsed.error.format());
    process.exit(1);
}

const env = parsed.data;

export const config = {
    port: env.PORT,
    isProd: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',

    jwt: {
        secret: env.JWT_SECRET,
        expiresIn: env.JWT_EXPIRES_IN,
    },

    db: {
        path: env.DATABASE_PATH,
    },

    cors: {
        origins: env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
    },

    nowpayments: {
        apiKey: env.NOWPAYMENTS_API_KEY,
        ipnSecret: env.NOWPAYMENTS_IPN_SECRET,
        sandbox: env.NOWPAYMENTS_SANDBOX === 'true',
        baseUrl: env.NOWPAYMENTS_SANDBOX
            ? 'https://api-sandbox.nowpayments.io/v1'
            : 'https://api.nowpayments.io/v1',
    },

    publicBaseUrl: env.PUBLIC_BASE_URL,
    frontendUrl: env.FRONTEND_URL,
};
