/**
 * Repositories.
 *
 * The one property to understand here is **idempotency on a device-generated id**. The
 * door device retries from a bounded local queue after a failed upload and reuses the
 * original ULID. Without idempotency in the store, a backend outage arrives later as
 * duplicate rings in the house — so every device-facing insert reports whether it created
 * a row or found one, and never raises on a repeat.
 */

import type { Database } from 'better-sqlite3';

export type EventType = 'ring' | 'motion';
export type WakeReason = 'button' | 'motion' | 'unknown';
export type DeviceState = 'sleeping' | 'awake' | 'live' | 'unreachable';

export interface EventInput {
    readonly id: string;
    readonly deviceId: string;
    readonly type: EventType;
    readonly occurredAt: string;
    readonly deviceUptimeMs?: number | undefined;
    readonly wakeReason?: WakeReason | undefined;
    readonly batteryVoltage?: number | undefined;
    readonly rssi?: number | undefined;
    readonly snapshotId?: string | undefined;
    readonly publishedToMqtt?: boolean | undefined;
}

export interface EventRow {
    readonly id: string;
    readonly deviceId: string;
    readonly type: EventType;
    readonly occurredAt: string;
    readonly deviceUptimeMs: number | null;
    readonly wakeReason: WakeReason | null;
    readonly batteryVoltage: number | null;
    readonly rssi: number | null;
    readonly snapshotId: string | null;
    readonly publishedToMqtt: boolean;
}

export interface SnapshotInput {
    readonly id: string;
    readonly deviceId: string;
    readonly capturedAt: string;
    readonly byteSize: number;
    readonly filePath: string;
    readonly eventId?: string | undefined;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
}

export interface SnapshotRow {
    readonly id: string;
    readonly deviceId: string;
    readonly eventId: string | null;
    readonly capturedAt: string;
    readonly byteSize: number;
    readonly width: number | null;
    readonly height: number | null;
    readonly filePath: string;
}

export interface TelemetryInput {
    readonly deviceId: string;
    readonly receivedAt: string;
    readonly deviceUptimeMs?: number | undefined;
    readonly wakeReason?: WakeReason | undefined;
    readonly bootCount?: number | undefined;
    readonly batteryVoltage?: number | undefined;
    readonly rssi?: number | undefined;
    readonly freeHeapBytes?: number | undefined;
    readonly wakeToNetworkMs?: number | undefined;
    readonly uploadMs?: number | undefined;
    readonly queuedEvents?: number | undefined;
}

export interface DeviceRow {
    readonly deviceId: string;
    readonly name: string | null;
    readonly state: DeviceState;
    readonly lastSeen: string | null;
    readonly lastEventId: string | null;
    readonly lastRingAt: string | null;
    readonly lastMotionAt: string | null;
    readonly batteryVoltage: number | null;
    readonly rssi: number | null;
    readonly wakeWindowEndsAt: string | null;
}

/** What an idempotent insert did. `existed` means the id was already known. */
export interface InsertResult<T> {
    readonly created: boolean;
    readonly row: T;
}

