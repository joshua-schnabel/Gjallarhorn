# Solar-powered video doorbell

A solar- and battery-powered smart video doorbell built on an ESP32-P4, with a local
server and an Android tablet client. Designed to run inside the local network.

**Status: Phase 0 — architecture and technical spikes.** No product code has been written
yet. The power budget and the hardware selection are settled; the WebRTC, MQTT, client
and backend decisions are next.

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
| `client/` | Tablet interface — PWA or native Android, decision pending in ADR-003 |
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
- **[`AGENTS.md`](AGENTS.md)** — how to work in this repository. Read before changing
  anything.

Architecture decision records land in `docs/adr/` as they are made. The API specification
lands in `docs/api/openapi.yaml`. Both directories are currently empty by design — their
content is the output of Phase 0 work packages, not a starting point.

---

## The constraint worth knowing up front

The door device has no mains power. Energy is a first-class architectural constraint, not
a later optimisation — and here it decided the architecture.

The board draws 31.5 mA in deep sleep, roughly 1220 mAh per day before a single event is
handled. That would need a ~12 W panel and a ~21 Ah cell, which is a garden installation
rather than a doorbell. With an external latching load switch the board is **fully
unpowered between events**: ~57 mAh/day, a 2 W panel and a 3000-5000 mAh cell.

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
