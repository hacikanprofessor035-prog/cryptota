// Integration tests using supertest. Spins up the real app against an
// in-memory DB (better-sqlite3 supports ':memory:').
//
// We mock NOWPayments so we don't hit the real API in tests.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set up env BEFORE importing config (dotenv reads on import)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-integration-tests-12345678';
process.env.DATABASE_PATH = ':memory:';
process.env.CORS_ORIGINS = '*';
process.env.NOWPAYMENTS_API_KEY = 'mock-key';
process.env.NOWPAYMENTS_IPN_SECRET = 'mock-ipn-secret';
process.env.NOWPAYMENTS_SANDBOX = 'true';
process.env.PUBLIC_BASE_URL = 'http://localhost:3001';
process.env.FRONTEND_URL = 'http://localhost:8092';

// Now import after env is set
const { createApp } = await import('../src/index.js');
const { default: supertest } = await import('supertest');
const { config } = await import('../src/config.js');
const { nowpayments } = await import('../src/lib/nowpayments.js');
const { getDb, closeDb } = await import('../src/lib/db.js');

const api = supertest(createApp());

// Mock NOWPayments — replace methods we use
let mockCreatePayment = async (args) => {
    return {
        payment_id: 99999,
        payment_status: 'waiting',
        pay_address: 'bc1qmockaddress',
        pay_amount: 0.0001,
        pay_currency: args.payCurrency,
    };
};
nowpayments.createPayment = mockCreatePayment;

// Reset DB between tests — keeps the same connection, drops all data
function resetDb() {
    const db = getDb();
    db.exec(`
        DELETE FROM webhook_events;
        DELETE FROM licenses;
        DELETE FROM payments;
        DELETE FROM users;
        DELETE FROM sqlite_sequence;
    `);
}
beforeEach(resetDb);

// ===== Health =====
test('GET /api/health returns ok', async () => {
    const res = await api.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.pricing.pro.usd, 3);
    assert.equal(res.body.pricing.lifetime.usd, 39);
});

// ===== Auth =====
test('POST /api/auth/register creates user and returns token', async () => {
    const res = await api.post('/api/auth/register').send({
        email: 'alice@example.com',
        password: 'secret12345',
        name: 'Alice',
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.token);
    assert.equal(res.body.user.email, 'alice@example.com');
    assert.equal(res.body.user.name, 'Alice');
});

test('POST /api/auth/register rejects duplicate email', async () => {
    await api.post('/api/auth/register').send({ email: 'bob@x.com', password: 'secret12345' });
    const res = await api.post('/api/auth/register').send({ email: 'bob@x.com', password: 'secret12345' });
    assert.equal(res.status, 409);
});

test('POST /api/auth/register rejects short password', async () => {
    const res = await api.post('/api/auth/register').send({ email: 'x@x.com', password: 'short' });
    assert.equal(res.status, 400);
});

test('POST /api/auth/login returns token for valid creds', async () => {
    await api.post('/api/auth/register').send({ email: 'carol@x.com', password: 'secret12345' });
    const res = await api.post('/api/auth/login').send({ email: 'carol@x.com', password: 'secret12345' });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
});

test('POST /api/auth/login rejects wrong password', async () => {
    await api.post('/api/auth/register').send({ email: 'dan@x.com', password: 'secret12345' });
    const res = await api.post('/api/auth/login').send({ email: 'dan@x.com', password: 'wrongpass1234' });
    assert.equal(res.status, 401);
});

test('GET /api/auth/me returns user when authed', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'eve@x.com', password: 'secret12345' });
    const token = reg.body.token;
    const res = await api.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'eve@x.com');
});

test('GET /api/auth/me rejects missing token', async () => {
    const res = await api.get('/api/auth/me');
    assert.equal(res.status, 401);
});