export interface PageQuery {
    readonly limit?: number | undefined;
    /** Cursor: return rows strictly older than this timestamp. */
    readonly before?: string | undefined;
    readonly deviceId?: string | undefined;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_LIMIT;
    return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function toBool(value: unknown): boolean {
    return value === 1 || value === true;
}

function mapEvent(row: Record<string, unknown>): EventRow {
    return {
        id: row['id'] as string,
        deviceId: row['deviceId'] as string,
        type: row['type'] as EventType,
        occurredAt: row['occurredAt'] as string,
        deviceUptimeMs: (row['deviceUptimeMs'] as number | null) ?? null,
        wakeReason: (row['wakeReason'] as WakeReason | null) ?? null,
        batteryVoltage: (row['batteryVoltage'] as number | null) ?? null,
        rssi: (row['rssi'] as number | null) ?? null,
        snapshotId: (row['snapshotId'] as string | null) ?? null,
        publishedToMqtt: toBool(row['publishedToMqtt']),
    };
}

const EVENT_COLUMNS = `
    id, device_id AS deviceId, type, occurred_at AS occurredAt,
    device_uptime_ms AS deviceUptimeMs, wake_reason AS wakeReason,
    battery_voltage AS batteryVoltage, rssi, snapshot_id AS snapshotId,
    published_to_mqtt AS publishedToMqtt
`;

const SNAPSHOT_COLUMNS = `
    id, device_id AS deviceId, event_id AS eventId, captured_at AS capturedAt,
    byte_size AS byteSize, width, height, file_path AS filePath
`;

const DEVICE_COLUMNS = `
    device_id AS deviceId, name, state, last_seen AS lastSeen,
    last_event_id AS lastEventId, last_ring_at AS lastRingAt,
    last_motion_at AS lastMotionAt, battery_voltage AS batteryVoltage, rssi,
    wake_window_ends_at AS wakeWindowEndsAt
`;

export class Repositories {
    private readonly db: Database;

    constructor(db: Database) {
        this.db = db;
    }

    // ── Devices ───────────────────────────────────────────────────────────────

    /**
     * Devices appear by reporting. There is no registration step: a device that posts an
     * event is a device, and rejecting the first event because nobody pre-registered it
     * would lose a doorbell press for a bookkeeping reason.
     *
     * Authentication is a separate concern and belongs to the route, not here.
     */
    ensureDevice(deviceId: string, now: string): void {
        this.db
            .prepare(
                `INSERT INTO devices (device_id, created_at) VALUES (?, ?)
                 ON CONFLICT(device_id) DO NOTHING`,
            )
            .run(deviceId, now);
    }

    getDevice(deviceId: string): DeviceRow | undefined {
        return this.db.prepare(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE device_id = ?`).get(deviceId) as
            DeviceRow | undefined;
    }

    listDevices(): DeviceRow[] {
        return this.db
            .prepare(`SELECT ${DEVICE_COLUMNS} FROM devices ORDER BY device_id`)
            .all() as DeviceRow[];
    }

    setDeviceState(deviceId: string, state: DeviceState, wakeWindowEndsAt?: string | null): void {
        this.db
            .prepare('UPDATE devices SET state = ?, wake_window_ends_at = ? WHERE device_id = ?')
            .run(state, wakeWindowEndsAt ?? null, deviceId);
    }

    /**
     * `sleeping` is the normal, healthy state for a device that powers itself off between
     * events, so staleness — not absence of a connection — is what means something is
     * wrong. There is no connection to observe.
     */
    deviceStateFor(lastSeen: string | null, staleAfterMs: number, now: Date = new Date()): DeviceState {
        if (lastSeen === null) return 'unreachable';
        const age = now.getTime() - new Date(lastSeen).getTime();
        return age > staleAfterMs ? 'unreachable' : 'sleeping';
    }

    /** Recomputes every device's state from its last contact. Cheap; one device is expected. */
    refreshDeviceStates(staleAfterMs: number, now: Date = new Date()): void {
        const update = this.db.prepare('UPDATE devices SET state = ? WHERE device_id = ?');
        this.db.transaction(() => {
            for (const device of this.listDevices()) {
                // A live or awake device is inside its wake window; that is tracked
                // explicitly and must not be overwritten by a staleness sweep.
                if (device.state === 'live' || device.state === 'awake') continue;
                update.run(this.deviceStateFor(device.lastSeen, staleAfterMs, now), device.deviceId);
            }
        })();
    }

    // ── Events ────────────────────────────────────────────────────────────────

    /**
     * Idempotent on `id`. A repeat returns the stored row with `created: false` rather
     * than raising or overwriting — the device's retry must not become a second ring, and
     * the first version of an event is the truthful one.
     */
    insertEvent(input: EventInput): InsertResult<EventRow> {
        const existing = this.getEvent(input.id);
        if (existing !== undefined) return { created: false, row: existing };

        this.db.transaction(() => {
            this.ensureDevice(input.deviceId, input.occurredAt);
            this.db
                .prepare(
                    `INSERT INTO events (
                        id, device_id, type, occurred_at, device_uptime_ms, wake_reason,
                        battery_voltage, rssi, snapshot_id, published_to_mqtt
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    input.id,
                    input.deviceId,
                    input.type,
                    input.occurredAt,
                    input.deviceUptimeMs ?? null,
                    input.wakeReason ?? null,
                    input.batteryVoltage ?? null,
                    input.rssi ?? null,
                    input.snapshotId ?? null,
                    input.publishedToMqtt === true ? 1 : 0,
                );

            // The device summary is denormalised so the tablet's home screen is one read
            // rather than a scan of the event log.
            this.db
                .prepare(
                    `UPDATE devices SET
                        last_seen = ?,
                        last_event_id = ?,
                        last_ring_at = CASE WHEN ? = 'ring' THEN ? ELSE last_ring_at END,
                        last_motion_at = CASE WHEN ? = 'motion' THEN ? ELSE last_motion_at END,
                        battery_voltage = COALESCE(?, battery_voltage),
                        rssi = COALESCE(?, rssi)
                     WHERE device_id = ?`,
                )
                .run(
                    input.occurredAt,
                    input.id,
                    input.type,
                    input.occurredAt,
                    input.type,
                    input.occurredAt,
                    input.batteryVoltage ?? null,
                    input.rssi ?? null,
                    input.deviceId,
                );
        })();

