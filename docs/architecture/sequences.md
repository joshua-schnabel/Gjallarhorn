# Sequence diagrams

The three core flows, plus the failure paths that shape them.

Read [`../architecture.md`](../architecture.md) first for the component picture.

---

## 1. Doorbell ring

```mermaid
sequenceDiagram
    participant B as Button
    participant L as Power latch
    participant D as Door device
    participant S as Backend
    participant Q as MQTT broker
    participant A as Android service
    participant U as WebView UI

    B->>L: press (debounced in hardware)
    L->>D: power on
    activate D
    D->>D: boot, read wake reason

    par camera and network start together
        D->>D: init camera, capture snapshot
    and
        D->>D: associate Wi-Fi (C6 over SDIO)
    end

    D->>S: POST /events {type:ring, id, uptime, battery, rssi}
    S->>S: persist, stamp wall-clock time
    S->>Q: publish event/ring (QoS 1, no retain)
    S->>Q: publish state = awake (retained)
    S-->>A: WebSocket: ring {eventId}
    A->>A: full-screen intent — screen on, app to front
    A->>U: show ring view

    D->>S: POST /snapshots (multipart)
    S-->>A: WebSocket: snapshot ready {snapshotId}
    A->>U: show still image immediately
    Note over U: the visitor is visible here,<br/>before WebRTC has negotiated

    D->>S: open signaling channel (held for wake window)

    U->>S: accept call
    S->>D: signaling: peer waiting
    D-->>S: SDP offer
    S-->>U: SDP offer
    U-->>S: SDP answer
    S-->>D: SDP answer
    D<<->>U: ICE candidates via backend

    D->>U: WebRTC media — H.264 video, Opus audio
    U->>D: WebRTC media — Opus audio
    Note over D,U: direct, does not traverse the backend

    U->>S: hang up
    S->>D: signaling: BYE
    D->>S: POST /telemetry (final)
    S->>Q: publish state = sleeping (retained)
    D->>L: release latch
    deactivate D
    L-->>D: power off
```

**Why the snapshot appears before the video.** Time to first frame is dominated by the
cold boot, not by WebRTC. The snapshot is being captured anyway, so showing it the moment
it arrives puts the visitor on screen while negotiation is still running. This costs
nothing and hides most of the setup latency (ADR-001).

**Why camera and Wi-Fi start in parallel.** Both are on the critical path and neither
depends on the other. Serialising them would add roughly three seconds of camera warm-up
to every activation, paid in energy as well as latency.

---

## 2. Motion

```mermaid
sequenceDiagram
    participant P as PIR
    participant L as Power latch
    participant D as Door device
    participant S as Backend
    participant Q as MQTT broker
    participant A as Android service

    P->>L: rising edge
    L->>D: power on
    activate D
    D->>D: boot, wake reason = motion

    par
        D->>D: init camera, capture snapshot
    and
        D->>D: associate Wi-Fi
    end

    D->>S: POST /events {type:motion, id, ...}
    S->>S: persist, apply server-side cooldown
    alt within cooldown window
        S-->>D: 200 accepted, deduplicated
        Note over S: stored, but not republished
    else outside cooldown
        S->>Q: publish event/motion (QoS 1, no retain)
        S-->>A: WebSocket: motion {eventId}
        Note over A: history updates —<br/>no full-screen intent, no ring
    end

    D->>S: POST /snapshots
    D->>S: POST /telemetry
    D->>L: release latch
    deactivate D
    L-->>D: power off

    Note over P,L: PIR output stays high for its hold time.<br/>No rising edge, so no re-activation.<br/>This is the real cooldown.
```

**Motion must not ring.** The full-screen intent is reserved for the button. A motion
event that seized the screen would make the tablet unusable on a windy day — and would
train the user to ignore it.

**The cooldown is hardware.** See [`../architecture.md`](../architecture.md) section 6.
The server-side cooldown that appears here protects the event history from duplicates; it
cannot protect the battery, because by the time the request arrives the energy is spent.

---

## 3. Live session

```mermaid
sequenceDiagram
    participant D as Door device
    participant S as Backend
    participant A1 as Tablet 1
    participant A2 as Tablet 2

    Note over D: already awake, inside the wake window
    D->>S: signaling channel open

    S-->>A1: ring
    S-->>A2: ring
    A1->>A1: screen on, ring view
    A2->>A2: screen on, ring view

    A1->>S: accept
    S->>S: claim session — first accept wins
    S-->>A2: answered elsewhere
    A2->>A2: dismiss ring view

    S->>D: peer waiting
    D-->>S: SDP offer
    S-->>A1: SDP offer
    A1-->>S: SDP answer
    S-->>D: SDP answer

    par ICE, host candidates only on a LAN
        D-->>S: candidate
        S-->>A1: candidate
        A1-->>S: candidate
        S-->>D: candidate
    end

    D->>A1: video + audio
    A1->>D: audio

    alt user hangs up
        A1->>S: hang up
        S->>D: BYE
    else wake window expires
        S->>A1: session ending
        D->>D: window timeout
    else tablet disappears
        S->>S: WebSocket closed
        S->>D: BYE
    end

    D->>S: POST /telemetry
    D->>D: release latch, power off
```

**First accept wins.** Several tablets are notified but only one holds media
([`../planning/constraints.md`](../planning/constraints.md)). The others are told
explicitly that the call was answered — a ring view that simply stops is
indistinguishable from a broken app.

**Every ending leads to the same place.** Hang-up, timeout and disconnection all converge
on teardown and power-off. There is no path where the device stays awake because nobody
told it to stop.

---

## 4. Failure paths

The brief lists nine failure situations. The ones that shape the design:

### Backend unreachable

```mermaid
sequenceDiagram
    participant D as Door device
    participant S as Backend

    D->>S: POST /events
    S--xD: timeout
    loop bounded retries with backoff
        D->>S: POST /events (same event id)
        S--xD: timeout
    end
    D->>D: queue event locally (bounded)
    D->>D: release latch, power off
    Note over D: retried on the next activation,<br/>with the original event id
```

**It gives up and sleeps.** An unbounded retry loop against a dead server is the most
expensive thing this device could do. The event is not lost — it is queued, with its
original ID so the eventual delivery does not duplicate.

The queue is bounded and drops oldest-first when full. A server outage must not fill the
flash.

### Live session setup fails

ICE fails, or the tablet never answers. The device holds the signaling channel until the
wake window expires, then tears down and powers off. **The wake window is the backstop for
every live-session failure** — there is no separate error path that could itself hang.

### No one answers the ring

The wake window expires, the device powers off, and the backend publishes state
`sleeping`. The tablets show a missed ring. The snapshot is already stored, so the user
sees who called.

### Backend restarts mid-session

The signaling channel drops. The device's wake window continues and expires normally.
Media already established would survive briefly — it is direct — but signaling and
teardown are gone, so the session ends at the window boundary rather than cleanly.
Acceptable: the backend is a single container with a restart policy, and the device
protects itself with the window.

### Device stops responding while awake

A watchdog forces power-off at the maximum awake time regardless of state. This is the
last line of defence for the battery and it is unconditional; see
[`firmware-state-machine.md`](firmware-state-machine.md).
