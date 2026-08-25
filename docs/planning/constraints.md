# Project constraints

Decisions and constraints set by the maintainer. Recorded here because they are not
derivable from the code or the project brief, and because later work packages depend on
them.

Established 2026-08-19.

---

## Operating model

**The device deep-sleeps and is woken only by the doorbell button or the motion sensor.**

Confirmed by the maintainer. Consequences, accepted:

- No spontaneous live view. The tablet cannot call a sleeping device.
- No periodic telemetry. Battery voltage and status ride along with events.
- A live session is possible only inside the wake window that follows an event.

This matches the project brief section 18 and it settles the question WP-03 was
scheduled to answer, so the architecture can be designed against it directly.

## Home automation

- Broker: **Mosquitto**, already running.
- Consumers: **Node-RED** today, **Home Assistant** planned.
- ESPHome is not usable — it does not support the ESP32-P4 yet.
- Broker authentication: **username and password**.
- **Data flows one way only**, device to home automation. No command channel.
  The maintainer's reasoning is correct: a deep-sleeping device cannot receive an
  unsolicited command. Should a command path ever be wanted, it would have to be polled
  during the wake window — that option stays open, it is simply not MVP scope.

### Configuration philosophy

The maintainer has existing topic conventions but wants the project to **leave them to
the user**. This generalises to a rule for the whole project:

> Choose a sensible default for every parameter, and make every parameter configurable.

Applies to MQTT base topic, timings, resolutions and everything else in the project brief
section 26.

## Client

- Device: **Google Pixel Tablet, Android 14**, on a stand, permanently on mains power.
- **The display is not permanently on.**
- **On a ring the app must come to the front, the way an incoming call does** — screen on,
  app raised, without the user touching anything.
- **No FCM / Google push.** A persistent connection from the tablet is acceptable, since
  it is permanently powered.
- A certificate can be installed on the tablet.

This combination is what forces a native Android client; see
[`../adr/ADR-003-client-platform.md`](../adr/ADR-003-client-platform.md). No web
technology can raise itself to the foreground or hold a connection while the screen is
off, and the only web route to waking a closed app is push through FCM.

## Server

- Host: **Proxmox on x86**.
- Deployed with **Docker**.
- **ARM must also be supported** — so images must be multi-architecture and no dependency
  may be x86-only.

## TLS

**Revised 2026-08-19**, superseding the earlier self-signed default. The maintainer
requires a service worker, and a service worker requires a genuinely trusted certificate —
Chrome refuses to register one on an origin with a certificate error. Self-signed is
therefore no longer sufficient, and **a trusted certificate is a base requirement of the
system rather than an optional improvement.**

Two supported paths:

1. **Own CA (default).** The deployment generates a local CA and a server certificate
   signed by it, and publishes the CA certificate for download. The user installs it once
   on the tablet. Chrome on Android trusts user-installed CAs, so this yields a fully
   trusted origin with no external dependency — the system stays self-contained.
2. **Let's Encrypt**, where the server is publicly reachable or a DNS-01 challenge with a
   real domain is available.

The maintainer's existing home CA can be used instead by supplying certificate and key;
that is configuration, not a separate code path.

**DNS is a prerequisite.** The maintainer runs DNS on the network, and the project may
assume a resolvable hostname for the backend rather than working around bare IP
addresses — certificates for IPs are awkward, and Let's Encrypt will not issue them at
all.

**The hostname itself is configurable**, per the configuration rule above: other
installations will use different names. There is no sensible default, so the value is
**required at startup** and the backend must **fail loudly if it is unset** rather than
generating a certificate for a name the tablet will reject. A certificate quietly issued
for the wrong name is a failure that only shows up on the tablet, far from its cause.

**Note for a possible native client:** Android apps have not trusted user-installed CAs by
default since Android 7. Chrome does, so this affects nothing today, but a native client
would have to opt in explicitly.

## Certificate renewal

