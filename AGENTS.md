# AGENTS.md

Canonical context for AI coding agents working on this project.

This file is the starting point and single source of truth for how an AI coding
agent should work in this repository.

The project architecture and technical decisions will evolve during development.
Do not invent missing decisions. Important decisions should be discussed,
documented and, where appropriate, recorded as ADRs.

---

## 1. What this project is

This project is a **solar- and battery-powered smart video doorbell**.

The system consists of three main software components:

1. **Door device firmware**
2. **Server/backend**
3. **Tablet client**

The door device is based on an **ESP32-P4** and will be connected to provided
hardware including, at minimum:

* camera
* microphone
* speaker
* doorbell button
* motion sensor
* battery / solar power supply
* network connectivity

The hardware itself is not part of this software project. Hardware interfaces,
pins and exact peripheral components will be provided or defined during
development.

The firmware must therefore keep hardware-specific code separated from
application logic wherever practical.

---

### Core product behaviour

The doorbell must support:

* detection of the doorbell button
* motion detection
* snapshot capture on relevant motion
* transmission and storage of snapshots
* live video
* bidirectional audio
* communication with a tablet
* communication with a local server
* MQTT integration for home automation
* battery and device telemetry
* energy-efficient operation

The system is intended to operate primarily inside the local network.

The door device has no permanent mains power supply.

**Energy efficiency is therefore a core product requirement, not an optional
later optimization.**

The device should spend as much time as practical in an appropriate low-power
state and wake when required by events such as motion or the doorbell button.

---

### Real-time communication

Live video and bidirectional audio are required.

**WebRTC is expected to be a strong candidate for this functionality**, but the
exact architecture has not yet been decided.

Relevant approaches to evaluate include:

* direct WebRTC between door device and client
* Espressif's WebRTC / doorbell components
* Janus WebRTC Server

Janus is a candidate component, not a predetermined requirement.

Do not reject or select any of these approaches before evaluating them against
the actual requirements and available ESP32-P4 support.

---

### Server

The backend must be deployable using **Docker**.

Its exact responsibilities will be defined during architecture work.

Expected areas include:

* device communication
* events
* snapshots
* telemetry
* persistence
* client communication
* MQTT integration
* coordination of live sessions

Additional services such as Janus may run alongside the backend if selected by
the architecture.

---

### Tablet client

The primary user interface will run on an **Android tablet**.

Possible implementations include:

* browser application / PWA
* native Android application

The implementation has not yet been selected.

The decision should be based on technical requirements such as WebRTC support,
notifications, background behaviour, reliability and maintainability.

---

## 2. Working with the maintainer

* Reply to the maintainer in **German**.
* Everything committed to the repository — source code, comments,
  documentation and commit messages — must be written in **English**.
* Work autonomously when the requirements and existing architecture are clear.
* Ask only at genuine product or architecture forks.
* Do not ask for confirmation for routine implementation details.
* Prefer small, understandable and testable changes.
* Keep solutions as simple as possible without compromising the requirements.

---

## 3. Verify before changing

Do not guess technical facts that can reasonably be verified.

Before relying on behaviour of external systems or libraries, verify it against
the actual source code or official documentation.

This is especially important for:

* ESP32-P4 capabilities
* ESP-IDF APIs
* Espressif components
* WebRTC
* codecs
* Janus
* browser APIs
* Android behaviour
* MQTT
* Docker images
* third-party libraries

When documentation and assumptions disagree, documentation or tested behaviour
wins.

Clearly distinguish between:

* verified fact
* architectural assumption
* recommendation
* open question

Do not silently turn an assumption into a project requirement.

---

## 4. Do not over-design

This project will be developed iteratively.

Do not introduce infrastructure merely because it may become useful later.

In particular, do not prematurely introduce:

* cloud services
* Kubernetes
* distributed databases
* message queues beyond actual requirements
* complex authentication infrastructure
* microservices without a concrete reason
* custom protocols where established protocols solve the problem

Prefer an architecture that can evolve without making the MVP unnecessarily
complex.

---

## 5. Security and privacy

Security is a first-class requirement because the system contains a camera,
microphone and network-connected device.

At minimum:

* never commit credentials or secrets
* never log secrets
* avoid unnecessary exposed network services
* use least privilege
* validate data received from the network
* treat camera and microphone access as sensitive
* do not create unauthenticated remote access to live media
* prefer established security mechanisms over custom cryptography

The initial product is **LAN-first**, but local network access must not be
treated as inherently trusted.

---

## 6. Power consumption

Power consumption is a first-class architectural constraint.

The door device is battery- and solar-powered.

When designing firmware or protocols, always consider:

* time spent awake
* network startup time
* camera startup time
* radio usage
* connection establishment
* retries
* polling
* CPU load
* memory usage
* duration of live sessions

Avoid:

* permanent streaming
* unnecessary polling
* unbounded retries
* busy loops
* keeping peripherals active without a reason

Do not claim expected battery life without measurements.

Where power behaviour matters, prefer measurement over assumption.

---

## 7. Hardware abstraction

Exact hardware details may change during development.

Do not spread GPIO numbers, camera-specific behaviour, audio hardware details or
network-module assumptions throughout the application.

Keep hardware-specific code behind clear interfaces or components.

Application logic should describe behaviour such as:

```text
capture image
detect motion
read battery
connect network
start audio
start video
```

rather than directly manipulating hardware everywhere.

---

## 8. Dependencies

Prefer existing platform capabilities and official upstream components before
adding third-party dependencies.

Before introducing a dependency:

1. establish why it is needed
2. verify that the existing stack cannot reasonably provide the functionality
3. consider maintenance and security implications
4. discuss significant dependencies with the maintainer

For ESP32-P4 functionality, prefer supported Espressif components where they
meet the requirements.

Do not implement standards such as WebRTC, cryptography or media codecs from
scratch when suitable maintained implementations exist.

---

## 9. Git workflow

Do not push directly to protected branches.

Use appropriately named working branches and submit changes through pull
requests.

Never:

* force-push without explicit approval
* rewrite shared history without explicit approval
* merge or approve a pull request on behalf of the maintainer
* modify repository security settings or secrets without explicit approval

Commit messages should explain the purpose of the change.

Keep commits logically scoped.

---

## 10. Documentation

Documentation is part of the implementation.

When an architectural decision is made, document the reasoning rather than only
the final result.

Prefer:

```text
docs/architecture.md
docs/adr/
docs/testing/
```

for detailed documentation.

Do not turn `AGENTS.md` into a duplicate architecture manual.

This file defines **how to work on the project**.

The architecture documentation defines **how the system works**.

---

## 11. General implementation principles

* Prefer clear code over clever code.
* Keep components small and responsibilities explicit.
* Avoid hidden global state.
* Handle errors explicitly.
* Do not silently ignore failures.
* Add meaningful logging at system boundaries.
* Design network operations with timeouts.
* Bound queues and retries.
* Make failure behaviour intentional.
* Write tests for important behaviour.
* Keep interfaces narrow.
* Remove obsolete code rather than leaving dead alternatives behind.
* Do not optimize without evidence, except where power consumption requires
  deliberate design from the beginning.

Above all:

**Understand the existing project before changing it, verify uncertain facts,
make architectural decisions explicit, and keep the implementation appropriate
for a small maintainable embedded system.**
