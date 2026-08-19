# ADR-003: Client platform

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-19 |
| **Work package** | [WP-06](../planning/work-packages/WP-06-client-platform.md) |

## Decision

**A browser-based web application, served by the backend over HTTPS, running full-screen
on the Pixel Tablet.**

Not a native Android app, and — deliberately — **not a PWA in the installable sense**.
The distinction matters and is explained below.

---

## What the MVP actually requires

The project brief, section 24:

> When the tablet application is open, a doorbell event must become visible immediately.

**Only while open.** There is no requirement for background notification, for waking a
dark screen, or for push while the app is closed. That single sentence removes the
strongest argument for a native app, so it is worth checking against the maintainer rather
than reading past — it is called out in the open questions below.

The views required (brief section 23) are a status home page, a ring view with live video
and audio controls, and a history list. All are ordinary web UI.

---

## The certificate question, resolved

[`constraints.md`](../planning/constraints.md) sets self-signed certificates as the
default so a new user can start without a CA, while noting a suspected conflict with
microphone access. WP-06 was to resolve it. It resolves better than feared, and the
resolution is a clean split:

| Capability | On a self-signed origin the user has accepted |
| --- | --- |
| `getUserMedia` — microphone for two-way audio | **Works.** The origin remains a secure context after the user proceeds past the interstitial. |
| WebRTC, DTLS-SRTP media | **Works.** Media security is independent of page-certificate trust. |
| Service worker registration | **Blocked.** Chrome refuses to register a service worker on an origin with a certificate error. |
| PWA install, offline caching, web push | **Blocked**, since all of them require a service worker. |

**So the self-signed default does not block two-way audio.** It blocks installability —
which the MVP does not need, because the requirement is "visible while open".

This is documented and reported browser behaviour, **not yet tested on the actual Pixel
Tablet**. It is the first thing to verify in Phase 3, and it is cheap to verify.

### Consequence for the design

Build a **web application, not a PWA**. Do not depend on a service worker for anything on
the critical path. Ring notification arrives over a live connection from the backend
(SSE or WebSocket) while the page is open, which needs no service worker at all.

This keeps the self-contained default genuinely working out of the box, and it avoids
building on a foundation that the default deployment removes.

### The documented upgrade

The maintainer has a CA and can install a certificate on the tablet. Doing so removes the
interstitial — which otherwise reappears after a browser restart and is a real annoyance
on a wall tablet — and unlocks installability if it is ever wanted. This is step two in
[`constraints.md`](../planning/constraints.md), and it is a genuine improvement rather
than a workaround. Document it; do not require it.

---

## Options considered

### Web application served by the backend — **chosen**

**For:**
- Meets every stated MVP requirement, including two-way audio, on the self-signed default.
- WebRTC and `getUserMedia` are first-class in Chrome on Android 14.
- Distribution is a URL. No build signing, no store, no install step, no update mechanism
  to maintain.
- One codebase, and it is the same TypeScript as the backend, so event and API types can
  be shared rather than restated.
- Nothing to reinstall when the tablet is replaced or reset.

**Against:**
- **Cannot wake a dark screen.** The Screen Wake Lock API keeps a screen on; it cannot
  turn one on. See the limitation below.
- Certificate interstitial after browser restarts, until the CA is trusted.
- Depends on the browser staying in the foreground.

### Native Android application

**For:**
- Can wake the screen with a full-screen intent, and can notify while closed.
- Kiosk and background behaviour under app control.
- Survives the browser being backgrounded.

**Against:**
- Solves problems the MVP does not have, at the cost of a second toolchain, signing,
  installation and an update path — infrastructure ahead of requirement
  (AGENTS.md section 4).
- Slower to iterate during Phase 3, when the UI is changing most.
- Would still talk to the same backend API over the same WebRTC, so nothing is learned
  earlier by building it now.

**Not rejected permanently.** See below.

---

## The limitation to be explicit about

**A web page cannot turn on a dark screen.** If the tablet's display is off when someone
rings, the browser can play audio and update the page, but the screen stays dark until
someone touches it.

Two ways to live with this, both acceptable for a docked tablet on mains power:

1. **Keep the display on.** The tablet is on a stand and permanently powered. A
   `WakeLock` held by the page, plus Android's display settings, keeps the ring view
   visible. This is the assumed deployment.
2. **Audible alert.** Sound draws attention regardless of the screen, and audio playback
   is permitted once the page has had any user interaction — which a kiosk page gets at
   startup.

**This limitation is the one thing that would overturn this ADR.** If "the screen must
wake itself on a ring" becomes a requirement, no web application can satisfy it and the
client must become native. Recording it here so that the trigger is recognised rather than
rediscovered.

---

## Consequences

- The client is a single-page web application in TypeScript, served by the backend over
  HTTPS.
- **No service worker on any critical path.** If one is ever added for convenience, the
  application must remain fully functional without it.
- Ring notification uses a live backend connection while the page is open. SSE is
  sufficient and simpler than WebSocket for a one-way event stream; the signaling path
  in ADR-001 needs bidirectional exchange and can use its own transport. Final choice
  belongs to [WP-09](../planning/work-packages/WP-09-api-design.md).
- The page requests a screen wake lock while it is in the foreground.
- Audio autoplay is unlocked by the initial user interaction at kiosk startup; the UI must
  not assume it can play sound before any interaction has happened.
- **Several tablets may be notified; only one takes the media session** — the others must
  show that the call was answered elsewhere rather than failing silently or hanging.
- The tablet authenticates to the backend. Mechanism belongs to WP-09.

---

## Open questions

- **Is "visible only while open" really acceptable?** The brief says so, and this ADR
  rests on it. On a docked tablet with the display on it is a reasonable product. If the
  expectation is really "the tablet is dark and the doorbell wakes it", say so now — that
  is the native trigger, and it is much cheaper to know before Phase 3 than after.
- Should a second tablet be able to *take over* a call, or only observe that it was
  answered? Interacts with the single-media-peer constraint in ADR-001.
- Does the history view need to work when the backend is down? With no service worker
  there is no offline cache, so the answer today is no.
