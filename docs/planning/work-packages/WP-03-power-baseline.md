# WP-03: Power baseline and budget

| | |
| --- | --- |
| **Status** | done, with residual items |
| **Phase** | 0 |
| **Depends on** | WP-02 |
| **Blocks** | WP-04 — now released |

## Goal

Establish what the device draws, whether solar and battery operation is achievable, and
what the operating model has to be — because that determines which live-video
architectures are reachable in WP-04.

**Scope changed during the package.** It was written assuming measurement. No current
measurement equipment is available, so the budget is *calculated* from vendor figures and
stated assumptions instead. The compromise and its handling are recorded in
[`../constraints.md`](../constraints.md).

## Outcome

The question that blocked WP-04 is answered.

- Board deep sleep at 31.5 mA costs ~1220 mAh/day, needing a ~12 W panel and a ~21 Ah
  cell. Not a doorbell.
- With an external latching load switch, the board is fully unpowered between events:
  ~57 mAh/day, a 2 W panel and a 3000-5000 mAh cell. **A factor of about 21.**
- **The load switch is therefore a requirement of the design, not an optimisation.**
- The operating model is settled: deep power-off, woken only by button or motion, live
  sessions only inside the wake window after an event. Accepted by the maintainer.
- The sensitivity analysis shows the recommendation survives every plausible combination
  of wrong assumptions, which matters because the assumptions are unmeasured.

## Tasks

- [x] Convert board figures at VIN to battery current through the boost converter
- [x] Model idle draw under both scenarios
- [x] Model energy per motion event and per doorbell event with a live session
- [x] Compute daily consumption against assumed event rates
- [x] Size the battery, including depth of discharge and cold derating
- [x] Size the solar panel for a Central European winter
- [x] Sensitivity analysis over the uncertain inputs
- [x] Recommend an operating model and record what it costs functionally
- [ ] Read the board schematic, if DFRobot publishes one, to attribute the 31.5 mA
      between the C6, the regulators and the USB bridge — documentation work, not
      measurement, and it would sharpen the model
- [ ] Measure wake-to-network-ready in Phase 1 — this needs only a log timestamp and is
      the least certain input in the model
- [ ] Decide bulk capacitance at VIN against the 1050 mA transmit peak
- [ ] Replace assumed values with measured ones if measurement equipment appears

## Deliverables

- `docs/power-budget.md` — inputs, model, both scenarios, sizing, sensitivity, open issues

## Acceptance

- Every value is either **[V]** from vendor data with a source, or **[A]** with its
  reasoning stated. No unlabelled numbers.
- The model can be recomputed from its listed inputs, so a measurement can replace an
  assumption without rebuilding the structure.
- Battery and panel sizing follow from the daily figure for a stated worst-case season.
- The operating-model recommendation names what it costs — specifically that spontaneous
  live view does not survive.
- **No bare battery-life claim appears.** The document states a calculated estimate with
  visible assumptions, and says so (AGENTS.md section 6).

## Residual open items

Carried rather than closed:

- **Cold charging** — tracked in WP-02, the only item that can damage hardware.
- **VIN bulk capacitance** — the module supplies 1 A, the board peaks at 1050 mA. Start
  generous, treat brownouts during transmit as the symptom.
- **The model is unmeasured.** This is stated everywhere it matters rather than being
  quietly forgotten. If measurement equipment becomes available, the module quiescent
  current is the single most valuable thing to measure: it is 97 % of the idle draw and
  44 % of the daily budget.
