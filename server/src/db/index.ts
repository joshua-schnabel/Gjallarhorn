/**
 * Database connection.
 *
 * `better-sqlite3` is synchronous, which suits SQLite: the driver is not doing I/O
 * concurrently anyway, and synchronous calls keep the repositories readable (ADR-004).
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { migrate } from './migrate.ts';

/** `migrations/` sits next to `src/`, so resolve it from this file rather than from cwd. */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export interface OpenOptions {
    /** Absolute path, or `:memory:` for tests. */
    readonly file: string;
    readonly migrationsDir?: string;
}

export function openDatabase(options: OpenOptions): DatabaseType {
    const { file, migrationsDir = MIGRATIONS_DIR } = options;

    if (file !== ':memory:') {
        mkdirSync(dirname(file), { recursive: true });
    }

    const db = new Database(file);

    // WAL: a reader never blocks the writer. The tablet polls history while the device
    // uploads, and those must not wait on each other.
    if (file !== ':memory:') {
        db.pragma('journal_mode = WAL');
    }
    // NORMAL rather than FULL: with WAL this survives a process crash, losing at most the
    // most recent transactions on a power cut. The alternative is an fsync per write on a
    // device that writes on every doorbell press.
    db.pragma('synchronous = NORMAL');
    // Declared foreign keys do nothing in SQLite unless this is on, per connection.
    // The schema relies on ON DELETE CASCADE, so this is not optional.
    db.pragma('foreign_keys = ON');
    // Wait rather than fail immediately when another connection holds the write lock.
    db.pragma('busy_timeout = 5000');

    migrate(db, migrationsDir);

    return db;
}

export type { DatabaseType };
export { migrate, appliedMigrations } from './migrate.ts';
