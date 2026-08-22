import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, MIGRATIONS_DIR, migrate, appliedMigrations } from '../src/db/index.ts';
import { Repositories } from '../src/db/repositories.ts';
import type { DatabaseType } from '../src/db/index.ts';

let db: DatabaseType;
let repos: Repositories;

const dirs: string[] = [];

function tempDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'doorbell-db-'));
    dirs.push(d);
    return d;
}

beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    repos = new Repositories(db);
});

after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NOW = '2026-08-22T12:00:00.000Z';

function ringEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: '01J8F3QK7XB2N4ZZZZZZZZZZZZ',
        deviceId: 'frontdoor',
        type: 'ring' as const,
        occurredAt: NOW,
        deviceUptimeMs: 4820,
        wakeReason: 'button' as const,
        batteryVoltage: 3.91,
        rssi: -61,
        ...overrides,
    };
}

describe('migrations', () => {
    test('apply on first open and record themselves', () => {
        const applied = appliedMigrations(db);
        assert.ok(applied.length >= 1, 'at least the initial migration ran');
        assert.equal(applied[0]?.name, '001-initial.sql');
    });

    test('re-running is a no-op', () => {
        // A restart must not fail or duplicate. This is the property, not an
        // implementation detail.
        const before = appliedMigrations(db).length;
        const second = migrate(db, MIGRATIONS_DIR);
        assert.deepEqual(second, [], 'nothing was applied the second time');
        assert.equal(appliedMigrations(db).length, before);
    });

    test('foreign keys are actually enforced, not just declared', () => {
        // SQLite ignores declared foreign keys unless the pragma is on per connection.
        // The schema relies on ON DELETE CASCADE, so this needs proving.
        assert.throws(
            () =>
                db
                    .prepare('INSERT INTO events (id, device_id, type, occurred_at) VALUES (?, ?, ?, ?)')
                    .run('x', 'no-such-device', 'ring', NOW),
            /FOREIGN KEY/i,
        );
    });
});

describe('events', () => {
    test('an insert creates the device and the event', () => {
        const result = repos.insertEvent(ringEvent());

        assert.equal(result.created, true);
        assert.equal(result.row.type, 'ring');
        // No registration step: a device that reports is a device. Rejecting the first
        // event for bookkeeping reasons would lose a doorbell press.
        assert.equal(repos.getDevice('frontdoor')?.deviceId, 'frontdoor');
    });

    test('re-inserting the same id returns the stored row and creates nothing', () => {
        // The device retries from its local queue with the original id. Without this, a
        // backend outage would arrive later as duplicate rings in the house.
        const first = repos.insertEvent(ringEvent());
        const second = repos.insertEvent(ringEvent({ batteryVoltage: 3.2, rssi: -90 }));

        assert.equal(first.created, true);
        assert.equal(second.created, false);
        assert.equal(repos.listEvents().length, 1);
        // The first version wins: the retry must not rewrite history.
        assert.equal(second.row.batteryVoltage, 3.91);
    });

    test('the device summary follows the event', () => {
        repos.insertEvent(ringEvent());
        const device = repos.getDevice('frontdoor');

        assert.equal(device?.lastRingAt, NOW);
        assert.equal(device?.lastEventId, '01J8F3QK7XB2N4ZZZZZZZZZZZZ');
        assert.equal(device?.batteryVoltage, 3.91);
        assert.equal(device?.lastMotionAt, null, 'a ring does not touch the motion timestamp');
    });

    test('listing is newest first and honours the cursor', () => {
        for (let i = 0; i < 5; i++) {
            repos.insertEvent(
                ringEvent({
                    id: `01J8F3QK7XB2N4ZZZZZZZZZZ0${i}`,
                    occurredAt: `2026-08-22T12:0${i}:00.000Z`,
                    type: i % 2 === 0 ? 'ring' : 'motion',
                }),
            );
        }

        const page = repos.listEvents({ limit: 2 });
        assert.equal(page.length, 2);
        assert.equal(page[0]?.occurredAt, '2026-08-22T12:04:00.000Z');

        const next = repos.listEvents({ limit: 2, before: page[1]?.occurredAt });
        assert.equal(next[0]?.occurredAt, '2026-08-22T12:02:00.000Z');
        assert.ok(
            next.every((e) => e.occurredAt < (page[1]?.occurredAt ?? '')),
            'the cursor is strict, so a row is never returned on two pages',
        );
    });

    test('filters by type and device', () => {
        repos.insertEvent(ringEvent({ id: '01J8F3QK7XB2N4ZZZZZZZZZZ01', type: 'ring' }));
        repos.insertEvent(ringEvent({ id: '01J8F3QK7XB2N4ZZZZZZZZZZ02', type: 'motion' }));
        repos.insertEvent(
            ringEvent({ id: '01J8F3QK7XB2N4ZZZZZZZZZZ03', deviceId: 'backdoor', type: 'ring' }),
        );

        assert.equal(repos.listEvents({ type: 'ring' }).length, 2);
        assert.equal(repos.listEvents({ deviceId: 'frontdoor' }).length, 2);
        assert.equal(repos.listEvents({ deviceId: 'backdoor', type: 'ring' }).length, 1);
    });

    test('limit is clamped rather than trusted', () => {
        repos.insertEvent(ringEvent());
        assert.equal(repos.listEvents({ limit: 100000 }).length, 1);
        assert.doesNotThrow(() => repos.listEvents({ limit: -5 }));
    });

    test('records whether an event was republished', () => {
        // Stored rather than recomputed, so the history says what actually happened when
        // the server-side cooldown suppressed a motion event.
        const { row } = repos.insertEvent(ringEvent());
        assert.equal(row.publishedToMqtt, false);

        repos.markEventPublished(row.id, true);
        assert.equal(repos.getEvent(row.id)?.publishedToMqtt, true);
    });
});

