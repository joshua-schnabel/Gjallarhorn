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

- Device: **Google Pixel Tablet, Android 14**, on a stand.
- A certificate can be installed on the tablet.

## Server

- Host: **Proxmox on x86**.
- Deployed with **Docker**.
- **ARM must also be supported** — so images must be multi-architecture and no dependency
  may be x86-only.

## TLS

- A CA exists in the home network, but **the default must be a self-contained system**:
  self-signed certificates, so a new user can start quickly.
- Using the existing CA is step two, not the default.

**Known risk:** the client needs a secure context for microphone access. Whether a
self-signed certificate is enough for `getUserMedia` and for a service worker on Android
Chrome after the user accepts the warning is **not established** and must be tested in
WP-06. If it is not enough, the self-signed default conflicts with two-way audio, and
that conflict has to be resolved rather than discovered late.

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

## Git workflow

- Default branch: **`main`**.
- Development happens on **`dev`**.
- Changes reach `main` by merge request.
- No remote yet. The maintainer will create one on request.
