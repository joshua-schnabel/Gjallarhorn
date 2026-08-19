# ADR-003: Client platform

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-19 |
| **Revised** | 2026-08-19 — twice; see revision history at the end |
| **Work package** | [WP-06](../planning/work-packages/WP-06-client-platform.md) |

## Decision

**A native Android application that hosts the web UI in a WebView.**

- A **foreground service** holds a persistent WebSocket to the backend.
- On a ring, a **full-screen intent** turns the screen on and brings the app to the
  front, the way an incoming call does.
- The **UI is the web application**, served by the backend and loaded into the WebView, so
  it stays TypeScript and shares types with the backend.

No FCM, no Google dependency, no internet requirement.

---

## Why this changed

The requirement that decides it, from the maintainer:

> The tablet is not permanently on. On a ring, the app should come to the front, the way
> it would for an incoming call.

The previous version of this ADR recorded exactly this as the trigger that would force a
native client. The trigger has fired.

**A web page cannot do this, and no amount of configuration changes that:**

- **There is no API for a page to bring itself to the foreground.** The web platform
  deliberately has none.
- **A backgrounded page is frozen.** Chrome on Android freezes backgrounded tabs, and
  Android's Doze mode suspends network for non-exempt apps. A WebSocket does not survive
  the screen going off — mains power does not change this, because the restriction is
  about process state, not battery.
- **Waking a service worker without push is not possible.** The only way to wake one from
  a closed state is a push message, and on Chrome for Android that means FCM — which the
  maintainer has ruled out, and which would contradict the LAN-first design anyway.

So the choice is not "web or native" on grounds of taste. Only a native process can hold a
connection while the screen is off and raise itself when something arrives.

### The service worker requirement dissolves

The maintainer asked for a service worker as the means to this end. With a native shell
the end is met directly and better: installability, a home-screen icon and a standalone
window all come from the app being an app.

A service worker in the WebView is therefore **optional**, not required. It may still be
worth adding later for app-shell caching so the UI renders during a backend restart, but
nothing on the critical path depends on it.

---

## How the ring reaches a dark tablet

```text
device --HTTP--> backend --WebSocket--> foreground service (always connected)
                                              |
                                     full-screen intent
                                              |
                              screen on + activity to front
                                              |
                                    WebView shows ring view
                                              |
                              WebRTC direct to the door device
```

**Foreground service.** Android permits a persistent connection in a foreground service
with an ongoing notification. The tablet is permanently on mains power, so exempting the
app from battery optimisation is reasonable and has no cost here.

**Full-screen intent.** This is Android's incoming-call mechanism. The activity is
declared with `setShowWhenLocked(true)` and `setTurnScreenOn(true)`, so it appears over
the lock screen with the display switched on.

**Android 14 caveat, and it is a real one.** Since Android 14, `USE_FULL_SCREEN_INTENT` is
a special app access: only calling and alarm apps receive it by default, and the Play
Store revokes it for others on install. The app must check
`NotificationManager.canUseFullScreenIntent()` and, if not granted, send the user to
settings via `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`.

For a privately installed doorbell this is a one-time toggle during setup, not a blocker —
but the app must **detect the missing permission and guide the user**, because a doorbell
that silently fails to appear is worse than one that says why. Onboarding must cover this
alongside battery-optimisation exemption.

---

## Why a WebView shell rather than a fully native UI

The native part is small and stable: a service, a connection, a notification, an activity,
and WebView configuration. The part that will change constantly during Phase 3 — the
status view, the ring view, the history — stays web.

**This keeps most of the benefits of the web decision** while adding the one capability
that required native:

- One language across backend and client; API and event types shared, not restated.
- UI changes are a page reload, not a rebuild-sign-install cycle.
- The same UI is reachable from a desktop browser for development and debugging.
- The native surface is small enough to be written once and rarely touched.

### What this costs, and what it requires

