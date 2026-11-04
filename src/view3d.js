'use strict';
/* Three.js scene: Festo MS6 air-prep unit, flow left -> right.
   filter | on/off valve (CIP, V2S1) | dist. block | MS6-SV-D safety dump (V1S1, V1S2, FS1, FS2) | dist. block | outlet */
const View3D = (() => {
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1319);
  scene.fog = new THREE.Fog(0x0e1319, 160, 320);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 600);

  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3038, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(30, 70, 60); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 0.8); rim.position.set(-40, 20, -50); scene.add(rim);

  const root = new THREE.Group(); scene.add(root);
  const FLOOR_Y = -33;
  const grid = new THREE.GridHelper(220, 44, 0x2b3642, 0x1b232c); grid.position.set(30, FLOOR_Y, 0); scene.add(grid);

  /* ---------- helpers ---------- */
  const bodyMats = [];
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.5, metalness: 0.1 }, o));
  const bodyMat = (color, o = {}) => { const m = mat(color, o); bodyMats.push(m); return m; };
  const M = {
    white: bodyMat(0xe4e8ea), light: bodyMat(0xcfd5d9), dark: bodyMat(0x23262b, { roughness: 0.45 }),
    black: bodyMat(0x14161a), grey: bodyMat(0x7b8088), silver: bodyMat(0xaab0b6, { metalness: 0.6, roughness: 0.35 }),
    yellow: bodyMat(0xffe600, { roughness: 0.6 }), blue: bodyMat(0x1e88ff),
    glass: bodyMat(0xcfe3ee, { transparent: true, opacity: 0.45, roughness: 0.1 }),
  };
  M.glass.userData.keepAlpha = true;
  function add(mesh, x, y, z, parent) { mesh.position.set(x, y, z); (parent || root).add(mesh); return mesh; }
  const box = (w, h, d, m, x, y, z, p) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m), x, y, z, p);
  function cyl(r, h, m, x, y, z, axis, p, seg = 32, r2) {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r2 === undefined ? r : r2, h, seg), m);
    if (axis === 'x') g.rotation.z = Math.PI / 2; else if (axis === 'z') g.rotation.x = Math.PI / 2;
    return add(g, x, y, z, p);
  }
  function pcolor(p) { // pressure -> colour, shared with the SVG diagram
    const c = new THREE.Color(); c.setHSL(Math.max(0, (215 - 18 * p)) / 360, 0.9, 0.55); return c;
  }

  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  function halo(color, size, parent, x, y, z) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(size, size, 1); add(s, x, y, z, parent); return s;
  }
  function label(text, o = {}) {
    const w = o.w || 360, h = o.h || 64, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = o.bg || '#0a7d4f'; g.beginPath();
    g.moveTo(14, 0); g.lineTo(w, 0); g.lineTo(w - 14, h); g.lineTo(0, h); g.closePath(); g.fill();
    g.fillStyle = o.fg || '#fff'; g.font = '700 ' + (o.fs || 30) + 'px system-ui,Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    const sc = o.scale || 0.05; sp.scale.set(w * sc, h * sc, 1); sp.renderOrder = 10; return sp;
  }

  /* ---------- LED connector (green = 24 V good, yellow = coil energised) ---------- */
  function connector(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    cyl(0.95, 4, M.dark, 0, 2, 0, 'y', g, 20);
    cyl(1.25, 0.7, M.silver, 0, 0.5, 0, 'y', g, 6);
    const gm = new THREE.MeshStandardMaterial({ color: 0x0d4a22, emissive: 0x00ff66, emissiveIntensity: 0.0, roughness: 0.3, side: THREE.DoubleSide });
    const ym = new THREE.MeshStandardMaterial({ color: 0x5a4400, emissive: 0xffc400, emissiveIntensity: 0.0, roughness: 0.3, side: THREE.DoubleSide });
    const by = 5.6;
    add(new THREE.Mesh(new THREE.SphereGeometry(1.7, 28, 18, -Math.PI / 2, Math.PI), gm), 0, by, 0, g);
    add(new THREE.Mesh(new THREE.SphereGeometry(1.7, 28, 18, Math.PI / 2, Math.PI), ym), 0, by, 0, g);
    cyl(0.6, 3, M.black, 0, by, -2.4, 'z', g, 16);
    const hg = halo(0x00ff66, 5, g, -0.9, by, 1.6), hy = halo(0xffc400, 5, g, 0.9, by, 1.6);
    return {
      group: g,
      set(green, yellow) {
        gm.emissiveIntensity = green ? 2.4 : 0.0; ym.emissiveIntensity = yellow ? 2.4 : 0.0;
        hg.material.opacity = green ? 0.9 : 0; hy.material.opacity = yellow ? 0.9 : 0;
      },
    };
  }

  /* ---------- M8 proximity switch with LED (FS1 / FS2) ---------- */
  function proxSwitch(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    box(2.6, 2.6, 1.0, M.dark, 0, 0, -0.1, g);
    const t = new THREE.Group(); t.rotation.z = -0.45; t.position.set(0, 0, 0.5); g.add(t);
    cyl(0.85, 3.4, M.silver, 0, -1.7, 0, 'y', t, 20);
    cyl(1.25, 1.0, M.yellow, 0, -0.55, 0, 'y', t, 6);
    cyl(1.05, 2.2, M.dark, 0, -4.4, 0, 'y', t, 20);
    cyl(0.5, 1.8, M.black, 0, -6.4, 0, 'y', t, 14);
    const lm = new THREE.MeshStandardMaterial({ color: 0x4d3b00, emissive: 0xffb300, emissiveIntensity: 0, roughness: 0.3 });
    add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), lm), 0, -4.4, 1.0, t);
    const hl = halo(0xffb300, 3.6, t, 0, -4.4, 1.4);
    return { set(on) { lm.emissiveIntensity = on ? 2.6 : 0; hl.material.opacity = on ? 0.85 : 0; } };
  }

  /* ---------- gauge ---------- */
  function gauge(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    cyl(2.4, 1.2, M.silver, 0, 0, 0, 'z', g, 32);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    const face = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.z = 0.62; g.add(face);
    let last = -1;
    return {
      set(p) {
        if (Math.abs(p - last) < 0.02) return; last = p;
        const x2 = c.getContext('2d'); x2.fillStyle = '#f4f4f0'; x2.fillRect(0, 0, 128, 128);
        x2.translate(64, 64);
        x2.strokeStyle = '#222'; x2.fillStyle = '#222'; x2.lineWidth = 2; x2.font = '12px Arial'; x2.textAlign = 'center';
        for (let i = 0; i <= 10; i++) {
          const a = (-225 + i * 27) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
          x2.beginPath(); x2.moveTo(ca * 52, sa * 52); x2.lineTo(ca * (i % 2 ? 58 : 62), sa * (i % 2 ? 58 : 62)); x2.stroke();
          if (i % 2 === 0) x2.fillText(String(i), ca * 42, sa * 42 + 4);
        }
        x2.fillText('bar', 0, 26);
        const a = (-225 + SIM.clamp(p, 0, 10) * 27) * Math.PI / 180;
        x2.strokeStyle = '#c00'; x2.lineWidth = 3; x2.beginPath(); x2.moveTo(0, 0); x2.lineTo(Math.cos(a) * 46, Math.sin(a) * 46); x2.stroke();
        x2.fillStyle = '#222'; x2.beginPath(); x2.arc(0, 0, 4, 0, 7); x2.fill();
        x2.setTransform(1, 0, 0, 1, 0, 0); tex.needsUpdate = true;
      },
    };
  }

  /* ---------- build the unit from the Festo CAD model (STEP 919111 -> assets/ms6-model.*) ---------- */
  const AX = 0;           // flow axis y = 0
  const SC = 1.45;        // CAD cm -> scene units (keeps the proportions of the earlier hand-built scene)
  const V = {};           // handles for the update loop
  const bores = [];       // internal air passages (visible in X-ray)
  function bore(x0, x1, key) {
    const m = new THREE.MeshBasicMaterial({ color: 0x3355ff, transparent: true, opacity: 0.0, depthWrite: false });
    const mesh = cyl(1.05, x1 - x0, m, (x0 + x1) / 2, AX, 0, 'x', root, 16);
    mesh.renderOrder = 2; bores.push({ mesh, key, x0, x1 });
  }

  // part roles, indices as in assets/ms6-model.json
  const ROLE = {};
  const role = (r, list) => list.forEach(i => { ROLE[i] = r; });
  role('white', [0, 7, 8]); role('ee', [3]); role('sv', [9]);
  role('dark', [2, 5, 10, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 17, 18, 44, 45, 11, 12, 6, 13, 15, 40, 41, 42, 43]);
  role('black', [14, 16, 35, 36, 37, 38, 39]);
  role('silver', [20, 21, 34, 4, 46, 47]); role('white2', [19]); role('brass', [1]);
  const MATS = {
    white: bodyMat(0xe6eaec, { roughness: 0.55 }), white2: bodyMat(0xdfe3e6, { roughness: 0.5 }),
    dark: bodyMat(0x2b2e33, { roughness: 0.5 }), black: bodyMat(0x15171a, { roughness: 0.45 }),
    silver: bodyMat(0xb3b9bf, { metalness: 0.6, roughness: 0.35 }), brass: bodyMat(0xc79a3b, { metalness: 0.7, roughness: 0.35 }),
    vc: bodyMat(0xffffff, { roughness: 0.55, vertexColors: true }),
  };
  function paintFaces(geo0, kind) {     // flat colour per triangle (no gradients across the big CAD triangles)
    const geo = geo0.toNonIndexed(), pos = geo.attributes.position, n = pos.count, col = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nm = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      nm.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      const y = (a.y + b.y + c.y) / 3;
      let k = [0.9, 0.92, 0.93];
      if (kind === 'ee') { if (y > 6.2) k = [0.08, 0.09, 0.1]; }
      else if (y > 4.6) k = [0.08, 0.09, 0.1];
      else if (nm.z > 0.9 && (a.z + b.z + c.z) / 3 > 6.3 && y < 3) k = [1, 0.9, 0];   // raised label panel on the front
      for (let j = 0; j < 3; j++) { col[(i + j) * 3] = k[0]; col[(i + j) * 3 + 1] = k[1]; col[(i + j) * 3 + 2] = k[2]; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    return geo;
  }
  (() => {
    const bin = atob(MS6_MODEL.b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const buf = u8.buffer;
    for (const m of MS6_MODEL.meta) {
      const q = new Uint16Array(buf.slice(m.off, m.off + m.nv * 6)), pos = new Float32Array(m.nv * 3);
      for (let i = 0; i < m.nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = (m.mn[k] + q[i * 3 + k] * m.sc[k]) * SC;
      const io = m.off + m.nv * 6, idx = m.u32 ? new Uint32Array(buf.slice(io, io + m.nt * 12)) : new Uint16Array(buf.slice(io, io + m.nt * 6));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
      const r = ROLE[m.i] || 'white';
      const painted = r === 'ee' || r === 'sv';
      root.add(new THREE.Mesh(painted ? paintFaces(geo, r) : geo, painted ? MATS.vc : MATS[r]));
    }
  })();

  // anchors measured from the CAD model (scene units)
  const X_FILTER = 0, X_CIP = 9.0, X_D1 = 15.75, X_SV = 22.5, X_D2 = 29.25, X_PORT_IN = -8.3, X_PORT_OUT = 35.3;
  const cx = X_CIP, sx = X_SV;
  const hoseM = new THREE.MeshStandardMaterial({ color: 0x2c5fa8, transparent: true, opacity: 0.55, roughness: 0.3 });
  cyl(1.2, 14, hoseM, X_PORT_IN - 7, AX, 0, 'x', root, 20);               // supply hose
  bore(X_PORT_IN - 14, X_CIP, 'F'); bore(X_CIP, X_SV, 'A'); bore(X_SV, X_PORT_OUT, 'P2');
  const filterLabel = label('MS6 FILTER', { bg: '#394b5c', w: 300, fs: 28 }); filterLabel.position.set(X_FILTER, 14, 0); root.add(filterLabel);
  const cipLabel = label('CIP   V2S1', { w: 300, fs: 30 }); cipLabel.position.set(X_CIP, 26, 0); root.add(cipLabel);
  const cipOpt = label('(optional)', { bg: '#555f6a', w: 220, h: 48, fs: 24 }); cipOpt.position.set(X_CIP, 22.2, 0); root.add(cipOpt);
  const d1Label = label('DIST. BLOCK', { bg: '#394b5c', w: 260, fs: 26 }); d1Label.position.set(X_D1, 12, 0); root.add(d1Label);
  const d2Label = label('DIST. BLOCK', { bg: '#394b5c', w: 260, fs: 26 }); d2Label.position.set(X_D2, 20, 0); root.add(d2Label);
  const svL1 = label('MAIN   V1S1', { w: 250, h: 52, fs: 26, scale: 0.045 }); svL1.position.set(X_SV - 2.2, 26, 0); root.add(svL1);
  const svL2 = label('V1S2', { w: 130, h: 52, fs: 26, scale: 0.045 }); svL2.position.set(X_SV + 3.6, 26, 0); root.add(svL2);
  const svName = label('MS6-SV-D  SAFETY DUMP (PLd)', { bg: '#394b5c', w: 430, h: 52, fs: 24, scale: 0.045 }); svName.position.set(X_SV, 31, 0); root.add(svName);

  // LED heads on the three M12 solenoid plugs: left half green (24 V good), right half yellow (coil energised)
  function ledFace(x, y, z, r) {
    const gm = new THREE.MeshStandardMaterial({ color: 0x0d4a22, emissive: 0x00ff66, emissiveIntensity: 0, roughness: 0.3 });
    const ym = new THREE.MeshStandardMaterial({ color: 0x5a4400, emissive: 0xffc400, emissiveIntensity: 0, roughness: 0.3 });
    add(new THREE.Mesh(new THREE.CircleGeometry(r, 28, Math.PI / 2, Math.PI), gm), x, y, z, root);
    add(new THREE.Mesh(new THREE.CircleGeometry(r, 28, -Math.PI / 2, Math.PI), ym), x, y, z, root);
    const hg = halo(0x00ff66, 4.2, root, x - r * 0.5, y, z + 0.5), hy = halo(0xffc400, 4.2, root, x + r * 0.5, y, z + 0.5);
    return { set(g, y2) { gm.emissiveIntensity = g ? 2.4 : 0; ym.emissiveIntensity = y2 ? 2.4 : 0; hg.material.opacity = g ? 0.9 : 0; hy.material.opacity = y2 ? 0.9 : 0; } };
  }
  V.cipConn = ledFace(9.0, 15.55, -3.74, 0.95);
  V.v1s1Conn = ledFace(21.2, 17.25, -3.74, 1.0);
  V.v1s2Conn = ledFace(23.8, 17.25, -3.74, 1.0);

  // FS1 / FS2 proximity-switch LEDs (lit = 24 V = normal position) on the SV front sensor
  function sensorLed(x, y, z) {
    const lm = new THREE.MeshStandardMaterial({ color: 0x4d3b00, emissive: 0xffb300, emissiveIntensity: 0, roughness: 0.3 });
    add(new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), lm), x, y, z, root);
    const hl = halo(0xffb300, 3.2, root, x, y, z + 0.5);
    return { set(on) { lm.emissiveIntensity = on ? 2.6 : 0; hl.material.opacity = on ? 0.85 : 0; } };
  }
  V.fs1 = sensorLed(18.75, -9.6, 10.72);
  V.fs2 = sensorLed(18.5, -11.8, 10.72);
  const fs1L = label('FS1', { bg: '#c9322f', w: 120, h: 44, fs: 26, scale: 0.04 }); fs1L.position.set(15.6, -9.6, 11.5); root.add(fs1L);
  const fs2L = label('FS2', { bg: '#c9322f', w: 120, h: 44, fs: 26, scale: 0.04 }); fs2L.position.set(15.6, -12.2, 11.5); root.add(fs2L);

  // gauges on the distribution blocks
  V.gauge1 = gauge(root, X_D1, -1.0, 4.5 + 0.6);
  V.gauge2 = gauge(root, X_D2, -1.0, 4.5 + 0.6);

  // soft-start flow-control screw (turns with n)
  const screw = new THREE.Group(); screw.position.set(X_SV + 0.2, 11.8, 3.2); root.add(screw);
  cyl(0.9, 0.5, M.silver, 0, 0.25, 0, 'y', screw, 20); box(1.5, 0.2, 0.28, M.black, 0, 0.55, 0, screw);
  V.screw = screw;
  const screwLbl = label('SOFT-START SCREW  CCW (+) faster', { bg: '#7a3aa8', w: 420, h: 48, fs: 22, scale: 0.042 }); screwLbl.position.set(X_SV, 15.5, 4.5); root.add(screwLbl);

  // moving internals, visible in X-ray: CIP poppet and the safety-dump spool
  const cipPoppet = cyl(0.8, 1.6, new THREE.MeshStandardMaterial({ color: 0xff9a2a }), X_CIP, -0.9, 0, 'y', root, 16);
  const spool = box(2.2, 4.4, 2.2, new THREE.MeshStandardMaterial({ color: 0xff9a2a }), X_SV, 0, 0);
  V.exhaustSV = new THREE.Vector3(X_SV, -30.6, 0);
  V.exhaustCIP = new THREE.Vector3(X_CIP, -27.6, 0);
  V.exhaustSVe = { origin: V.exhaustSV }; V.exhaustCIPe = { origin: V.exhaustCIP };

  // outlet hose + machine volume
  let x = X_PORT_OUT;
  cyl(1.2, 9, hoseM, x + 4.5, AX, 0, 'x', root, 20);
  const tx = x + 9; V.tankX = tx;
  const tank = cyl(5.2, 14, new THREE.MeshStandardMaterial({ color: 0xaecbe0, transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false }), tx + 7, 0, 0, 'x', root, 36);
  const tankFill = cyl(4.8, 13.2, new THREE.MeshBasicMaterial({ color: 0x3355ff, transparent: true, opacity: 0, depthWrite: false }), tx + 7, 0, 0, 'x', root, 36);
  cyl(5.3, 0.8, M.dark, tx, 0, 0, 'x'); cyl(5.3, 0.8, M.dark, tx + 14, 0, 0, 'x');
  const tankLbl = label('TO MACHINE (volume)', { bg: '#394b5c', w: 380, h: 52, fs: 24, scale: 0.045 }); tankLbl.position.set(tx + 7, 11, 0); root.add(tankLbl);
  const X_END = tx + 13;
  bore(X_PORT_OUT, tx + 14, 'P2');

  // manual leak valve at the end of the tank: brass ball valve with lever + 1/4" tube to atmosphere
  const brass = bodyMat(0xc79a3b, { metalness: 0.7, roughness: 0.35 });
  cyl(0.7, 2.4, M.silver, tx + 15.0, 0, 0, 'x', root, 16);
  cyl(1.6, 3.0, brass, tx + 17.2, 0, 0, 'x', root, 24);
  cyl(0.55, 1.6, M.silver, tx + 17.2, 1.9, 0, 'y', root, 12);
  const leverPivot = new THREE.Group(); leverPivot.position.set(tx + 17.2, 2.7, 0); root.add(leverPivot);
  box(5.4, 0.45, 0.9, new THREE.MeshStandardMaterial({ color: 0xd83a2e, roughness: 0.5 }), 2.7, 0, 0, leverPivot);
  cyl(0.4, 0.9, new THREE.MeshStandardMaterial({ color: 0xd83a2e }), 5.2, 0, 0, 'y', leverPivot, 12);
  cyl(0.32, 5.2, M.silver, tx + 21.4, 0, 0, 'x', root, 12);          // 1/4" line
  V.leakOrigin = { origin: new THREE.Vector3(tx + 24.1, 0, 0) };
  const leakLbl = label('LEAK VALVE  0%', { bg: '#8a3b12', w: 330, h: 52, fs: 24, scale: 0.045 }); leakLbl.position.set(tx + 19, 8.5, 0); root.add(leakLbl);
  const leakTxt = (() => {
    const c = document.createElement('canvas'); c.width = 330; c.height = 52; const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); sp.scale.set(330 * 0.045, 52 * 0.045, 1); sp.renderOrder = 10; sp.position.set(tx + 21, -8.5, 0); root.add(sp);
    let last = '';
    return { set(t) { if (t === last) return; last = t; const g = c.getContext('2d'); g.clearRect(0, 0, 330, 52); g.fillStyle = '#0b1016e6'; g.fillRect(0, 0, 330, 52);
      g.strokeStyle = '#ff9a3c'; g.lineWidth = 2; g.strokeRect(1, 1, 328, 50); g.fillStyle = '#ffb36b'; g.font = '700 26px system-ui,Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 165, 28); tex.needsUpdate = true; } };
  })();

  // pendant: E-STOP + CONTROL RESET (blue lamp)
  const px = -34, pz = 4;
  box(11, 29, 8, M.dark, px, -17.5, pz);
  box(12, 8.5, 6.4, M.dark, px, -1.5, pz);
  const pf = pz + 3.3;
  box(4.6, 4.6, 0.6, M.yellow, px - 3, -1.5, pf);
  const estop = cyl(2.0, 1.8, new THREE.MeshStandardMaterial({ color: 0xd10000, roughness: 0.35 }), px - 3, -1.5, pf + 1.0, 'z', root, 28);
  estop.userData.action = 'estop';
  const resetMat = new THREE.MeshStandardMaterial({ color: 0x0a3b7a, emissive: 0x2a8cff, emissiveIntensity: 0, roughness: 0.3 });
  cyl(2.3, 0.8, M.silver, px + 3, -1.5, pf, 'z', root, 28);
  const reset = cyl(1.7, 1.4, resetMat, px + 3, -1.5, pf + 0.5, 'z', root, 28);
  reset.userData.action = 'reset';
  V.estop = estop; V.resetMat = resetMat;
  V.resetHalo = halo(0x2a8cff, 9, root, px + 3, -1.5, pf + 1.9);
  const pl1 = label('E-STOP', { bg: '#a01d1d', w: 150, h: 42, fs: 24, scale: 0.04 }); pl1.position.set(px - 3, 2.2, pf + 0.5); root.add(pl1);
  const pl2 = label('CONTROL RESET', { bg: '#1760b8', w: 250, h: 42, fs: 22, scale: 0.04 }); pl2.position.set(px + 3, 2.2, pf + 0.5); root.add(pl2);
  const plt = label('CONTROL STATION', { bg: '#394b5c', w: 280, h: 46, fs: 22, scale: 0.045 }); plt.position.set(px, 6, pz); root.add(plt);

  // flow direction arrow on the floor
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry((() => {
    const s = new THREE.Shape(); s.moveTo(0, -1.2); s.lineTo(8, -1.2); s.lineTo(8, -3); s.lineTo(13, 0); s.lineTo(8, 3); s.lineTo(8, 1.2); s.lineTo(0, 1.2); s.closePath(); return s;
  })()), new THREE.MeshBasicMaterial({ color: 0x2b7bd6, transparent: true, opacity: 0.55 }));
  arrow.rotation.x = -Math.PI / 2; arrow.position.set(12, FLOOR_Y + 0.05, 16); root.add(arrow);
  const arrowL = label('AIR FLOW', { bg: '#1f4f86', w: 200, h: 44, fs: 24, scale: 0.04 }); arrowL.position.set(17, FLOOR_Y + 4, 16); root.add(arrowL);

  /* ---------- particles (air flow) ---------- */
  const X0 = X_PORT_IN - 14;
  const NP = 900, ppos = new Float32Array(NP * 3), pcol = new Float32Array(NP * 3);
  const px_ = new Float32Array(NP), pr_ = new Float32Array(NP), pa_ = new Float32Array(NP);
  for (let i = 0; i < NP; i++) { px_[i] = X0 + Math.random() * (X_END - X0); pr_[i] = Math.sqrt(Math.random()) * 0.8; pa_[i] = Math.random() * 6.283; }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(ppos, 3)); pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(0.5, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 1.1, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  points.frustumCulled = false; points.renderOrder = 5; root.add(points);

  // exhaust puffs
  const NE = 260, epos = new Float32Array(NE * 3), evel = new Float32Array(NE * 3), elife = new Float32Array(NE), ecol = new Float32Array(NE * 3);
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(epos, 3)); eg.setAttribute('color', new THREE.BufferAttribute(ecol, 3));
  const epoints = new THREE.Points(eg, new THREE.PointsMaterial({ size: 1.6, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  epoints.frustumCulled = false; epoints.renderOrder = 5; root.add(epoints);
  for (let i = 0; i < NE; i++) { epos[i * 3 + 1] = -999; elife[i] = 0; }
  let eCursor = 0;
  const DOWN = new THREE.Vector3(0, -1, 0), JET = new THREE.Vector3(1, 0, 0);
  function spawn(em, q, dt, dir, spread) {
    em.acc = (em.acc || 0) + Math.min(q, 3000) / 12 * dt;   // particles per second ~ flow (l/min)
    while (em.acc >= 1) {
      em.acc -= 1; const i = eCursor++ % NE, o = em.origin, j = i * 3;
      epos[j] = o.x + (Math.random() - 0.5) * 0.6; epos[j + 1] = o.y + (Math.random() - 0.5) * 0.6; epos[j + 2] = o.z + (Math.random() - 0.5) * 0.6;
      const sp = 6 + Math.min(q, 3000) / 3000 * 28, k = sp * (0.4 + Math.random() * 0.6);
      evel[j] = dir.x * k + (Math.random() - 0.5) * sp * spread; evel[j + 1] = dir.y * k + (Math.random() - 0.5) * sp * spread; evel[j + 2] = dir.z * k + (Math.random() - 0.5) * sp * spread;
      elife[i] = 0.5 + Math.random() * 0.5;
    }
  }

  const xmid = { cip: X_CIP, sv: X_SV };
  function pAt(px, s) { return px < xmid.cip ? s.pF : px < xmid.sv ? s.pa : s.p2; }

  /* ---------- camera / orbit ---------- */
  const target = new THREE.Vector3(30, 0, 0);
  const orbit = { az: 0.45, el: 0.3, r: 125 };
  const goal = { az: orbit.az, el: orbit.el, r: orbit.r, tx: target.x, ty: target.y, tz: target.z };
  function applyCam() {
    orbit.az += (goal.az - orbit.az) * 0.15; orbit.el += (goal.el - orbit.el) * 0.15; orbit.r += (goal.r - orbit.r) * 0.15;
    target.x += (goal.tx - target.x) * 0.15; target.y += (goal.ty - target.y) * 0.15; target.z += (goal.tz - target.z) * 0.15;
    camera.position.set(target.x + orbit.r * Math.sin(orbit.az) * Math.cos(orbit.el), target.y + orbit.r * Math.sin(orbit.el), target.z + orbit.r * Math.cos(orbit.az) * Math.cos(orbit.el));
    camera.lookAt(target);
  }
  const presets = {
    iso:    { az: 0.45, el: 0.3, r: 125, tx: 30, ty: 0, tz: 0 },
    front:  { az: 0,    el: 0.02, r: 120, tx: 30, ty: 0,  tz: 0 },
    top:    { az: 0,    el: 1.5,  r: 125, tx: 30, ty: 0,  tz: 0 },
    safety: { az: 0.25, el: 0.2,  r: 62,  tx: X_SV, ty: -4, tz: 0 },
    cip:    { az: -0.2, el: 0.2,  r: 62,  tx: X_CIP, ty: -4, tz: 0 },
  };
  function view(name) { Object.assign(goal, presets[name]); }
  let drag = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.button === 2 || e.shiftKey }; });
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = goal.r * 0.0016; goal.tx -= Math.cos(goal.az) * dx * k; goal.tz += Math.sin(goal.az) * dx * k; goal.ty += dy * k;
      } else { goal.az -= dx * 0.006; goal.el = SIM.clamp(goal.el + dy * 0.006, -0.2, 1.55); }
    } else hover(e);
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) pick(e);
    drag = null; if (api.onRelease) api.onRelease();
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); goal.r = SIM.clamp(goal.r * (1 + e.deltaY * 0.001), 18, 260); }, { passive: false });
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  function hit(e) {
    const r = canvas.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const h = ray.intersectObjects([estop, reset], false)[0]; return h ? h.object.userData.action : null;
  }
  function hover(e) { canvas.style.cursor = hit(e) ? 'pointer' : 'grab'; }
  function pick(e) { const a = hit(e); if (a && api.onAction) api.onAction(a); }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.fov = Math.min(75, 38 * Math.max(1, 1.4 / camera.aspect)); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement); resize();

  /* ---------- per-frame update ---------- */
  let xray = false;
  function setXray(on) {
    xray = on;
    for (const m of bodyMats) { if (m.userData.keepAlpha) continue; m.transparent = on; m.opacity = on ? 0.16 : 1; m.depthWrite = !on; m.needsUpdate = true; }
  }
  const bcol = new THREE.Color();
  function update(P, dt, tReal) {
    const s = P.s, plc = P.plc.m, co = P.coils();
    applyCam();
    V.cipConn.set(co.cip.green, co.cip.yellow);
    V.v1s1Conn.set(co.v1s1.green, co.v1s1.yellow);
    V.v1s2Conn.set(co.v1s2.green, co.v1s2.yellow);
    V.fs1.set(P.fs1()); V.fs2.set(P.fs2());
    cipOpt.visible = !P.cfg.cipFitted; cipLabel.material.opacity = P.cfg.cipFitted ? 1 : 0.5;
    cipPoppet.position.y = -0.9 + 1.8 * s.cipPos;
    spool.position.y = s.stage === 0 ? -1.2 : s.stage === 1 ? 0.6 : 1.9;
    V.screw.rotation.y = -P.cfg.n * Math.PI * 2;      // CCW (+) opens
    estop.position.z = (P.ctl.estop ? -0.7 : 0) + (pz + 3.3 + 1.0);
    estop.material.color.setHex(P.ctl.estop ? 0x7a0000 : 0xd10000);
    const lamp = plc.LAMP;
    resetMat.emissiveIntensity = lamp ? 2.6 : 0.0; V.resetHalo.material.opacity = lamp ? 0.95 : 0;
    V.gauge1.set(s.pa); V.gauge2.set(s.p2);

    // bores (X-ray) + tank
    for (const b of bores) {
      const p = b.key === 'F' ? s.pF : b.key === 'A' ? s.pa : s.p2;
      b.mesh.material.opacity = xray ? Math.min(0.55, p / 6) : 0;
      b.mesh.material.color.copy(pcolor(p));
    }
    tankFill.material.color.copy(pcolor(s.p2)); tankFill.material.opacity = Math.min(0.5, s.p2 / 12);
    tankFill.scale.set(1, 0.4 + 0.6 * Math.min(1, s.p2 / 10), 1);
    tankFill.scale.z = tankFill.scale.y;

    // particles
    const v = 1.5 + 70 * Math.sqrt(Math.min(1, s.q / 1500));
    for (let i = 0; i < NP; i++) {
      px_[i] += v * dt * (0.75 + 0.5 * ((i * 7919) % 100) / 100);
      if (px_[i] > X_END) { px_[i] = X0; pa_[i] = Math.random() * 6.283; }
      const p = pAt(px_[i], s), j = i * 3, a = pa_[i] + tReal * 0.8;
      ppos[j] = px_[i]; ppos[j + 1] = Math.sin(a) * pr_[i]; ppos[j + 2] = Math.cos(a) * pr_[i];
      bcol.copy(pcolor(p)).multiplyScalar(p < 0.05 ? 0 : Math.min(1, 0.25 + p / 4));
      pcol[j] = bcol.r; pcol[j + 1] = bcol.g; pcol[j + 2] = bcol.b;
    }
    pg.attributes.position.needsUpdate = true; pg.attributes.color.needsUpdate = true;

    spawn(V.exhaustSVe, s.qEx, dt, DOWN, 1); spawn(V.exhaustCIPe, s.qExCip, dt, DOWN, 1);
    spawn(V.leakOrigin, s.qLeak * SIM.L_PER_SCFM, dt, JET, 0.25);
    leverPivot.rotation.y = (1 - P.cfg.leakPct / 100) * Math.PI / 2;
    leakLbl.visible = false;
    leakTxt.set(P.cfg.leakPct > 0 ? 'LEAK ' + P.cfg.leakPct.toFixed(0) + '% : ' + s.qLeak.toFixed(1) + ' SCFM' : 'LEAK VALVE CLOSED');
    for (let i = 0; i < NE; i++) {
      if (elife[i] <= 0) { epos[i * 3 + 1] = -999; continue; }
      elife[i] -= dt; const j = i * 3;
      epos[j] += evel[j] * dt; epos[j + 1] += evel[j + 1] * dt; epos[j + 2] += evel[j + 2] * dt;
      if (epos[j + 1] < FLOOR_Y + 0.3) { epos[j + 1] = FLOOR_Y + 0.3; evel[j + 1] = 0; }
      const f = Math.max(0, elife[i]) * 1.2; ecol[j] = f; ecol[j + 1] = f; ecol[j + 2] = f;
    }
    eg.attributes.position.needsUpdate = true; eg.attributes.color.needsUpdate = true;
    renderer.render(scene, camera);
  }

  const api = { update, setXray, view, onAction: null, onRelease: null, canvas };
  return api;
})();
