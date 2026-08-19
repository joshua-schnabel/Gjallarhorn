# ADR-001: WebRTC architecture

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-19 |
| **Work package** | [WP-04](../planning/work-packages/WP-04-spike-webrtc.md) |

## Decision

**Direct peer-to-peer WebRTC between the door device and the tablet, with signaling
implemented in our own backend against the `esp_peer_signaling_impl_t` interface.**

Janus is rejected for the MVP and kept as a documented later option. The abstraction that
makes this possible — signaling being a pluggable interface — is the same one that keeps
the Janus door open.

Media: **H.264 video** (device to tablet, one way) and **Opus audio** (both directions).

---

## Context

The device is **fully powered off between events** and cold-boots on every wake
([ADR context in `power-budget.md`](../power-budget.md)). Signaling and notification fan
out to several tablets, but media runs with exactly one at a time. The system is LAN-only
for the MVP, with remote access explicitly out of scope
([`constraints.md`](../planning/constraints.md)).

That reframes the comparison. The usual WebRTC trade-offs are about steady-state latency
and scaling to many subscribers. Here, neither is the binding constraint: **every session
begins with a cold boot**, and there is only ever one media peer.

---

## Verified findings

Established by reading `espressif/esp-webrtc-solution` at commit depth 1, 2026-08-19.
These correct or confirm what the initial documentation survey suggested.

### Codecs — the question that was open

`components/esp_peer/include/esp_peer.h`:

```c
ESP_PEER_VIDEO_CODEC_NONE  = 0,
ESP_PEER_VIDEO_CODEC_H264  = 1,
ESP_PEER_VIDEO_CODEC_MJPEG = 2,

ESP_PEER_AUDIO_CODEC_NONE  = 0,
ESP_PEER_AUDIO_CODEC_G711A = 1,   /* PCMA */
ESP_PEER_AUDIO_CODEC_G711U = 2,   /* PCMU */
ESP_PEER_AUDIO_CODEC_OPUS  = 3,
```

**Opus is supported.** This was the open question and it resolves favourably: ESP-side
H.264 + Opus matches browser-side H.264 + Opus with no transcoding and no codec
negotiation risk. `doorbell_local` selects Opus behind a `WEBRTC_SUPPORT_OPUS` build
option, falling back to G711A.

### Janus integration is publisher-only

`components/esp_webrtc/impl/janus_signal/janus_signaling.c` attaches to
`janus.plugin.videoroom` with `"ptype": "publisher"` and issues only `publish` and
`unpublish`. There is no subscriber handle and no `start` request.

**Confirmed from source: two-way audio via Janus does not exist as shipped.** The return
path (tablet microphone to device speaker) would require writing a VideoRoom subscriber
implementation. That is the single most consequential finding in this ADR, because
two-way audio is MVP acceptance criterion 10.

### Signaling is genuinely pluggable, and the interface is small

`components/esp_webrtc/include/esp_peer_signaling.h` defines a three-function vtable:

```c
typedef struct {
    int (*start)(esp_peer_signaling_cfg_t *cfg, esp_peer_signaling_handle_t *sig);
    int (*send_msg)(esp_peer_signaling_handle_t sig, esp_peer_signaling_msg_t *msg);
    int (*stop)(esp_peer_signaling_handle_t sig);
} esp_peer_signaling_impl_t;
```

with callbacks `on_ice_info`, `on_connected`, `on_msg`, `on_close`, and message types
`SDP`, `CANDIDATE`, `BYE`, `CUSTOMIZED`.

`doorbell_local` implements exactly this locally, in a single file
(`main/webrtc_http_server.c`), over HTTPS using SSE towards the browser and HTTP POST
back. **Writing our own implementation against our backend is a small, well-templated
job**, not a fork of the stack.

### Doorbell examples

- `doorbell_demo` — two-way audio, **one-way video** (device to browser). Defaults to
  Espressif's **hosted** signaling at `webrtc.espressif.com/doorbell`. Unusable as-is for
  a LAN-first product, but its media architecture is exactly what we need.
- `doorbell_local` — same media architecture, no external server, signaling on the device.
  Limits: **one peer at a time**, 5 s heartbeat.

Both are direct peer-to-peer. **Variants A and B are therefore not competing
architectures** — B *is* A, differing only in where signaling lives. Treating them as
alternatives, as the project brief does, conflates the media path with the signaling
path. The real decision is: direct P2P or a media server, and then, independently, where
signaling runs.

### Build and platform

- `idf: version: ">=5.0"`.
- `espressif/esp_h264 ~1.3` is pulled in for `esp32p4`, so the **hardware H.264 encoder
  is wired into the media pipeline** rather than being a separate integration job.
- `doorbell_local` defaults to **1920x1080 @ 25 fps** on P4 — far more than a
  battery-powered doorbell should send. To be reduced; see consequences.
- **Our board is not in `codec_board/board_cfg.txt`.** It lists `ESP32_P4_DEV_V14` and
  `ESP32_P4_EYE`, not the FireBeetle 2 P4. A board entry must be added. `ESP32_P4_EYE`
  is the closer template — it uses `in: {codec: DUMMY}` with a PDM-style I2S input and
  no audio codec chip, which matches our PDM microphone plus MAX98357A arrangement.

---

## Options considered

### A. Direct peer-to-peer, signaling in our backend — **chosen**

