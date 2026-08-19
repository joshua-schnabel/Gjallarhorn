# ADR-004: Backend stack

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-08-19 |
| **Work package** | [WP-07](../planning/work-packages/WP-07-backend-stack.md) |

## Decision

| Concern | Choice |
| --- | --- |
| Language | **TypeScript on Node.js**, current Active LTS line |
| HTTP framework | **Fastify** |
| Schemas and types | **TypeBox**, schema-first with types derived |
| Database | **SQLite via `better-sqlite3`** |
| Base image | **`node:<lts>-bookworm-slim`** — glibc, **not Alpine** |
| Migrations | Forward-only SQL files, tracked in a table. No ORM. |
| MQTT | **`mqtt.js`** |
| API specification | **Code-first**: generated from Fastify schemas, committed |
| Logging | **`pino`**, structured JSON |
| Tests | **`node:test`** with `fastify.inject()` |
| TLS | Terminated by the backend, self-signed generated on first start |

One container serves the API and the client application, per ADR-003.

---

## Language

TypeScript on Node.js was set by the maintainer. Recorded here with its trade-off rather
than left implicit.

**What it buys:** one language across backend and client, so event shapes, API types and
MQTT payload types are defined once and shared instead of restated. Given that ADR-003
chose a web client, this is a real and continuing benefit rather than a theoretical one.

**What it costs:** Go would have produced a single static binary, a container image an
order of magnitude smaller, and no runtime or native-module concerns for the ARM
requirement. That is a genuine loss, and the ARM requirement is precisely where it shows
up — see the database section.

The decision stands; the cost is named so nobody rediscovers it as a surprise.

---

## HTTP framework: Fastify

**Chosen because validation, typing and the API specification collapse into one thing.**
A Fastify route declares a JSON Schema for its body, params and response. That single
declaration then provides:

- runtime input validation, which the brief requires for untrusted device and client
  input (AGENTS.md section 5),
- the TypeScript types for the handler, via TypeBox,
- the OpenAPI document, via `@fastify/swagger`.

For a project whose deliverable 9 is an OpenAPI specification and whose security section
demands input validation, having those come from the same source removes an entire class
of drift.

Also relevant: `pino` is built in with per-request IDs, which is most of what the brief's
logging section asks for; and `fastify.inject()` allows full request tests with no network
and no test server.

**Express** would need a validation library, a separate OpenAPI generator and a logging
setup assembled by hand, with three places for the same shape to diverge. **Nest** brings
dependency injection, decorators and module wiring that a service this small does not
need — over-design by the standard of AGENTS.md section 4.

---

## Database: `better-sqlite3` on a glibc image

This is where the ARM requirement bites, and it decides both the driver and the base
image.

**`node:sqlite`, the built-in module, is Stability 1.2 — a release candidate.** The API is
settled barring significant issues, but it has not been declared stable. It is attractive
because it removes the native dependency entirely, which would make multi-architecture
builds trivial.

**It is not chosen**, because this database holds the user's only copy of their event and
snapshot history, on a service intended to run unattended for a long time. A
release-candidate storage layer is the wrong place to save a dependency.

**`better-sqlite3`** is mature, synchronous — which suits SQLite's actual behaviour and
keeps the code straightforward — and fast. Its cost is being a native module.

### Why the base image is Debian, not Alpine

`better-sqlite3` ships prebuilt binaries for common platforms including **linux/arm64 on
glibc**. The gap is **musl**: Alpine builds frequently find no prebuild and fall back to
compiling from source, which needs a full C toolchain in the image.

So `node:<lts>-bookworm-slim` is chosen deliberately, not by habit. It gives prebuilt
binaries on both `linux/amd64` (the Proxmox host) and `linux/arm64` (the stated
requirement) with no compiler in the runtime image.

**This must be verified, not assumed.** A multi-architecture build with
`docker buildx --platform linux/amd64,linux/arm64` that actually *runs* on both is an
acceptance criterion of [WP-10](../planning/work-packages/WP-10-deployment-topology.md).
A native module that silently compiles during build is a slow build; one that silently
fails on arm64 is a broken deployment discovered late.

