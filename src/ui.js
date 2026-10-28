'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const P = SIM.makePlant();
  window.festoSim = P; // handy for experiments from the browser console
  const plc = P.plc.m;
  const fmt = (v, d = 1) => v.toFixed(d);
  const pcol = p => p < 0.05 ? '#59636e' : 'hsl(' + Math.max(0, 215 - 18 * p) + ',90%,55%)';

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
    const t = P.fillTimeEstimate();
    $('nNote').textContent = 'Counter-clockwise (+) = more flow = faster pressure build-up. Fill to switch-through: ' +
      (isFinite(t) ? '~' + fmt(t, t < 10 ? 1 : 0) + ' s' : 'no supply') + (c.n < 0.5 ? ' (screw nearly closed: creeping)' : c.n > 9 ? ' (nearly instantaneous)' : '') + '.';
  }
  bind('cSupply', e => P.cfg.supplyOn = e.checked);
  bind('sP0', e => P.cfg.P0 = +e.value);
  bind('sN', e => P.cfg.n = +e.value);
  bind('sRatio', e => P.cfg.ratio = +e.value / 100);
  bind('sV', e => P.cfg.V = +e.value);
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
  const ledFill = (id, on, col) => { const e = S(id); e.setAttribute('fill', on ? col : '#1b242d'); e.setAttribute('stroke', on ? '#fff' : '#455465'); e.setAttribute('stroke-width', on ? 1.5 : 1); };
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
    show('cipOpen', open); show('cipClosed', !open);
    S('cc1').setAttribute('stroke', pcol(s.pF)); S('cc2').setAttribute('stroke', pcol(s.pa));
    S('cc3').setAttribute('fill', pcol(s.pa)); stroke('cipEx', open ? 0 : s.pa, !open && s.qExCip > 1);
    S('cipOpen').setAttribute('stroke', pcol(s.pF));
    ledFill('svgCipG', co.cip.green, '#22ff77'); ledFill('svgCipY', co.cip.yellow, '#ffc400');
    S('gCip').setAttribute('opacity', c.cipFitted ? 1 : 0.45);
    S('cipNF').textContent = c.cipFitted ? '' : 'NOT FITTED - straight through';
    // soft-start valve: highlight the active position box
    const energised = co.v1s1.yellow && co.v1s2.yellow;
    const active = s.stage === 1 ? 1 : s.stage === 2 ? 2 : energised ? 3 : 4;
    for (let i = 1; i <= 4; i++) {
      const r = S('svB' + i).querySelector('.bx'), on = i === active;
      r.setAttribute('stroke', on ? '#7cf2a3' : '#6c7a89'); r.setAttribute('stroke-width', on ? 3.5 : 1.5);
      r.setAttribute('fill', on ? 'rgba(60,200,130,.16)' : 'none');
      S('svB' + i).setAttribute('opacity', on ? 1 : 0.55);
    }
    S('sB1a').setAttribute('stroke', pcol(s.pa)); S('sB1h').setAttribute('fill', pcol(s.pa));
    S('sB2a').setAttribute('stroke', pcol(s.pa)); S('sB2h').setAttribute('fill', pcol(s.pa));
    S('sB4e').setAttribute('stroke', pcol(s.p2)); S('sB4h').setAttribute('fill', pcol(s.p2));
    stroke('pt1', s.pa, s.q > 1); stroke('pt2', s.p2, s.q > 1);
    stroke('pt3', s.stage === 0 ? s.p2 : 0, s.qEx > 1);
    S('sThr').setAttribute('stroke', s.stage === 1 ? '#d9a8ff' : '#cfd8e0'); S('sThrH').setAttribute('fill', s.stage === 1 ? '#d9a8ff' : '#cfd8e0');
    S('svPos').textContent = ['EXHAUST (spring return)', 'SOFT-START (throttled)', 'FULL FLOW'][s.stage] + (s.stage === 0 && energised ? ' - pilots shifting' : '');
    S('svPos').setAttribute('fill', ['#ef8a8a', '#d9a8ff', '#7cf2a3'][s.stage]);
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
    const h = 84 * Math.min(1, s.p2 / 10), tf = S('tankFill');
    tf.setAttribute('y', 102 - h); tf.setAttribute('height', Math.max(0, h - 3)); tf.setAttribute('fill', pcol(s.p2)); tf.setAttribute('opacity', 0.5);
  }

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
      uiAcc = 0; updatePLC();
      const s = P.s;
      $('rP0').textContent = fmt(s.pF); $('rPa').textContent = fmt(s.pa); $('rP2').textContent = fmt(s.p2);
      $('rP2psi').textContent = '(' + fmt(s.p2 * 14.504, 0) + ' psi)'; $('rQ').textContent = fmt(Math.max(s.q, s.qEx), 0); $('rStage').textContent = stageNames[s.stage];
      const el = $('plcState'); el.textContent = plc.msg;
      el.className = 'chip ' + (plc.FAULT || P.ctl.estop ? 'bad' : plc.RUN ? 'ok' : 'warn');
    }
    if (chartAcc > 0.1) { chartAcc = 0; drawTime(); drawFlow(); }
    requestAnimationFrame(frame);
  }
  refreshNotes();
  requestAnimationFrame(frame);
})();
