# Power budget

How much energy the door device needs, what battery and panel that implies, and what the
numbers depend on.

> **These figures are calculated, not measured.** No current measurement equipment is
> available (see [`planning/constraints.md`](planning/constraints.md)). Every derived
> value is tagged **[A]** and every input is listed, so any figure can be recomputed when
> measurement becomes possible. This document states a *calculated estimate with visible
> assumptions*. It does not claim a battery life.

Last updated: 2026-08-19.

---

## 1. Model inputs

### Fixed values, from vendor data **[V]**

| Input | Value | Source |
| --- | --- | --- |
| Board deep sleep | 31.5 mA @ 5 V | DFR1172 wiki |
| Board idle | 80 mA @ 5 V | DFR1172 wiki |
| Board Wi-Fi STA | avg 80 mA, peak 1050 mA @ 5 V | DFR1172 wiki |
| Power module boost efficiency | 86 % @ 50 % load | DFR0559 wiki |
| Power module quiescent | < 1 mA | DFR0559 wiki |
| Power module charge limit | 900 mA | DFR0559 wiki |

### Assumed values **[A]**

These are engineering estimates. They are the first things to replace with measurements.

| Input | Assumed | Reasoning |
| --- | --- | --- |
| Battery nominal voltage | 3.7 V | Li-ion / Li-Po |
| Wake to network ready | 5 s @ 120 mA | P4 boot plus C6 boot plus Wi-Fi association over SDIO |
| Camera init and capture | 3 s @ 150 mA | sensor power-up dominates; unverified until the module is chosen |
| Snapshot upload | 2 s @ 100 mA | ~200 KB over LAN Wi-Fi |
| Shutdown | 1 s @ 80 mA | |
| Live session | 90 s @ 250 mA | Wi-Fi plus camera plus H.264 hardware encode plus two-way audio |
| PIR quiescent | 12 µA @ 5 V | AM312 class sensor |
| Latch circuit quiescent | 5 µA @ 5 V | |
| Charge path efficiency | 75 % | MPPT plus charger losses |
| Winter yield | 0.5 peak sun hours/day | Central Europe December, wall-mounted, possibly shaded |
| Motion events per day | 20 | |
| Doorbell rings per day | 2 | |

### Conversion

Board figures are given at VIN = 5 V. Converting to current drawn from a 3.7 V cell
through the boost converter:

```
I_battery = I_5V * (5.0 / 3.7) / 0.86 = I_5V * 1.571
```

---

## 2. Two scenarios

The whole question is whether the board's 31.5 mA deep-sleep draw is present between
events or not.

### Scenario A — board deep sleep, no external gating

The board sleeps and wakes on button or motion, drawing its specified 31.5 mA in between.

```
idle:   31.5 mA @ 5 V  ->  49.5 mA from battery  ->  1188 mAh/day
events: ~32 mAh/day (see below)
------------------------------------------------------------
total:  ~1220 mAh/day  =  ~4.5 Wh/day
```

### Scenario B — external power gating

A latching load switch sits between the power module and the board's VIN. The PIR or the
button sets the latch; the firmware clears it when its work is finished. Between events
the board is **fully unpowered**, and only the PIR, the latch and the power module itself
draw current.

```
power module quiescent:  1.00 mA from battery  ->  24.0 mAh/day
PIR (12 µA @ 5 V):       0.019 mA              ->   0.45 mAh/day
latch (5 µA @ 5 V):      0.008 mA              ->   0.19 mAh/day
------------------------------------------------------------
idle subtotal:                                     24.6 mAh/day
```

Note what dominates: with the board gated off, the **power module's own quiescent current
is 97 % of the idle draw**. The PIR is noise by comparison.

---

## 3. Energy per event

At VIN, then converted to battery.

### Motion event

| Phase | Duration | Current @ 5 V | Charge @ 5 V |
| --- | --- | --- | --- |
| Wake, boot, Wi-Fi association | 5 s | 120 mA | 0.167 mAh |
| Camera init and capture | 3 s | 150 mA | 0.125 mAh |
| Upload | 2 s | 100 mA | 0.056 mAh |
| Shutdown | 1 s | 80 mA | 0.022 mAh |
| **Total** | **11 s** | | **0.370 mAh** |

From battery: 0.370 x 1.571 = **0.58 mAh per motion event** **[A]**

### Doorbell event with a 90 s live session

| Phase | Duration | Current @ 5 V | Charge @ 5 V |
| --- | --- | --- | --- |
| Wake, boot, Wi-Fi association | 5 s | 120 mA | 0.167 mAh |
| Live session | 90 s | 250 mA | 6.250 mAh |
| Teardown | 2 s | 80 mA | 0.044 mAh |
| **Total** | **97 s** | | **6.46 mAh** |

