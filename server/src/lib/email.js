// Email sender via Brevo SMTP (smtp-relay.brevo.com).
// Used by /api/auth/forgot-password to deliver a one-time reset code.
//
// We import nodemailer lazily so the rest of the app boots even when the
// optional SMTP dependency is missing (dev environments that don't send
// email). When BREVO_SMTP_KEY is unset, sendEmail() throws a friendly
// error and the route returns 503.
import nodemailer from 'nodemailer';
import { config } from '../config.js';

let _transporter = null;

function getTransporter() {
    if (_transporter) return _transporter;
    if (!config.email.smtpKey) {
        throw new Error('Email not configured (BREVO_SMTP_KEY missing)');
    }
    _transporter = nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: false,         // STARTTLS
        requireTLS: true,
        auth: {
            // Brevo's transactional SMTP uses the key directly as the
            // username; the "password" is the same key string.
            user: config.email.smtpKey,
            pass: config.email.smtpKey,
        },
        tls: {
            // Don't fail on self-signed (Brevo uses a valid CA but be lenient)
            rejectUnauthorized: true,
        },
    });
    return _transporter;
}

/**
 * Send a transactional email.
 * @param {string} to       Recipient email
 * @param {string} subject  Plain-text subject
 * @param {string} html     HTML body
 * @returns {Promise<{messageId: string}>}
 */
export async function sendEmail({ to, subject, html }) {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
        from: `"${config.email.fromName}" <${config.email.fromEmail}>`,
        to,
        subject,
        html,
        // Brevo accepts a plain-text fallback (recommended for deliverability)
        text: html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    });
    return { messageId: info.messageId };
}

export function isEmailEnabled() {
    return !!config.email.smtpKey;
}