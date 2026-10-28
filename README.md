# Festo MS6 air-prep unit – 3D simulation

Open **`festo-air-prep-sim.html`** in a browser (single self-contained file, works offline).

Flow left → right: MS6 filter → MS6 on/off valve (**CIP, V2S1**, one coil) → distribution block →
MS6-SV-D safety dump (**V1S1 / V1S2**, dual coil, **FS1 / FS2** proximity switches, PLd) → distribution block → machine volume.

- **LEDs on each coil connector**: green = 24 VDC good, yellow = coil energised. Press *Control Reset*
  (button or the blue button in the 3D scene) and all six lights come on, blue lamp goes solid.
- **Soft-start screw** (turns n, counter-clockwise (+) = faster) uses the digitised Fig. 10 filling-flow curves
  (4/6/8/10 bar); the spool switches through to full flow at ~50 % p1 (adjustable 30–70 %, Fig. 5).
- **Pneumatic symbol diagram** follows the sim: valve positions, line colour = pressure, coil LEDs, FS1/FS2 contacts.
- **Simulated PLC** (20 ms scan): ladder-style rungs, I/O table, RUN latch, FS1/FS2 plausibility
  (discrepancy, no-switch, no-return), fault latch, diagnostic test (Tab. 6), blue-lamp blink logic.
- Timing chart in the style of Fig. 4 (V1S1, V1S2, FS1, FS2, p1, p2) and live operating point on the flow curves.
- **X-ray** button: translucent 3D bodies plus the Festo MS6-SV-D cutaway animation, scrubbed in sync with the simulated pressures (closed, soft-start, full flow), or play it as a loop. Clip source: `assets/safety-dump-xray.mp4` (embedded into the HTML by `build.py`).
- Fault injection: stuck FS1/FS2, broken coil wire, supply off, CIP not fitted, E-stop.

Build: `python3 build.py` inlines `src/*` and `vendor/three.min.js` (three.js r160, MIT).
Logic only (no DOM): `src/sim.js` can be run in node.