From battery: 6.46 x 1.571 = **10.15 mAh per ring** **[A]**

### Daily total, Scenario B

```
idle:                   24.6 mAh/day
20 motion events:       11.6 mAh/day
2 doorbell rings:       20.3 mAh/day
--------------------------------------
total:                  56.5 mAh/day  =  0.21 Wh/day
```

---

## 4. The comparison that decides the design

| | Scenario A (deep sleep) | Scenario B (power gating) |
| --- | --- | --- |
| Daily consumption | ~1220 mAh/day | ~57 mAh/day |
| Required panel | ~12 W | ~2 W |
| Battery for 10 days autonomy | ~21 Ah | ~3 Ah |
| Buildable as a doorbell | no | yes |

**Scenario B uses about 1/21 of the energy.** A 12 W panel and a 21 Ah battery is not a
doorbell, it is a garden installation. A 2 W panel and a 3000 mAh cell is an ordinary
outdoor device.

This is why the external load switch is a requirement of the design, not an
optimisation — and why it is worth the functional cost of the device being fully off
between events, which the maintainer has accepted.

---

## 5. Recommended sizing

### Battery

```
daily consumption:            56.5 mAh/day
10 days autonomy:            565 mAh usable
usable depth of discharge:   / 0.80  ->  706 mAh
cold derating at 0 degrees:  / 0.70  ->  1009 mAh minimum
```

**Recommendation: 3000 mAh minimum, 5000 mAh preferred.** **[A]**

The margin over the calculated 1009 mAh is deliberate. The event estimates carry a
plausible factor of two to three of uncertainty, and the cost difference between a
3000 mAh and a 5000 mAh cell is small compared to the cost of finding out in January that
it is too small.

### Solar panel

```
daily need:                 0.21 Wh/day
charge path efficiency:     / 0.75  ->  0.28 Wh/day from the panel
winter yield:               / 0.5 peak sun hours  ->  0.56 W
margin for dirt, orientation, ageing:  x 3
```

**Recommendation: 5 V, 2 W panel.** **[A]**

It must be 4.5-6 V for the module's MPPT input. At 2 W it delivers around 400 mA, well
within the module's 900 mA charge limit, so no current limiting is needed.

---

## 6. Sensitivity

Which assumptions actually matter, and what happens if they are wrong:

| If this changes | Daily total becomes | Comment |
| --- | --- | --- |
| Baseline | 57 mAh/day | |
| Module quiescent is 0.5 mA, not 1 mA | 45 mAh/day | idle is the largest single term |
| Module quiescent is 2 mA | 81 mAh/day | worth measuring first, if anything is measured |
| Live session draws 400 mA | 69 mAh/day | |
| Wake takes 15 s, not 5 s | 64 mAh/day | |
| 100 motion events/day (busy street) | 103 mAh/day | |
| All of the pessimistic cases together | ~150 mAh/day | |

Even the fully pessimistic combination is served by a 5000 mAh cell and a 2 W panel with
room to spare. **The recommendation is robust against being wrong about the details** —
which matters, because without measurement the details are exactly what is uncertain.

The conclusion that survives regardless: Scenario A fails by an order of magnitude,
Scenario B succeeds with margin. No plausible correction to these assumptions changes
that.

---

## 7. Open issues

**Cold charging.** Li-ion must not be charged below 0 degrees C. A doorbell in Central
Europe will see that regularly. The DFR0559 specification lists no temperature cutoff.
Charging a cold cell causes lithium plating: permanent capacity loss, and a safety
concern. This needs resolving before outdoor deployment — an NTC cutoff, a chemistry that
tolerates it, or an accepted and documented lifetime reduction. **[O]**

**VIN peak current.** The module supplies 1 A and the board peaks at 1050 mA during Wi-Fi
transmission. Bulk capacitance at VIN is the standard mitigation, but the value follows
from measurement. Without measurement, start generous — a few hundred µF of low-ESR
capacitance — and treat brownouts during transmit as the symptom to watch for. **[O]**

**The 31.5 mA has not been attributed.** Reading the board schematic, if DFRobot
publishes it, would establish how much is the C6 module, the regulators and the USB
bridge. That is a documentation exercise rather than a measurement, and it would sharpen
Scenario A — though it would not change the decision, since Scenario B is chosen anyway.
**[O]**

**Wake duration is the least certain input.** Boot plus C6 boot plus SDIO bring-up plus
Wi-Fi association is assumed at 5 s. It could plausibly be 15 s. It can be measured with
nothing more than a log timestamp once firmware exists, and it should be, in Phase 1.
