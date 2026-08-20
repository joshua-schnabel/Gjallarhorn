# ADR-002: MQTT architecture

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-19 |
| **Work package** | [WP-05](../planning/work-packages/WP-05-spike-mqtt.md) |

## Decision

**The backend publishes to MQTT. The device does not.**

```text
device --HTTP--> backend --MQTT--> broker --> Node-RED / Home Assistant
```

This is variant 1 of the project brief. The brief already stated a preliminary preference
for it on the grounds of keeping the firmware simple. That reasoning is sound but
secondary — the decisive argument is different, and it is set out below.

The topic schema, payloads and per-topic QoS and retain settings are in
[`../mqtt.md`](../mqtt.md).

---

## The decisive argument: a powered-off device cannot express availability

The device is **fully powered off between events** and cold-boots on every wake
([`constraints.md`](../planning/constraints.md)). MQTT availability semantics assume a
client that stays connected. Verified against Mosquitto 2.1.2 in a container:

**An ungraceful disconnect fires the Last Will.** A client connected with a will on
`doorbell/frontdoor/availability` was killed; the broker published `offline`:

```text
doorbell/frontdoor/availability  online     <- published by the client
doorbell/frontdoor/availability  offline    <- published by the broker, as the will
```

**A clean disconnect does not fire it.** The same client disconnecting normally left the
topic at `online`:

```text
doorbell/frontdoor/availability  online     <- and nothing further
```

Both behaviours are correct per the protocol. Together they leave a device that publishes
directly with only two options, and neither is acceptable:

| If the device… | Then… |
| --- | --- |
| disconnects cleanly before powering off | the will never fires, so `availability` stays `online` **while the device is physically dead**. The topic lies. |
| is cut mid-connection by the power latch | the will fires on **every normal cycle** — 20-plus times a day — so home automation sees a device that is constantly failing. |

Neither models the truth, which is *intentionally powered off and working correctly*.
There is no third option: the protocol has no way for a client to say "I am leaving on
purpose and will be back."

**Availability semantics only work if something stays connected, and by design that
cannot be the device.** The backend can: it holds a persistent session, publishes its own
truthful will for the bridge, and maintains the device's state as a separate retained
topic driven by event arrival and a staleness timeout. `sleeping` then means sleeping, and
`unreachable` means something is actually wrong.

This argument is a consequence of the power design in ADR-003's sibling decision, and it
would not apply to a mains-powered doorbell. It is worth stating explicitly, because
"backend publishes" is otherwise easy to mistake for mere convenience.

---

## Options considered

### Variant 1 — backend publishes — **chosen**

**For:**
- **Truthful availability**, per the argument above. This is the one that decides it.
- **Credentials stay on the server.** The device sits at the front door and is physically
  reachable; keeping broker credentials off it removes a class of attack. Flash Encryption
  would mitigate but not eliminate this, and it is better not to need the mitigation.
- **Topics change without reflashing.** The base topic is user-configurable per
  [`constraints.md`](../planning/constraints.md); doing that on the device would mean a
  firmware round trip for a naming preference.
- **One retry and logging path.** Event delivery already needs bounded retries and a
  local queue; adding a second independent delivery path would double that logic on the
  most constrained component.
- **No second connection on the wake path.** The device already opens HTTP to the
  backend. MQTT would add a TCP connect plus MQTT CONNECT before it could publish, on
  every cold boot.

**Against:**
- **The backend is in the critical event path.** If it is down, home automation learns
  nothing. Accepted, with reasoning below.

### Variant 2 — device publishes directly

**For:**
- Home automation keeps working when the backend is down.
- One less hop.

**Against:**
- **Availability cannot be expressed truthfully.** Decisive.
- Broker credentials on a physically accessible device.
- A second connection setup on every cold boot, paid in energy on every event.
- Topic changes require reflashing.
- Retry and queue logic duplicated on the device.

### Variant 3 — hybrid

Device publishes `ring` and `motion` directly; images and bulk data go over HTTP; the
backend publishes normalised events too.

**Against:**
- Inherits variant 2's availability problem for the topics the device owns.
- The brief itself flags the main risk: **duplicate events in home automation**.
  Preventing them means deduplication by event ID in every consumer, or a strict topic
  split that nobody may violate later. That is ongoing discipline in exchange for a
  benefit the MVP does not need.
- Two publishers for one logical device is hard to reason about when debugging.

---

## The accepted risk, and why it is acceptable

Variant 1 puts the backend in the path of every event. If the backend is down, the ring
does not reach Home Assistant.

This matters less than it first appears, because **when the backend is down the doorbell
is already degraded in ways MQTT cannot fix**:

- The snapshot upload fails, so there is no image.
- The tablet — the primary user interface — is served by and signals through the backend,
  so the live session cannot start either.
- The device has a bounded local queue and retries, so events are not lost, only delayed.

Home automation continuing to receive rings while the user can neither see nor speak to
the visitor is a narrow benefit. It does not justify making availability permanently
dishonest.

**Mitigations that are cheap and should be taken:**
- The backend is a single container with a restart policy and a health check; recovery is
  fast and automatic.
- The device queues events and retries with bounds, so a backend restart delays events
  rather than dropping them.
- The bridge availability topic makes backend downtime visible in home automation, so a
  missing ring is diagnosable rather than silent.

**If this risk ever becomes unacceptable**, the honest fix is not variant 2 but making the
backend more available. Revisiting is cheap: the device publishes nothing today, so
adding direct publishing later changes only the device, not the schema.

---

## Consequences

- The device speaks HTTP only. No MQTT client, no broker credentials, no second
  connection on the wake path.
- The backend holds a persistent MQTT session with a Last Will on the bridge topic.
- The backend owns device state and derives it from event arrival plus a configurable
  staleness timeout. It must not simply mirror connection state, because there is no
  device connection to mirror.
- **The backend stamps event timestamps.** A cold-booting device has no reliable wall
  clock until it syncs, and spending wake time on SNTP costs energy for a value the
  backend already has. The device supplies a monotonic uptime and its own event ID; the
  backend supplies the wall-clock time. This must match [WP-09](../planning/work-packages/WP-09-api-design.md).
- Event IDs are generated by the device and carried through to MQTT, so that retried
  uploads do not produce duplicate home-automation events.

### Home Assistant discovery

Home Assistant is planned but not yet installed. Topic and payload shapes are therefore
chosen to be discovery-friendly, but **discovery publishing is not implemented for the
MVP**. It is a small, self-contained addition once Home Assistant is actually running, and
building it now would be infrastructure ahead of requirement (AGENTS.md section 4).

Node-RED, which is in use today, needs no discovery.