**ACME is the intended primary path**, decided 2026-08-22. The local CA that the backend
generates stays as the zero-configuration bootstrap, but it is not the long-term answer:
a certificate that silently expires takes the doorbell UI with it, and renewing only on
process start works solely for a service that happens to restart.

**Open, and it decides the implementation:** Let's Encrypt will not issue for an internal
name such as `doorbell.fritz.box`. ACME therefore means one of two things, and they are
different work:

| Path | Needs | Consequence |
| --- | --- | --- |
| **Public domain, DNS-01** | A real domain and DNS provider credentials | Publicly trusted certificate. **No CA installation on the tablet at all** — the onboarding step disappears. |
| **Internal ACME server** (step-ca or similar) | Another service to run | The tablet still installs the internal CA once, but renewal is automatic. |

The first is markedly better for onboarding; the second keeps the system self-contained.
Not blocking anything before the backend needs TLS renewal.

## Cold charging

Unresolved, and the only open hardware item that can damage something: Li-ion must not be
charged below 0 degrees C, and the DFR0559 has no temperature cutoff.

**The maintainer is sourcing a charge controller with temperature sensing** (2026-08-22).
Until one is chosen, no outdoor deployment through a winter.

## Live sessions

- **Signaling and notification go to multiple devices.**
- **Media communication runs with only one device at a time.**

This rules out `doorbell_local`'s on-device signaling as a complete answer — it accepts
exactly one peer — and points towards backend-mediated signaling with notification
fan-out. Input to WP-04.

## Scale

- **One door device**, for the foreseeable future.

The device ID stays in the API and topic schema anyway, because it costs nothing now and
removes a migration later. It is not a reason to build multi-tenancy.

## Firmware security

The maintainer raised whether the firmware can be protected. It can, and it should be,
because the device is physically reachable at the front door and carries MQTT credentials
and a device token:

- **Flash Encryption**, XTS-AES-128, supported on ESP32-P4
- **Secure Boot v2**, supported on ESP32-P4

Sources: [ESP-IDF security guides for ESP32-P4](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/security/index.html).

To be planned as part of Phase 1. Note that enabling either is irreversible on a given
chip, so it belongs at the end of firmware bring-up, not the start.

## Measurement

**No current measurement equipment is available.** The power budget is therefore
*calculated* from vendor figures and stated assumptions, not measured.

This is a real limitation and it is handled as follows:

- Every derived number is tagged **[A]** and its inputs are listed, so any figure can be
  recomputed when a measurement becomes possible.
- The model is built so that measured values can replace assumed ones without redoing
  the structure.
- Where a conclusion depends on an assumption, the sensitivity is stated.

The project brief and AGENTS.md section 6 forbid claiming battery life without
measurement. The compromise adopted: the budget states a *calculated estimate with its
assumptions visible*, never a bare battery-life claim, and the distinction is kept in the
wording. See [`../power-budget.md`](../power-budget.md).

## Development environment

Established 2026-08-21 by checking the machine rather than assuming.

**Available:** Node.js 24, npm, Python 3.14, Docker, gh.

**Not available:** ESP-IDF, C compiler, CMake, Ninja. `IDF_PATH` is unset and there is no
ESP-IDF installation.

Consequence: **firmware C code cannot currently be compiled or tested here.** Writing
firmware in this state would produce unverified code for a device that also cannot be
flashed, which is the opposite of how this project is meant to work (AGENTS.md section 3).

The backend and its tests, by contrast, are fully buildable and testable now, and Docker
works - multi-architecture behaviour has already been verified through it.

Two ways forward, to be decided per phase rather than once:

1. **Install ESP-IDF** when firmware work begins. It is a multi-gigabyte install that
   changes the environment, so it needs the maintainer's go-ahead.
2. **Build the backend first.** It is unblocked, testable, and it is a hard dependency of
   Phase 1's own acceptance target - `motion -> wake -> snapshot -> upload` has nothing to
   upload to until the backend exists.

## Git workflow

- Default branch: **`main`**.
- Development happens on **`dev`**.
- Changes reach `main` by merge request.
- No remote yet. The maintainer will create one on request.
