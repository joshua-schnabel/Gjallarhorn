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
| Base image | **`node:24-bookworm-slim`** — glibc; Alpine also verified to work |
| Migrations | Forward-only SQL files, tracked in a table. No ORM. |
| MQTT | **`mqtt.js`** |
| API specification | **Code-first**: generated from Fastify schemas, committed |
| Logging | **`pino`**, structured JSON |
| Tests | **`node:test`** with `fastify.inject()` |
| TLS | Terminated by the backend; local CA and certificate generated on first start |

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
keeps the code straightforward — and fast. Its cost is being a native module, which is
why the base image needed checking rather than assuming.

### Base image: Debian slim — corrected

**The original reasoning here was wrong, and testing refuted it.**

This ADR first claimed that `better-sqlite3` lacks arm64 prebuilds for musl, and that
Alpine would therefore fall back to compiling from source. That was based on reported
issues rather than a test. WP-10 ran the test:

| Image, `linux/arm64` under emulation | Install | Native module loads and queries |
| --- | --- | --- |
| `node:24-bookworm-slim` | 6 s, prebuilt | yes |
| `node:24-alpine` | 6 s, prebuilt | yes |

Both work. Neither needs a compiler in the image. The musl gap that drove the original
decision does not exist at these versions.

**The decision stays `node:24-bookworm-slim`, but for smaller and honest reasons:**

- **musl's DNS resolver differs from glibc's**, historically around search domains and
  TCP fallback for large responses. This project makes DNS a prerequisite and resolves a
  configured hostname, so the resolver is on a path that matters.
- **Image size is not a binding constraint here.** The deployment target is a Proxmox
  host, not a constrained SBC; ARM must be *supported*, not optimised for.

**Alpine is now a legitimate alternative**, and if image size ever becomes a real
constraint the switch is cheap and evidence already exists that it works. This is no
longer a forced choice, and it should not be quoted as one.

**What survives from the original reasoning** is the process rule: a multi-architecture
build must be *verified to run*, not assumed. A native module that silently compiles
during build is a slow build; one that silently fails on arm64 is a broken deployment
found late.

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

## TLS and certificates

The backend terminates TLS itself. No reverse proxy in the MVP.

ADR-003 requires a **genuinely trusted** certificate, because Chrome refuses to register a
service worker on an origin with a certificate error. Self-signed is therefore not
sufficient, and the backend must make a trusted certificate easy rather than leaving it to
the user.

On first start, if no certificate is supplied, the backend **generates a local CA and a
server certificate signed by it**, and serves the CA certificate at a well-known path so
the tablet can be provisioned in one step. That keeps the system self-contained while
producing an origin the browser actually trusts.

Supplying certificate and key — from the maintainer's existing home CA, or from Let's
Encrypt where the server is public — is configuration, not a separate code path.

The certificate is issued for a **configurable hostname**. DNS is a project
prerequisite, so a resolvable name may be assumed; the name itself varies per
installation and has no sensible default, so it is **required configuration** and the
backend fails at startup when it is unset. Issuing a certificate for a guessed name would
push the failure onto the tablet, far from its cause. See WP-10.

## Serving the client

**The backend serves the web UI from the same origin as the API.** One container, one
certificate, one port.

Per ADR-003 the UI is loaded into a WebView inside a native Android app rather than into a
browser, but it is served the same way and this decision is unaffected. WebView refuses
`getUserMedia` from `file://`, so the UI is served over HTTPS rather than bundled into the
app — which also keeps UI changes to a page reload instead of an app rebuild.

Same origin removes work: no CORS configuration, and static assets and API under one
certificate. The API is mounted under `/api/v1` so the two never collide.

The alternative — a separate container for the client — would need its own certificate and
either a second origin with CORS or a reverse proxy to unify them. Neither buys anything
at this size.

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

- Node 24 was verified. The answer can change with each Node major, so the arm64 install
  check is worth repeating on any Node upgrade rather than trusted once.
- Does the live-session coordination in ADR-001 need state that outlives a process
  restart, or is in-memory enough? In-memory until something shows otherwise — a session
  does not survive the device's wake window anyway.
- Snapshot retention: storage is finite and the brief excludes long-term recording. A
  retention policy is needed before this runs unattended, but it is not MVP scope.