        const row = this.getEvent(input.id);
        if (row === undefined) throw new Error(`event ${input.id} vanished immediately after insert`);
        return { created: true, row };
    }

    getEvent(id: string): EventRow | undefined {
        const row = this.db.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(id) as
            Record<string, unknown> | undefined;
        return row === undefined ? undefined : mapEvent(row);
    }

    markEventPublished(id: string, published: boolean): void {
        this.db.prepare('UPDATE events SET published_to_mqtt = ? WHERE id = ?').run(published ? 1 : 0, id);
    }

    listEvents(query: PageQuery & { type?: EventType | undefined } = {}): EventRow[] {
        const limit = clampLimit(query.limit);
        const clauses: string[] = [];
        const params: unknown[] = [];

        if (query.deviceId !== undefined) {
            clauses.push('device_id = ?');
            params.push(query.deviceId);
        }
        if (query.type !== undefined) {
            clauses.push('type = ?');
            params.push(query.type);
        }
        if (query.before !== undefined) {
            clauses.push('occurred_at < ?');
            params.push(query.before);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const rows = this.db
            .prepare(
                `SELECT ${EVENT_COLUMNS} FROM events ${where} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
            )
            .all(...params, limit) as Record<string, unknown>[];
        return rows.map(mapEvent);
    }

    /** Most recent event of a type, used by the cooldown check. */
    latestEvent(deviceId: string, type: EventType): EventRow | undefined {
        const row = this.db
            .prepare(
                `SELECT ${EVENT_COLUMNS} FROM events
                 WHERE device_id = ? AND type = ? ORDER BY occurred_at DESC LIMIT 1`,
            )
            .get(deviceId, type) as Record<string, unknown> | undefined;
        return row === undefined ? undefined : mapEvent(row);
    }

    // ── Snapshots ─────────────────────────────────────────────────────────────

    /** Idempotent on `id`, for the same reason as events. */
    insertSnapshot(input: SnapshotInput): InsertResult<SnapshotRow> {
        const existing = this.getSnapshot(input.id);
        if (existing !== undefined) return { created: false, row: existing };

        this.db.transaction(() => {
            this.ensureDevice(input.deviceId, input.capturedAt);
            this.db
                .prepare(
                    `INSERT INTO snapshots (
                        id, device_id, event_id, captured_at, byte_size, width, height, file_path
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    input.id,
                    input.deviceId,
                    input.eventId ?? null,
                    input.capturedAt,
                    input.byteSize,
                    input.width ?? null,
                    input.height ?? null,
                    input.filePath,
                );

            // The device uploads the event and the image as two requests, in either
            // order. Whichever arrives second links them.
            if (input.eventId !== undefined) {
                this.db
                    .prepare('UPDATE events SET snapshot_id = ? WHERE id = ? AND snapshot_id IS NULL')
                    .run(input.id, input.eventId);
            }
        })();

        const row = this.getSnapshot(input.id);
        if (row === undefined) throw new Error(`snapshot ${input.id} vanished immediately after insert`);
        return { created: true, row };
    }

