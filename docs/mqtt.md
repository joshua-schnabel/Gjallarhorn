# MQTT specification

Topic schema, payloads, and per-topic QoS and retain behaviour.

The publishing architecture — the backend publishes, the device does not — is decided in
[`adr/ADR-002-mqtt-architecture.md`](adr/ADR-002-mqtt-architecture.md).

Verified against Mosquitto 2.1.2.

---

## 1. Configuration

Every value here is a default, and every default is configurable
([`planning/constraints.md`](planning/constraints.md)).

| Setting | Default | Notes |
| --- | --- | --- |
| `MQTT_BASE_TOPIC` | `doorbell` | Root of the whole tree |
| `MQTT_HOST` / `MQTT_PORT` | — / `1883` | Broker address |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | — | From environment or secret file, never committed |
| `DEVICE_ID` | `frontdoor` | Appears in every device topic |
| `DEVICE_STALE_AFTER` | `30 min` | Beyond this with no contact, state becomes `unreachable` |

---

## 2. Topic tree

```text
doorbell/
├── bridge/
│   └── availability            online | offline     (backend's own Last Will)
└── frontdoor/
    ├── availability            online | offline     (is the device reachable at all)
    ├── state                   sleeping | awake | live | unreachable
    ├── event/
    │   ├── ring
    │   └── motion
    ├── battery
    └── telemetry
```

Two separate ideas are deliberately kept apart:

- **`bridge/availability`** is the backend's real MQTT connection state, maintained by the
  broker through the Last Will. If this says `offline`, nothing else in the tree is
  current.
- **`frontdoor/state`** is what the *device* is doing, derived by the backend from event
  arrival and the staleness timeout. It is not a connection state, because the device
  holds no connection — see ADR-002.

Without this split there is no way to distinguish "the doorbell is asleep, as designed"
from "the backend died and nobody knows anything".

---

## 3. QoS and retain

| Topic | QoS | Retain | Reasoning |
| --- | :---: | :---: | --- |
| `bridge/availability` | 1 | **yes** | A subscriber connecting later must learn the bridge is down. Set as the Last Will. |
| `<device>/availability` | 1 | **yes** | Current reachability must survive a consumer restart. |
| `<device>/state` | 1 | **yes** | The current value *is* the truth; a late subscriber needs it immediately. |
| `<device>/event/ring` | 1 | **no** | See below. |
| `<device>/event/motion` | 1 | **no** | See below. |
| `<device>/battery` | 1 | **yes** | Last known reading stays meaningful; the device reports rarely. |
| `<device>/telemetry` | 1 | **yes** | Same. |

### Why events must not be retained

Verified: a retained message is redelivered to every late subscriber, a non-retained one
is not.

```text
published:  <device>/state       {"state":"sleeping"}   retained
published:  <device>/event/ring  {"event":"ring",...}   not retained

a new subscriber then receives:
            <device>/state       {"state":"sleeping"}
            (and nothing else)
```

If `event/ring` were retained, **every Home Assistant restart would replay the last ring**
and re-trigger whatever automation is attached to it — lights, notifications, a chime at
three in the morning. Events are facts about a moment; states are facts about now. Only
states get retained.

### Why QoS 1 and not QoS 2

QoS 1 is at-least-once, so a message can arrive twice. That is handled by the `id` field:
every event carries a device-generated identifier, and consumers deduplicate on it. This
is needed regardless, because the device retries uploads from its local queue.

QoS 2 costs four round trips for exactly-once delivery that the `id` field already
provides more cheaply, and it is delivery-level only — it would not protect against the
device's own retry path.

---

## 4. Payloads

JSON throughout. Every payload carries `schemaVersion`, `deviceId` and `timestamp`.

**Timestamps are UTC ISO 8601, stamped by the backend.** A cold-booting device has no
reliable wall clock, and spending wake time on SNTP costs energy for a value the backend
already has. The device supplies `deviceUptimeMs` instead, which is useful for diagnosing
boot behaviour.

