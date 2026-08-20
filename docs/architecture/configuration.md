# Configuration model

Which settings exist, and which component holds each. The project rule from
[`../planning/constraints.md`](../planning/constraints.md) applies throughout:

> Choose a sensible default for every parameter, and make every parameter configurable.

With one deliberate exception, noted below.

---

## Door device

Compiled in or held in NVS. The device is the most expensive place to change a setting —
it needs a flash — so anything that might reasonably be tuned belongs on the server side
instead.

| Setting | Default | Notes |
| --- | --- | --- |
| `DEVICE_ID` | `frontdoor` | Appears in every event and topic |
| `BACKEND_URL` | — | **Required.** No default is meaningful. |
| `DEVICE_TOKEN` | — | **Required.** Provisioned, never committed. |
| `WAKE_WINDOW_MS` | 90000 | Ring only; motion never waits |
| `LIVE_SESSION_TIMEOUT_MS` | 120000 | |
| `MAX_AWAKE_MS` | 180000 | Watchdog backstop |
| `WIFI_CONNECT_TIMEOUT_MS` | 15000 | |
| `UPLOAD_TIMEOUT_MS` | 5000 | Per attempt |
| `UPLOAD_RETRY_MAX` | 3 | |
| `QUEUE_MAX_ENTRIES` | 32 | Bounded; drops oldest first |
| `SNAPSHOT_WIDTH` / `HEIGHT` | 1280 x 720 | Lower than the demo's 1080p; see below |
| `VIDEO_WIDTH` / `HEIGHT` | 1280 x 720 | |
| `VIDEO_FPS` | 15 | |
| `VIDEO_BITRATE` | 1 Mbit/s | |
| `AUDIO_CODEC` | Opus | G711A available as a build option |

**Resolution and frame rate are energy settings, not quality settings.** Espressif's
`doorbell_local` defaults to 1920x1080 at 25 fps, which is a demo choice. Every second of
live session is roughly 0.11 mAh, and encode plus radio time scale with both figures. 720p
at 15 fps is the proposed starting point; it should be checked against the picture the
camera actually produces before being treated as settled.

### Not configurable: the motion cooldown

The cooldown is a **potentiometer on the PIR**, not a software value. The device is
unpowered during the cooldown and cannot hold a timer; see
[`../architecture.md`](../architecture.md) section 6.

This is a real loss of flexibility and it is recorded rather than hidden. The backend has
its own `MOTION_COOLDOWN_MS`, but that one protects the event history from duplicates —
it cannot protect the battery, because the energy is already spent by the time a request
arrives.

---

## Backend

Environment variables, or a secret file for anything sensitive. Nothing sensitive is
committed; `.env.example` carries names and descriptions only.

| Setting | Default | Notes |
| --- | --- | --- |
| `PUBLIC_HOSTNAME` | — | **Required, fails loudly if unset.** The certificate is issued for this name. No default can be right, and guessing would move the failure onto the tablet. |
| `HTTP_PORT` | 8443 | |
| `TLS_CERT_PATH` / `TLS_KEY_PATH` | — | If unset, a local CA and certificate are generated on first start |
| `TLS_CA_DOWNLOAD_PATH` | `/ca.crt` | Where the tablet fetches the CA certificate |
| `DATA_DIR` | `/data` | SQLite database; a Docker volume |
| `SNAPSHOT_DIR` | `/data/snapshots` | Volume |
| `SNAPSHOT_MAX_BYTES` | 2 MiB | Upload limit |
| `SNAPSHOT_RETENTION_DAYS` | 30 | Storage is finite |
| `MOTION_COOLDOWN_MS` | 60000 | Deduplication, not battery protection |
| `DEVICE_STALE_AFTER_MS` | 1800000 | Beyond this, state becomes `unreachable` |
| `MQTT_HOST` / `MQTT_PORT` | — / 1883 | |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | — | Secret file or environment |
| `MQTT_BASE_TOPIC` | `doorbell` | Also the escape hatch for schema versioning |
| `MQTT_RECONNECT_MAX_MS` | 60000 | Backoff ceiling |
| `LOG_LEVEL` | `info` | |

No `JANUS_URL` or `JANUS_AUTH`: the project brief lists them, but ADR-001 rejected Janus,
so they would be configuration for something that does not exist.

---

## Android app

| Setting | Default | Notes |
| --- | --- | --- |
| `BACKEND_URL` | — | **Required.** Entered during onboarding. |
| Credentials | — | Obtained at pairing, stored in Android's keystore |
| `RECONNECT_MAX_MS` | 30000 | Backoff ceiling for the WebSocket |
| `RING_TIMEOUT_MS` | 90000 | Must not outlast the device's wake window |

`RING_TIMEOUT_MS` should track `WAKE_WINDOW_MS`. A tablet still ringing after the device
has powered off invites the user to answer a call that cannot connect.

---

## Secrets

Never committed (AGENTS.md section 5).

| Secret | Where it lives | Where it must not |
| --- | --- | --- |
| MQTT username and password | Backend only | The device, the app, git |
| Device token | Device NVS and backend | git |
| TLS private key | Backend volume | git |
| Local CA private key | Backend volume | Anywhere else — it can sign for any name |
| Tablet session credentials | Android keystore | git |

The device holds exactly one secret, its own token, because it is the component an
attacker can physically reach (see [`../architecture.md`](../architecture.md) section 4).
