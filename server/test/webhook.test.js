// Tests for NOWPayments webhook signature + license activation flow.
// Uses Node's built-in test runner (no extra deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { nowpayments } from '../src/lib/nowpayments.js';
import { config } from '../src/config.js';

test('verifyIpnSignature accepts valid HMAC-SHA512', () => {
    // Override secret for this test
    const original = config.nowpayments.ipnSecret;
    config.nowpayments.ipnSecret = 'test-secret-12345';

    const payload = JSON.stringify({ payment_id: 123, payment_status: 'finished' });
    const sig = createHmac('sha512', 'test-secret-12345').update(payload).digest('hex');

    assert.equal(nowpayments.verifyIpnSignature(payload, sig), true);
    config.nowpayments.ipnSecret = original;
});

test('verifyIpnSignature rejects tampered payload', () => {
    const original = config.nowpayments.ipnSecret;
    config.nowpayments.ipnSecret = 'test-secret-12345';

    const payload = JSON.stringify({ payment_id: 123, payment_status: 'finished' });
    const sig = createHmac('sha512', 'test-secret-12345').update(payload).digest('hex');

    // Tamper with the payload
    const tampered = payload.replace('finished', 'waiting');
    assert.equal(nowpayments.verifyIpnSignature(tampered, sig), false);
    config.nowpayments.ipnSecret = original;
});

test('verifyIpnSignature rejects when secret mismatches', () => {
    const original = config.nowpayments.ipnSecret;
    config.nowpayments.ipnSecret = 'secret-A';
    const payload = JSON.stringify({ foo: 'bar' });
    const sig = createHmac('sha512', 'secret-B').update(payload).digest('hex');
    assert.equal(nowpayments.verifyIpnSignature(payload, sig), false);
    config.nowpayments.ipnSecret = original;
});

test('verifyIpnSignature fails closed when no secret configured', () => {
    const original = config.nowpayments.ipnSecret;
    config.nowpayments.ipnSecret = '';
    assert.equal(nowpayments.verifyIpnSignature('{}', 'deadbeef'), false);
    config.nowpayments.ipnSecret = original;
});