### `event/ring`

```json
{
  "schemaVersion": 1,
  "deviceId": "frontdoor",
  "event": "ring",
  "id": "01J8F3QK7XB2N4",
  "timestamp": "2026-08-19T12:00:00Z",
  "deviceUptimeMs": 4820,
  "batteryVoltage": 3.91,
  "rssi": -61,
  "snapshotId": "01J8F3QK80ZZ1A"
}
```

`snapshotId` is present when an image was captured with the event, and absent otherwise.

### `event/motion`

```json
{
  "schemaVersion": 1,
  "deviceId": "frontdoor",
  "event": "motion",
  "id": "01J8F3R2M9C7P1",
  "timestamp": "2026-08-19T12:04:11Z",
  "deviceUptimeMs": 3900,
  "batteryVoltage": 3.90,
  "rssi": -63,
  "snapshotId": "01J8F3R2MA4KD2"
}
```

### `state`

```json
{
  "schemaVersion": 1,
  "deviceId": "frontdoor",
  "state": "sleeping",
  "timestamp": "2026-08-19T12:04:19Z",
  "lastSeen": "2026-08-19T12:04:11Z",
  "lastEvent": "motion"
}
```

| State | Meaning |
| --- | --- |
| `sleeping` | Powered off between events. **The normal, healthy state.** |
| `awake` | Within a wake window, reachable |
| `live` | In a live session |
| `unreachable` | No contact for longer than `DEVICE_STALE_AFTER` — the state that means something is wrong |

### `battery`

```json
{
  "schemaVersion": 1,
  "deviceId": "frontdoor",
  "voltage": 3.91,
  "percent": 78,
  "timestamp": "2026-08-19T12:04:11Z"
}
```

`percent` is derived from voltage and is an estimate; `voltage` is the measurement. Both
are published so consumers can choose.

### `telemetry`

```json
{
  "schemaVersion": 1,
  "deviceId": "frontdoor",
  "timestamp": "2026-08-19T12:04:11Z",
  "deviceUptimeMs": 3900,
  "wakeReason": "motion",
  "bootCount": 1043,
  "rssi": -63,
  "freeHeapBytes": 4212288,
  "wakeToNetworkMs": 4180,
  "uploadMs": 820
}
```

`wakeToNetworkMs` is not incidental. It is the least certain input in
[`power-budget.md`](power-budget.md), it costs nothing but a timestamp to report, and
collecting it over time turns an assumption into data.

### `availability` and `bridge/availability`

Plain string payloads, `online` or `offline`, not JSON. Home Assistant's availability
handling expects exactly this, and using JSON here would mean configuring a value template
for no benefit.

---

## 5. Versioning

Two mechanisms, for two kinds of change:

**Additive changes** — a new optional field — bump nothing. Consumers ignore what they do
not know.

**Breaking changes** — a renamed or removed field, or a restructured tree — increment
`schemaVersion` and, if the topic tree itself changes, run under a different
`MQTT_BASE_TOPIC`. Since the base topic is already configurable, both schemas can be
published in parallel during a migration, and consumers move over at their own pace.

**Why the version is not in the topic path.** A `doorbell/v1/frontdoor/...` layout puts a
version between the root and the device in every wildcard subscription, complicates Home
Assistant discovery paths, and pays that cost permanently for a migration that may never
happen. The configurable base topic already provides the escape hatch, without the
standing cost.

---

## 6. Testing

Verified with Mosquitto 2.1.2 in a container:

- Retained topics are redelivered to late subscribers; non-retained ones are not.
- The Last Will fires on ungraceful disconnect and does **not** fire on clean disconnect —
  which is what makes device-published availability impossible, see ADR-002.

Still to verify when the components exist:

- Schema validation of every payload against the documented shape.
- Duplicate suppression by `id` under a forced device retry.
- Behaviour of the staleness timeout across a backend restart: `state` must not flap to
  `unreachable` merely because the backend restarted while the device was legitimately
  asleep.
