// Integration tests using supertest. Spins up the real app against an
// in-memory DB (sql.js supports ':memory:').
//
// We mock TON / CoinGecko so we don't hit external APIs in tests.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Set up env BEFORE importing config (dotenv reads on import)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-integration-tests-12345678';
process.env.DATABASE_PATH = ':memory:';
process.env.CORS_ORIGINS = '*';
process.env.TON_ADDRESS = 'UQAUzzNlRDTwQ6SuRFs3boU8VXYkA40GuFC6JDrpo-HrjGje';
process.env.PUBLIC_BASE_URL = 'http://localhost:3001';
process.env.FRONTEND_URL = 'http://localhost:8092';

// Now import after env is set
const { createApp } = await import('../src/index.js');
const { default: supertest } = await import('supertest');
const { config } = await import('../src/config.js');
const dbModule = await import('../src/lib/db.js');

const api = supertest(await createApp());

// Mock the TON helpers — replace what we use in tests.
// (ESM exports are read-only, so we wrap them via a thin facade imported by
// the route. For now the integration tests don't exercise the polling worker
// directly, so we don't need to mock anything.)

// Reset DB between tests — drop all rows so each test starts clean
async function resetDb() {
    await dbModule.getDb();
    await dbModule.runRaw('DELETE FROM webhook_events');
    await dbModule.runRaw('DELETE FROM licenses');
    await dbModule.runRaw('DELETE FROM payments');
    await dbModule.runRaw('DELETE FROM users');
    await dbModule.runRaw("DELETE FROM sqlite_sequence WHERE name IN ('users','licenses','payments','webhook_events')");
}
beforeEach(async () => { await resetDb(); });

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
    assert.equal(res.status, 200);
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
test('POST /api/payments/create returns TON payment details', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'gina@x.com', password: 'secret12345' });
    const token = reg.body.token;
    const res = await api.post('/api/payments/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'pro', payCurrency: 'ton' });
    assert.equal(res.status, 201);
    assert.ok(res.body.payment.memo);
    assert.equal(res.body.payment.tier, 'pro');
    assert.equal(res.body.payment.payAddress, config.ton.address);
    assert.equal(res.body.payment.payCurrency, 'ton');
    assert.ok(res.body.payment.payAmount >= 2);
    assert.equal(res.body.payment.status, 'waiting');
});

test('POST /api/payments/create returns lifetime TON invoice', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'gina2@x.com', password: 'secret12345' });
    const token = reg.body.token;
    const res = await api.post('/api/payments/create')
        .set('Authorization', `Bearer ${token}`)
        .send({ tier: 'lifetime', payCurrency: 'ton' });
    assert.equal(res.status, 201);
    assert.equal(res.body.payment.tier, 'lifetime');
    assert.ok(res.body.payment.payAmount >= 20);
});

test('POST /api/payments/create rejects invalid tier', async () => {
    const reg = await api.post('/api/auth/register').send({ email: 'hank@x.com', password: 'secret12345' });
    const res = await api.post('/api/payments/create')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({ tier: 'platinum', payCurrency: 'ton' });
    assert.equal(res.status, 400);
});

test('POST /api/payments/create requires auth', async () => {
    const res = await api.post('/api/payments/create').send({ tier: 'pro', payCurrency: 'ton' });
    assert.equal(res.status, 401);
});

// Force exit — sql.js keeps wasm alive otherwise
process.on('exit', () => { try { dbModule.closeDb(); } catch {} });
