// NOWPayments API client. We talk to them over fetch (undici in Node 22).
// All public methods throw NowPaymentsError on non-2xx so callers can wrap.
import { request } from 'undici';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export class NowPaymentsError extends Error {
    constructor(message, { status, body } = {}) {
        super(message);
        this.name = 'NowPaymentsError';
        this.status = status;
        this.body = body;
    }
}

async function npFetch(path, { method = 'GET', body } = {}) {
    const url = `${config.nowpayments.baseUrl}${path}`;
    const headers = {
        'x-api-key': config.nowpayments.apiKey,
        'Content-Type': 'application/json',
    };
    const res = await request(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.body.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
    if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new NowPaymentsError(
            `NOWPayments ${method} ${path} failed: ${res.statusCode}`,
            { status: res.statusCode, body: json ?? text }
        );
    }
    return json;
}

export const nowpayments = {
    /** Get list of available currencies. Used to validate user selection. */
    async getCurrencies() {
        const r = await npFetch('/currencies');
        return r.currencies || [];
    },

    /** Create a payment. Returns { payment_id, pay_address, pay_amount, pay_currency, ... } */
    async createPayment({ priceAmount, priceCurrency = 'usd', payCurrency, orderId, orderDescription, ipnCallbackUrl }) {
        return npFetch('/payment', {
            method: 'POST',
            body: {
                price_amount: priceAmount,
                price_currency: priceCurrency,
                pay_currency: payCurrency,
                order_id: orderId,
                order_description: orderDescription,
                ipn_callback_url: ipnCallbackUrl,
            },
        });
    },

    /** Get current status of a payment. */
    async getPaymentStatus(paymentId) {
        return npFetch(`/payment/${paymentId}`);
    },

    /** Verify IPN callback signature. NOWPayments uses HMAC-SHA512. */
    verifyIpnSignature(payloadJson, signatureHeader) {
        if (!config.nowpayments.ipnSecret) {
            // No secret configured — refuse to accept (fail closed).
            return false;
        }
        const expected = createHmac('sha512', config.nowpayments.ipnSecret)
            .update(payloadJson)
            .digest('hex');
        if (expected.length !== signatureHeader.length) return false;
        return timingSafeEqual(
            Buffer.from(expected, 'hex'),
            Buffer.from(signatureHeader, 'hex')
        );
    },

    /** Minimum payment amount for a given currency in USD. */
    async getMinimumAmount(currency) {
        const r = await npFetch(`/min-amount?currency=${encodeURIComponent(currency)}&fiat=usd`);
        return r.min_amount;
    },
};
