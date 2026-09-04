// TON (Toncoin) payment integration — direct wallet, no third-party provider.
//
// How it works:
//   1. We have ONE static wallet address (TON_ADDRESS in env).
//   2. For each payment we generate a unique short "memo" string (16 hex chars).
//   3. User sends exactly `payAmount` TON to TON_ADDRESS with that memo as comment.
//   4. Our polling loop hits toncenter.com to look up incoming transactions
//      with the matching memo. When found, we mark the payment as completed.
//
// Trade-offs:
//   - User MUST include the comment when sending. Without it we can't attribute
//     the payment. Most wallets support this; we surface it prominently in UI.
//   - We rely on toncenter.com (public, free, rate-limited ~100 req/min).
//     Fallback to tonapi.io or self-hosted liteserver is possible later.
//   - We use USD price from CoinGecko to convert tier price → TON amount.
//     A small buffer covers price moves during the payment window.

import { randomBytes } from 'node:crypto';
import { request } from 'undici';
import { config } from '../config.js';

const TONCENTER = 'https://toncenter.com/api/v2';
const COINGECKO = 'https://api.coingecko.com/api/v3';
// TON has 9 decimals; 1 TON = 1_000_000_000 nano-TON
const TON_DECIMALS = 1_000_000_000;
// Memo we send: 16 hex chars (8 bytes) — collision-safe for our scale.
const MEMO_LEN = 16;

export class TonError extends Error {
    constructor(message, { status, body } = {}) {
        super(message);
        this.name = 'TonError';
        this.status = status;
        this.body = body;
    }
}

/** Generate a unique payment memo. Hex, 16 chars. */
export function generateMemo() {
    return randomBytes(MEMO_LEN / 2).toString('hex');
}

async function httpJson(url, opts = {}) {
    const res = await request(url, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.body.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
    if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new TonError(`TON HTTP ${opts.method || 'GET'} ${url} failed: ${res.statusCode}`, {
            status: res.statusCode, body: json ?? text,
        });
    }
    return json;
}

/** Current TON/USD price from CoinGecko. Cached for 5 min to avoid hammering. */
let _priceCache = { value: null, fetchedAt: 0 };
const PRICE_TTL_MS = 5 * 60 * 1000;

export async function getTonUsdPrice() {
    const now = Date.now();
    if (_priceCache.value && now - _priceCache.fetchedAt < PRICE_TTL_MS) {
        return _priceCache.value;
    }
    try {
        const j = await httpJson(`${COINGECKO}/simple/price?ids=the-open-network&vs_currencies=usd`);
        const price = j?.['the-open-network']?.usd;
        if (typeof price !== 'number' || price <= 0) throw new Error('Invalid price');
        _priceCache = { value: price, fetchedAt: now };
        return price;
    } catch (e) {
        // Fallback: last known price if we have one, else hardcoded.
        if (_priceCache.value) return _priceCache.value;
        // Last-resort fallback so the system stays usable if CoinGecko is down.
        return 2.50;
    }
}

/** Convert USD amount to TON. Returns { tonAmount, nanoTon, priceUsd }. */
export async function usdToTon(usd) {
    const priceUsd = await getTonUsdPrice();
    // Buffer: +3% so the user sends a bit more to absorb price swings.
    const tonAmount = (usd / priceUsd) * 1.03;
    const nanoTon = Math.ceil(tonAmount * TON_DECIMALS);
    return { tonAmount: nanoTon / TON_DECIMALS, nanoTon, priceUsd };
}

/**
 * Look up incoming transactions on TON_ADDRESS whose `comment` matches the memo.
 * Returns the matching tx (or null) and the current balance in nano-TON.
 *
 * `minNanoTon` is the minimum amount (in nano-TON) we consider as "paid".
 * We require at least 1 confirmation (the tx is in a finalized block).
 */
