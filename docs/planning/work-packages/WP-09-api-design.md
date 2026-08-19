# WP-09: REST API design

| | |
| --- | --- |
| **Status** | todo |
| **Phase** | 0 |
| **Depends on** | WP-08 |
| **Blocks** | Phase 1 firmware HTTP client, Phase 2 backend, Phase 3 client |

## Goal

Specify the versioned REST API as an OpenAPI document, so firmware, backend and client
can be built against one contract rather than against each other. This is deliverable 9
of the project brief.

## Tasks

### Endpoints
Starting from the brief's proposal in section 14, which is explicitly a starting point
and not fixed:

- [ ] Device intake: `POST /api/v1/devices/{id}/events`,
      `.../snapshots`, `.../telemetry`
- [ ] Queries: `GET /api/v1/devices`, `/devices/{id}`, `/events`, `/snapshots`,
      `/snapshots/{id}`
- [ ] Live session: `POST /api/v1/devices/{id}/live/start`, `.../live/stop`
- [ ] `GET /api/v1/health`
- [ ] Add whatever the WP-08 sequence diagrams require and this list is missing —
      signaling endpoints in particular, if ADR-001 put signaling in the backend
- [ ] Pagination and filtering for the history endpoints, which the tablet needs

### Contract detail
- [ ] Request and response schemas for every endpoint
- [ ] Error model: consistent shape, meaningful status codes, no silent failures
- [ ] **Idempotency for event intake.** A device that retries after a failed upload must
      not create duplicate events. This matters because the firmware queues and retries
      (project brief section 21) — decide on an event ID supplied by the device or
      another mechanism.
- [ ] **Snapshot upload**: transfer format, size limit, content type checking, and
      whether metadata rides with the image or is posted separately. Consider what is
      cheapest for the device, since upload time is energy.
- [ ] Timestamps: format, and whether the device or the backend is authoritative. A
      power-gated device may boot without a reliable clock — this must line up with the
      same decision in WP-05.
- [ ] Telemetry payload: battery voltage, RSSI, wake reason, boot reason, uptime, free
      memory

### Security
- [ ] Device authentication: device ID plus token, and how the token is provisioned and
      rotated
- [ ] Client authentication for the tablet
- [ ] Input validation rules and upload limits
- [ ] Session timeouts
- [ ] Confirm the design works over HTTPS even if development uses plain HTTP

### Produce
- [ ] Write `docs/api/openapi.yaml`, following the spec-first or code-first approach
      chosen in WP-07's ADR
- [ ] Validate the document against the OpenAPI schema
- [ ] Provide request and response examples for each endpoint

## Deliverables

- `docs/api/openapi.yaml`

## Acceptance

- The document is valid OpenAPI and passes a validator.
- Every use case listed in the project brief section 14 is covered.
- Every endpoint has request and response schemas, error responses and an example.
- Event intake is idempotent, and the mechanism is documented.
- Upload limits and content type checking are specified, not left to implementation.
- Authentication is specified for both the device and the client.
- Every interaction in the WP-08 sequence diagrams has a corresponding endpoint.
- The API is versioned and the versioning strategy is stated.

## Open questions

- Does the device poll for pending commands, or is the flow purely device-initiated?
  A power-gated device cannot receive an unsolicited request, so any command channel has
  to be polled during the wake window — this shapes the API.
- Does the live-session flow need endpoints beyond start and stop? ADR-001 decides, in
  particular whether SDP and ICE candidates flow through this API.
- How long are snapshots retained, and is deletion part of the MVP API? Storage is
  finite and the brief excludes long-term recording.
