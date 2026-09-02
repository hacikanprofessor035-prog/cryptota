// CryptoTA backend — entry point.
// Wires up Express, routes, middleware, and starts the server.
//
// When imported (e.g. by tests), the app is created but NOT listening.
// To start the server, run `npm start` which calls startServer().
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { getDb, closeDb } from './lib/db.js';
import { authRouter } from './routes/auth.js';
import { licenseRouter } from './routes/license.js';
import { paymentsRouter, PRICING } from './routes/payments.js';
import { webhooksRouter } from './routes/webhooks.js';

export function createApp() {
    // Initialise database (runs migrations)
    getDb();

    const app = express();

    // CORS — explicit allowlist
    app.use(cors({
        origin(origin, cb) {
            if (!origin) return cb(null, true);
            if (config.cors.origins.includes('*') || config.cors.origins.includes(origin)) {
                return cb(null, true);
            }
            return cb(new Error(`Origin not allowed: ${origin}`));
        },
        credentials: true,
    }));

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
            nowpayments: {
                configured: !!config.nowpayments.apiKey,
                sandbox: config.nowpayments.sandbox,
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

export function startServer() {
    const app = createApp();
    const server = app.listen(config.port, () => {
        console.log(`[server] listening on http://localhost:${config.port}`);
        console.log(`[server] NOWPayments: ${config.nowpayments.apiKey ? 'configured' : 'NOT configured (payments will fail)'}`);
        console.log(`[server] CORS allowed origins: ${config.cors.origins.join(', ')}`);
    });

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
    startServer();
}
