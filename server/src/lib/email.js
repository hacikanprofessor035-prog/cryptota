// Email sender via Brevo HTTPS API (api.brevo.com/v3/smtp/email).
//
// We use the HTTPS API rather than SMTP because the VPS provider blocks
// outbound SMTP traffic (ports 465, 587, 2525) — a common anti-spam
// measure. The API works over plain HTTPS (port 443) and is not blocked.
//
// Docs: https://developers.brevo.com/reference/sendtransacemail
//
// Authentication: api-key header. The key is created in Brevo dashboard
// under Settings -> SMTP & API -> API Keys, with at least the
// "Transactional: write" scope.
//
// The HTTPS transport is `fetch` (Node 22 has it built-in), so we have
// no extra runtime deps.

import { config } from '../config.js';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export function isEmailEnabled() {
    return Boolean(config.email?.apiKey && config.email?.fromEmail);
}

/**
 * Send a transactional email.
 * @param {object} opts
 * @param {string} opts.to        — recipient email
 * @param {string} opts.subject
 * @param {string} opts.html      — HTML body
 * @param {string} [opts.text]    — plain-text fallback (Brevo derives from html if omitted)
 * @param {string} [opts.replyTo] — reply-to address
 * @returns {Promise<{messageId: string}>}
 * @throws if the API call fails (caller should catch + log)
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
    if (!isEmailEnabled()) {
        throw new Error('Email is not configured (missing api key or from address)');
    }

    const body = {
        sender: {
            email: config.email.fromEmail,
            name: config.email.fromName || 'CryptoTA',
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
    };
    if (text) body.textContent = text;
    if (replyTo) body.replyTo = { email: replyTo };

    const r = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
            'api-key': config.email.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        // 10s is generous — Brevo usually responds in <2s.
        signal: AbortSignal.timeout(10_000),
    });

    if (!r.ok) {
        // Brevo returns JSON with a `message` field; include it for diagnostics.
        let errText;
        try { errText = await r.text(); } catch { errText = '<unreadable>'; }
        throw new Error(`Brevo API ${r.status}: ${errText.slice(0, 500)}`);
    }

    const data = await r.json().catch(() => ({}));
    return { messageId: data.messageId || null };
}