- **WebRTC in a WebView needs explicit permission plumbing.** `getUserMedia` fails with a
  permission error unless the app overrides `WebChromeClient.onPermissionRequest` and
  grants camera and microphone, in addition to the manifest permissions. This is a known,
  documented step — but it is a step, and it must be in the Phase 3 plan rather than
  discovered.
- **The UI must be served over HTTPS.** WebView refuses `getUserMedia` from `file://`, so
  the app loads the UI from the backend rather than bundling it.
- WebView is Chromium-based but is not identical to Chrome. WebRTC behaviour must be
  verified on the actual device rather than inferred from browser testing.

### Alternative considered: Trusted Web Activity

Rejected. A TWA requires Digital Asset Links verification, which needs a publicly
resolvable domain — awkward-to-impossible for a LAN-only deployment, and it buys nothing
that a WebView does not already provide here.

### Alternative considered: fully native UI with native WebRTC

Rejected for the MVP. It would mean building every view twice over the project's life and
integrating a native WebRTC stack, for no functional gain over a WebView that already has
one. Remains available if the WebView proves limiting.

---

## Certificates

The trusted-certificate requirement from the previous revision **stands**, but the
mechanism changes slightly because the app now controls its own trust store.

- The deployment generates a **local CA and server certificate**; the CA certificate is
  installed once on the tablet.
- The app declares a `network_security_config.xml` that **trusts user-installed CAs**.
  Android apps have ignored user CAs by default since Android 7, so this opt-in is
  required — it is one manifest reference and one XML file.
- Let's Encrypt remains the option where the server is publicly reachable.

Keeping a real CA rather than pinning a self-signed certificate means the tablet's browser
also works for debugging, and it avoids hand-rolled certificate handling, which
AGENTS.md section 8 warns against.

**The stable-hostname consequence stands**: the certificate needs a name, so the LAN needs
a resolvable one. Tracked in [WP-10](../planning/work-packages/WP-10-deployment-topology.md).

---

## Consequences

- **A fourth deliverable exists that did not before**: an Android application. It is small,
  but it needs a toolchain, a signing key and an install path onto the tablet. Phase 3
  grows accordingly.
- The backend serves the web UI over HTTPS as decided in ADR-004; the WebView loads it.
- The backend gains a **WebSocket endpoint** for device events, replacing the SSE plan.
  Bidirectional is now warranted: the app acknowledges rings and reports which tablet took
  the call. Feeds [WP-09](../planning/work-packages/WP-09-api-design.md).
- The connection must **reconnect with bounded backoff** and survive network changes; a
  doorbell whose app quietly lost its connection is broken in the worst way, so the
  service must surface its own connection state to the UI.
- Onboarding must cover: install the CA certificate, grant full-screen intent, exempt from
  battery optimisation. All three are one-time, all three are silent failures if skipped.
- **Several tablets are notified; only one takes the media session.** The others must
  dismiss their ring UI when the call is answered elsewhere.
- The service worker is optional. If added, the app must work without it.

---

## Open questions

- Should the app use Android's **Telecom / ConnectionService** APIs to register as a real
  calling app? That would make full-screen intent permission automatic and give proper
  call UI integration, at the cost of a much larger API surface. Worth a look in Phase 3;
  the plain full-screen intent route is the simpler starting point.
- What happens when the ring is not answered? A missed-call notification, presumably, but
  the timeout and its relationship to the device's wake window need defining.
- Does the app need to work at all when the backend is unreachable, beyond showing that it
  is disconnected?

---

## Revision history

| Version | Decision | Why it changed |
| --- | --- | --- |
| 1 | Plain web app, no service worker | Self-signed certificates were the default, and Chrome blocks service workers on untrusted origins |
| 2 | Installable PWA with service worker | Maintainer required a service worker and accepted a trusted certificate as a prerequisite |
| 3 | **Native Android shell hosting the web UI** | Maintainer requires the app to come to the front on a ring, with the screen off and without FCM. No web technology can do this. |