// ===== License =====
test('GET /api/license/me returns free for new user', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'frank@x.com', password: 'secret12345' });
    const res = await api.get('/api/license/me').set('Authorization', `Bearer ${reg.body.token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.tier, 'free');
});

test('GET /api/license/me returns free for unauthenticated', async () => {
    const res = await api.get('/api/license/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.tier, 'free');
});

// ===== Payments =====
test('POST /api/payments/create returns payment details', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'gina@x.com', password: 'secret12345' });
    const token = reg.body.token;
    const res = await api.post('/api/payments/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'pro', payCurrency: 'btc' });
    assert.equal(res.status, 201);
    assert.ok(res.body.payment.providerPaymentId);
    assert.equal(res.body.payment.tier, 'pro');
    assert.equal(res.body.payment.payAddress, 'bc1qmockaddress');
    assert.equal(res.body.payment.status, 'waiting');
});

test('POST /api/payments/create rejects invalid tier', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'hank@x.com', password: 'secret12345' });
    const res = await api.post('/api/payments/create')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({ tier: 'platinum', payCurrency: 'btc' });
    assert.equal(res.status, 400);
});

test('POST /api/payments/create requires auth', async () => {
    const res = await api.post('/api/payments/create').send({ tier: 'pro', payCurrency: 'btc' });
    assert.equal(res.status, 401);
});

// ===== Webhook — the critical one =====
test('POST /api/webhooks/nowpayments activates license on finished', async () => {
    // 1. Register user
    const reg = await api.post('/api/auth/register').send({ email: 'iris@x.com', password: 'secret12345' });
    const token = reg.body.token;

    // 2. Create payment
    const create = await api.post('/api/payments/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'pro', payCurrency: 'btc' });
    const internalId = create.body.payment.id;

    // 3. Simulate NOWPayments webhook with valid signature
    const payload = JSON.stringify({
        payment_id: 99999,
        order_id: internalId,
        payment_status: 'finished',
        pay_amount: 0.0001,
        pay_currency: 'btc',
    });
    const sig = createHmac('sha512', config.nowpayments.ipnSecret).update(payload).digest('hex');

    const res = await api.post('/api/webhooks/nowpayments')
        .set('Content-Type', 'application/json')
        .set('x-nowpayments-sig', sig)
        .set('x-nowpayments-event-id', 'evt-001')
        .send(payload);
    assert.equal(res.status, 200);

    // 4. Verify license is now pro
    const lic = await api.get('/api/license/me').set('Authorization', `Bearer ${token}`);
    assert.equal(lic.status, 200);
    assert.equal(lic.body.tier, 'pro');
    assert.ok(lic.body.expiresAt);
});

test('Webhook rejects bad signature', async () => {
    const payload = JSON.stringify({ payment_id: 1, order_id: 999, payment_status: 'finished' });
    const res = await api.post('/api/webhooks/nowpayments')
        .set('Content-Type', 'application/json')
        .set('x-nowpayments-sig', 'invalidsig')
        .send(payload);
    assert.equal(res.status, 401);
});

test('Webhook is idempotent on duplicate event_id', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'jack@x.com', password: 'secret12345' });
    const create = await api.post('/api/payments/create')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({ tier: 'lifetime', payCurrency: 'eth' });
    const internalId = create.body.payment.id;

    const payload = JSON.stringify({
        payment_id: 99999,
        order_id: internalId,
        payment_status: 'finished',
    });
    const sig = createHmac('sha512', config.nowpayments.ipnSecret).update(payload).digest('hex');

    // First call
    const r1 = await api.post('/api/webhooks/nowpayments')
        .set('Content-Type', 'application/json')
        .set('x-nowpayments-sig', sig).set('x-nowpayments-event-id', 'evt-dup')
        .send(payload);
    assert.equal(r1.status, 200);

    // Second call with same event_id — should ACK but skip activation
    const r2 = await api.post('/api/webhooks/nowpayments')
        .set('Content-Type', 'application/json')
        .set('x-nowpayments-sig', sig).set('x-nowpayments-event-id', 'evt-dup')
        .send(payload);
    assert.equal(r2.status, 200);

    // Verify only ONE license was created
    const lic = await api.get('/api/license/me').set('Authorization', `Bearer ${reg.body.token}`);
    assert.equal(lic.body.tier, 'lifetime');
    const hist = await api.get('/api/license/history').set('Authorization', `Bearer ${reg.body.token}`);
    assert.equal(hist.body.licenses.length, 1);
});

// Force exit — sqlite WAL keeps handles open otherwise
process.on('exit', () => closeDb());
