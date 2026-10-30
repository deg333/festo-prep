'use strict';
/* Plant (pneumatics + safety hardware) and PLC logic for the Festo MS6 air-prep unit.
   No DOM / WebGL in here so it can be unit-tested in node. */
const SIM = (() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---- Fig. 10 "Filling flow": throttle flow qn [l/min] vs. rotations n of the flow-control screw ----
     digitised from the Festo MS6-SV-D manual. n = 0 closed, counter-clockwise (+) opens. */
  const FLOW_Q = {
    4:  [0, 18, 28, 38, 50,  85, 150, 225, 295, 330, 348],
    6:  [0, 28, 42, 55, 70, 120, 215, 320, 415, 455, 487],
    8:  [0, 35, 55, 72, 95, 175, 285, 420, 525, 590, 630],
    10: [0, 45, 70, 90, 120, 230, 390, 545, 660, 730, 775],
  };
  const FLOW_P = [4, 6, 8, 10];
  function interpN(arr, n) {
    n = clamp(n, 0, 10);
    const i = Math.min(9, Math.floor(n));
    return arr[i] + (arr[i + 1] - arr[i]) * (n - i);
  }
  function qn(n, p1) {
    let q;
    if (p1 <= 4) q = interpN(FLOW_Q[4], n) * Math.max(p1, 0) / 4;
    else if (p1 >= 10) q = interpN(FLOW_Q[10], n);
    else {
      const i = FLOW_P.findIndex((p, k) => p1 >= p && p1 < FLOW_P[k + 1]);
      const a = interpN(FLOW_Q[FLOW_P[i]], n), b = interpN(FLOW_Q[FLOW_P[i + 1]], n);
      q = a + (b - a) * (p1 - FLOW_P[i]) / (FLOW_P[i + 1] - FLOW_P[i]);
    }
    return Math.max(q, 5 * p1 / 6); // small leakage floor so n = 0 still creeps up
  }

  /* Manual leak valve at the end of the tank: 0-100 % open, 100 % = 1/4" line. Orifice flow of air:
     choked above ~0.9 bar(g), subsonic below. Cd 0.7, flow in SCFM (14.7 psia / 68 F). */
  const GAMMA = 1.4, LEAK_D_IN = 0.25, LEAK_CD = 0.7, SCFM_K = 11.5, PATM = 1.01325, L_PER_SCFM = 28.3168;
  const LEAK_AREA = Math.PI / 4 * LEAK_D_IN * LEAK_D_IN;
  const psiFn = r => Math.sqrt(Math.pow(r, 2 / GAMMA) - Math.pow(r, (GAMMA + 1) / GAMMA));
  const R_CRIT = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));
  function leakScfm(pBarG, pct) {
    if (pct <= 0 || pBarG <= 0.005) return 0;
    const pAbsPsi = (pBarG + PATM) * 14.5038, r = PATM / (pBarG + PATM);
    const f = r <= R_CRIT ? 1 : psiFn(r) / psiFn(R_CRIT);
    return SCFM_K * LEAK_CD * LEAK_AREA * (pct / 100) * pAbsPsi * f;
  }

  const P_PILOT_ON = 3.5, P_PILOT_OFF = 2.0; // bar, MS6-SV-D operating range starts at 3.5 bar
  const T_SHIFT_UP = 0.12, T_SHIFT_DN = 0.08; // pilot piston / proximity switch travel times [s]
  const V_CIP_LINE = 0.5;                     // L between CIP valve and soft-start valve

  /* ------------------------------------------------------------------ PLC */
  function makePLC() {
    const m = {
      resetPrev: false, diagPrev: false,
      RUN: false, FAULT: false, code: 0, diag: 0, diagT: 0, diagResult: '',
      Q1: false, Q2: false, QC: false,
      tOn: 0, tOff: 0, tDisc: 0, blink: 0,
      REST_OK: true, DISC: false, rstR: false, LAMP: false, msg: '',
    };
    const FAULT_TEXT = {
      1: 'F1 FS1/FS2 plausibility (discrepancy)',
      2: 'F2 FS1/FS2 did not switch after V1S1+V1S2 ON',
      3: 'F3 FS1/FS2 did not return to normal after OFF',
      4: 'F4 diagnostic test failed',
    };

    function scan(I, dt) {
      const rstR = I.RESET && !m.resetPrev; m.resetPrev = I.RESET;
      const diagR = I.DIAG && !m.diagPrev; m.diagPrev = I.DIAG;
      m.rstR = rstR;
      m.REST_OK = I.FS1 && I.FS2 && !m.Q1 && !m.Q2;           // both valves in "bled-off" normal position
      m.DISC = I.FS1 !== I.FS2;

      // R3: fault reset (needs normal position + no discrepancy)
      if (m.FAULT && rstR && m.REST_OK && !m.DISC && I.ESTOP_OK) { m.FAULT = false; m.code = 0; }

      // R4: RUN latch (soft-start / safety dump enable)
      const start = rstR && I.SAFE && !m.FAULT && m.REST_OK && I.AIR_OK && m.diag === 0;
      m.RUN = (start || m.RUN) && I.SAFE && !m.FAULT;

      // diagnostic test (Festo manual Tab. 6: switch V1, check S1; V2, check S2)
      let dq1 = false, dq2 = false;
      if (m.diag === 0 && diagR && !m.RUN && I.SAFE && !m.FAULT && m.REST_OK && I.AIR_OK) {
        m.diag = 1; m.diagT = 0; m.diagResult = '';
      } else if (m.diag > 0) {
        if (!I.SAFE || m.RUN) { m.diag = 0; m.diagResult = 'aborted'; }
        else {
          m.diagT += dt;
          const step = m.diag;
          dq1 = step === 1; dq2 = step === 3;
          const ok = step === 1 ? (!I.FS1 && I.FS2)
                   : step === 2 ? I.FS1
                   : step === 3 ? (!I.FS2 && I.FS1)
                   : I.FS2;
          if (ok && m.diagT > 0.3) {
            if (step === 4) { m.diag = 0; m.diagResult = 'PASS'; } else { m.diag++; m.diagT = 0; }
          } else if (m.diagT > 2.5) {
            m.diag = 0; m.FAULT = true; m.code = 4; m.diagResult = 'FAIL step ' + step;
          }
        }
      }
      const diagOn = m.diag > 0;

      // R5: outputs
      m.Q1 = m.RUN || dq1;
      m.Q2 = m.RUN || dq2;
      m.QC = (m.RUN || diagOn) && I.CIP_EN;

      // R6..R8: plausibility timers
      m.tOn   = (m.Q1 && m.Q2 && !(!I.FS1 && !I.FS2)) ? m.tOn + dt : 0;
      m.tOff  = (!m.Q1 && !m.Q2 && !(I.FS1 && I.FS2) && !diagOn) ? m.tOff + dt : 0;
      m.tDisc = (m.DISC && !diagOn) ? m.tDisc + dt : 0;

      // R9: fault latch -> drops RUN and every output (valve spring-returns, p2 is dumped)
      if (!m.FAULT && (m.tOn >= 3 || m.tOff >= 3 || m.tDisc >= 0.5)) {
        m.FAULT = true; m.RUN = false; m.Q1 = m.Q2 = m.QC = false;
        m.code = m.tDisc >= 0.5 ? 1 : m.tOn >= 3 ? 2 : 3;
      }

      // R10: blue lamp in the Control Reset button
      m.blink += dt;
      if (!I.ESTOP_OK) m.LAMP = false;
      else if (m.FAULT) m.LAMP = (m.blink % 0.25) < 0.125;
      else if (m.RUN) m.LAMP = true;
      else m.LAMP = (m.blink % 1) < 0.5;

      // status text
      if (!I.ESTOP_OK) m.msg = 'E-STOP PRESSED - 24 V removed from all coils';
      else if (m.FAULT) m.msg = FAULT_TEXT[m.code] + ' - clear cause, press Control Reset';
      else if (m.diag) m.msg = 'DIAGNOSTIC step ' + m.diag + '/4';
      else if (m.RUN) m.msg = 'RUN - valves energised, air available';
      else if (!I.AIR_OK) m.msg = 'WAITING - supply air < 3.5 bar';
      else if (!m.REST_OK) m.msg = 'NOT READY - FS1/FS2 not in normal position';
      else m.msg = 'READY - press Control Reset (blue lamp blinking)';
      return m;
    }
    return { m, scan };
  }

  /* ---------------------------------------------------------------- plant */
  function makePlant() {
    const plc = makePLC();
    const P = {
      cfg: { supplyOn: true, P0: 6, n: 5, ratio: 0.5, V: 5, cipFitted: true, leakPct: 0 },
      faults: { fs1Stuck: false, fs2Stuck: false, v1s1Open: false, v1s2Open: false },
      ctl: { estop: false, reset: false, diag: false },
      s: {
        t: 0, pF: 0, pa: 0, p2: 0, kSafe: false, stage: 0, pilotOk: false,
        pos1: 0, pos2: 0, cipPos: 0, q: 0, qEx: 0, qExCip: 0, qLeak: 0,
      },
      plc,
      scanAcc: 0, resetPrev: false,
    };

    P.inputs = () => ({
      ESTOP_OK: !P.ctl.estop,
      SAFE: P.s.kSafe,
      RESET: P.ctl.reset,
      DIAG: P.ctl.diag,
      FS1: P.fs1(), FS2: P.fs2(),
      CIP_EN: P.cfg.cipFitted,
      AIR_OK: P.cfg.supplyOn && P.cfg.P0 >= 3.5,
    });
    P.fs1 = () => P.faults.fs1Stuck ? true : P.s.pos1 < 0.5;
    P.fs2 = () => P.faults.fs2Stuck ? true : P.s.pos2 < 0.5;
    // coil / connector state as seen by the LEDs
    P.coils = () => {
      const m = plc.m, s = P.s;
      const mk = (q, open) => ({ green: s.kSafe && !open, yellow: q && s.kSafe && !open });
      return {
        cip: P.cfg.cipFitted ? mk(m.QC, false) : { green: false, yellow: false },
        v1s1: mk(m.Q1, P.faults.v1s1Open),
        v1s2: mk(m.Q2, P.faults.v1s2Open),
      };
    };

    P.step = (h) => {
      const s = P.s, c = P.cfg, m = plc.m;
      s.t += h;

      // safety relay hardware (independent of PLC): E-stop drops it, Control Reset re-latches it
      if (P.ctl.estop) s.kSafe = false;
      else if (P.ctl.reset && !P.resetPrev) s.kSafe = true;
      P.resetPrev = P.ctl.reset;

      // PLC scan every 20 ms
      P.scanAcc += h;
      while (P.scanAcc >= 0.02) { P.scanAcc -= 0.02; plc.scan(P.inputs(), 0.02); }

      const co = P.coils();
      s.pF = c.supplyOn ? c.P0 : 0;

      // CIP on/off valve (3/2, spring closed, vents downstream line through port 3)
      const cipOpen = !c.cipFitted || co.cip.yellow;
      const target = cipOpen ? 1 : 0;
      s.cipPos += clamp(target - s.cipPos, -h / 0.1, h / 0.1);
      const paOld = s.pa;
      if (cipOpen) s.pa += (s.pF - s.pa) * (1 - Math.exp(-6 * h));
      else s.pa = Math.max(0, s.pa - (s.pa * 3 + 0.4) * h);
      s.qExCip = !cipOpen ? Math.max(0, (paOld - s.pa) * V_CIP_LINE * 60 / h) : 0;

      // pilot pressure + pilot valve pistons (proximity switch targets)
      if (s.pa >= P_PILOT_ON) s.pilotOk = true; else if (s.pa < P_PILOT_OFF) s.pilotOk = false;
      const t1 = co.v1s1.yellow && s.pilotOk ? 1 : 0, t2 = co.v1s2.yellow && s.pilotOk ? 1 : 0;
      s.pos1 += clamp(t1 - s.pos1, -h / T_SHIFT_DN, h / T_SHIFT_UP);
      s.pos2 += clamp(t2 - s.pos2, -h / T_SHIFT_DN, h / T_SHIFT_UP);

      // main spool: both pilot valves (series AND) must be actuated
      const shifted = s.pos1 >= 0.95 && s.pos2 >= 0.95;
      if (!shifted) s.stage = 0;
      else {
        if (s.stage === 0) s.stage = 1;
        if (s.stage === 1 && s.p2 >= c.ratio * s.pa) s.stage = 2; // switch-through at ~50 % p1
      }

      let dp = 0; s.q = 0; s.qEx = 0;
      if (s.stage === 0) {
        const rate = (s.p2 * 4 + 0.8) * (5 / c.V);
        dp = -Math.min(s.p2, rate * h);
        s.qEx = -dp / h * c.V * 60;
      } else if (s.stage === 1) {
        s.q = qn(c.n, s.pa);
        dp = s.q / 60 / c.V * h;
      } else {
        const qmax = 1500 * s.pa / 6;
        s.q = s.pa > s.p2 ? qmax * Math.min(1, (s.pa - s.p2) / (0.25 * s.pa + 0.01)) : 0;
        dp = s.q / 60 / c.V * h;
      }
      if (dp > 0) dp = Math.min(dp, Math.max(0, s.pa - s.p2));
      // manual leak valve at the end of the tank (flow in SCFM, converted to free-air l/min for the volume balance)
      s.qLeak = leakScfm(s.p2, c.leakPct);
      const dpLeak = Math.min(s.p2 + dp, s.qLeak * L_PER_SCFM / 60 / c.V * h);
      s.p2 = Math.max(0, s.p2 + dp - dpLeak);
      s.q = Math.max(s.q, 0);
    };

    // estimated time for p2 to reach the switch-through point at the current settings
    P.fillTimeEstimate = () => {
      const c = P.cfg, p1 = c.supplyOn ? c.P0 : 0;
      if (p1 < 3.5) return Infinity;
      const qt = qn(c.n, p1) - leakScfm(c.ratio * p1, c.leakPct) * L_PER_SCFM;
      if (qt <= 1) return Infinity;
      return c.ratio * p1 / (qt / 60 / c.V);
    };
    return P;
  }

  return { makePlant, qn, leakScfm, L_PER_SCFM, FLOW_Q, FLOW_P, clamp, P_PILOT_ON };
})();
if (typeof module !== 'undefined') module.exports = SIM;
