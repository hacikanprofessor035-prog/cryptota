// Tests for POST /api/client-log + admin client-log endpoints.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-client-log-tests-1234567890';
process.env.DATABASE_PATH = ':memory:';
process.env.CORS_ORIGINS = '*';
process.env.TON_ADDRESS = 'UQAUzzNlRDTwQ6SuRFs3boU8VXYkA40GuFC6JDrpo-HrjGje';
process.env.PUBLIC_BASE_URL = 'http://localhost:3001';
process.env.FRONTEND_URL = 'http://localhost:8092';
process.env.ADMIN_TOKEN = 'test-admin-token-very-long-and-secret-1234567890';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Import after env is set (top-level await, same pattern as integration.test.js)
const { default: request } = await import('supertest');
const { createApp } = await import('../src/index.js');
const { closeDb } = await import('../src/lib/db.js');

const app = await createApp();

after(async () => {
    await closeDb();
});

test('POST /api/client-log accepts a valid error report with 202', async () => {
    const res = await request(app)
        .post('/api/client-log')
        .send({ level: 'error', message: 'TypeError: cannot read props of undefined', url: '/' })
        .expect(202);
    assert.equal(res.body.ok, true);
});

test('POST /api/client-log rejects an empty report with 400', async () => {
    await request(app)
        .post('/api/client-log')
        .send({ message: '   ' })
        .expect(400);
});

test('admin can read client logs and stats', async () => {
    const logs = await request(app)
        .get('/api/admin/client-logs')
        .set('Authorization', 'Bearer ' + process.env.ADMIN_TOKEN)
        .expect(200);
    assert.ok(Array.isArray(logs.body));
    assert.ok(logs.body.length >= 1);
    assert.ok(logs.body[0].message.includes('TypeError'));

    const stats = await request(app)
        .get('/api/admin/client-log-stats')
        .set('Authorization', 'Bearer ' + process.env.ADMIN_TOKEN)
        .expect(200);
    assert.ok(Array.isArray(stats.body.perDay));
    assert.ok(stats.body.perDay.length >= 1);
    assert.ok(Array.isArray(stats.body.top));
});

test('admin client-log endpoints reject a bad token', async () => {
    await request(app)
        .get('/api/admin/client-logs')
        .set('Authorization', 'Bearer wrong-token')
        .expect(401);
});

test('long fields are capped, DB stays sane', async () => {
    await request(app)
        .post('/api/client-log')
        .send({ message: 'x'.repeat(50_000) })
        .expect(202);
    const logs = await request(app)
        .get('/api/admin/client-logs')
        .set('Authorization', 'Bearer ' + process.env.ADMIN_TOKEN)
        .expect(200);
    const row = logs.body.find(r => r.message[0] === 'x');
    assert.ok(row, 'capped message stored');
    assert.ok(row.message.length <= 2000, 'message capped at 2000 chars');
});
