// /api/webhooks/* — reserved for future push-based payment notifications.
//
// We currently use our own polling worker in routes/payments.js to detect
// incoming TON transactions. This router is kept as a placeholder so we can
// later add things like TonAPI webhooks (https://tonapi.io) without changing
// the route layout.
import { Router } from 'express';

export const webhooksRouter = Router();

// Default 501 — explicit "not implemented" so health checks don't pass.
webhooksRouter.use('/_unused', (req, res) => {
    res.status(501).json({ error: 'No webhook source configured' });
});
