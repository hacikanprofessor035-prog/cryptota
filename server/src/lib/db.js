// SQLite via sql.js (WebAssembly build, no native compilation needed).
// We persist to disk by reading/writing the .db file as a binary blob on
// every commit. For a small user base this is fine; for high write rates
// we'd switch back to a native driver (better-sqlite3) on a host with
// the build toolchain (Python + make + g++).
//
// Async API: every call returns a Promise. Routes use it via `await`.
//
// Schema migrations run on first getDb() call.
import initSqlJs from 'sql.js';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

// Resolve path to sql.js's wasm file at runtime. We try several locations
// because the install layout can differ between dev and Railway.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATE_WASM_PATHS = [
    // dev: server/src/lib/db.js → ../../node_modules/...
    `${__dirname}/../../node_modules/sql.js/dist/sql-wasm.wasm`,
    // Railway: app/ working dir → ./node_modules/...
    `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
    `${process.cwd()}/../node_modules/sql.js/dist/sql-wasm.wasm`,
];

let SQLJS_WASM_PATH = null;
for (const p of CANDIDATE_WASM_PATHS) {
    if (existsSync(p)) { SQLJS_WASM_PATH = p; break; }
}
if (!SQLJS_WASM_PATH) {
    // Last-ditch: let sql.js figure it out from its own resolution
    SQLJS_WASM_PATH = 'sql-wasm.wasm';
}
console.log(`[db] Using sql.js wasm at: ${SQLJS_WASM_PATH}`);

let _db = null;            // sql.js Database instance
let _ready = null;         // Promise that resolves when _db is initialised
let _writeChain = Promise.resolve();  // serialise disk writes

export function getDb() {
    if (_db) return Promise.resolve(_db);
    if (_ready) return _ready;
    _ready = (async () => {
        const SQL = await initSqlJs({
            locateFile: file => SQLJS_WASM_PATH
        });

        mkdirSync(dirname(config.db.path), { recursive: true });

        let db;
        if (config.db.path === ':memory:' || !existsSync(config.db.path)) {
            db = new SQL.Database();
        } else {
            const buf = readFileSync(config.db.path);
            db = new SQL.Database(new Uint8Array(buf));
        }
        _db = db;
        runMigrations(_db);
        scheduleWrite();
        return _db;
    })();
    return _ready;
}

function runMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    const appliedRows = queryAll(db, 'SELECT version FROM _migrations');
    const applied = new Set(appliedRows.map(r => r.version));
    for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        db.exec('BEGIN');
        try {
            db.exec(m.sql);
            execStmt(db,
                'INSERT INTO _migrations (version, applied_at) VALUES (?, ?)',
                [m.version, new Date().toISOString()]);
            db.exec('COMMIT');
            console.log(`[db] applied migration v${m.version}: ${m.name}`);
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    }
}

const MIGRATIONS = [
    {
        version: 1,
        name: 'initial schema',
        sql: `
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                name TEXT,
                created_at TEXT NOT NULL,
                last_login_at TEXT
            );

            CREATE TABLE licenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                tier TEXT NOT NULL CHECK(tier IN ('pro', 'lifetime')),
                activated_at TEXT NOT NULL,
                expires_at TEXT,
                source TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_licenses_user ON licenses(user_id);

            CREATE TABLE payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                provider TEXT NOT NULL DEFAULT 'ton',
                provider_payment_id TEXT,
                tier TEXT NOT NULL CHECK(tier IN ('pro', 'lifetime')),
                amount_usd REAL NOT NULL,
                pay_amount REAL,
                pay_currency TEXT,
                pay_address TEXT,
                status TEXT NOT NULL DEFAULT 'waiting',
                expires_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE UNIQUE INDEX idx_payments_provider_id ON payments(provider_payment_id)
                WHERE provider_payment_id IS NOT NULL;
            CREATE INDEX idx_payments_user ON payments(user_id);

            CREATE TABLE webhook_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                event_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                received_at TEXT NOT NULL,
                processed_at TEXT,
                error TEXT,
                UNIQUE(provider, event_id)
            );
        `,
    },
    {
        version: 2,
        name: 'ton direct payments',
        sql: `
            ALTER TABLE payments ADD COLUMN memo TEXT;
            ALTER TABLE payments ADD COLUMN price_usd_at_create REAL;
            ALTER TABLE payments ADD COLUMN min_nano_ton INTEGER;
            ALTER TABLE payments ADD COLUMN last_seen_lt TEXT;
            ALTER TABLE payments ADD COLUMN last_seen_utime INTEGER;
            ALTER TABLE payments ADD COLUMN tx_hash TEXT;
            ALTER TABLE payments ADD COLUMN tx_lt TEXT;
            ALTER TABLE payments ADD COLUMN tx_from TEXT;
            ALTER TABLE payments ADD COLUMN tx_value INTEGER;
            ALTER TABLE payments ADD COLUMN completed_at INTEGER;
            CREATE INDEX idx_payments_memo ON payments(memo) WHERE memo IS NOT NULL;
            CREATE INDEX idx_payments_status ON payments(status);
        `,
    },
    {
        // v3: activity log + license tier — backs the /api/admin/stats endpoint.
        // user_activity records the last API hit per user (TTL = 5 minutes, used
        // to compute "online" count). licenses.tier is denormalized so we can
        // count pro/lifetime holders without joining on payments.
        version: 3,
        name: 'activity log + license tier',
        sql: `
            CREATE TABLE IF NOT EXISTS user_activity (
                user_id INTEGER PRIMARY KEY,
                last_seen_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_user_activity_seen ON user_activity(last_seen_at);
            ALTER TABLE licenses ADD COLUMN tier_text TEXT;
        `,
    },
];

// ===== Helpers (sync, on an already-loaded db) =====
function queryAll(db, sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
}

function queryOne(db, sql, params = []) {
    const rows = queryAll(db, sql, params);
    return rows[0] || null;
}

function execStmt(db, sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.run(params);
    stmt.free();
}

// ===== Persist to disk =====
let _writeScheduled = false;
function scheduleWrite() {
    if (_writeScheduled) return;
    _writeScheduled = true;
    _writeChain = _writeChain.then(() => doWrite());
}

async function doWrite() {
    _writeScheduled = false;
    if (config.db.path === ':memory:') return;
    try {
        const data = _db.export();
        writeFileSync(config.db.path, Buffer.from(data));
    } catch (e) {
        console.error('[db] write failed', e);
    }
}

// ===== Public API =====
// All methods are async to keep the contract uniform, but on a loaded
// in-memory db they're effectively sync internally.

export async function get(userId) {
    await getDb();
    return queryOne(_db, 'SELECT * FROM users WHERE id = ?', [userId]);
}

// Low-level escape hatch for tests — runs raw SQL on the loaded db
export async function runRaw(sql, params = []) {
    await getDb();
    execStmt(_db, sql, params);
    scheduleWrite();
}

export async function getByEmail(email) {
    await getDb();
    return queryOne(_db, 'SELECT * FROM users WHERE email = ?', [email]);
}

export async function createUser({ email, passwordHash, name }) {
    await getDb();
    const now = new Date().toISOString();
    execStmt(_db,
        'INSERT INTO users (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)',
        [email, passwordHash, name || null, now]);
    const row = queryOne(_db, 'SELECT last_insert_rowid() AS id');
    scheduleWrite();
    return get(row.id);
}

export async function updateLastLogin(userId) {
    await getDb();
    execStmt(_db, 'UPDATE users SET last_login_at = ? WHERE id = ?',
        [new Date().toISOString(), userId]);
    scheduleWrite();
}

// ===== Activity log (backed by user_activity) =====
// Backs the /api/admin/stats "online" counter. We treat the last 5 minutes
// of activity as "online now" and the last 24h as "active today".

const ACTIVITY_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function recordActivity(userId) {
    await getDb();
    const now = new Date().toISOString();
    execStmt(_db,
        `INSERT INTO user_activity (user_id, last_seen_at) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
        [userId, now]);
    // Don't scheduleWrite() here — we'd be writing on every API call.
    // We'll let the next "real" mutation flush it. SQLite reads are fine
    // against a stale buffer; the worst case is the online count lags by
    // a few seconds, which is acceptable.
}

