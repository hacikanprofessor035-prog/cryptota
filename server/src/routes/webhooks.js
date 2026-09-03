// /api/webhooks/* — future-proof webhook router.
//
// We previously received NOWPayments IPN callbacks here. After switching to
// direct TON payments there is no third-party webhook source, but we keep
// the router in place so we can later add things like:
//   - TonAPI webhook (https://tonapi.io) for push-based payment notifications
//   - TON HTTP-API webhooks if we ever self-host one
//
// For now, all payment activation is handled by the polling worker in
// routes/payments.js.
import { Router } from 'express';

export const webhooksRouter = Router();

// Default 501 — explicit "not implemented" so health checks don't pass.
webhooksRouter.use('/_unused', (req, res) => {
    res.status(501).json({ error: 'No webhook source configured' });
});