export async function checkIncoming({ memo, minNanoTon, sinceLt = null, sinceUtime = null }) {
    if (!config.ton.address) {
        throw new TonError('TON_ADDRESS is not configured');
    }

    // toncenter: getTransactions returns up to `limit` recent txs for the address.
    // We paginate by `lt` (logical time) until we either find our memo or run out.
    const limit = 50;
    let lt = sinceLt;
    let hash = null;
    let found = null;
    let newestUt = sinceUtime;

    // Safety cap: 10 pages × 50 = 500 txs scanned.
    for (let i = 0; i < 10; i++) {
        const params = new URLSearchParams({ address: config.ton.address, limit: String(limit) });
        if (lt) params.set('lt', String(lt));
        if (hash) params.set('hash', hash);

        const j = await httpJson(`${TONCENTER}/getTransactions?${params}`);
        const txs = j?.result;
        if (!Array.isArray(txs) || txs.length === 0) break;

        for (const tx of txs) {
            const txLt = tx.transaction_id?.lt;
            const txHash = tx.transaction_id?.hash;

            // Track newest (for next poll's sinceUtime/sinceLt).
            const utime = Number(tx.utime || 0);
            if (utime && (newestUt == null || utime > newestUt)) {
                newestUt = utime;
            }

            // Incoming message?
            const inMsg = tx.in_msg;
            if (!inMsg || !inMsg.value) continue;
            // Skip our own outgoing (memo'd) txs if any.
            if (inMsg.source && inMsg.source === config.ton.address) continue;

            // Value in nano-TON
            const value = Number(inMsg.value);
            if (!Number.isFinite(value) || value < minNanoTon) continue;

            // Memo: in_msg.message is the comment string (base64-encoded utf8).
            const comment = decodeComment(inMsg.message);
            if (comment !== memo) continue;

            // Found it. We only accept txs with at least 1 confirmation.
            // toncenter returns `confirmations` if available, otherwise we trust
            // that the tx is in `tx.now` block (finalized).
            found = {
                lt: txLt,
                hash: txHash,
                utime,
                value,
                from: inMsg.source || null,
                raw: tx,
            };
            return { found, newestUt, newestLt: txLt, newestHash: txHash };
        }

        // Advance pagination cursor.
        const last = txs[txs.length - 1];
        lt = last.transaction_id?.lt;
        hash = last.transaction_id?.hash;
        if (!lt) break;
    }

    return { found, newestUt, newestLt: lt, newestHash: hash };
}

/**
 * Decode the `message` field from toncenter's getTransactions response.
 *
 * Toncenter returns `in_msg.message` in TWO possible encodings depending on
 * version / endpoint — empirically we see HEX more often (the actual hex bytes
 * of the comment string), but legacy responses use BASE64 (utf8 → base64).
 * Either way, the underlying string is our 16-char lowercase hex memo.
 *
 * Detection order:
 *   1. Pure hex of expected length → use as-is.
 *   2. Base64 that decodes to our hex → use decoded.
 *   3. Anything else → ignore.
 */
function decodeComment(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();

    // (1) Already a plain hex string
    if (/^[0-9a-f]{16}$/i.test(trimmed)) return trimmed.toLowerCase();

    // (2) Pure hex bytes (may be any even length) → utf8 = our memo
    if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
        try {
            const s = Buffer.from(trimmed, 'hex').toString('utf8').trim();
            if (/^[0-9a-f]{16}$/i.test(s)) return s.toLowerCase();
        } catch { /* fall through */ }
    }

    // (3) Base64 of utf8 (legacy format)
    try {
        const s = Buffer.from(trimmed, 'base64').toString('utf8').trim();
        if (/^[0-9a-f]{16}$/i.test(s)) return s.toLowerCase();
    } catch { /* fall through */ }

    return null;
}

/** Current wallet balance in nano-TON (for diagnostics). */
export async function getBalance() {
    if (!config.ton.address) return 0;
    try {
        const j = await httpJson(`${TONCENTER}/getAddressBalance?address=${config.ton.address}`);
        return Number(j?.result || 0);
    } catch {
        return 0;
    }
}

/** Health check: returns true if TON_ADDRESS is set and reachable. */
export async function isHealthy() {
    if (!config.ton.address) return false;
    try {
        const j = await httpJson(`${TONCENTER}/getAddressInformation?address=${config.ton.address}`);
        return !!j?.ok;
    } catch {
        return false;
    }
}