export async function getStats() {
    await getDb();
    const now = Date.now();
    const fiveMinAgo = new Date(now - ACTIVITY_TTL_MS).toISOString();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const num = (sql, params = []) => {
        const r = queryOne(_db, sql, params);
        return r ? Number(r.c) : 0;
    };

    return {
        // Total registered users.
        usersTotal:     num('SELECT COUNT(*) AS c FROM users'),
        // Logged in within the last 24 hours (anything more granular than
        // "online now" needs last_login_at; activity is a separate signal).
        usersLoggedIn24h: num(
            "SELECT COUNT(*) AS c FROM users WHERE last_login_at >= ?", [dayAgo]),
        // Touched the API within the last 5 minutes — the "online now" count.
        onlineNow:      num(
            'SELECT COUNT(*) AS c FROM user_activity WHERE last_seen_at >= ?', [fiveMinAgo]),
        onlineLast24h:  num(
            'SELECT COUNT(*) AS c FROM user_activity WHERE last_seen_at >= ?', [dayAgo]),

        // Licenses. tier is the canonical column (tier_text is a denorm
        // fallback for the migration v3 transition).
        proHolders:     num(
            "SELECT COUNT(*) AS c FROM licenses WHERE tier = 'pro' AND (expires_at IS NULL OR expires_at > ?) AND activated_at <= ?",
            [new Date(now).toISOString(), new Date(now).toISOString()]),
        lifetimeHolders: num(
            "SELECT COUNT(*) AS c FROM licenses WHERE tier = 'lifetime' AND (expires_at IS NULL OR expires_at > ?) AND activated_at <= ?",
            [new Date(now).toISOString(), new Date(now).toISOString()]),

        // Payments. status values: waiting | confirming | finished | failed | expired.
        payments: {
            total:     num('SELECT COUNT(*) AS c FROM payments'),
            waiting:   num("SELECT COUNT(*) AS c FROM payments WHERE status = 'waiting'"),
            finished:  num("SELECT COUNT(*) AS c FROM payments WHERE status = 'finished'"),
            failed:    num("SELECT COUNT(*) AS c FROM payments WHERE status IN ('failed','expired')"),
            // Total TON received (in nanoTON, sum of tx_value on finished payments).
            tonReceivedNano: Number(queryOne(
                _db,
                "SELECT COALESCE(SUM(tx_value), 0) AS c FROM payments WHERE status = 'finished' AND tx_value IS NOT NULL"
            )?.c || 0),
        },

        // Server-reported time so the UI can show "last updated".
        serverTime: new Date().toISOString(),
    };
}

