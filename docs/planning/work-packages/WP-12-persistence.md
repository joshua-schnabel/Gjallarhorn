# WP-12: Persistence

| | |
| --- | --- |
| **Status** | done |
| **Phase** | 2 |
| **Depends on** | WP-11 |
| **Blocks** | WP-13 .. WP-17 |

## Goal

The storage layer every endpoint needs: schema, migrations, and repositories for devices,
events, snapshots and telemetry.

Two properties matter more than the rest, and both come from decisions already made:

**Idempotency on a device-generated ULID.** The device retries from a bounded local queue
after a failed upload, reusing the original identifier
([`architecture.md`](../../architecture.md) invariants). Without idempotency in the store,
a backend outage arrives later as duplicate rings in the house.

**Survival of a restart.** MVP acceptance criterion 13. Verified by stopping and starting
the container, not by asserting that a function was called.

## Tasks

- [x] Schema: `devices`, `events`, `snapshots`, `telemetry`
- [x] Forward-only migrations, applied at startup, tracked in `schema_migrations`
- [x] Repository layer typed against the OpenAPI schemas
- [x] Idempotent insert on ULID: re-inserting a known id returns the stored row unchanged
- [x] Device state derivation from event arrival plus the staleness timeout — the backend
      owns this, because the device holds no connection to mirror (ADR-002)
- [x] Backend stamps wall-clock time; the device supplies `deviceUptimeMs`
- [x] Cursor pagination support, newest first
- [x] Unit tests, including migration re-runs and idempotent inserts
- [x] Extend `scripts/integration-test.sh`: data survives `down` and `up`

## Deliverables

- `server/src/db/` — connection, migrations, repositories
- `server/migrations/*.sql`
- Tests

## Acceptance

- `npm test` passes; coverage stays above the gate.
- Running migrations twice is a no-op — a restart must not fail or duplicate.
- Inserting the same event id twice yields one row, and the second call reports that it
  already existed rather than raising.
- Events and snapshots written before a container restart are readable afterwards.
- Timestamps are backend-stamped and stored as UTC.
- Foreign keys are enforced, not merely declared.

## Outcome

**45 tests pass** (20 new), typecheck clean, coverage above the gate, and the integration
test now checks the database inside the running container.

### Two findings from the container, not from reasoning

**`npm ci` tried to compile better-sqlite3, and the build failed.** The package ships
prebuilt binaries for every platform this project targets - linux-x64, linux-arm64 and
both musl variants - but it also ships a `binding.gyp`, and npm's default behaviour for
such a package is to run `node-gyp rebuild` anyway. The runtime image has no compiler, by
design.

The fix is `--ignore-scripts`, and it is an improvement rather than a workaround: the
shipped prebuild loads and runs (verified), and no install script from the dependency tree
executes at image build time. CI uses the same flag, so it resolves the same binaries the
image ships instead of compiling its own.

**This refines ADR-004.** WP-10 verified that prebuilds resolve without a compiler using
`npm install`; with `npm ci` npm attempts the build regardless. The conclusion holds, the
mechanism needed one more flag.

**The Dockerfile did not copy `migrations/`.** The service started and then failed on a
missing directory. The integration test found it, which is the point of running the
packaged container rather than trusting the source.

### Design notes

- **Devices appear by reporting.** No registration step: rejecting a first event because
  nobody pre-registered the device would lose a doorbell press for bookkeeping reasons.
- **A snapshot may arrive before its event.** They are two requests and either may be
  retried independently, so `snapshots.event_id` is deliberately not a foreign key -
  whichever arrives second links them.
- **`sleeping` is healthy.** State comes from staleness, never from a connection, because
  the device holds none.
- **Retention selects without deleting.** The caller owns the filesystem; a row removed
  before its file would leave an orphan nothing points at.

## Open questions

- Does a snapshot row need to survive its file being deleted by retention, or should
  retention remove both together? Leaning towards both together, so the API never returns
  a reference to something that is gone.
- Should telemetry be capped as well as snapshots? It is small per row but unbounded over
  time, and nothing currently deletes it.
