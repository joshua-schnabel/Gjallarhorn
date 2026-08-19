# WP-02: Hardware baseline and component selection

| | |
| --- | --- |
| **Status** | in progress |
| **Phase** | 0 |
| **Depends on** | WP-01 |
| **Blocks** | WP-03 |

## Goal

Pin down what the door device consists of. The maintainer has the board and the power
module and delegated the remaining choices, so this package selects the components and
records the reasoning. This is deliverable 12 of the project brief.

It stays in progress until the parts are actually sourced and the pin map is fixed.

## Tasks

- [x] Verify the FireBeetle 2 ESP32-P4 board specification against the vendor wiki
- [x] Verify the Solar Power Manager 5V (DFR0559) specification
- [x] Record what the board does *not* provide
- [x] **Camera**: confirmed `esp_cam_sensor` supports **OV5647** over MIPI-CSI, which is
      the Raspberry Pi Camera Module v1 sensor and matches the board's RPi-compatible CSI
      connector. Established that **IMX219 (v2) and IMX708 (v3) are not supported** —
      the trap worth avoiding, since all three share the connector.
- [x] **Audio output**: MAX98357A I2S amplifier, chosen for having a shutdown pin
- [x] **Motion sensor**: AM312 PIR, chosen for ~12 µA quiescent — it stays powered when
      the board does not, so its idle draw is one of only three permanent loads
- [x] **Power latch**: latching load switch, set by PIR and button, cleared by firmware
- [x] **Battery and panel**: sized in `docs/power-budget.md` — 3000 mAh minimum,
      5000 mAh preferred; 5 V / 2 W panel
- [ ] Source the parts and confirm availability
- [ ] Verify the OV5647 module's lane count against the board's 2-lane CSI
- [ ] Determine the camera's field of view and whether it frames a doorway usefully
- [ ] Measure power-on to first usable frame once hardware exists — an input to the
      wake budget that needs only a log timestamp
- [ ] Validate MAX98357A against `av_render` and assign its I2S bus and pins
- [ ] Define battery voltage sensing: ADC divider on the gated side, channel, ratio,
      calibration
- [ ] **Resolve cold charging** — see open questions, this is the one item that can
      damage hardware
- [ ] Fix the pin map and hand it to the firmware `board_config` component

## Deliverables

- `docs/hardware.md` — a living document, updated as parts are sourced and validated

## Acceptance

- Every entry in `docs/hardware.md` carries a **[V]** / **[A]** / **[O]** tag, and every
  **[V]** has a source link.
- Every selected component has its reasoning recorded, not just its part number.
- The open-parameter list is specific enough that `board_config` could be written the day
  the parts arrive — pins, voltages and timings, not part categories.
- The cold-charging question has a decision, not just a note.

## Open questions

- **Cold charging is the live risk.** Li-ion must not be charged below 0 degrees C, an
  outdoor doorbell in Central Europe will see that, and the DFR0559 lists no temperature
  cutoff. Options: NTC charge inhibit, a tolerant chemistry, or an accepted and
  documented reduction in cell life. Needs a decision before outdoor deployment.
- Does the OV5647 module physically fit the intended enclosure, and does its fixed focus
  suit doorway distances?
- The power latch is the one piece requiring actual electronics work. Off-the-shelf
  pushbutton power-switch modules implement it, but the maintainer has to build or buy
  it — worth confirming this is wanted before the design depends on it further.