### Migrations

Forward-only `.sql` files applied at startup, with applied versions recorded in a
`schema_migrations` table. No ORM and no migration framework.

The reason is MVP acceptance criterion 13: a server restart must not lose data. That needs
a schema that evolves predictably, which is a small amount of disciplined SQL — not an
abstraction layer over a database this project will never outgrow.

Snapshots stay on the filesystem with the database holding the reference, per the brief.

---

## MQTT: `mqtt.js`

The established client for Node. ADR-002 needs a persistent session, a Last Will with
retain, QoS 1 publishing, and automatic reconnection with backoff; `mqtt.js` provides all
of them directly.

The reconnect behaviour needs explicit configuration rather than defaults: an unbounded
reconnect storm against a broker that is down is exactly the failure mode AGENTS.md
section 11 warns about, even on the server side where energy is not a concern.

---

## API specification: code-first

The OpenAPI document is generated from the Fastify route schemas and **committed to the
repository** at `docs/api/openapi.yaml`, so it is reviewable and diffable.

**Spec-first was considered** and is genuinely better when several teams build against a
contract in parallel. Here there is one developer, and the client shares TypeScript types
with the backend directly — so spec-first would add a generation step and a second source
of truth to solve a coordination problem that does not exist. Code-first makes drift
structurally impossible instead.

The generated document must be regenerated in CI and the build must fail if it differs
from the committed copy. Otherwise "generated from code" quietly becomes "written once and
forgotten".

---

## Logging

`pino`, structured JSON, with the fields the brief's section 27 requires: request ID,
device ID, event ID, session ID. Request ID comes from Fastify; the rest are attached at
the boundaries where they become known.

Secrets are never logged (AGENTS.md section 5). Device tokens and MQTT credentials are
redacted through pino's redaction paths rather than by remembering not to log them.

---

## Tests

Node's built-in `node:test` runner with `fastify.inject()`, which exercises the full
request pipeline — routing, validation, handler, serialisation — without opening a socket.

This covers the brief's required unit and integration tests, including
`event -> API -> DB`, `snapshot -> API -> filesystem` and `backend restart -> data
intact`, with no additional test framework dependency. If it later proves limiting,
adding one is a small change; starting with one that may not be needed is not
(AGENTS.md section 8).

---

## TLS

The backend terminates TLS itself and **generates a self-signed certificate on first start
if none is supplied**. No reverse proxy in the MVP.

ADR-003 established that the client needs HTTPS for microphone access and that a
self-signed certificate is sufficient for it. Making certificate generation automatic is
what makes the self-contained default in
[`constraints.md`](../planning/constraints.md) actually true — a first-time user runs one
command and gets a working system.

Supplying a certificate from the maintainer's own CA is configuration, not a code path:
if cert and key are provided, they are used.

---

## Consequences

- One container image, multi-architecture, serving API and client.
- No compiler in the runtime image; native prebuilds must resolve for both architectures,
  and this is verified in WP-10 rather than assumed.
- Route schemas are the single source for validation, types and the API document. WP-09
  writes schemas, not prose.
- Upload limits and content-type checking are enforced at the route schema and multipart
  configuration, with the file type confirmed from its actual bytes rather than from the
  declared header.
- The MQTT client's reconnect behaviour is configured with explicit bounds.
- CI regenerates the OpenAPI document and fails on a mismatch.

## Open questions

- Which Node LTS line at implementation time, and does `better-sqlite3` publish
  arm64 prebuilds for it? The answer changes with each Node major, so it is checked when
  Phase 2 starts rather than pinned here.
- Does the live-session coordination in ADR-001 need state that outlives a process
  restart, or is in-memory enough? In-memory until something shows otherwise — a session
  does not survive the device's wake window anyway.
- Snapshot retention: storage is finite and the brief excludes long-term recording. A
  retention policy is needed before this runs unattended, but it is not MVP scope.
