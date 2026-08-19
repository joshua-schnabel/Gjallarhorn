# WP-06: Client platform decision

| | |
| --- | --- |
| **Status** | done |
| **Phase** | 0 |
| **Depends on** | WP-01 |
| **Blocks** | WP-08, Phase 3 |

## Goal

Decide whether the tablet interface is a browser-based PWA or a native Android
application. The project brief allows a PWA for the MVP *if the requirements are cleanly
solvable that way* — so the work is to test that condition, not to assume it.

## Tasks

### Test the requirements that actually decide this
- [ ] **Ring notification while the app is open.** Verify the transport options from the
      project brief section 24: WebSocket or SSE from the backend, MQTT over WebSocket,
      or another local push mechanism. Determine what survives an Android tablet with the
      screen off.
- [ ] **Waking the screen on a ring.** A doorbell that rings silently on a dark screen
      has failed. Establish what a PWA can actually do here — this is the strongest
      argument for native and needs a real answer, not a hopeful one.
- [ ] **Audio playback and autoplay policy.** Browsers block autoplaying audio without a
      user gesture. Determine whether an incoming ring can produce sound without the user
      first touching the screen.
- [ ] **Microphone access.** `getUserMedia` requires a secure context. On a LAN with plain
      HTTP this is a real obstacle. Establish what it takes: TLS with a local CA,
      `localhost` exemptions, or something else. This constrains WP-10 as well.
- [ ] **Background behaviour.** What happens when the tablet screen locks or Android
      suspends the browser.
- [ ] **Kiosk mode**, if the tablet is a dedicated wall device.
- [ ] **WebRTC support**, against the codecs that WP-04 establishes as available.
- [ ] Reliability over long uptimes, and reconnect behaviour after network loss

### Compare and decide
- [ ] Weigh PWA against native Android on those findings, plus distribution effort and
      maintainability
- [ ] Consider whether a PWA is sufficient for the MVP with native kept as a later option,
      and what that would cost to migrate
- [ ] Recommend one

## Deliverables

- `docs/adr/ADR-003-client-platform.md`

## Acceptance

- The decision rests on tested behaviour on an actual Android tablet, not on general
  claims about PWA capabilities.
- Ring notification, screen wake and audible alert are each answered concretely — these
  are what makes a doorbell usable, and they are where PWAs are weakest.
- The secure-context requirement for microphone access is resolved, with its consequence
  for the deployment topology stated for WP-10.
- If a PWA is recommended, its limitations are named explicitly rather than glossed over,
  along with what would force a move to native later.

## Constraints now fixed

From [`../constraints.md`](../constraints.md):

- Target device is a **Google Pixel Tablet on Android 14**, on a stand.
- **A service worker is required**, so the client is an installable PWA.
- **A trusted certificate is a base requirement**: an own CA by default, or Let's Encrypt
  where the server is public. Self-signed is not sufficient - Chrome refuses to register
  a service worker on an origin with a certificate error.
- The backend serves the PWA from the same origin as the API.
- **Several tablets receive the ring notification**, but only one holds the media session.

## Resolved

The suspected conflict between certificates and two-way audio turned out to be a clean
split, and it is what drove the certificate decision:

- `getUserMedia` and WebRTC **keep working** on an accepted self-signed origin.
- Service worker registration is **refused outright** on such an origin.

Since a service worker is required, the certificate has to be genuinely trusted. See
[`../../adr/ADR-003-client-platform.md`](../../adr/ADR-003-client-platform.md).

## Outcome

Decided in ADR-003: an installable PWA with a service worker, served by the backend over
HTTPS with a trusted certificate. Native Android is not needed for the stated
requirements, and the one requirement that would force it is recorded.

## Open questions

- **What is the service worker for?** Installability and the offline app shell work on an
  isolated LAN. Notification while the app is *closed* needs Web Push, which Chrome on
  Android delivers through the OS FCM client - so it needs internet on both the backend
  and the tablet. Raised with the maintainer.
- Should a second tablet be able to take over a call, or only observe that it was
  answered? Interacts with the single-media-peer constraint in ADR-001.
- What update strategy does the service worker need? A stale cached shell on a wall tablet
  nobody reloads is a real failure mode.