export async function insertLicense({ userId, tier, expiresAt, source }) {
    await getDb();
    execStmt(_db,
        'INSERT INTO licenses (user_id, tier, activated_at, expires_at, source) VALUES (?, ?, ?, ?, ?)',
        [userId, tier, new Date().toISOString(), expiresAt || null, source]);
    scheduleWrite();
    return queryOne(_db, 'SELECT last_insert_rowid() AS id');
}

export async function getActiveLicense(userId) {
    await getDb();
    return queryOne(_db,
        `SELECT * FROM licenses
         WHERE user_id = ?
           AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY activated_at DESC LIMIT 1`,
        [userId]);
}

export async function listLicenses(userId, limit = 20) {
    await getDb();
    return queryAll(_db,
        'SELECT * FROM licenses WHERE user_id = ? ORDER BY activated_at DESC LIMIT ?',
        [userId, limit]);
}

export async function createPayment({ userId, tier, amountUsd, provider = 'nowpayments' }) {
    await getDb();
    const now = new Date().toISOString();
    execStmt(_db,
        `INSERT INTO payments
         (user_id, provider, tier, amount_usd, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'waiting', ?, ?)`,
        [userId || null, provider, tier, amountUsd, now, now]);
    const row = queryOne(_db, 'SELECT last_insert_rowid() AS id');
    scheduleWrite();
    return queryOne(_db, 'SELECT * FROM payments WHERE id = ?', [row.id]);
}

