# Tablet WebSocket protocol

The tablet's connection to the backend. Documented here rather than in
[`openapi.yaml`](openapi.yaml) because OpenAPI cannot express a bidirectional stream.

This is the connection that makes the doorbell work. The Android foreground service holds
it open continuously so that a ring can reach a tablet whose screen is off
([ADR-003](../adr/ADR-003-client-platform.md)).

---

## Connection

```text
wss://<host>:<port>/api/v1/ws
```

Authenticated with the client token from `POST /auth/pair`, sent as a bearer token during
the upgrade request. An unauthenticated upgrade is refused with `401` — the token is not
accepted as a query parameter, because query strings end up in logs.

One connection per client. A second connection with the same client identity replaces the
first, which is what happens naturally when Android restarts the service.

---

## Framing

Every frame is a JSON object with a `type` field.

```json
{ "type": "ring", "eventId": "01J8F3QK7XB2N4ZZZZZZZZZZZZ", "deviceId": "frontdoor" }
```

Unknown `type` values are ignored rather than treated as errors, so that a newer backend
can add message types without breaking an older app.

---

## Server to client

| Type | Meaning | App behaviour |
| --- | --- | --- |
| `hello` | Sent on connect; carries server time and protocol version | Reconcile clock skew for display |
| `ring` | Doorbell pressed | **Full-screen intent**: screen on, app to front, ring view |
| `motion` | Motion detected | Update history. **No full-screen intent.** |
| `snapshot` | Snapshot stored and available | Show the still image immediately |
| `device-state` | Device state changed | Update status display |
| `session-claimed` | Another client took the call | Dismiss the ring view |
| `session-ended` | Live session over | Return to the status view |
| `signaling` | SDP or ICE relayed from the device | Feed to the peer connection |
| `ping` | Keepalive | Reply with `pong` |

**Motion must never raise a full-screen intent.** A tablet that seizes the screen for
every passing cat is a tablet whose user disables notifications — and then misses the
actual doorbell.

## Client to server

| Type | Meaning |
| --- | --- |
| `pong` | Keepalive reply |
| `signaling` | SDP or ICE for the device |
| `ack` | Acknowledges a `ring`, so the backend can record which tablets actually saw it |

Claiming and ending a session go over REST (`/live/start`, `/live/stop`), not this
socket. They are state-changing operations that need a clear success or failure response,
and `409 Conflict` on a lost race is more honest than an asynchronous message that may or
may not arrive.

---

## Signaling frames

Signaling frames carry the same `SignalingMessage` shape as the device side of the REST
API, so both ends of the relay speak one vocabulary:

```json
{
  "type": "signaling",
  "sessionId": "s_01J8F3QK",
  "message": {
    "type": "answer",
    "sdp": "v=0\r\no=- ..."
  }
}
```

The backend relays without interpreting. It does not parse SDP, rewrite candidates, or
hold media state — per [ADR-001](../adr/ADR-001-webrtc-architecture.md), media goes
directly between device and tablet and the backend only makes the introduction.

---

## Keepalive and reconnection

**Keepalive.** The server sends `ping` every 30 seconds; a client that misses two
consecutive pings should assume the connection is dead and reconnect. Relying on TCP to
notice is not enough — a Wi-Fi handover can leave a socket that looks open and delivers
nothing, which on a doorbell means silently missing rings.

**Reconnection** uses exponential backoff from 1 s to a ceiling of `RECONNECT_MAX_MS`
(default 30 s), with jitter. Bounded, per the project's retry rules.

**The connection state must be visible in the UI.** A doorbell app that quietly lost its
connection is broken in the worst possible way: it looks fine and never rings. The status
view shows disconnection explicitly, and the foreground service notification reflects it
too.

---

## What the app misses while disconnected

Nothing is replayed. If a ring happens while the tablet is disconnected, the app does not
learn about it as a ring — it appears in the history on reconnect, like a missed call.

This is deliberate. Replaying a ring that happened four minutes ago would put a live-call
UI on screen for a device that has long since powered off, and the user would answer a
call that cannot connect. The event history is the record; the WebSocket is for things
happening now.