    getSnapshot(id: string): SnapshotRow | undefined {
        return this.db.prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots WHERE id = ?`).get(id) as
            SnapshotRow | undefined;
    }

    listSnapshots(query: PageQuery = {}): SnapshotRow[] {
        const limit = clampLimit(query.limit);
        const clauses: string[] = [];
        const params: unknown[] = [];

        if (query.deviceId !== undefined) {
            clauses.push('device_id = ?');
            params.push(query.deviceId);
        }
        if (query.before !== undefined) {
            clauses.push('captured_at < ?');
            params.push(query.before);
        }

        const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        return this.db
            .prepare(
                `SELECT ${SNAPSHOT_COLUMNS} FROM snapshots ${where} ORDER BY captured_at DESC, id DESC LIMIT ?`,
            )
            .all(...params, limit) as SnapshotRow[];
    }

    /**
     * Snapshots older than the cutoff, so retention can delete the files and the rows
     * together. Returned rather than deleted here: the caller owns the filesystem, and a
     * row removed before its file would leave an orphan nothing points at.
     */
    snapshotsOlderThan(cutoff: string): SnapshotRow[] {
        return this.db
            .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots WHERE captured_at < ? ORDER BY captured_at`)
            .all(cutoff) as SnapshotRow[];
    }

    deleteSnapshot(id: string): void {
        this.db.transaction(() => {
            this.db.prepare('UPDATE events SET snapshot_id = NULL WHERE snapshot_id = ?').run(id);
            this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
        })();
    }

    // ── Telemetry ─────────────────────────────────────────────────────────────

    insertTelemetry(input: TelemetryInput): void {
        this.db.transaction(() => {
            this.ensureDevice(input.deviceId, input.receivedAt);
            this.db
                .prepare(
                    `INSERT INTO telemetry (
                        device_id, received_at, device_uptime_ms, wake_reason, boot_count,
                        battery_voltage, rssi, free_heap_bytes, wake_to_network_ms,
                        upload_ms, queued_events
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    input.deviceId,
                    input.receivedAt,
                    input.deviceUptimeMs ?? null,
                    input.wakeReason ?? null,
                    input.bootCount ?? null,
                    input.batteryVoltage ?? null,
                    input.rssi ?? null,
                    input.freeHeapBytes ?? null,
                    input.wakeToNetworkMs ?? null,
                    input.uploadMs ?? null,
                    input.queuedEvents ?? null,
                );

            this.db
                .prepare(
                    `UPDATE devices SET
                        last_seen = ?,
                        battery_voltage = COALESCE(?, battery_voltage),
                        rssi = COALESCE(?, rssi)
                     WHERE device_id = ?`,
                )
                .run(input.receivedAt, input.batteryVoltage ?? null, input.rssi ?? null, input.deviceId);
        })();
    }

    countTelemetry(deviceId: string): number {
        const row = this.db
            .prepare('SELECT COUNT(*) AS n FROM telemetry WHERE device_id = ?')
            .get(deviceId) as {
            n: number;
        };
        return row.n;
    }
}
