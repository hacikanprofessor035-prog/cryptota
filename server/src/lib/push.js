// Web Push sender — thin wrapper around web-push + our SQLite store.
//
// VAPID keys live in server/.env:
//   PUSH_VAPID_PUBLIC  — the public key the frontend subscribes with
//   PUSH_VAPID_PRIVATE  — never leaves the server
//   PUSH_SUBJECT        — mailto: contact for the push service (optional)
//
// If keys are missing, push silently no-ops (alerts still record
// "triggered" status; users see them on next visit — degraded, not broken).
import webpush from 'web-push';
import * as db from './db.js';
import { config } from '../config.js';

let _configured = false;

export function isPushConfigured() {
    return !!(process.env.PUSH_VAPID_PUBLIC && process.env.PUSH_VAPID_PRIVATE);
}

function ensureConfig() {
    if (_configured) return true;
    if (!isPushConfigured()) return false;
    webpush.setVapidDetails(
        process.env.PUSH_SUBJECT || 'mailto:admin@cryptota.duckdns.org',
        process.env.PUSH_VAPID_PUBLIC,
        process.env.PUSH_VAPID_PRIVATE
    );
    _configured = true;
    return true;
}

// Public key for the frontend (GET /api/push/key).
export function getVapidPublicKey() {
    return process.env.PUSH_VAPID_PUBLIC || null;
}

// Send one notification to every subscription of a user.
// Cares for the store: marks success, counts failures, drops dead subs.
export async function sendPushToUser(userId, payload) {
    if (!ensureConfig()) return { sent: 0, skipped: 'not-configured' };
    const subs = await db.getPushSubscriptionsForUser(userId);
    if (subs.length === 0) return { sent: 0, skipped: 'no-subscriptions' };
    let sent = 0;
    const json = JSON.stringify(payload);
    for (const s of subs) {
        try {
            await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                json,
                { TTL: 86400, urgency: 'high' }
            );
            await db.markPushSuccess(s.endpoint);
            sent++;
        } catch (e) {
            const status = e?.statusCode;
            const shouldDrop = await db.markPushFailure(s.endpoint, status);
            if (shouldDrop || status === 404 || status === 410) {
                await db.dropPushSubscription(s.endpoint);
            }
        }
    }
    return { sent };
}

// Send to ONE subscription object (used by the "test push" endpoint).
export async function sendPushToSubscription(sub, payload) {
    if (!ensureConfig()) return { sent: 0, skipped: 'not-configured' };
    try {
        await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload),
            { TTL: 86400, urgency: 'high' }
        );
        await db.markPushSuccess(sub.endpoint);
        return { sent: 1 };
    } catch (e) {
        const status = e?.statusCode;
        const shouldDrop = await db.markPushFailure(sub.endpoint, status);
        if (shouldDrop || status === 404 || status === 410) {
            await db.dropPushSubscription(sub.endpoint);
        }
        throw e;
    }
}
