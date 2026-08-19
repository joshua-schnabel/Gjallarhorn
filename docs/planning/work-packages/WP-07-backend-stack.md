# WP-07: Backend stack decision

| | |
| --- | --- |
| **Status** | todo |
| **Phase** | 0 |
| **Depends on** | WP-01 |
| **Blocks** | WP-08, Phase 2 |

## Goal

Settle the backend stack. The language is already decided — **Node.js with TypeScript**,
chosen by the maintainer — so this package resolves what sits inside that: HTTP
framework, SQLite driver, MQTT client, OpenAPI approach, and the runtime and container
base image. The ADR records the language choice and its rationale too, so the decision is
not left implicit in the code.

## Tasks

- [ ] Record the language decision and its trade-offs, including the option it forecloses
      (a single static Go binary would give a smaller image and fewer runtime
      dependencies; TypeScript buys shared types with a PWA client, which matters only if
      WP-06 chooses a PWA — note the dependency)
- [ ] **HTTP framework**: evaluate Fastify, Express and Nest against the project's
      priorities — simple, robust, maintainable, few operational dependencies, good REST
      support. Weigh built-in schema validation, since the brief requires input
      validation and upload limits.
- [ ] **SQLite driver**: evaluate `better-sqlite3` (synchronous, native build) against
      `node:sqlite` (built into newer Node) and alternatives. Check what each implies for
      the container image and for cross-compilation.
- [ ] **Migrations**: decide the approach. Even an MVP needs a schema to survive a
      restart with data intact — MVP acceptance criterion 13.
- [ ] **MQTT client**: evaluate `mqtt.js`; confirm reconnect behaviour, QoS support and
      LWT against what WP-05 specifies
- [ ] **OpenAPI**: decide between spec-first (write `openapi.yaml`, generate types) and
      code-first (annotate routes, emit the spec). This directly shapes WP-09.
- [ ] **Validation**: pick the runtime validation approach for untrusted device and client
      input (AGENTS.md section 5)
- [ ] **Snapshot storage**: confirm the file-system-plus-database-reference model, and
      define upload limits and file type checking
- [ ] **Logging**: pick a structured logger and define the fields required by the project
      brief section 27 — request ID, device ID, event ID, session ID
- [ ] **Testing**: pick the test runner and the integration-test approach
- [ ] **Container**: choose the Node version and base image; confirm any native modules
      build in it
- [ ] Write the ADR

## Deliverables

- `docs/adr/ADR-004-backend-stack.md`

## Acceptance

- Every component choice is justified against the project's stated priorities, not by
  popularity.
- The choice of native versus pure-JS dependencies is checked against the container
  build — a native SQLite driver that fails to build in the chosen base image is a
  problem found now, not in Phase 2.
- The OpenAPI approach is decided, because WP-09 depends on it.
- Structured logging covers the fields the project brief requires.
- Dependencies are justified per AGENTS.md section 8: why needed, why the platform cannot
  provide it, and the maintenance and security implications.

## Constraints now fixed

From [`../constraints.md`](../constraints.md):

- Language is **Node.js with TypeScript**, set by the maintainer.
- Host is **Proxmox on x86**, but **ARM must also be supported**. Images must be
  multi-architecture and no dependency may be x86-only. This is a real filter on the
  SQLite driver choice: a native module must build for both, which argues for
  `node:sqlite` or for a prebuilt-binary strategy that genuinely covers arm64.
- The default deployment is **self-contained with self-signed certificates**, so
  certificate generation on first start is a backend or deployment concern rather than
  something the user is expected to arrange.

## Open questions

- Does the backend also serve the client application, or is that a separate container?
  Interacts with WP-06's secure-context finding and with WP-10.
- Does the backend terminate TLS itself or sit behind a reverse proxy? The architecture
  must permit HTTPS, and the client needs a secure context for microphone access.
- Is a single process sufficient, or does live-session coordination need separate
  handling? Keep it simple until WP-04 shows a reason otherwise (AGENTS.md section 4).
