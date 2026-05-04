/**
 * SQLite database interface for OpenClaude provider configuration.
 * Uses Node.js built-in node:sqlite (available in Node.js 22.5+).
 * Schema now supports flexible provider options (inspired by Kilo config).
 * DB stored at: ~/.openclaude/config.db
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';

process.removeAllListeners('warning'); // suppress ExperimentalWarning for sqlite

const DB_DIR = join(homedir(), '.openclaude');
const DB_PATH = join(DB_DIR, 'config.db');

let _db = null;

function getDb() {
    if (_db) return _db;
    mkdirSync(DB_DIR, { recursive: true });
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    _initSchema(_db);
    return _db;
}

function _initSchema(db) {
    // Check if old schema exists and migrate if needed
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const hasOldSchema = tables.some(t => t.name === 'providers' &&
        db.prepare("PRAGMA table_info(providers)").all().some(col => col.name === 'api_format'));

    if (hasOldSchema) {
        migrateOldSchema(db);
        return;
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS providers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            alias      TEXT UNIQUE NOT NULL,
            name       TEXT NOT NULL,
            api_type   TEXT NOT NULL DEFAULT 'anthropic',
            base_url   TEXT NOT NULL,
            options    TEXT NOT NULL DEFAULT '{}',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS models (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id  INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            model_id     TEXT NOT NULL,
            tier         TEXT NOT NULL,
            name         TEXT,
            cost         TEXT,
            limits       TEXT,
            UNIQUE(provider_id, model_id)
        );
    `);
}

function migrateOldSchema(db) {
    console.log('Migrating old provider schema...');

    // Create new schema
    db.exec(`
        CREATE TABLE providers_new (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            alias      TEXT UNIQUE NOT NULL,
            name       TEXT NOT NULL,
            api_type   TEXT NOT NULL DEFAULT 'anthropic',
            base_url   TEXT NOT NULL,
            options    TEXT NOT NULL DEFAULT '{}',
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
    `);

    // Migrate data from old schema
    const oldProviders = db.prepare('SELECT * FROM providers').all();
    const insertNew = db.prepare(`
        INSERT INTO providers_new (id, alias, name, api_type, base_url, options, is_default, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of oldProviders) {
        const options = {
            apiKey: p.api_key || undefined,
            auth_type: p.auth_type || 'bearer',
            timeout: 30000,
        };
        // Remove undefined values
        Object.keys(options).forEach(k => options[k] === undefined && delete options[k]);

        insertNew.run(
            p.id,
            p.alias,
            p.name,
            p.api_format === 'openai' ? 'openai' : 'anthropic',
            p.url,
            JSON.stringify(options),
            p.is_default,
            p.created_at
        );
    }

    // Drop old tables and rename new
    db.exec('DROP TABLE models');
    db.exec('DROP TABLE providers');
    db.exec('ALTER TABLE providers_new RENAME TO providers');

    // Create new models table
    db.exec(`
        CREATE TABLE models (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id  INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
            model_id     TEXT NOT NULL,
            tier         TEXT NOT NULL,
            name         TEXT,
            cost         TEXT,
            limits       TEXT,
            UNIQUE(provider_id, model_id)
        );
    `);

    console.log('Migration complete');
}

export function dbPath() { return DB_PATH; }

export function hasProviders() {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as n FROM providers').get();
    return row.n > 0;
}

export function getProviders() {
    const db = getDb();
    const providers = db.prepare('SELECT * FROM providers ORDER BY is_default DESC, created_at ASC').all();
    const modelStmt = db.prepare('SELECT * FROM models WHERE provider_id = ?');
    for (const p of providers) {
        p.options = parseJSON(p.options);
        p.models = modelStmt.all(p.id).map(m => ({
            ...m,
            cost: parseJSON(m.cost),
            limits: parseJSON(m.limits)
        }));
    }
    return providers;
}

export function getProvider(alias) {
    const db = getDb();
    const p = db.prepare('SELECT * FROM providers WHERE alias = ?').get(alias);
    if (!p) return null;
    p.options = parseJSON(p.options);
    p.models = db.prepare('SELECT * FROM models WHERE provider_id = ?').all(p.id).map(m => ({
        ...m,
        cost: parseJSON(m.cost),
        limits: parseJSON(m.limits)
    }));
    return p;
}

export function getDefaultProvider() {
    const db = getDb();
    const p = db.prepare('SELECT * FROM providers WHERE is_default = 1').get()
        || db.prepare('SELECT * FROM providers ORDER BY created_at ASC').get();
    if (!p) return null;
    p.options = parseJSON(p.options);
    p.models = db.prepare('SELECT * FROM models WHERE provider_id = ?').all(p.id).map(m => ({
        ...m,
        cost: parseJSON(m.cost),
        limits: parseJSON(m.limits)
    }));
    return p;
}

export function saveProvider(provider) {
    const db = getDb();
    const { alias, name, api_type, base_url, options, is_default, models } = provider;

    if (is_default) db.prepare('UPDATE providers SET is_default = 0').run();

    db.prepare(`
        INSERT INTO providers (alias, name, api_type, base_url, options, is_default)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(alias) DO UPDATE SET
            name = excluded.name, api_type = excluded.api_type,
            base_url = excluded.base_url, options = excluded.options,
            is_default = excluded.is_default
    `).run(
        alias,
        name,
        api_type || 'anthropic',
        base_url,
        JSON.stringify(options || {}),
        is_default ? 1 : 0
    );

    const providerRow = db.prepare('SELECT id FROM providers WHERE alias = ?').get(alias);
    db.prepare('DELETE FROM models WHERE provider_id = ?').run(providerRow.id);

    if (models && Array.isArray(models)) {
        const ins = db.prepare(`
            INSERT INTO models (provider_id, model_id, tier, name, cost, limits)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const m of models) {
            ins.run(
                providerRow.id,
                m.model_id || m.tier,
                m.tier,
                m.name || m.tier,
                m.cost ? JSON.stringify(m.cost) : null,
                m.limits ? JSON.stringify(m.limits) : null
            );
        }
    }
}

export function deleteProvider(alias) {
    getDb().prepare('DELETE FROM providers WHERE alias = ?').run(alias);
}

export function setDefault(alias) {
    const db = getDb();
    db.prepare('UPDATE providers SET is_default = 0').run();
    db.prepare('UPDATE providers SET is_default = 1 WHERE alias = ?').run(alias);
}

export function getModelForTier(provider, tier) {
    if (!provider.models) return '';
    const m = provider.models.find(m => m.tier === tier);
    if (m) return m.model_id || m.tier;
    return provider.models[0]?.model_id || provider.models[0]?.tier || '';
}

// Helper to safely parse JSON
function parseJSON(str) {
    try {
        return str ? JSON.parse(str) : {};
    } catch {
        return {};
    }
}
