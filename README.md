# Solar-powered video doorbell

A solar- and battery-powered smart video doorbell built on an ESP32-P4, with a local
server and an Android tablet client. Designed to run inside the local network.

**Status: Phase 0 complete.** All twelve deliverables from the project brief are in
place: architecture and sequence diagrams, four ADRs, the firmware state machine, the
REST API, the MQTT schema, the deployment topology and the hardware parameter list. No
product code has been written yet — Phase 1 is the firmware.

One item stays open by necessity: the hardware baseline waits on parts being sourced.

---

## What it does

- Detects the doorbell button and rings through to the tablet
- Detects motion, captures a snapshot and uploads it
- Streams live video from the door to the tablet, with two-way audio
- Publishes events to MQTT for home automation
- Reports battery and device telemetry
- Runs on battery and solar, so it sleeps whenever it can

## The three components

| Directory | Component |
| --- | --- |
| `firmware/` | Door device firmware, ESP32-P4 on ESP-IDF |
| `server/` | Backend, Node.js and TypeScript, deployed with Docker |
| `client/` | Tablet interface — native Android app hosting the web UI in a WebView |
| `deploy/` | Docker Compose and deployment configuration |
| `docs/` | Architecture, decisions, API and planning |

---

## Start here

- **[`docs/planning/roadmap.md`](docs/planning/roadmap.md)** — the plan of record: work
  packages, status, dependencies, and the phases ahead.
- **[`docs/planning/constraints.md`](docs/planning/constraints.md)** — the decisions the
  maintainer has set, and what follows from them.
- **[`docs/hardware.md`](docs/hardware.md)** — what the device is built from and what is
  still undecided.
- **[`docs/power-budget.md`](docs/power-budget.md)** — why the design looks the way it
  does.
- **[`docs/ci-cd.md`](docs/ci-cd.md)** — the pipeline: what gates what, and why.
- **[`AGENTS.md`](AGENTS.md)** — how to work in this repository. Read before changing
  anything.

- **[`docs/architecture.md`](docs/architecture.md)** — how the system fits together,
  with sequence diagrams and the firmware state machine under
  [`docs/architecture/`](docs/architecture/).
- **[`docs/adr/`](docs/adr/)** — the four architecture decisions and why they were made.
- **[`docs/api/openapi.yaml`](docs/api/openapi.yaml)** — the REST API, plus
  [`websocket.md`](docs/api/websocket.md) for the tablet protocol.
- **[`docs/mqtt.md`](docs/mqtt.md)** — topics, payloads, QoS and retain.

---

## The constraint worth knowing up front

The door device has no mains power. Energy is a first-class architectural constraint, not
a later optimisation — and here it decided the architecture.

The board draws 31.5 mA in deep sleep, roughly 1220 mAh per day before a single event is
handled. That would need a ~12 W panel and a ~21 Ah cell, which is a garden installation
rather than a doorbell. With an external latching load switch the board is **fully
unpowered between events**: ~58 mAh/day, a 2 W panel and a 3000-5000 mAh cell.

So the device does not sleep — it switches off. It cold-boots on every wake, triggered
only by the button or the motion sensor, and is unreachable in between. There is no
spontaneous live view; a live session happens inside the wake window that follows an
event.

The budget is calculated from vendor figures, not measured, and says so throughout.
See [`docs/power-budget.md`](docs/power-budget.md).

---

## Conventions

- Repository content — code, comments, documentation, commit messages — is in **English**.
- One work package per branch, merged by pull request.
- External behaviour gets verified against source or official documentation before it is
  relied on. Documents keep verified fact, assumption and open question distinguishable.

Build, flash and deployment instructions will be added as the components are
implemented.