The device and the tablet establish a direct connection on the LAN. Our backend carries
SDP and ICE candidates, notifies the tablets, and authenticates both ends.

**For:**
- **Two-way audio works as shipped.** No new protocol code on the device.
- **Fewest steps between wake and first frame.** On a LAN, ICE resolves with host
  candidates; no STUN, no TURN, no relay. This matters more than usual because the
  session-setup budget is already dominated by cold boot.
- **Codecs line up end to end**: H.264 + Opus on both sides, no transcoding.
- **The backend already has to exist** for events, snapshots and telemetry. Signaling is
  a small addition to it, and it is the natural place for tablet authentication and for
  the multi-tablet notification fan-out.
- **Least operational surface**: no extra container, no UDP port range, no Docker
  networking mode that quietly breaks media.
- Media is DTLS-SRTP with fingerprints exchanged in SDP, so the self-signed-certificate
  question in [WP-06](../planning/work-packages/WP-06-client-platform.md) affects the
  *page origin*, not the media path.

**Against:**
- One media peer at a time. Matches the constraint, but it is a real ceiling.
- No remote access without adding TURN later.
- We write and maintain the signaling implementation — roughly one file on each side.

### B. Espressif doorbell architecture

Not a distinct media architecture; see above. Adopted in substance: we take the media
pipeline of `doorbell_demo` / `doorbell_local` and replace their signaling.

`doorbell_demo`'s hosted signaling is rejected — a LAN-first product must not depend on
a vendor's cloud endpoint. `doorbell_local`'s on-device signaling is rejected as the
primary path because it caps at one peer, puts tablet authentication on the device, and
would have every tablet talk to the door device directly. It remains interesting as a
**fallback if the backend is unreachable**, and is noted as a possible later addition.

### C. Janus WebRTC Server

`ESP <-> Janus <-> tablet`, with Janus as a dedicated media service and application
logic staying in our backend.

**For:**
- Fan-out to many subscribers, recording, and a clean path to remote access via TURN.
- Decouples the device from the number of viewers.
- VideoRoom supports H.264 and Opus, so codecs can be made to line up.

**Against, decisively for this MVP:**
- **The ESP integration is publisher-only.** Return audio would require implementing a
  VideoRoom subscriber on the device — the largest single piece of new protocol work in
  any option here, in service of a requirement the direct path already satisfies.
- **Its strengths are not MVP requirements.** One viewer, no recording, no remote access.
- **It adds setup steps to the most expensive part of the budget**: create session,
  attach plugin, join room, publish, then the tablet subscribes — all after a cold boot.
- **Operational cost**: another container, a UDP media port range, ICE configuration, and
  Docker networking that commonly breaks WebRTC in exactly this deployment shape.
- Introducing it now would be infrastructure ahead of requirement (AGENTS.md section 4).

**Not tested at runtime.** Docker Desktop was not running on the development machine, so
the planned container interop test did not happen. This is a real gap, and it is recorded
rather than papered over. It does not change the decision: the blocking finding against
Janus is the publisher-only integration, which is established from source and is not a
runtime question.

---

## Consequences

### What we build

- A signaling implementation on the device against `esp_peer_signaling_impl_t`, modelled
  on `doorbell_local/main/webrtc_http_server.c` but pointed at our backend.
- Signaling endpoints in the backend, carrying SDP and ICE candidates, plus tablet
  notification fan-out and authentication for both ends.
- A `codec_board` entry for the FireBeetle 2 P4, using `ESP32_P4_EYE` as the template.

### Settings to revisit for energy

The 1920x1080 @ 25 fps default is a demo setting, not a product one. Resolution, frame
rate and bitrate are configurable parameters with sensible defaults, and their defaults
should be chosen against the power budget rather than inherited. Every second of live
session costs roughly 0.11 mAh at the assumed 250 mA; halving the encode load is directly
visible in daily consumption.

Opus versus G711A is a genuine trade-off to measure rather than assume: Opus is better
quality at lower bitrate, so less radio time, but costs CPU to encode. Both are supported;
the build option makes the comparison cheap.

### Latency expectation

Time to first frame is dominated by the cold boot, not by WebRTC. The assumed ~5 s
wake-to-network is the largest term and the least certain input in the whole model.

This suggests a product move worth taking: **the snapshot is already being captured, so
show it on the tablet immediately while WebRTC negotiates.** The user sees the visitor in
roughly the time it takes to upload one image, and the live stream replaces it when ready.
That hides most of the setup latency for free.

### What stays open

- Remote access would need TURN, or Janus. The signaling abstraction means that decision
  is not foreclosed — but nothing is built for it now.
- More than one simultaneous viewer would need an SFU. Same reasoning.
- The Janus container interop test is unperformed. If the maintainer wants it done before
  this ADR is considered settled, Docker Desktop needs to be running and it is roughly an
  hour's work.

---

## Follow-up work

Recorded so it is not lost between here and Phase 4:

1. Add the FireBeetle 2 P4 board entry to `codec_board`.
2. Choose default resolution, frame rate and bitrate against the power budget.
3. Measure Opus versus G711A: CPU, bitrate, and net effect on session energy.
4. Confirm PSRAM and heap headroom on the board's 32 MB at the chosen resolution.
5. Define the backend signaling API — feeds [WP-09](../planning/work-packages/WP-09-api-design.md).
6. Decide what the other tablets show once one answers — feeds ADR-003.
