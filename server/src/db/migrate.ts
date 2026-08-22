/**
 * Forward-only migrations.
 *
 * SQL files in `migrations/`, applied in filename order, each recorded in
 * `schema_migrations` so a restart re-applies nothing. No ORM and no migration
 * framework: the schema is small, it will not outgrow SQLite, and the reason it needs to
 * evolve predictably at all is MVP acceptance criterion 13 — a server restart must not
 * lose stored events or images.
 *
 * Each file runs inside a transaction together with its bookkeeping row, so a migration
 * that fails half way leaves the database on the previous version rather than in a state
 * no version describes.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';

export interface AppliedMigration {
    readonly name: string;
    readonly appliedAt: string;
}

const MIGRATION_PATTERN = /^\d{3}-[a-z0-9-]+\.sql$/;

function ensureBookkeeping(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    `);
}

/** Migration files on disk, in the order they must be applied. */
export function listMigrationFiles(dir: string): string[] {
    return readdirSync(dir)
        .filter((f) => MIGRATION_PATTERN.test(f))
        .sort();
}

/**
 * Applies every migration not yet recorded. Returns the names applied by this call, so a
 * caller can log "nothing to do" honestly rather than claiming work it did not perform.
 */
export function migrate(db: Database, dir: string): string[] {
    ensureBookkeeping(db);

    const already = new Set(
        db
            .prepare('SELECT name FROM schema_migrations')
            .all()
            .map((row) => (row as { name: string }).name),
    );

    const applied: string[] = [];

    for (const file of listMigrationFiles(dir)) {
        if (already.has(file)) continue;

        const sql = readFileSync(join(dir, file), 'utf8');
        const record = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

        // The schema change and the record that it happened commit together, or neither
        // does. Otherwise a crash between them leaves a database whose contents and
        // whose version disagree.
        db.transaction(() => {
            db.exec(sql);
            record.run(file, new Date().toISOString());
        })();

        applied.push(file);
    }

    return applied;
}

export function appliedMigrations(db: Database): AppliedMigration[] {
    ensureBookkeeping(db);
    return db
        .prepare('SELECT name, applied_at AS appliedAt FROM schema_migrations ORDER BY name')
        .all() as AppliedMigration[];
}
