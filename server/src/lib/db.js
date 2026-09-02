// SQLite via better-sqlite3 (synchronous, fast for our scale).
// Migrations run automatically on import. To add a new migration:
//   - append a new entry to MIGRATIONS with the next version number
//   - on startup, missing versions are applied in order
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

let _db = null;

export function getDb() {
    if (_db) return _db;
    mkdirSync(dirname(config.db.path), { recursive: true });
    _db = new Database(config.db.path);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    runMigrations(_db);
    return _db;
}

function runMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);
    const applied = new Set(
        db.prepare('SELECT version FROM _migrations').all().map(r => r.version)
    );
    for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        db.transaction(() => {
            db.exec(m.sql);
            db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)')
                .run(m.version, new Date().toISOString());
        })();
        console.log(`[db] applied migration v${m.version}: ${m.name}`);
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
                provider TEXT NOT NULL DEFAULT 'nowpayments',
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
];

export function closeDb() {
    if (_db) {
        _db.close();
        _db = null;
    }
}
