# Hardware baseline

Status of what the door device is built from, what is still undefined, and which facts
are verified against a primary source.

Every statement below is tagged:

| Tag | Meaning |
| --- | --- |
| **[V]** | Verified against a primary source, linked inline. |
| **[A]** | Architectural assumption. Reasonable, but not confirmed. Must not silently become a requirement. |
| **[O]** | Open question. Needs a decision or a measurement before it can be relied on. |

Last updated: 2026-08-19.

---

## 1. Main board

**DFRobot FireBeetle 2 ESP32-P4 AI Vision Board**, SKU DFR1172.

Sources: [product page](https://www.dfrobot.com/product-2915.html),
[wiki](https://wiki.dfrobot.com/dfr1172/).

| Property | Value | Tag |
| --- | --- | --- |
| SoC | ESP32-P4R32, dual-core RISC-V HP @ 360 MHz + single-core LP @ 40 MHz | **[V]** |
| PSRAM | 32 MB | **[V]** |
| Flash | 16 MB | **[V]** |
| On-chip memory | 768 KB HP L2MEM, 32 KB LP SRAM | **[V]** |
| Networking | ESP32-C6-MINI-1 over SDIO on GPIO 14-19 | **[V]** |
| Camera interface | MIPI-CSI, 2 lanes, Raspberry Pi 4B connector pinout | **[V]** |
| Display interface | MIPI-DSI, 2 lanes (unused by this project) | **[V]** |
| Microphone | PDM, on board, CLK = GPIO12, DATA = GPIO9 | **[V]** |
| Digital I/O | 24 pins; 5x UART, 2x I2C, I3C, 3x I2S, 2x SPI, SDIO 2.0, 8x PWM | **[V]** |
| Storage | microSD (TF) slot | **[V]** |
| USB | 2x Type-C (power / CDC programming, plus high-speed OTG 2.0) | **[V]** |
| Input voltage | 5 V via Type-C or VIN; logic 3.3 V | **[V]** |
| Dimensions | 25.4 x 60 mm | **[V]** |

### Not present on the board

Required by the product, but not provided by the board:

- **Speaker and audio output** — no amplifier and no audio codec on board. **[V]**
  An external I2S amplifier or codec is required; the board exposes 3x I2S. **[V]**
- **Camera module** — the CSI connector is present, the sensor is not. **[V]**
- **Battery connector, charging circuit, solar input** — none on the board. **[V]**
  Covered by the separate power module in section 2.
- **Motion sensor and doorbell button** — external. Selected in section 4. **[V]**

### Networking implication

The ESP32-P4 has no radio of its own. Wi-Fi and Bluetooth come from the ESP32-C6
co-processor over SDIO, driven by ESP-Hosted. **[V]**

This is exactly the situation AGENTS.md section 19 anticipates: the firmware must not
assume the network hardware is part of the main SoC. All network access goes behind a
`NetworkInterface` abstraction. Connection setup cost, C6 boot time and C6 sleep
behaviour are properties of the *co-processor*, and they belong in the power budget.

---

## 2. Power supply

**DFRobot Solar Power Manager 5V**, SKU DFR0559, based on CN3165.
Selected by the maintainer.

Source: [wiki](https://wiki.dfrobot.com/dfr0559).

| Property | Value | Tag |
| --- | --- | --- |
| Solar input | 4.5-6 V, with MPPT | **[V]** |
| USB input | 5 V | **[V]** |
| Battery | 3.7 V Li-ion / Li-Po, charge cutoff 4.2 V +/-1 % | **[V]** |
| Charge current | up to 900 mA; trickle / CC / CV | **[V]** |
| Regulated output | 5 V, **1 A** | **[V]** |
| Efficiency | 89 % @ 10 % load, 86 % @ 50 %, 83 % @ 90 % | **[V]** |
| Quiescent current | < 1 mA | **[V]** |
| Protection | overcharge 4.3 V, over-discharge 2.4 V, overcurrent 3 A, reverse polarity | **[V]** |
| Dimensions | 33 x 63 mm | **[V]** |

This module covers the supply side completely: panel input with MPPT, charge control,
battery protection including deep-discharge cutoff, and a regulated 5 V feed for the
board's VIN pin. Its own quiescent draw is negligible against the board's.

### Two constraints this creates

**2.1 — Output current headroom.** The module supplies 1 A. The board is specified at
peak 1050 mA in Wi-Fi STA mode. **[V]** That is at or slightly over the limit, and the
peaks coincide with transmit bursts — precisely when a doorbell event is being sent.
Bulk capacitance at VIN is the standard mitigation, but the required value follows from
measurement, not from a rule of thumb. **[O]** Tracked in WP-03.

**2.2 — The supply side is not the binding constraint.** See section 3.

---

## 3. The power problem

Board-level current consumption, all measured at 5 V on VIN by the vendor:

| State | Current | Tag |
| --- | --- | --- |
| Deep sleep | **31.5 mA** | **[V]** |
| Idle | 80 mA | **[V]** |
| Wi-Fi STA | avg 80 mA, peak 1050 mA | **[V]** |
| Wi-Fi AP | avg 130 mA, peak 1330 mA | **[V]** |

31.5 mA of deep-sleep draw is the central problem of this project.

Worked through: 31.5 mA at 5 V is 157.5 mW. Drawn from a 3.7 V cell through the module's
boost converter at roughly 86 % efficiency, that is about **50 mA continuous**, or
**~1200 mAh per day**, before a single event is handled. **[A]** — the arithmetic is
sound, but the efficiency figure and the vendor's sleep current are both unverified in
our configuration.

Replacing ~4.4 Wh/day from solar would need a panel around 12 W in a Central European
winter, and ten days of autonomy would need a cell around 21 Ah. **[A]** That is a garden
installation, not a doorbell. The full calculation is in
[`power-budget.md`](power-budget.md).

The conclusion does not depend on the precision of those assumptions:

> **The energy budget cannot be closed by enlarging the panel or the battery.
> It closes only by reducing the idle draw.**

### Where the idle draw comes from

The ESP32-P4 die itself is specified in the microamp range in deep sleep, so the 31.5 mA
is board circuitry, not the SoC. **[A]** Likely contributors: the ESP32-C6 module
remaining powered, the onboard regulators, the USB-serial bridge, and PSRAM retention.
Attribution is unconfirmed. **[O]**

### Resolution: external power gating

A latching load switch is placed between the power module output and the board's VIN. The
PIR or the doorbell button sets the latch; the firmware clears it when its work is done.
Between events the board is **fully unpowered**, and only the PIR, the latch and the
power module itself draw current.

Calculated in [`power-budget.md`](power-budget.md):

| | Board deep sleep | External power gating |
| --- | --- | --- |
| Daily consumption | ~1220 mAh/day | ~58 mAh/day |
| Required panel | ~12 W | ~2 W |
| Battery for 10 days | ~21 Ah | ~3 Ah |

A factor of about 21. The first is not a doorbell; the second is an ordinary outdoor
device. The load switch is therefore a **requirement of the design, not an
optimisation**.

The functional cost — no periodic telemetry, no spontaneous live view, the device
reachable only inside the wake window after an event — has been accepted by the
maintainer. See [`planning/constraints.md`](planning/constraints.md).

With the board gated off, the **power module's own quiescent current becomes 97 % of the
idle draw**. That, not the PIR, is the remaining lever.

**No battery life figure is stated in this project that is not calculated from listed
inputs** (AGENTS.md section 6). Since no measurement equipment is available, the budget
is a calculated estimate with visible assumptions, and it is labelled as such throughout.

---

## 4. Component selection

The maintainer has the board only, and delegated the remaining component choices. These
are recommendations with reasoning, not yet purchases. This is deliverable 12 of the
project brief. Tracked in WP-02.

### Camera — Raspberry Pi Camera Module v1 (OV5647)

`esp_cam_sensor` supports **OV5647** over MIPI-CSI, up to 2592x1944. **[V]**
([component registry](https://components.espressif.com/components/espressif/esp_cam_sensor))
The board's CSI connector follows the Raspberry Pi 4B pinout **[V]**, and the RPi Camera
Module v1 uses exactly that sensor — so it fits mechanically *and* has a driver.

> **Do not buy the v2 or v3 module.** The v2 uses IMX219 and the v3 uses IMX708.
> **Neither appears in the supported sensor list.** **[V]** This is the expensive mistake
> available here, because all three modules use the same connector.

Alternatives if the OV5647 disappoints: **SC2336** (1920x1080, MIPI) is what Espressif's
own EV board and the `doorbell_demo` examples use, so it is the best-supported path
through the WebRTC stack — but it is harder to source as a ready-made module. **OV5645**
and **OS02N10** are further MIPI options. **[V]**

Still open: lane count against the board's 2-lane CSI, field of view for doorbell
framing, and power-on to first usable frame. **[O]**

### Audio output — MAX98357A I2S amplifier

An I2S Class-D amplifier driving an 8 ohm speaker directly, with no separate codec
needed. It has a **shutdown pin**, which matters here: the firmware can de-power it
instead of leaving it drawing current through a live session. The board provides 3 I2S
buses. **[A]** — a common and reasonable choice, not yet validated against `av_render`.

Speaker: 8 ohm, 2-3 W, in a small sealed enclosure. **[A]**

### Motion sensor — HC-SR501 PIR, with adjustable hold time

**Revised.** The earlier choice was the AM312, picked for its ~12 µA quiescent against the
HC-SR501's ~50 µA. That reasoning was right about current and wrong about what matters.

The device is unpowered between activations, so it **cannot implement the motion
cooldown** — no timer runs while it is off. If the PIR asserts again the instant the latch
releases, the device boots again, and sustained motion becomes sustained booting. That is
the failure the cooldown requirement exists to prevent, and it has to be solved in
hardware.

The mechanism: the latch is **edge-triggered** on the PIR's rising edge, and the PIR's own
**hold time is the cooldown**. While the sensor holds its output high there is no new
rising edge, so no new activation is possible. The HC-SR501's hold time is adjustable from
a few seconds to several minutes; the AM312's is fixed at roughly two seconds, which is far
too short to serve as a cooldown.

The arithmetic on the trade: the extra ~38 µA costs about **1.4 mAh/day**, against a budget
of ~58 mAh/day. One avoided spurious activation costs 0.58 mAh, so the extra quiescent pays
for itself after about two prevented boots per day — and on a windy day with a moving
shrub in frame, it prevents far more than that. **[A]**

Set the sensor to repeatable ("H") mode so the output stays high while motion continues and
for the hold time after it stops.

Still open: supply voltage of the specific module (variants differ, 4.5-20 V is typical),
output logic level against the latch input, and lens coverage for the doorway. **[O]**

### Doorbell button

Momentary switch with an RC network for hardware debounce, in addition to firmware
debouncing. It must **set the power latch directly**, not merely signal a GPIO — a
powered-down board has no GPIO left to interrupt. **[A]**

### Power latch — edge-triggered

A latching load switch between the power module output and VIN, with two set inputs — the
PIR and the button — and a firmware-driven clear.

**It must trigger on the rising edge, not on level.** A level-triggered latch would
re-power the device immediately after the firmware releases it, because the PIR output is
still high at that moment. Edge triggering is what makes the PIR's hold time function as
the cooldown.

An off-the-shelf pushbutton power-switch module with ON and OFF inputs implements this; a
discrete P-MOSFET and N-MOSFET latch is the alternative. **[A]**

This is the component the entire energy design rests on. See section 3.

### Battery — 3000 mAh minimum, 5000 mAh preferred

Calculated in [`power-budget.md`](power-budget.md) section 5 from ~58 mAh/day, ten days of
autonomy, 80 % usable depth of discharge and cold derating. The calculated minimum is
~1000 mAh; the recommendation carries deliberate margin because the event estimates are
unmeasured. **[A]**

### Solar panel — 5 V, 2 W

Must be 4.5-6 V for the module's MPPT input. 2 W yields ~400 mA, comfortably under the
900 mA charge limit. The calculated requirement is 0.56 W; the recommendation carries a
3x margin for dirt, orientation and ageing. **[A]**

### Battery voltage sensing

The power module offers no telemetry output, so this needs an ADC divider from the cell to
a board ADC pin — placed on the gated side so it draws nothing while the board is off.
Channel, ratio and calibration still to define. **[O]**

### Mechanical

Enclosure, IP rating, panel mounting and orientation, camera aperture. **[O]**

### The one unresolved hardware risk

**Cold charging.** Li-ion must not be charged below 0 degrees C — doing so plates lithium,
permanently losing capacity and creating a safety concern. An outdoor doorbell in Central
Europe will see sub-zero temperatures regularly, and the DFR0559 specification lists no
temperature cutoff. **[O]**

Options: an NTC-based charge inhibit, a chemistry that tolerates cold charging, or an
accepted and documented reduction in cell life. This needs a decision before outdoor
deployment, and it is the only open hardware item that could damage something.
---

## 5. Consequences for the firmware

Independent of how the open questions resolve, three things follow already:

1. **Pins and part-specific behaviour live in one place.** A `board_config` component
   holds them; nothing else in the tree hardcodes a GPIO number (AGENTS.md section 7).
   Given how much of section 4 is still open, this is not stylistic — it is what keeps
   the application code from being rewritten when the parts arrive.
2. **Networking sits behind `NetworkInterface`.** The radio is on another chip.
3. **The device is powered off between events, not asleep.** The state machine models a
   cold boot on every wake, and its final act is releasing the power latch. There is no
   idle state to return to, and no state in which the device can be reached
   unsolicited — every session begins with a full boot and Wi-Fi association.
