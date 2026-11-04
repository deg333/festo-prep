'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const P = SIM.makePlant();
  window.festoSim = P; // handy for experiments from the browser console
  const plc = P.plc.m;
  const fmt = (v, d = 1) => v.toFixed(d);
  const pcol = p => p < 0.05 ? '#9aa3ad' : 'hsl(212,88%,' + Math.max(34, 62 - 3.2 * p) + '%)';   // blue = compressed air, darker = higher pressure

  /* ---------------- controls ---------------- */
  const bind = (id, fn, out) => {
    const el = $(id), o = out && $(out);
    const f = () => { fn(el); if (o) o.textContent = out === 'oP0' ? fmt(+el.value) + ' bar' : ''; refreshNotes(); };
    el.addEventListener('input', f); f(); return el;
  };
  function refreshNotes() {
    const c = P.cfg;
    $('oP0').textContent = fmt(c.P0) + ' bar';
    $('oN').textContent = fmt(c.n) + ' turns';
    $('oRatio').textContent = fmt(c.ratio * 100, 0) + ' % p1';
    $('oV').textContent = fmt(c.V) + ' L';
    $('oLeak').textContent = fmt(c.leakPct, 0) + ' %';
    $('leakNote').textContent = '100 % = 1/4" line open to atmosphere (Cd 0.7). At ' + fmt(c.P0) + ' bar the full 1/4" leak is ~' + fmt(SIM.leakScfm(c.P0, 100), 0) + ' SCFM.';
    const t = P.fillTimeEstimate();
    $('nNote').textContent = 'Counter-clockwise (+) = more flow = faster pressure build-up. Fill to switch-through: ' +
      (isFinite(t) ? '~' + fmt(t, t < 10 ? 1 : 0) + ' s' : c.leakPct > 0 && c.supplyOn && c.P0 >= 3.5 ? 'never - leak exceeds the soft-start flow' : 'no supply') + (c.n < 0.5 ? ' (screw nearly closed: creeping)' : c.n > 9 ? ' (nearly instantaneous)' : '') + '.';
  }
  bind('cSupply', e => P.cfg.supplyOn = e.checked);
  bind('sP0', e => P.cfg.P0 = +e.value);
  bind('sN', e => P.cfg.n = +e.value);
  bind('sRatio', e => P.cfg.ratio = +e.value / 100);
  bind('sV', e => P.cfg.V = +e.value);
  bind('sLeak', e => P.cfg.leakPct = +e.value);
  bind('cCip', e => P.cfg.cipFitted = e.checked);
  bind('fFs1', e => P.faults.fs1Stuck = e.checked);
  bind('fFs2', e => P.faults.fs2Stuck = e.checked);
  bind('fV1', e => P.faults.v1s1Open = e.checked);
  bind('fV2', e => P.faults.v1s2Open = e.checked);
  let speed = 1; $('sSpeed').addEventListener('change', e => speed = +e.target.value);

  const bReset = $('bReset');
  let resetTimer = 0;
  const pressReset = on => { P.ctl.reset = on; bReset.classList.toggle('lit', on); };
  bReset.addEventListener('pointerdown', e => { bReset.setPointerCapture(e.pointerId); pressReset(true); });
  bReset.addEventListener('pointerup', () => pressReset(false));
  bReset.addEventListener('pointercancel', () => pressReset(false));
  const toggleEstop = () => { P.ctl.estop = !P.ctl.estop; $('bEstop').classList.toggle('pressed', P.ctl.estop); $('bEstop').textContent = 'E-STOP: ' + (P.ctl.estop ? 'PRESSED' : 'released'); };
  $('bEstop').addEventListener('click', toggleEstop);
  $('bDiag').addEventListener('click', () => { P.ctl.diag = true; setTimeout(() => P.ctl.diag = false, 300); });
  $('bRestart').addEventListener('click', () => location.reload());
  View3D.onAction = a => {
    if (a === 'estop') toggleEstop();
    else if (a === 'reset') { pressReset(true); clearTimeout(resetTimer); resetTimer = setTimeout(() => pressReset(false), 450); }
  };
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    View3D.view(b.dataset.view); document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
  }));
  /* X-ray: translucent 3D bodies + Festo MS6-SV-D cutaway video. Video time is scrubbed from the simulated state
   (clip seconds: 1 normal, 3.2 pilots on, 4-9 soft-start, 9-12.5 full flow). */
  const xv = $('xrVid'), xp = $('xrayPanel'); let xOn = false, xCur = 2, xPlay = false;
  xv.addEventListener('error', () => { xp.hidden = true; });
  document.querySelectorAll('[name=xrmode]').forEach(r => r.addEventListener('change', () => {
    xPlay = r.value === 'play' && r.checked; if (xPlay) { xv.loop = true; xv.play(); } else { xv.pause(); xv.loop = false; }
  }));
  $('bXray').addEventListener('click', e => {
    xOn = !xOn; e.target.classList.toggle('on', xOn); View3D.setXray(xOn); xp.hidden = !xOn;
    if (xOn && xPlay) xv.play(); else xv.pause();
  });
  function xrayTarget() {
    const s = P.s, c = P.cfg, r = s.p2 / Math.max(s.pa, s.p2, 0.1);
    if (s.pa < 0.3 && s.p2 < 0.1) return [1.0, 'no supply pressure'];
    if (r < 0.02) return [s.stage ? 3.2 : 2.0, s.stage ? 'pilots energised' : 'closed, outlet exhausted'];
    if (r < c.ratio) return [4 + 5 * r / c.ratio, s.stage === 0 ? 'exhausting' : 'soft-start (throttled)'];
    return [9 + 3.5 * Math.min(1, (r - c.ratio) / (1 - c.ratio)), s.stage === 0 ? 'exhausting' : 'full flow'];
  }
  function updateXray(dt) {
    if (!xOn || xPlay || xv.readyState < 2) return;
    const [t, txt] = xrayTarget(); $('xrState').textContent = txt;
    xCur += (t - xCur) * Math.min(1, dt * 8);
    if (!xv.seeking && Math.abs(xv.currentTime - xCur) > 0.02) xv.currentTime = xCur;
  }

  /* ---------------- PLC I/O + ladder ---------------- */
  const io = [
    ['I300', 'ESTOP_OK', 'E-stop chain healthy (sim)', () => !P.ctl.estop],
    ['I303', 'SAFE_FB', 'Safety relay 24 V feedback (sim)', () => P.s.kSafe],
    ['I304', 'RESET_PB', 'Control Reset pushbutton (sim)', () => P.ctl.reset],
    ['I301', 'FS1', 'PL-FS1  prox. switch S1 (1 = normal)', () => P.fs1()],
    ['I302', 'FS2', 'PL-FS2  prox. switch S2 (1 = normal)', () => P.fs2()],
    ['I305', 'AIR_OK', 'Supply pressure switch >= 3.5 bar (sim)', () => P.cfg.supplyOn && P.cfg.P0 >= 3.5],
    ['I306', 'CIP_EN', 'CIP valve fitted selector (sim)', () => P.cfg.cipFitted],
    ['224T', 'Q_V1S1', 'PL-V1S1  safety coil 1', () => plc.Q1],
    ['224T', 'Q_V1S2', 'PL-V1S2  safety coil 2', () => plc.Q2],
    ['224T2', 'Q_V2S1', 'PL-V2S1  CIP coil', () => plc.QC],
    ['Q307', 'LAMP_RESET', 'Blue lamp in Control Reset (sim)', () => plc.LAMP],
  ];
  $('ioTable').innerHTML = '<tr><th></th><th>Addr</th><th>Tag</th><th>Description</th></tr>' +
    io.map((r, i) => '<tr><td><i class="led" id="io' + i + '"></i></td><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('');

  const N = (name, fn) => ({ name, fn });
  const NOT = (name, fn) => ({ name: '/' + name, fn: () => !fn() });
  const rungs = [
    { t: 'R1  Normal position: both pilot valves bled off', c: [N('FS1', () => P.fs1()), N('FS2', () => P.fs2()), NOT('Q_V1S1', () => plc.Q1), NOT('Q_V1S2', () => plc.Q2)], q: ['REST_OK', () => plc.REST_OK] },
    { t: 'R2  Fault reset (Control Reset with valves in normal position)', c: [N('FAULT', () => plc.FAULT), N('RESET_R', () => plc.rstR), N('REST_OK', () => plc.REST_OK), NOT('FS1<>FS2', () => plc.DISC)], q: ['unlatch FAULT', () => plc.FAULT && plc.rstR && plc.REST_OK && !plc.DISC] },
    { t: 'R3  RUN latch  (RESET_R ... OR RUN seal-in)', c: [N('RESET_R | RUN', () => plc.rstR || plc.RUN), N('SAFE_FB', () => P.s.kSafe), NOT('FAULT', () => plc.FAULT), N('REST_OK | RUN', () => plc.REST_OK || plc.RUN), N('AIR_OK', () => P.cfg.supplyOn && P.cfg.P0 >= 3.5 || plc.RUN)], q: ['RUN', () => plc.RUN] },
    { t: 'R4  Safety coils (dual channel) - same command, separate outputs', c: [N('RUN | DIAG1', () => plc.Q1)], q: ['Q_V1S1  (224T)', () => plc.Q1] },
    { t: '', c: [N('RUN | DIAG3', () => plc.Q2)], q: ['Q_V1S2  (224T)', () => plc.Q2] },
    { t: 'R5  Optional CIP valve', c: [N('RUN | DIAG', () => plc.RUN || plc.diag > 0), N('CIP_EN', () => P.cfg.cipFitted)], q: ['Q_V2S1  (224T2)', () => plc.QC] },
    { t: 'R6  Plausibility: coils ON > 3 s but FS1 & FS2 not both 0', c: [N('Q_V1S1', () => plc.Q1), N('Q_V1S2', () => plc.Q2), NOT('FS1=0&FS2=0', () => !P.fs1() && !P.fs2())], q: ['TON 3 s  ' + '', () => plc.tOn > 0] },
    { t: 'R7  Discrepancy: FS1 <> FS2 for > 0.5 s', c: [N('FS1<>FS2', () => plc.DISC), NOT('DIAG', () => plc.diag > 0)], q: ['TON 0.5 s', () => plc.tDisc > 0] },
    { t: 'R8  Coils OFF > 3 s but FS not back to 1', c: [NOT('Q_V1S1', () => plc.Q1), NOT('Q_V1S2', () => plc.Q2), NOT('FS1&FS2', () => P.fs1() && P.fs2())], q: ['TON 3 s', () => plc.tOff > 0] },
    { t: 'R9  Fault latch: drops RUN, all coils spring-return, p2 is exhausted', c: [N('T6 | T7 | T8 | DIAG fail', () => plc.FAULT)], q: ['FAULT', () => plc.FAULT] },
    { t: 'R10 Blue lamp: off = E-stop, blink 1 Hz = ready, solid = RUN, fast blink = fault', c: [N('ESTOP_OK', () => !P.ctl.estop)], q: ['LAMP_RESET', () => plc.LAMP] },
  ];
  $('ladder').innerHTML = rungs.map((r, i) =>
    '<div class="rung">' + (r.t ? '<div class="t">' + r.t + '</div>' : '') + '<span class="w on"></span>' +
    r.c.map((c, j) => '<span class="c" id="rc' + i + '_' + j + '">' + c.name + '</span><span class="w" id="rw' + i + '_' + j + '"></span>').join('') +
    '<span class="q" id="rq' + i + '">' + r.q[0] + '</span></div>').join('') +
    '<p class="note" id="plcExtra"></p>';
  function updatePLC() {
    io.forEach((r, i) => $('io' + i).classList.toggle('on', !!r[3]()));
    rungs.forEach((r, i) => {
      let all = true;
      r.c.forEach((c, j) => { const v = !!c.fn(); all = all && v; $('rc' + i + '_' + j).classList.toggle('on', v); $('rw' + i + '_' + j).classList.toggle('on', all); });
      $('rq' + i).classList.toggle('on', !!r.q[1]());
    });
    $('plcExtra').textContent = 'Timers: T6 ' + fmt(plc.tOn, 1) + ' s, T7 ' + fmt(plc.tDisc, 2) + ' s, T8 ' + fmt(plc.tOff, 1) + ' s' +
      (plc.diag ? ' | diag step ' + plc.diag + '/4' : plc.diagResult ? ' | last diagnostic: ' + plc.diagResult : '');
  }

  /* ---------------- pneumatic diagram ---------------- */
  const S = id => $(id);
  const ledFill = (id, on, col) => { const e = S(id); e.setAttribute('fill', on ? col : '#e1e5ea'); e.setAttribute('stroke', on ? '#333' : '#8a929b'); e.setAttribute('stroke-width', on ? 1.5 : 1); };
  const show = (id, on) => S(id).setAttribute('display', on ? 'inline' : 'none');
  let dash = 0;
  function updatePneu(dt) {
    const s = P.s, c = P.cfg, co = P.coils();
    dash = (dash - dt * (20 + s.q / 8)) % 1000;
    const stroke = (id, p, flowing) => { const e = S(id); e.setAttribute('stroke', pcol(p)); e.setAttribute('stroke-dasharray', flowing && p > 0.1 ? '10 8' : ''); e.setAttribute('stroke-dashoffset', dash); };
    const fl = s.q > 1 || (s.pa > 0.1 && s.pa < s.pF - 0.05);
    stroke('pp0', s.pF, fl); stroke('pp1', s.pF, fl);
    stroke('pp2', s.pa, s.q > 1); stroke('pp3', s.p2, s.q > 1); stroke('pG', s.p2, false);
    stroke('pPil', s.pos1 > 0.9 && s.pos2 > 0.9 ? s.pa : 0, false);
    // CIP valve
    const open = !c.cipFitted || co.cip.yellow;
    for (const [id, on] of [['cipL', open], ['cipR', !open]]) {
      const g = S(id), r = g.querySelector('.bx');
      r.setAttribute('stroke', on ? '#0a9d5a' : '#8a929b'); r.setAttribute('stroke-width', on ? 3.5 : 1.5); r.setAttribute('fill', on ? 'rgba(10,157,90,.14)' : 'none'); g.setAttribute('opacity', on ? 1 : 0.55);
    }
    stroke('cP1', s.pF, false); stroke('cP2', s.pa, s.q > 1); stroke('pCipOut', s.pa, s.q > 1);
    S('cL1').setAttribute('stroke', pcol(s.pF)); S('cL1h').setAttribute('fill', pcol(s.pF));
    S('cR2').setAttribute('stroke', pcol(s.pa)); S('cR2h').setAttribute('fill', pcol(s.pa));
    stroke('cipEx', open ? 0 : s.pa, !open && s.qExCip > 1);
    ledFill('svgCipG', co.cip.green, '#22ff77'); ledFill('svgCipY', co.cip.yellow, '#ffc400');
    S('gCip').setAttribute('opacity', c.cipFitted ? 1 : 0.45);
    S('cipNF').textContent = c.cipFitted ? '' : 'NOT FITTED - straight through';
    // soft-start valve: highlight the active position box
    const energised = co.v1s1.yellow && co.v1s2.yellow;
    const active = s.stage === 1 ? 1 : s.stage === 2 ? 2 : energised ? 3 : 4;
    for (let i = 1; i <= 4; i++) {
      const r = S('svB' + i).querySelector('.bx'), on = i === active;
      r.setAttribute('stroke', on ? '#0a9d5a' : '#8a929b'); r.setAttribute('stroke-width', on ? 3.5 : 1.5);
      r.setAttribute('fill', on ? 'rgba(10,157,90,.14)' : 'none');
      S('svB' + i).setAttribute('opacity', on ? 1 : 0.55);
    }
    S('sB1a').setAttribute('stroke', pcol(s.pa)); S('sB1h').setAttribute('fill', pcol(s.pa));
    S('sB2a').setAttribute('stroke', pcol(s.pa)); S('sB2h').setAttribute('fill', pcol(s.pa));
    S('sB4e').setAttribute('stroke', pcol(s.p2)); S('sB4h').setAttribute('fill', pcol(s.p2));
    stroke('pt1', s.pa, s.q > 1); stroke('pt2', s.p2, s.q > 1);
    stroke('pt3', s.stage === 0 ? s.p2 : 0, s.qEx > 1);
    S('sThr').setAttribute('stroke', s.stage === 1 ? '#7a3aa8' : '#1b1f24'); S('sThrH').setAttribute('fill', s.stage === 1 ? '#7a3aa8' : '#1b1f24');
    S('svPos').textContent = ['EXHAUST (spring return)', 'SOFT-START (throttled)', 'FULL FLOW'][s.stage] + (s.stage === 0 && energised ? ' - pilots shifting' : '');
    S('svPos').setAttribute('fill', ['#c0392b', '#7a3aa8', '#0a8a4f'][s.stage]);
    ledFill('svgV1G', co.v1s1.green, '#22ff77'); ledFill('svgV1Y', co.v1s1.yellow, '#ffc400');
    ledFill('svgV2G', co.v1s2.green, '#22ff77'); ledFill('svgV2Y', co.v1s2.yellow, '#ffc400');
    const f1 = P.fs1(), f2 = P.fs2();
    ledFill('svgFS1', f1, '#ffb300'); ledFill('svgFS2', f2, '#ffb300');
    S('fs1sw').setAttribute('d', f1 ? 'M628 291H640M640 291H658' : 'M628 291H640L652 281'); S('fs2sw').setAttribute('d', f2 ? 'M628 323H640M640 323H658' : 'M628 323H640L652 313');
    S('tFS1').textContent = '= ' + (f1 ? '1' : '0'); S('tFS2').textContent = '= ' + (f2 ? '1' : '0');
    // gauges / texts
    S('gaTxt').textContent = fmt(s.pa); S('gbTxt').textContent = fmt(s.p2);
    S('tP0').textContent = fmt(s.pF) + ' bar'; S('tPa').textContent = fmt(s.pa) + ' bar'; S('tP2').textContent = 'p2 ' + fmt(s.p2) + ' bar';
    S('tN').textContent = 'n = ' + fmt(c.n) + ' turns  (' + fmt(SIM.qn(c.n, Math.max(s.pa, c.supplyOn ? c.P0 : 0)), 0) + ' l/min)';
    S('tFlow').textContent = s.q > 1 ? 'flow ' + fmt(s.q, 0) + ' l/min' : s.qEx > 1 ? 'exhausting ' + fmt(s.qEx, 0) + ' l/min' : '';
    S('tV').textContent = c.V + ' L';
    stroke('pLeak', s.qLeak > 0.01 ? s.p2 : 0, s.qLeak > 0.01); stroke('pLeak2', s.qLeak > 0.01 ? s.p2 : 0, s.qLeak > 0.01);
    S('tLeakPct').textContent = fmt(c.leakPct, 0) + ' % open';
    S('tLeak').textContent = s.qLeak > 0.005 ? 'leak ' + fmt(s.qLeak, 1) + ' SCFM (' + fmt(s.qLeak * SIM.L_PER_SCFM, 0) + ' l/min)' : '';
    const h = 84 * Math.min(1, s.p2 / 10), tf = S('tankFill');
    tf.setAttribute('y', 102 - h); tf.setAttribute('height', Math.max(0, h - 3)); tf.setAttribute('fill', pcol(s.p2)); tf.setAttribute('opacity', 0.5);
  }

  /* ---------------- electro-pneumatic wiring ladder (IEC-style symbols, live) ---------------- */
  const NS = 'http://www.w3.org/2000/svg', E = $('elec');
  const mk = (tag, attrs, parent, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; (parent || E).appendChild(e); return e; };
  const INK = '#1b1f24', OFF = '#8a929b', LIVE = '#d6402b';
  const ladder = { wires: [], items: [] };
  const LX = 40, RX = 960;
  mk('rect', { x: 0, y: 0, width: 1000, height: 510, rx: 4, fill: '#fbfcfd', stroke: '#b9c0c8', 'stroke-width': 2 });
  mk('path', { d: 'M' + LX + ' 40V500', stroke: INK, 'stroke-width': 3, fill: 'none' }); mk('path', { d: 'M' + RX + ' 40V500', stroke: INK, 'stroke-width': 3, fill: 'none' });
  mk('text', { x: LX, y: 30, 'text-anchor': 'middle', 'font-weight': 700, fill: LIVE }, null, '+24 V'); mk('text', { x: RX, y: 30, 'text-anchor': 'middle', 'font-weight': 700, fill: '#2a5db0' }, null, '0 V');
  const wire = (x1, y1, x2, y2) => { const w = mk('path', { d: 'M' + x1 + ' ' + y1 + 'L' + x2 + ' ' + y2, fill: 'none', 'stroke-width': 2.2, 'stroke-linecap': 'round', stroke: OFF }); return w; };
  // a series element between xa and xb on rung y; returns {wires:[before, after], set(state)}
  function contact(x, y, name, nc, len = 105) {
    const g = mk('g'), w1 = wire(x - 55, y, x - 16, y), w2 = wire(x + 16, y, x + len, y);
    mk('circle', { cx: x - 16, cy: y, r: 2.6, fill: INK }, g); mk('circle', { cx: x + 16, cy: y, r: 2.6, fill: INK }, g);
    const blade = mk('path', { d: '', stroke: INK, 'stroke-width': 2.2, fill: 'none' }, g), bar = mk('path', { d: nc ? 'M' + (x + 16) + ' ' + (y - 10) + 'V' + y : '', stroke: INK, 'stroke-width': 2, fill: 'none' }, g);
    mk('text', { x, y: y - 22, 'text-anchor': 'middle', fill: '#111', 'font-weight': 700 }, g, name);
    const st = mk('text', { x, y: y + 24, 'text-anchor': 'middle', fill: '#666', 'font-size': 10 }, g, '');
    return { w1, w2, set(closed, txt) {
      blade.setAttribute('d', closed ? 'M' + (x - 16) + ' ' + y + 'H' + (x + 16) : 'M' + (x - 16) + ' ' + y + 'L' + (x + 13) + ' ' + (y - 14));
      st.textContent = txt || (closed ? 'closed' : 'open'); } };
  }
  function plcBox(x, y, addr, tag, isOut, len = 145) {
    const g = mk('g'), w1 = wire(x - 55, y, x - 38, y), w2 = wire(x + 38, y, x + len, y);
    const r = mk('rect', { x: x - 38, y: y - 15, width: 76, height: 30, fill: '#fff', stroke: INK, 'stroke-width': 1.8 }, g);
    mk('text', { x, y: y - 2, 'text-anchor': 'middle', fill: '#111', 'font-weight': 700, 'font-size': 11 }, g, addr);
    mk('text', { x, y: y + 10, 'text-anchor': 'middle', fill: '#555', 'font-size': 9.5 }, g, tag);
    mk('text', { x, y: y - 22, 'text-anchor': 'middle', fill: '#555', 'font-size': 10 }, g, isOut ? 'PLC output' : 'PLC input');
    return { w1, w2, set(on) { r.setAttribute('fill', on ? '#d7f5e3' : '#fff'); r.setAttribute('stroke', on ? '#0a9d5a' : INK); } };
  }
  function coil(x, y, name, o = {}) {
    const g = mk('g'), w1 = wire(x - 55, y, x - 20, y), w2 = wire(x + 20, y, RX, y);
    const r = mk('rect', { x: x - 20, y: y - 14, width: 40, height: 28, fill: '#fff', stroke: INK, 'stroke-width': 1.8 }, g);
    mk('text', { x, y: y + 4, 'text-anchor': 'middle', fill: '#111', 'font-weight': 700, 'font-size': 11 }, g, name);
    let gl, yl;
    if (o.leds) { gl = mk('circle', { cx: x + 34, cy: y - 7, r: 5, stroke: '#333', 'stroke-width': 1 }, g); yl = mk('circle', { cx: x + 34, cy: y + 8, r: 5, stroke: '#333', 'stroke-width': 1 }, g);
      mk('text', { x: x + 44, y: y - 3, fill: '#555', 'font-size': 9 }, g, 'green 24 V'); mk('text', { x: x + 44, y: y + 12, fill: '#555', 'font-size': 9 }, g, 'yellow coil'); }
    return { w1, w2, set(on, green, yellow) { r.setAttribute('fill', on ? '#fff3b0' : '#fff'); r.setAttribute('stroke', on ? '#b07d00' : INK);
      if (gl) { gl.setAttribute('fill', green ? '#22cc66' : '#e1e5ea'); yl.setAttribute('fill', yellow ? '#f2b705' : '#e1e5ea'); } } };
  }
  function lamp(x, y, name) {
    const g = mk('g'), w1 = wire(x - 55, y, x - 16, y), w2 = wire(x + 16, y, RX, y);
    const c = mk('circle', { cx: x, cy: y, r: 16, fill: '#fff', stroke: INK, 'stroke-width': 1.8 }, g);
    mk('path', { d: 'M' + (x - 11) + ' ' + (y - 11) + 'L' + (x + 11) + ' ' + (y + 11) + 'M' + (x + 11) + ' ' + (y - 11) + 'L' + (x - 11) + ' ' + (y + 11), stroke: INK, 'stroke-width': 1.5 }, g);
    mk('text', { x, y: y - 24, 'text-anchor': 'middle', fill: '#111', 'font-weight': 700 }, g, name);
    return { w1, w2, set(on) { c.setAttribute('fill', on ? '#8fc4ff' : '#fff'); } };
  }
  const note = (y, t) => mk('text', { x: 580, y: y - 10, fill: '#555', 'font-size': 11 }, null, t);
  const co = () => P.coils();
  const kOn = () => P.s.kSafe, safeOn = () => !P.ctl.estop;
  const rungs2 = [];
  // R1: safety relay K1: E-stop (NC) in series with Control Reset (NO) parallel K1 seal-in contact
  { const y = 70; wire(LX, y, 85, y);
    const es = contact(140, y, 'E-STOP S0', true, 200), rs = contact(320, y, 'CONTROL RESET S1', false, 375), sl = contact(320, y + 48, 'K1 seal-in', false, 375), k = coil(500, y, 'K1');
    wire(200, y, 200, y + 48); wire(200, y + 48, 265, y + 48); wire(375, y, 440, y); wire(375, y + 48, 440, y + 48); wire(440, y, 440, y + 48); wire(440, y, 445, y);
    note(y, 'Safety relay K1 (PLd): E-stop drops it, Reset re-latches');
    rungs2.push({ y, upd() {
      const p0 = true, eC = safeOn(), rC = P.ctl.reset, sC = kOn();
      es.set(eC, eC ? 'closed' : 'PRESSED'); rs.set(rC, rC ? 'pressed' : 'open'); sl.set(sC);
      const live = p0 && eC; const par = live && (rC || sC);
      es.w1.setAttribute('stroke', p0 ? LIVE : OFF); es.w2.setAttribute('stroke', live ? LIVE : OFF);
      rs.w1.setAttribute('stroke', live ? LIVE : OFF); rs.w2.setAttribute('stroke', live && rC ? LIVE : OFF); sl.w1.setAttribute('stroke', live ? LIVE : OFF); sl.w2.setAttribute('stroke', live && sC ? LIVE : OFF);
      k.w1.setAttribute('stroke', par ? LIVE : OFF); k.w2.setAttribute('stroke', par ? '#2a5db0' : OFF); k.set(sC);
    } }); }
  // generic output rung: K1 contact -> PLC output -> coil
  function outRung(y, tag, addr, getQ, ledsGet, note_) {
    wire(LX, y, 85, y);
    const kc = contact(140, y, 'K1 (24 V good)', false), q = plcBox(300, y, addr, tag, true), c = coil(500, y, tag.split(' ')[0], { leds: true });
    note(y + 0, note_);
    rungs2.push({ y, upd() { const kk = kOn(), qq = getQ(), l = ledsGet();
      kc.set(kk); kc.w1.setAttribute('stroke', LIVE); kc.w2.setAttribute('stroke', kk ? LIVE : OFF);
      q.set(qq); q.w1.setAttribute('stroke', kk ? LIVE : OFF); q.w2.setAttribute('stroke', kk && qq ? LIVE : OFF);
      c.set(kk && qq && l.green, l.green, l.yellow); c.w1.setAttribute('stroke', kk && qq ? LIVE : OFF); c.w2.setAttribute('stroke', kk && qq && l.green ? '#2a5db0' : OFF); } });
  }
  outRung(184, 'V2S1 CIP', 'Q 224T2', () => plc.QC, () => co().cip, 'PL-V2S1: optional CIP on/off valve, one coil');
  outRung(250, 'V1S1', 'Q 224T', () => plc.Q1, () => co().v1s1, 'PL-V1S1: safety coil 1 of the dump valve');
  outRung(316, 'V1S2', 'Q 224T', () => plc.Q2, () => co().v1s2, 'PL-V1S2: safety coil 2, redundant channel');
  // feedback rungs: +24 V -> FS contact -> PLC input
  function fsRung(y, name, addr, get, txt) {
    wire(LX, y, 85, y); const f = contact(140, y, name, false), i = plcBox(300, y, addr, 'FS feedback', false); wire(355, y, RX, y).setAttribute('stroke-dasharray', '3 4');
    note(y, txt);
    rungs2.push({ y, upd() { const on = get(); f.set(on, on ? '24 V = normal' : '0 V = actuated'); f.w1.setAttribute('stroke', LIVE); f.w2.setAttribute('stroke', on ? LIVE : OFF); i.set(on); i.w1.setAttribute('stroke', on ? LIVE : OFF); } });
  }
  fsRung(384, 'FS1 (S1)', 'I 301', () => P.fs1(), 'PL-FS1 prox. switch on the V1 pilot (1 = normal)');
  fsRung(440, 'FS2 (S2)', 'I 302', () => P.fs2(), 'PL-FS2 prox. switch on the V2 pilot');
  // reset lamp
  { const y = 490; wire(LX, y, 245, y); const q = plcBox(300, y, 'Q 307', 'reset lamp', true), l = lamp(500, y, 'BLUE LAMP'); note(y, 'Reset lamp: blink = ready, solid = run, fast = fault');
    rungs2.push({ y, upd() { const on = plc.LAMP; q.set(on); q.w1.setAttribute('stroke', LIVE); q.w2.setAttribute('stroke', on ? LIVE : OFF); l.set(on); l.w1.setAttribute('stroke', on ? LIVE : OFF); l.w2.setAttribute('stroke', on ? '#2a5db0' : OFF); } }); }
  const updateLadder = () => rungs2.forEach(r => r.upd());

  /* ---------------- charts ---------------- */
  const cvT = $('cvTime'), cvF = $('cvFlow');
  const HIST = [], WIN = 40, DT_S = 0.05; let acc = 0;
  function sample() {
    const s = P.s, co = P.coils();
    HIST.push({ t: s.t, pa: s.pa, p2: s.p2, st: s.stage, v1: co.v1s1.yellow, v2: co.v1s2.yellow, c: co.cip.yellow, f1: P.fs1(), f2: P.fs2() });
    while (HIST.length && HIST[0].t < s.t - WIN) HIST.shift();
  }
  function fit(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); return { g, w: r.width, h: r.height };
  }
  function drawTime() {
    const { g, w, h } = fit(cvT); g.clearRect(0, 0, w, h);
    const L = 92, R = 8, T = 6, B = 20, W = w - L - R;
    const rows = [['p1 valve in', 'a'], ['p2 output', '2'], ['V2S1 (CIP)', 'c'], ['V1S1', 'v1'], ['V1S2', 'v2'], ['FS1 (S1)', 'f1'], ['FS2 (S2)', 'f2']];
    const rh = (h - T - B) / rows.length, t1 = P.s.t, t0 = t1 - WIN;
    const X = t => L + (t - t0) / WIN * W;
    // soft-start band
    g.fillStyle = 'rgba(160,100,220,.18)';
    let st = null;
    for (const q of HIST) { if (q.st === 1 && st === null) st = q.t; if (q.st !== 1 && st !== null) { g.fillRect(X(st), T, X(q.t) - X(st), h - T - B); st = null; } }
    if (st !== null) g.fillRect(X(st), T, X(t1) - X(st), h - T - B);
    g.font = '11px system-ui'; g.textBaseline = 'middle';
    rows.forEach(([name, key], i) => {
      const y0 = T + i * rh, yb = y0 + rh - 4, yt = y0 + 5;
      g.strokeStyle = '#212c37'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, y0 + rh); g.lineTo(w - R, y0 + rh); g.stroke();
      g.fillStyle = '#9fb0c0'; g.textAlign = 'right'; g.fillText(name, L - 8, y0 + rh / 2);
      g.beginPath(); g.lineWidth = 2; g.strokeStyle = key === 'a' || key === '2' ? '#4aa3ff' : key[0] === 'f' ? '#ffb300' : '#22c55e';
      HIST.forEach((q, j) => {
        const v = key === 'a' ? q.pa / 10 : key === '2' ? q.p2 / 10 : +q[key];
        const x = X(q.t), y = yb - v * (yb - yt);
        if (j === 0) g.moveTo(x, y);
        else { if (key !== 'a' && key !== '2') g.lineTo(x, yb - +HIST[j - 1][key] * (yb - yt)); g.lineTo(x, y); }
      });
      g.stroke();
    });
    // time axis
    g.fillStyle = '#6c7a89'; g.textAlign = 'center';
    for (let k = 0; k <= 4; k++) { const tt = t0 + k * WIN / 4; g.fillText(fmt(Math.max(0, tt), 0) + ' s', X(tt), h - 8); }
    g.fillStyle = '#b48be0'; g.textAlign = 'left'; g.fillText('soft-start', L + 4, T + 8);
    g.fillStyle = '#6c7a89'; g.textAlign = 'right'; g.fillText('analogue rows: 0-10 bar', w - R, T + 8);
  }
  function drawFlow() {
    const { g, w, h } = fit(cvF); g.clearRect(0, 0, w, h);
    const L = 40, R = 10, T = 14, B = 60, W = w - L - R, H = h - T - B;
    const X = n => L + n / 12 * W, Y = q => T + H - q / 800 * H;
    g.font = '10.5px system-ui'; g.strokeStyle = '#212c37'; g.fillStyle = '#6c7a89'; g.lineWidth = 1;
    for (let q = 0; q <= 800; q += 200) { g.beginPath(); g.moveTo(L, Y(q)); g.lineTo(w - R, Y(q)); g.stroke(); g.textAlign = 'right'; g.fillText(q, L - 4, Y(q) + 3); }
    for (let n = 0; n <= 12; n += 2) { g.textAlign = 'center'; g.fillText(n, X(n), T + H + 12); }
    g.fillStyle = '#9fb0c0'; g.textAlign = 'center'; g.fillText('turns n of flow-control screw  (CCW +)', L + W / 2, T + H + 26);
    g.save(); g.translate(10, T + H / 2); g.rotate(-Math.PI / 2); g.fillText('qn [l/min]', 0, 0); g.restore();
    const styles = { 4: [[], '#8aa0b4'], 6: [[2, 3], '#6fb1ff'], 8: [[8, 4], '#7cf2a3'], 10: [[1, 3], '#ffd166'] };
    for (const p of SIM.FLOW_P) {
      g.beginPath(); g.setLineDash(styles[p][0]); g.strokeStyle = styles[p][1]; g.lineWidth = 2;
      SIM.FLOW_Q[p].forEach((q, n) => n ? g.lineTo(X(n), Y(q)) : g.moveTo(X(n), Y(q))); g.stroke();
    }
    g.setLineDash([]); g.textAlign = 'left';
    [4, 6, 8, 10].forEach((p, i) => { g.fillStyle = styles[p][1]; g.fillText(p + ' bar / ' + Math.round(p * 14.5) + ' psi', L + 6 + (i % 2) * (W / 2 - 10), T + H + 38 + (i > 1 ? 12 : 0)); });
    const p1 = P.s.pa > 0.5 ? P.s.pa : (P.cfg.supplyOn ? P.cfg.P0 : 0), q = SIM.qn(P.cfg.n, p1);
    g.strokeStyle = '#fff'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(P.cfg.n), T + H); g.lineTo(X(P.cfg.n), Y(q)); g.lineTo(L, Y(q)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(P.cfg.n), Y(q), 4.5, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(fmt(q, 0) + ' l/min @ ' + fmt(p1) + ' bar', Math.min(X(P.cfg.n) + 8, w - 120), Math.max(Y(q) - 8, 12));
  }

  /* ---------------- resizable columns ---------------- */
  const main = $('layout'), KEY = 'festoSimLayout';
  const DEF = { w1: 270, w4: 290, r: 1.1 / 2.3 };
  let lay = Object.assign({}, DEF);
  try { Object.assign(lay, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage unavailable */ }
  const applyLayout = () => {
    main.style.setProperty('--w1', lay.w1 + 'px'); main.style.setProperty('--w4', lay.w4 + 'px');
    main.style.setProperty('--w2', lay.r + 'fr'); main.style.setProperty('--w3', (1 - lay.r) + 'fr');
  };
  const saveLayout = () => { try { localStorage.setItem(KEY, JSON.stringify(lay)); } catch (e) { /* ignore */ } };
  applyLayout();
  const widthOf = id => $(id).getBoundingClientRect().width;
  function dragger(id, onStart) {
    const g = $(id);
    g.addEventListener('dblclick', () => { Object.assign(lay, DEF); applyLayout(); saveLayout(); });
    g.addEventListener('pointerdown', e => {
      g.setPointerCapture(e.pointerId); g.classList.add('drag'); document.body.classList.add('resizing');
      const x0 = e.clientX, move = onStart();
      const mv = ev => { move(ev.clientX - x0); applyLayout(); };
      const up = () => { g.classList.remove('drag'); document.body.classList.remove('resizing'); g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); saveLayout(); };
      g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
  }
  dragger('gut1', () => { const a = lay.w1; return d => lay.w1 = SIM.clamp(a + d, 200, 560); });
  dragger('gut3', () => { const a = lay.w4; return d => lay.w4 = SIM.clamp(a - d, 220, 640); });
  dragger('gut2', () => {
    const a = widthOf('stage'), b = widthOf('pneu-card'), tot = a + b;
    return d => lay.r = SIM.clamp((a + d) / tot, 260 / tot, 1 - 260 / tot);
  });

  /* ---------------- main loop ---------------- */
  const stageNames = ['EXHAUST', 'SOFT-START', 'FULL FLOW'];
  let last = performance.now(), uiAcc = 0, chartAcc = 0;
  function frame(now) {
    const dtR = Math.min(0.05, (now - last) / 1000); last = now;
    let rem = dtR * speed; const h = 0.01;
    while (rem > 1e-9) { const d = Math.min(h, rem); P.step(d); rem -= d; acc += d; if (acc >= DT_S) { acc -= DT_S; sample(); } }
    View3D.update(P, dtR * speed, now / 1000);
    updatePneu(dtR * speed);
    updateXray(dtR);
    uiAcc += dtR; chartAcc += dtR;
    if (uiAcc > 0.1) {
      uiAcc = 0; updatePLC(); updateLadder();
      const s = P.s;
      $('rP0').textContent = fmt(s.pF); $('rPa').textContent = fmt(s.pa); $('rP2').textContent = fmt(s.p2);
      $('rP2psi').textContent = '(' + fmt(s.p2 * 14.504, 0) + ' psi)'; $('rQ').textContent = fmt(Math.max(s.q, s.qEx), 0); $('rLeak').textContent = fmt(s.qLeak, 1); $('rStage').textContent = stageNames[s.stage];
      const el = $('plcState'); el.textContent = plc.msg;
      el.className = 'chip ' + (plc.FAULT || P.ctl.estop ? 'bad' : plc.RUN ? 'ok' : 'warn');
    }
    if (chartAcc > 0.1) { chartAcc = 0; drawTime(); drawFlow(); }
    requestAnimationFrame(frame);
  }
  refreshNotes();
  requestAnimationFrame(frame);
})();
