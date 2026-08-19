# WP-05: MQTT architecture and topic schema

| | |
| --- | --- |
| **Status** | todo |
| **Phase** | 0 |
| **Depends on** | WP-01 |
| **Blocks** | WP-08 |

## Goal

Decide where MQTT is published from, and define a versionable topic schema with explicit
QoS and retain behaviour per topic. The broker is an external service belonging to the
existing home automation; a Mosquitto container is for development only.

The project brief states a **preliminary preference** for `ESP -> HTTP -> backend -> MQTT`,
to keep the firmware wake cycle simple. That preference may be overturned by evidence,
and this package exists to look for that evidence rather than to rubber-stamp it.

## Tasks

### Evaluate the three variants
- [ ] **Variant 1, backend publishes**: simple firmware, central event normalisation,
      MQTT credentials only on the server, topics changeable without reflashing, uniform
      retry and logging. Cost: the backend sits in the critical event path.
- [ ] **Variant 2, device publishes directly**: quantify the extra wake cost — TCP plus
      MQTT CONNECT plus TLS if used, on top of Wi-Fi association. Use WP-03 measurements
      rather than intuition. Also: QoS behaviour, retained messages, offline behaviour,
      credential management on the device, firmware complexity, and the benefit of
      decoupling home automation from backend availability.
- [ ] **Variant 3, hybrid**: device publishes only `doorbell`, `motion` and key status
      directly; images and bulk data go over HTTP to the backend. Determine how duplicate
      events in home automation are prevented — this is the variant's main risk.
- [ ] Decide, and record why

### Design the topic schema
- [ ] Versionable topic structure, with the version position justified
- [ ] JSON payload schema per topic, with required and optional fields
- [ ] **QoS per topic**, stated explicitly and justified
- [ ] **Retain per topic**, stated explicitly — status and battery are natural retain
      candidates, events are not
- [ ] Last Will and Testament for connectivity, and how it interacts with a device that
      sleeps or is powered off (a device that is *meant* to be offline must not look
      like a failure)
- [ ] Timestamp format and clock source: a device that deep-sleeps or is power-gated may
      have no reliable wall clock on wake. Decide whether the device or the backend
      stamps events.
- [ ] Home Assistant discovery: evaluate whether to support it, and whether that is MVP
      scope or a later addition

### Verify
- [ ] Run Mosquitto in a container and validate the schema end to end
- [ ] Confirm the retain and LWT behaviour matches the intent, by test

## Deliverables

- `docs/adr/ADR-002-mqtt-architecture.md`
- `docs/mqtt.md` — the topic schema, payloads, QoS and retain table

## Acceptance

- All three variants are evaluated against the criteria in the project brief section 8.
- The decision is justified by evidence — for the wake-cost question specifically, by
  WP-03 measurements or by a stated and labelled assumption, not by gut feeling
  (the brief is explicit about this).
- Every topic has a stated QoS and retain value with a reason.
- The schema is versionable, and the versioning mechanism is described.
- Offline and sleeping-device behaviour is specified, including LWT semantics for a
  device that is intentionally unreachable.
- Payload examples validate against the documented schema.

## Constraints now fixed

From [`../constraints.md`](../constraints.md):

- Broker is **Mosquitto**, already running. Consumers are **Node-RED** today and
  **Home Assistant** planned. Authentication is **username and password**.
- **Data flows one way only.** No command channel. The maintainer's reasoning holds: a
  powered-off device cannot receive an unsolicited command. If one were ever wanted, it
  would have to be polled during the wake window.
- **The device is powered off between events.** An MQTT connection per event therefore
  costs a full TCP and MQTT handshake on top of Wi-Fi association, every time. This
  strengthens variant 1, but the comparison still gets made rather than assumed.
- **Topic conventions are left to the user.** Pick a sensible default, make it
  configurable. That is the general rule for every parameter in this project.

## Open questions

- Retained status and Last Will need care. A device that is *meant* to be unreachable
  must not look like a failure in Home Assistant. Decide what "online" even means for a
  device that is powered off by design - a retained status of `sleeping` with a last-seen
  timestamp is probably closer to the truth than an LWT of `offline`.
- Does Home Assistant discovery belong in the MVP, given it is planned but not yet
  installed? Publishing discovery config for a system that is not there costs little,
  but it is scope.
- Where does the timestamp come from? A device that cold-boots on every wake has no
  reliable clock until it syncs. Either it runs SNTP during the wake window, which costs
  time and energy, or the backend stamps arrival. Must match the same decision in
  WP-09.
