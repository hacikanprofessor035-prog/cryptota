// Tests for /api/drawings — cloud sync of chart drawings (Pro).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-drawings-tests-1234567890';
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
const { closeDb, insertLicense } = await import('../src/lib/db.js');

const app = await createApp();

after(async () => {
    await closeDb();
});

async function newUser(email) {
    await request(app).post('/api/auth/register').send({ email, password: 'password123' }).expect(200);
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    return { token: res.body.token, id: res.body.user.id };
}

test('drawings endpoints require auth', async () => {
    await request(app).get('/api/drawings').expect(401);
    await request(app).get('/api/drawings/BTCUSDT').expect(401);
    await request(app).put('/api/drawings/BTCUSDT').send({ objects: [] }).expect(401);
});

test('free user: PUT → 402 upgrade, GET works', async () => {
    const u = await newUser('free-draw@test.com');
    const put = await request(app)
        .put('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ objects: [{ id: 'L1', time1: 1, price1: 2, time2: 3, price2: 4 }] })
        .expect(402);
    assert.equal(put.body.upgrade, true);

    // GET is allowed on free — read-only preview of the Pro feature
    const get = await request(app)
        .get('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .expect(200);
    assert.equal(get.body.objects, null);
});

test('pro user: PUT then GET roundtrip', async () => {
    const u = await newUser('pro-draw@test.com');
    await insertLicense({ userId: u.id, tier: 'pro', source: 'test' });

    const objects = [
        { id: 'L1', time1: 1700000000, price1: 60000, time2: 1700100000, price2: 61000 },
        { id: 'H1', type: 'hline', price: 55000 },
        { id: 'R1', type: 'rect', time1: 1, price1: 2, time2: 3, price2: 4 },
    ];
    await request(app)
        .put('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ objects })
        .expect(200);

    const get = await request(app)
        .get('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .expect(200);
    assert.equal(get.body.symbol, 'BTCUSDT');
    assert.equal(get.body.objects.length, 3);
    assert.equal(get.body.objects[1].price, 55000);
    assert.ok(get.body.updatedAt);

    // update overwrites (one row per symbol)
    await request(app)
        .put('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ objects: [{ id: 'H2', type: 'hline', price: 123 }] })
        .expect(200);

    const get2 = await request(app)
        .get('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .expect(200);
    assert.equal(get2.body.objects.length, 1);

    // symbol listing
    const list = await request(app)
        .get('/api/drawings')
        .set('Authorization', 'Bearer ' + u.token)
        .expect(200);
    assert.equal(list.body.symbols.length, 1);
    assert.equal(list.body.symbols[0].symbol, 'BTCUSDT');
});

test('validation: bad symbol / bad body', async () => {
    const u = await newUser('pro-valid-draw@test.com');
    await insertLicense({ userId: u.id, tier: 'lifetime', source: 'test' });

    await request(app)
        .put('/api/drawings/btc')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ objects: [] })
        .expect(400);

    await request(app)
        .put('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ objects: 'not-an-array' })
        .expect(400);

    await request(app)
        .get('/api/drawings/BAD~SYM')
        .set('Authorization', 'Bearer ' + u.token)
        .expect(400);
});

test('oversized drawing set rejected', async () => {
    const u = await newUser('pro-big-draw@test.com');
    await insertLicense({ userId: u.id, tier: 'pro', source: 'test' });

    // 300KB body — Express's 64KB JSON limit rejects first (413),
    // which is even tighter than our own 256KB cap. Either way: rejected.
    const big = [{ id: 'X', type: 'hline', price: 1, pad: 'y'.repeat(300_000) }];
    await request(app)
        .put('/api/drawings/BTCUSDT')
        .set('Authorization', 'Bearer ' + u.token)
        .send({ objects: big })
        .expect(413);
});
