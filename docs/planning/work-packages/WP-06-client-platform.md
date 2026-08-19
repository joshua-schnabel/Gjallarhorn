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

- Target device is a **Google Pixel Tablet on Android 14**, on a stand. A certificate can
  be installed on it.
- **The default deployment uses self-signed certificates**, so a new user can start
  without setting up a CA. Using the existing home CA is step two.
- **Several tablets receive the ring notification**, but only one holds the media session.

## The risk this package resolves first

The self-signed default and two-way audio may be in conflict. `getUserMedia` requires a
secure context. Whether Android Chrome grants a full secure context - including service
worker registration for a PWA - after the user accepts a self-signed certificate warning
is **not established**, and general documentation will not settle it.

Test this early. If a self-signed certificate is not enough, then either the default
stops being self-signed, or the MVP ships without tablet-side audio. Both are decisions
for the maintainer to make rather than discover in Phase 4. A locally trusted certificate
installed on the tablet - which the maintainer has said is possible - is the likely
escape hatch, but it weakens "self-contained by default".

## Open questions

- Must the client work when the backend is down, for example to still receive a ring?
  That would argue for MQTT over WebSocket directly, and interacts with ADR-002.
- With several tablets notified but only one able to take the call, what happens to the
  others when one answers? That is a UI question as much as a signaling one, and it
  belongs in ADR-003 as well as ADR-001.
