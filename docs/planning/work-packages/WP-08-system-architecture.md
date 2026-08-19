# WP-08: System architecture and diagrams

| | |
| --- | --- |
| **Status** | todo |
| **Phase** | 0 |
| **Depends on** | WP-04, WP-05, WP-06, WP-07 |
| **Blocks** | WP-09, WP-10, Phase 1 |

## Goal

Consolidate the four decisions into one coherent architecture, and describe it in
diagrams that make the data flow and the device's behaviour unambiguous. This produces
deliverables 1 to 4 and 8 of the project brief.

It depends on all four spikes because an architecture drawn before them would be
speculation.

## Tasks

### System view
- [ ] System architecture diagram: door device, backend, client, MQTT broker, and the
      media server if ADR-001 selected one. Show which protocol carries what.
- [ ] Component breakdown for each of the three software components
- [ ] Trust boundaries and where authentication happens

### Sequence diagrams
- [ ] **Doorbell ring**: button through wake, event, backend, MQTT, tablet notification,
      and the live window. Include the debounce point and the wake window duration.
- [ ] **Motion**: `motion -> wake -> capture -> upload -> event -> cooldown -> sleep`,
      showing where the cooldown is enforced and what happens if the upload fails.
- [ ] **Live call**: signaling, ICE, media paths for video and both audio directions,
      and session teardown. Show explicitly how the device returns to its low-power state
      afterwards — MVP acceptance criterion 12.
- [ ] **Failure paths**: at minimum backend unreachable and live session setup failing.
      The brief's section 20 lists nine failure situations; the diagrams should make clear
      that none of them produces an unbounded retry.

### Firmware state machine
- [ ] Define the states, starting from the brief's proposal (`BOOT`, `INITIALIZING`,
      `IDLE`, `LOW_POWER`, `WAKE_MOTION`, `WAKE_DOORBELL`, `CAPTURING`, `UPLOADING`,
      `READY_FOR_LIVE`, `LIVE_SESSION`, `SESSION_ENDING`, `ERROR_RECOVERY`) and improve it
      where the WP-03 result requires
- [ ] For every state, state which peripherals must be powered: camera, audio, network
- [ ] Define every transition, including timeouts and error transitions
- [ ] Make the low-power exit explicit — whether it is deep sleep or a hard power-off
      depends on WP-03, and the state machine must express whichever wins
- [ ] Answer, for any state: why is the device awake, what must be on, when can it sleep

### Cross-cutting
- [ ] Data flow diagram covering events, snapshots and telemetry
- [ ] Configuration model: which values live on which component (project brief section 26)
- [ ] Error handling and retry strategy, with bounds
- [ ] Write `docs/architecture.md` as the entry point, with detail in
      `docs/architecture/`

## Deliverables

- `docs/architecture.md` — the overview and entry point
- `docs/architecture/` — diagrams and detail, as Mermaid so they are diffable

## Acceptance

- Deliverables 1, 2, 3, 4 and 8 of the project brief section 35 are covered.
- Every diagram is consistent with the four ADRs. No diagram shows a mechanism that no
  ADR chose.
- The state machine names, for every state, which peripherals are powered and what the
  exit conditions are.
- Retry and timeout behaviour is bounded everywhere it appears, and the bound is visible
  in the diagram or the accompanying text.
- Diagrams are Mermaid in version control, not binary images.
- The reasoning is recorded, not just the result (AGENTS.md section 10).

## Open questions

- How long is the wake window after an event? The brief suggests 60 to 120 seconds. The
  real answer is an energy trade-off and depends on WP-03.
- What happens to a live session request that arrives after the window has closed?
  Fail visibly on the tablet, or queue until the next wake?
- Does the architecture need to accommodate more than one door device? The brief excludes
  multi-tenant from the MVP, but the device ID is in the API and topic schema from the
  start, so this costs little if the shape is right.
