# ADR-003: Client platform

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-19 |
| **Revised** | 2026-08-19 — service worker required, trusted certificate now a prerequisite |
| **Work package** | [WP-06](../planning/work-packages/WP-06-client-platform.md) |

## Decision

**An installable PWA with a service worker, served by the backend over HTTPS with a
genuinely trusted certificate.**

Not a native Android app.

### What changed in the revision

The first version of this ADR chose a plain web application without a service worker,
because self-signed certificates were the deployment default and Chrome blocks service
worker registration on origins with certificate errors.

The maintainer has since required a service worker and accepted a **trusted certificate as
a base requirement** — an own CA, or Let's Encrypt where the server is public. That
removes the constraint the original decision was shaped around, so the decision changes
with it. See [`../planning/constraints.md`](../planning/constraints.md).

---

## Certificates

A service worker needs a properly trusted origin. Accepting a self-signed certificate
through the browser interstitial is **not** enough: `getUserMedia` and WebRTC keep working
on such an origin, but service worker registration is refused outright.

| Path | Notes |
| --- | --- |
| **Own CA — the default** | The deployment generates a local CA plus a server certificate and publishes the CA certificate for download. Installed once on the tablet. **Chrome on Android trusts user-installed CAs**, so this gives a fully trusted origin with no external dependency. |
| **Let's Encrypt** | Where the server is publicly reachable, or a DNS-01 challenge with a real domain is available. |
| **Existing home CA** | Supply certificate and key. Configuration, not a code path. |

This keeps the system self-contained — the goal behind the original self-signed default —
while actually satisfying the browser. The cost is a one-time certificate installation on
the tablet, which the maintainer has confirmed is possible.

**Deployment consequence:** certificates need a stable hostname. Bare-IP certificates are
awkward and Let's Encrypt will not issue them at all, so the LAN needs a resolvable name
for the backend. Tracked in [WP-10](../planning/work-packages/WP-10-deployment-topology.md).

---

## What the service worker actually buys

This matters, because the answer splits cleanly in two, and the second half is a
limitation worth knowing before it is designed around.

### Works fully offline, on a LAN with no internet

- **Installability.** A home-screen icon and a standalone window with no browser chrome —
  a materially better kiosk experience on a wall tablet than a browser tab.
- **Offline app shell.** The UI loads even while the backend is restarting, instead of
  showing a browser error page.
- **Faster starts** and resilience to brief network interruptions.
- Control over caching and update behaviour.

### Requires internet, and therefore does not work on a LAN-only deployment

- **Push notifications while the app is closed.**

**Chrome on Android delivers Web Push through the operating system's FCM client.** The
chain is: the page subscribes and receives an endpoint on Google's push service; the
backend sends the encrypted payload to that endpoint; FCM delivers it to the device over
its own persistent connection; Chrome then wakes the service worker.

That requires outbound internet from the backend **and** a live FCM connection on the
tablet. On an isolated LAN, none of it works. A service worker on its own does not create
a local push channel — there is no such thing in the web platform.

This is a strong inference from the documented architecture rather than something tested
here, but the dependency is structural, not incidental.

---

## Ring notification, and the dark screen

With the app **open**, nothing has changed and nothing is difficult: the backend pushes
the ring over a live connection (SSE), the page reacts immediately, holds a screen wake
lock, and plays an alert sound. This satisfies the project brief's section 24, which asks
only for immediate visibility while the application is open.

With the app **closed or the screen dark**, the options are:

| Approach | Works without internet | Can wake a dark screen |
| --- | :---: | :---: |
| Page open in kiosk, wake lock, audible alert | yes | screen is already on |
| Web Push via service worker | **no** | yes, via the notification |
| Native app, full-screen intent | yes | yes |

So the earlier finding stands in a sharper form. **The service worker does not remove the
dark-screen limitation on a LAN-only system** — it removes it only if the deployment has
internet access and uses Web Push. If the requirement is "the tablet sits dark and the
doorbell wakes it, with no internet dependency", that is still the native trigger.

The assumed deployment remains a docked, mains-powered tablet with the display on and the
app in the foreground, for which the open-app path is sufficient.

---

## Options considered

### Installable PWA served by the backend — **chosen**

**For:**
- Meets every MVP requirement including two-way audio.
- Standalone window and home-screen launch suit a dedicated wall tablet.
- Offline app shell survives backend restarts.
- Distribution is a URL; no store, no signing, no install artefact to maintain.
- One language across backend and client, so API and event types are shared rather than
  restated.
- Keeps a future Web Push option open at zero cost if the deployment ever has internet.

**Against:**
- Requires a trusted certificate — now accepted as a prerequisite.
- No closed-app notification without internet.
- Cannot wake a dark screen without push.

### Native Android application

**For:** full-screen intents, background operation, local alerting with no internet, and
complete control of kiosk behaviour.

**Against:** a second toolchain, signing, installation and update path, for capabilities
the stated requirements do not ask for. It would use the same backend API and the same
WebRTC, so building it now teaches nothing earlier. Remains the correct answer if
dark-screen wake without internet becomes a requirement.

---

## Consequences

- The client is an installable PWA in TypeScript, served by the backend on the **same
  origin** as the API. Same origin means no CORS, one certificate, one port, and a service
  worker scope that covers app shell and API together.
- The backend generates a CA and server certificate on first start, and serves the CA
  certificate for download so the tablet can be provisioned.
- **The service worker caches the app shell only.** Event and snapshot data stay live —
  a doorbell showing cached history would be actively misleading.
- **Nothing on the critical path depends on push.** Ring notification while the app is
  open uses SSE, and that path must remain the primary one even if Web Push is added
  later.
- The page holds a screen wake lock while in the foreground.
- Audio autoplay is unlocked by the initial interaction at kiosk startup.
- Several tablets are notified; only one takes the media session. The others must show
  that the call was answered elsewhere rather than failing silently.

---

## Open questions

- **What is the service worker actually for?** If it is installability and the offline
  shell, everything above works on an isolated LAN. If the goal is notification while the
  app is closed, that needs internet and FCM — and that is a deployment decision, not a
  code one. Raised with the maintainer.
- Should a second tablet be able to take over a call, or only observe that it was
  answered? Interacts with the single-media-peer constraint in ADR-001.
- Does the service worker need an update strategy beyond the default? A stale cached shell
  on a wall tablet nobody reloads is a real failure mode.