describe('snapshots', () => {
    const snapshot = {
        id: '01J8F3QK80ZZ1AZZZZZZZZZZZZ',
        deviceId: 'frontdoor',
        capturedAt: NOW,
        byteSize: 204_800,
        filePath: 'frontdoor/2026/08/01J8F3QK80ZZ1AZZZZZZZZZZZZ.jpg',
    };

    test('idempotent on id', () => {
        assert.equal(repos.insertSnapshot(snapshot).created, true);
        assert.equal(repos.insertSnapshot(snapshot).created, false);
        assert.equal(repos.listSnapshots().length, 1);
    });

    test('links to its event when the event already exists', () => {
        const { row: event } = repos.insertEvent(ringEvent());
        repos.insertSnapshot({ ...snapshot, eventId: event.id });

        assert.equal(repos.getEvent(event.id)?.snapshotId, snapshot.id);
    });

    test('a snapshot may arrive before its event', () => {
        // The device posts them as two requests and may retry either independently.
        // Enforcing an order here would reject a valid upload.
        assert.doesNotThrow(() => repos.insertSnapshot({ ...snapshot, eventId: 'not-yet-uploaded' }));
        assert.equal(repos.getSnapshot(snapshot.id)?.eventId, 'not-yet-uploaded');
    });

    test('deleting clears the reference from its event', () => {
        // Otherwise the API would hand out a snapshot id that resolves to nothing.
        const { row: event } = repos.insertEvent(ringEvent());
        repos.insertSnapshot({ ...snapshot, eventId: event.id });

        repos.deleteSnapshot(snapshot.id);

        assert.equal(repos.getSnapshot(snapshot.id), undefined);
        assert.equal(repos.getEvent(event.id)?.snapshotId, null);
    });

    test('retention selects by age without deleting', () => {
        // The caller owns the filesystem: a row removed before its file leaves an orphan
        // nothing points at.
        repos.insertSnapshot({ ...snapshot, id: 'old', capturedAt: '2026-01-01T00:00:00.000Z' });
        repos.insertSnapshot({ ...snapshot, id: 'new', capturedAt: NOW });

        const stale = repos.snapshotsOlderThan('2026-06-01T00:00:00.000Z');
        assert.deepEqual(
            stale.map((s) => s.id),
            ['old'],
        );
        assert.equal(repos.listSnapshots().length, 2, 'selecting does not delete');
    });
});

describe('telemetry and device state', () => {
    test('telemetry updates last contact', () => {
        repos.insertTelemetry({
            deviceId: 'frontdoor',
            receivedAt: NOW,
            batteryVoltage: 3.88,
            wakeToNetworkMs: 4180,
        });

        assert.equal(repos.countTelemetry('frontdoor'), 1);
        assert.equal(repos.getDevice('frontdoor')?.lastSeen, NOW);
        assert.equal(repos.getDevice('frontdoor')?.batteryVoltage, 3.88);
    });

    test('sleeping is healthy; only staleness means unreachable', () => {
        const staleAfter = 30 * 60_000;
        const now = new Date('2026-08-22T12:00:00.000Z');

        assert.equal(repos.deviceStateFor('2026-08-22T11:50:00.000Z', staleAfter, now), 'sleeping');
        assert.equal(repos.deviceStateFor('2026-08-22T10:00:00.000Z', staleAfter, now), 'unreachable');
        assert.equal(repos.deviceStateFor(null, staleAfter, now), 'unreachable');
    });

    test('a staleness sweep does not disturb a device inside its wake window', () => {
        repos.insertEvent(ringEvent());
        repos.setDeviceState('frontdoor', 'live', '2026-08-22T12:02:00.000Z');

        repos.refreshDeviceStates(1, new Date('2026-08-22T23:00:00.000Z'));

        assert.equal(repos.getDevice('frontdoor')?.state, 'live', 'an active session outranks the sweep');
    });

    test('a long-quiet device becomes unreachable', () => {
        repos.insertEvent(ringEvent());
        repos.refreshDeviceStates(60_000, new Date('2026-08-23T12:00:00.000Z'));

        assert.equal(repos.getDevice('frontdoor')?.state, 'unreachable');
    });
});

describe('durability', () => {
    test('data written before a reopen is readable afterwards', () => {
        // MVP acceptance criterion 13, at the storage layer. The container-level version
        // lives in scripts/integration-test.sh.
        const dir = tempDir();
        const file = join(dir, 'doorbell.sqlite');

        const first = openDatabase({ file });
        new Repositories(first).insertEvent(ringEvent());
        first.close();

        const second = openDatabase({ file });
        const events = new Repositories(second).listEvents();
        second.close();

        assert.equal(events.length, 1);
        assert.equal(events[0]?.id, '01J8F3QK7XB2N4ZZZZZZZZZZZZ');
    });
});