export async function updatePayment(id, fields) {
    await getDb();
    const keys = Object.keys(fields);
    if (!keys.length) return getPayment(id);
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => fields[k]);
    vals.push(new Date().toISOString());
    vals.push(id);
    execStmt(_db, `UPDATE payments SET ${sets}, updated_at = ? WHERE id = ?`, vals);
    scheduleWrite();
    return getPayment(id);
}

export async function updatePaymentByProviderId(providerPaymentId, fields) {
    await getDb();
    const keys = Object.keys(fields);
    if (!keys.length) return null;
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => fields[k]);
    vals.push(new Date().toISOString());
    vals.push(providerPaymentId);
    execStmt(_db,
        `UPDATE payments SET ${sets}, updated_at = ? WHERE provider_payment_id = ?`,
        vals);
    scheduleWrite();
    return queryOne(_db,
        'SELECT * FROM payments WHERE provider_payment_id = ?',
        [providerPaymentId]);
}

export async function getPayment(id) {
    await getDb();
    return queryOne(_db, 'SELECT * FROM payments WHERE id = ?', [id]);
}

export async function listPayments(userId, limit = 20) {
    await getDb();
    return queryAll(_db,
        'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, limit]);
}

/** All payments in 'waiting' status with a memo. Used by the TON polling worker. */
export async function listPendingPayments() {
    await getDb();
    return queryAll(_db,
        `SELECT * FROM payments
         WHERE status = 'waiting'
           AND memo IS NOT NULL
           AND min_nano_ton IS NOT NULL
         ORDER BY id ASC
         LIMIT 100`);
}

/** KV store for the polling worker — when was the last full scan? */
export async function getPollCheckpoint() {
    await getDb();
    // Read from a tiny k/v table if it exists, else null.
    const row = queryOne(_db,
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name='_kv'`);
    if (!row) return null;
    return queryOne(_db,
        `SELECT value FROM _kv WHERE key = 'poll_checkpoint'`);
}

export async function setPollCheckpoint(ts) {
    await getDb();
    const has = queryOne(_db,
        `SELECT name FROM sqlite_master WHERE type='table' AND name='_kv'`);
    if (!has) {
        execStmt(_db, `CREATE TABLE IF NOT EXISTS _kv (key TEXT PRIMARY KEY, value TEXT)`);
    }
    execStmt(_db,
        `INSERT INTO _kv (key, value) VALUES ('poll_checkpoint', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(ts)]);
    scheduleWrite();
}

export async function recordWebhookEvent({ provider, eventId, payload }) {
    await getDb();
    try {
        execStmt(_db,
            `INSERT INTO webhook_events
             (provider, event_id, payload, received_at) VALUES (?, ?, ?, ?)`,
            [provider, eventId, JSON.stringify(payload), new Date().toISOString()]);
        scheduleWrite();
        return { duplicate: false };
    } catch (e) {
        // UNIQUE constraint → already processed
        if (String(e).includes('UNIQUE') || String(e).includes('constraint')) {
            return { duplicate: true };
        }
        throw e;
    }
}

export async function markWebhookProcessed(eventId, error = null) {
    await getDb();
    execStmt(_db,
        'UPDATE webhook_events SET processed_at = ?, error = ? WHERE event_id = ?',
        [new Date().toISOString(), error, eventId]);
    scheduleWrite();
}

export async function closeDb() {
    if (_db) {
        // Flush any pending writes before closing
        await _writeChain;
        _db.close();
        _db = null;
        _ready = null;
    }
}

// For tests that need to wipe state
export async function _resetForTests() {
    await closeDb();
    if (config.db.path !== ':memory:' && existsSync(config.db.path)) {
        writeFileSync(config.db.path, Buffer.alloc(0));
    }
}
