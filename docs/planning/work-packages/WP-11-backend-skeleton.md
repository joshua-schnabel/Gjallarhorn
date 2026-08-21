# WP-11: Backend skeleton

| | |
| --- | --- |
| **Status** | done |
| **Phase** | 2 |
| **Depends on** | WP-07 (ADR-004), WP-09 (API), WP-10 (deployment) |
| **Blocks** | WP-12 .. WP-17 |

## Goal

Get a backend that starts, refuses to start when misconfigured, serves HTTPS with a
certificate it generated itself, answers a health check, and logs in the shape the project
requires. Everything after this is features on a working foundation.

The two things that decide whether the system works at all live here: **configuration
validation** and **TLS**. A backend that starts with a missing hostname and issues a
certificate for the wrong name pushes its failure onto the tablet, far from the cause.

## Tasks

- [x] `package.json`, `tsconfig.json`, TypeScript build
- [x] Config loader: parse environment, **fail loudly on missing required values**, with
      a message naming what is missing and why it matters
- [x] Structured logging with `pino`, request ids, secret redaction
- [x] TLS: load supplied certificate and key, or generate a local CA plus server
      certificate on first start and persist them
- [x] Serve the CA certificate at the configured download path
- [x] Fastify app factory, so tests can build an app without starting a listener
- [x] `GET /api/v1/health`
- [x] Tests with `node:test` and `fastify.inject()`
- [x] `Dockerfile`

## Deliverables

- `server/` — a service that starts and serves HTTPS
- Tests that run with `npm test`

## Acceptance

- `npm test` passes.
- Starting without `PUBLIC_HOSTNAME` **fails with a clear message** rather than starting.
- On first start with no certificate configured, a CA and a server certificate are
  generated, persisted, and reused on the next start rather than regenerated.
- The generated server certificate carries `PUBLIC_HOSTNAME` as a subject alternative
  name — this is what the tablet validates.
- `GET /api/v1/health` answers, and matches the shape in `openapi.yaml`.
- Secrets never appear in logs.
- No compiler needed in the runtime image; the build works for amd64 and arm64.

## Outcome

`server/` runs. **25 tests pass**, typecheck is clean, and the acceptance criteria were
verified against a running container rather than argued for.

| Criterion | Evidence |
| --- | --- |
| Refuses to start when misconfigured | Container exits **78** (`EX_CONFIG`) with a message naming every problem at once |
| Generates CA and certificate on first start | Log reports `tls:generated`; material persisted to the volume |
| Reuses them on the next start | Log reports `tls:reused`; CA fingerprint identical across restart |
| Certificate carries the configured name | Strict TLS verification against the generated CA **passed** for `doorbell.lan` |
| Verification is real, not vacuous | A wrong hostname is rejected (`ERR_TLS_CERT_ALTNAME_INVALID`) and an unrelated CA is rejected (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) |
| Health endpoint matches the spec | `200 {status:ok}` |
| No compiler in the runtime image | `node:24-bookworm-slim`, no build stage |

### Decisions taken while building

**No build step.** Node 24 executes TypeScript directly, verified before relying on it, so
`tsc` is used only to typecheck. This removes a build stage from the Dockerfile and a
class of source-map problems.

**Type stripping constrains the TypeScript.** `erasableSyntaxOnly` is enabled so the
compiler rejects syntax Node cannot strip. It caught a parameter property immediately -
better than a runtime failure in a container.

**`node-forge` for certificate generation.** Node can generate keys but cannot issue X.509
certificates. It is pure JavaScript, so it adds no native dependency and does not
complicate multi-architecture builds.

**The CA survives a hostname change.** Only the leaf is re-issued. Re-issuing the CA would
silently invalidate every tablet already provisioned.

**Health does not report MQTT.** Claiming to check a subsystem that does not exist yet
would be a health check that lies; the field is optional in the specification and is added
in WP-15.

## Open questions

- Certificate lifetime for the generated CA and leaf. A certificate that silently expires
  takes the doorbell UI with it, so renewal needs an answer before this runs unattended —
  probably a long-lived CA and a leaf renewed on start when close to expiry.
- Does the health check need to report MQTT connectivity from the start, or only once
  WP-15 exists? Reporting a subsystem that is not built yet would be dishonest.
