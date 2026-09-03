// CryptoTA backend — entry point.
// Wires up Express, routes, middleware, and starts the server.
//
// When imported (e.g. by tests), the app is created but NOT listening.
// To start the server, run `npm start` which calls startServer().
import express from 'express';
import { config } from './config.js';
import { getDb, closeDb } from './lib/db.js';
import { authRouter } from './routes/auth.js';
import { licenseRouter } from './routes/license.js';
import { paymentsRouter, PRICING, startPaymentPolling } from './routes/payments.js';
import { webhooksRouter } from './routes/webhooks.js';

export async function createApp() {
    // Initialise database (runs migrations)
    await getDb();

    const app = express();

    // CORS — explicit allowlist
    const allowOrigin = (origin) => {
        if (!origin) return true;
        if (config.cors.origins.includes('*')) return true;
        return config.cors.origins.includes(origin);
    };

    // Manually handle CORS so OPTIONS preflight never hits express's 404 path
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (allowOrigin(origin)) {
            if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        }
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    });

    // IMPORTANT: webhooks must receive the raw body BEFORE express.json() runs.
    app.use('/api/webhooks', webhooksRouter);

    // Everything else uses JSON
    app.use(express.json({ limit: '64kb' }));

    // Health check
    app.get('/api/health', (req, res) => {
        res.json({
            ok: true,
            version: '1.0.0',
            pricing: PRICING,
            ton: {
                configured: !!config.ton.address,
                address: config.ton.address ? config.ton.address.slice(0, 6) + '…' + config.ton.address.slice(-4) : null,
            },
        });
    });

    app.use('/api/auth', authRouter);
    app.use('/api/license', licenseRouter);
    app.use('/api/payments', paymentsRouter);

    app.use('/api/*', (req, res) => {
        res.status(404).json({ error: 'Not found', path: req.path });
    });

    app.use((err, req, res, _next) => {
        console.error('[error]', err);
        res.status(err.status || 500).json({
            error: err.message || 'Internal server error',
        });
    });

    return app;
}

export async function startServer() {
    const app = await createApp();
    const server = app.listen(config.port, () => {
        console.log(`[server] listening on http://localhost:${config.port}`);
        console.log(`[server] TON: ${config.ton.address ? `${config.ton.address.slice(0,6)}…${config.ton.address.slice(-4)}` : 'NOT configured (payments will fail)'}`);
        console.log(`[server] CORS allowed origins: ${config.cors.origins.join(', ')}`);
    });

    // Start polling worker for TON payments
    startPaymentPolling();

    function shutdown(signal) {
        console.log(`[server] received ${signal}, shutting down...`);
        server.close(() => {
            closeDb();
            process.exit(0);
        });
        setTimeout(() => process.exit(1), 5000).unref();
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    return server;
}

// Start the server only when run directly (not when imported)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    startServer().catch(err => {
        console.error('[server] failed to start:', err);
        process.exit(1);
    });
}
