// Tests for /api/alerts — CRUD + Pro gate + push subscribe validation.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-alerts-tests-1234567890';
process.env.DATABASE_PATH = ':memory:';
process.env.CORS_ORIGINS = '*';
process.env.TON_ADDRESS = 'UQAUzzNlRDTwQ6SuRFs3boU8VXYkA40GuFC6JDrpo-HrjGje';
process.env.PUBLIC_BASE_URL = 'http://localhost:3001';
process.env.FRONTEND_URL = 'http://localhost:8092';
process.env.ADMIN_TOKEN = 'test-admin-token-very-long-and-secret-1234567890';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/index.js');
const { closeDb } = await import('../src/lib/db.js');

const app = await createApp();

after(async () => {
    await closeDb();
});

// Helper: register + login → { token, id }
async function newUser(email) {
    await request(app).post('/api/auth/register').send({ email, password: 'password123' }).expect(200);
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    return { token: res.body.token, id: res.body.user.id };
}

test('GET /api/alerts requires auth', async () => {
    await request(app).get('/api/alerts').expect(401);
});

test('POST /api/alerts rejects free users with 402 upgrade', async () => {
    const u = await newUser('free-alerts@test.com');
    const res = await request(app)
        .post('/api/alerts')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ symbol: 'BTCUSDT', direction: 'above', targetPrice: 100000 })
        .expect(402);
    assert.equal(res.body.upgrade, true);
});

test('pro user can create, list and delete alerts', async () => {
    const u = await newUser('pro-alerts@test.com');
    // grant license directly in DB
    const { insertLicense, getActiveLicense } = await import('../src/lib/db.js');
    await insertLicense({ userId: u.id, tier: 'pro', source: 'test' });

    const lic = await getActiveLicense(u.id);
    assert.ok(lic, 'license created');

    const created = await request(app)
        .post('/api/alerts')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ symbol: 'BTCUSDT', direction: 'above', targetPrice: 100000 })
        .expect(201);
    assert.ok(created.body.id);

    const list = await request(app)
        .get('/api/alerts')
        .set('Authorization', 'Bearer ' + u.token)
        .expect(200);
    assert.equal(list.body.alerts.length, 1);
    assert.equal(list.body.alerts[0].symbol, 'BTCUSDT');
    assert.equal(list.body.alerts[0].status, 'active');
    assert.ok(list.body.vapidPublicKey === null || typeof list.body.vapidPublicKey === 'string');

    const del = await request(app)
        .delete('/api/alerts/' + created.body.id)
        .set('Authorization', 'Bearer ' + u.token)
        .expect(200);
    assert.equal(del.body.ok, true);

    // other user's alert → 404
    await request(app)
        .delete('/api/alerts/' + created.body.id)
        .set('Authorization', 'Bearer ' + u.token)
        .expect(404);
});

test('POST /api/alerts validates input', async () => {
    const u = await newUser('pro-valid@test.com');
    const { insertLicense } = await import('../src/lib/db.js');
    await insertLicense({ userId: u.id, tier: 'lifetime', source: 'test' });

    await request(app)
        .post('/api/alerts')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ symbol: 'btc', direction: 'above', targetPrice: 1 })   // symbol too short
        .expect(400);
    await request(app)
        .post('/api/alerts')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ symbol: 'BTCUSDT', direction: 'sideways', targetPrice: 1 })
        .expect(400);
    await request(app)
        .post('/api/alerts')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ symbol: 'BTCUSDT', direction: 'above', targetPrice: -5 })
        .expect(400);
});

test('push subscribe validates endpoint + keys', async () => {
    const u = await newUser('push-sub@test.com');

    await request(app)
        .post('/api/alerts/subscribe')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ endpoint: 'http://insecure', keys: { p256dh: 'x', auth: 'y' } })
        .expect(400);

    await request(app)
        .post('/api/alerts/subscribe')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'x' } })
        .expect(400);

    const ok = await request(app)
        .post('/api/alerts/subscribe')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'BPubKey', auth: 'authKey' } })
        .expect(201);
    assert.equal(ok.body.ok, true);

    // upsert same endpoint → still one row, no error
    await request(app)
        .post('/api/alerts/subscribe')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'BPubKey2', auth: 'authKey2' } })
        .expect(201);

    const del = await request(app)
        .delete('/api/alerts/subscribe')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ endpoint: 'https://push.example.com/sub/1' })
        .expect(200);
    assert.equal(del.body.ok, true);
});

test('test-push returns structured result without push configured', async () => {
    const u = await newUser('push-test@test.com');
    const res = await request(app)
        .post('/api/alerts/test-push')
        .set('Authorization', 'Bearer ' + u.token)
        .expect(200);
    // no VAPID env in tests → skipped:'not-configured'
    assert.equal(res.body.sent, 0);
    assert.equal(res.body.skipped, 'not-configured');
});
