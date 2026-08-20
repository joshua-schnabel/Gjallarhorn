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

- **Google Pixel Tablet, Android 14**, on a stand, permanently powered, **display not
  permanently on**.
- **On a ring the app must come to the front like an incoming call.**
- **No FCM.** A persistent connection from the tablet is acceptable.
- **A trusted certificate is a base requirement**: local CA by default, Let's Encrypt
  where the server is public.
- Several tablets are notified; only one holds the media session.

## Outcome

Decided in [`../../adr/ADR-003-client-platform.md`](../../adr/ADR-003-client-platform.md):
**a native Android app hosting the web UI in a WebView**, with a foreground service for
the persistent WebSocket and a full-screen intent to raise the app on a ring.

The ADR went through three versions as the requirements sharpened. The deciding finding:
no web technology can bring itself to the foreground or hold a connection while the screen
is off, and the only web route to waking a closed app is push through FCM — which is
excluded.

## Follow-on work this creates

- [ ] Android app skeleton: foreground service, WebSocket client with bounded reconnect,
      notification channel, full-screen-intent activity
- [ ] `network_security_config.xml` opting into user-installed CAs — required, since
      Android apps have ignored them by default since Android 7
- [ ] `WebChromeClient.onPermissionRequest` granting camera and microphone; without it
      `getUserMedia` fails in WebView despite manifest permissions
- [ ] Onboarding for the three one-time setup steps that all fail silently if skipped:
      install the CA certificate, grant full-screen intent, exempt from battery
      optimisation
- [ ] Verify WebRTC behaviour in WebView on the actual device rather than in Chrome
- [ ] Signing key and install path onto the tablet

## Open questions

- Should the app register as a real calling app via **Telecom / ConnectionService**? That
  makes the full-screen-intent permission automatic and integrates with the system call
  UI, at the cost of a much larger API surface. Worth evaluating in Phase 3.
- What happens when a ring is not answered — missed-call notification, and how does its
  timeout relate to the device's wake window?
- Should a second tablet be able to take over a call, or only see that it was answered?
