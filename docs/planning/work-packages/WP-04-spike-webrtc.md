# WP-04: WebRTC architecture spike

| | |
| --- | --- |
| **Status** | done |
| **Phase** | 0 |
| **Depends on** | WP-03 (done) |
| **Blocks** | WP-08, Phase 4, Phase 5 |

## Goal

Decide how live video and two-way audio are carried, by evaluating the three variants in
the project brief against what the ESP32-P4 and Espressif's components actually support.
The decision must not be pre-committed to Janus or to direct peer-to-peer.

## Starting knowledge

Verified during initial research, to be confirmed against the cloned source rather than
taken on trust:

- The repository is [`espressif/esp-webrtc-solution`](https://github.com/espressif/esp-webrtc-solution),
  with components `esp_webrtc`, `esp_peer`, `esp_capture`, `av_render`.
- **Signaling is pluggable.** `esp_peer_signaling` is an abstract interface and
  `components/esp_webrtc/impl/` contains `apprtc_signal`, `janus_signal`,
  `kvs_signaling`, `whip_signal`. Writing our own implementation against our backend is
  the intended path, not a fork.
- `doorbell_demo` uses AppRTC-style WebSocket signaling and gives two-way audio with
  **one-way video** (device to browser). It defaults to Espressif's **hosted** signaling
  server at `webrtc.espressif.com/doorbell`, which a LAN-first product cannot adopt.
- `doorbell_local` needs **no external server**: it runs HTTPS signaling on the device
  itself, SSE towards the browser and HTTP POST back. Two-way audio, one-way video,
  optional person detection via ESP-DL. Limits: **one peer at a time**, 5 s heartbeat
  timeout.
- `janus_demo` uses the VideoRoom plugin over **HTTP** signaling, with the ESP acting as
  **publisher only** — no subscribe path, so no return audio out of the box.
- The ESP32-P4 has a **hardware H.264 encoder** (up to 1080p30, YUV420, CAVLC).
- Janus VideoRoom supports video vp8/vp9/**h264**/av1/h265 (default vp8) and audio
  **opus**/g722/pcmu/pcma (default opus); both are configurable.

## Tasks

### Establish the facts
- [ ] Clone `esp-webrtc-solution` and read it. Confirm every claim above against source.
- [ ] Find the actual audio and video codec enums — they are **not** in
      `esp_peer_types.h`, which holds only error and role enums. Determine specifically
      whether **Opus** is supported or only G.711.
- [ ] Determine which chips and which ESP-IDF version the components require, and whether
      the FireBeetle board is usable or whether the examples assume the
      ESP32-P4-Function-EV-Board
- [ ] Confirm the H.264 encoder is actually wired into `esp_capture`, and at what
      resolution and bitrate it is practical for this use case
- [ ] Check PSRAM and heap requirements against the board's 32 MB

### Evaluate the variants
- [ ] **Variant A, direct peer-to-peer**: latency, complexity, signaling, ICE on a LAN,
      behaviour with no internet, browser compatibility, two-way audio, H.264
      compatibility, energy cost of connection setup, reconnect time
- [ ] **Variant B, Espressif doorbell architecture**: which parts are reusable, which are
      demo-specific, whether the signaling can be self-hosted, how well it fits a local
      Docker backend. Evaluate `doorbell_local` as well as `doorbell_demo` — its
      on-device signaling removes a server but caps concurrency at one peer.
- [ ] **Variant C, Janus**: VideoRoom and any better-fitting plugin, H.264 and audio
      codec interop, whether the ESP can subscribe as well as publish (required for
      return audio), signaling transport, session lifecycle, reconnect, Docker
      operation, UDP port ranges, ICE and STUN/TURN, LAN-only operation, later remote use

### Test rather than assume
- [ ] Run Janus in a container and verify browser interop with H.264 and the audio codec
      the ESP actually supports
- [ ] If the ESP audio codec is G.711 and Janus defaults to Opus, determine whether
      configuring the room resolves it or whether transcoding is needed — this is a
      likely decision point
- [ ] Measure connection setup time and end-to-end latency for the leading variant

### Decide
- [ ] Weigh each variant on: development effort, stability, latency, energy, browser
      support, two-way audio, video, maintainability, LAN-only operation, later remote
      capability, Docker operation, debuggability
- [ ] Give one clear recommendation

## Deliverables

- `docs/adr/ADR-001-webrtc-architecture.md`

## Acceptance

- All three variants are evaluated against every criterion in the project brief
  section 7. None is dismissed for merely looking complex.
- Two-way audio is confirmed as achievable in the recommended variant, with evidence —
  this is acceptance criterion 10 of the MVP and the point where `janus_demo`'s
  publisher-only design bites.
- Codec compatibility between the ESP, the chosen server (if any) and the browser is
  established from source or from a working test, not from documentation alone.
- The energy cost of connection setup is stated using WP-03 measurements.
- The ADR gives one unambiguous recommendation and records why the alternatives lost.
- Verified facts, assumptions and open questions remain distinguishable throughout.

## Constraints now fixed

WP-03 and the maintainer have settled what this package was waiting on. See
[`../constraints.md`](../constraints.md).

- **The device is fully powered off between events.** No architecture requiring a
  persistent signaling connection is viable. Every session pays a cold boot plus C6 boot
  plus Wi-Fi association before ICE even begins - assumed at ~5 s, and the largest term
  in the time-to-first-frame budget. Evaluate the variants on *connection setup from
  cold*, not on steady-state latency.
- **Signaling and notification fan out to several tablets; media runs with one at a
  time.** This rules out `doorbell_local`'s on-device signaling as a complete answer -
  it accepts exactly one peer - and points towards backend-mediated signaling with
  notification fan-out. Its SSE-plus-POST design is still worth reading as a model for
  our own implementation against `esp_peer_signaling`.
- **Video is one-way**, device to tablet, in both Espressif doorbell examples. That is
  what the product needs, so it is not a defect.

## Open questions

- How long may connection setup take before a ring feels broken? This is a product
  question and it bounds the acceptable architecture - a cold boot plus ICE plus DTLS
  may already spend most of the budget.
- Should the snapshot double as the first thing the tablet shows, so the user sees the
  visitor while WebRTC is still negotiating? That would hide most of the setup latency
  and is nearly free, since the snapshot is being captured anyway.
- Does the return audio path require Opus, or will G.711 do? It affects Janus room
  configuration and browser interop, and the ESP side's actual codec support is the
  first thing to establish from source.
