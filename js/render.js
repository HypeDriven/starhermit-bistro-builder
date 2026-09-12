/* Bistro Builder — Three.js presentation layer.
 * Semantic meshes for stations/guests/waiters built from procedural geometry;
 * render layers separate environment/gameplay/selection/effects; picking
 * raycasts only explicit interaction meshes. Rendering consumes immutable
 * rules snapshots — this module never mutates game state.
 */
import * as THREE from '../vendor/three.module.min.js';

const LAYER_ENV = 0, LAYER_PICK = 1; // pick meshes live on their own layer

const TILE = 1.0;            // world units per grid tile
const CAM_ELEV = 11;         // authored framing constants (no magic offsets)
const CAM_BACK = 8.5;
const CAM_FOV = 38;

let R = null; // module singleton (one renderer per page)

function makeRenderer(container) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
  } catch (e) { return null; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  return renderer;
}

function mat(color, opts) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.05 }, opts || {}));
}

// --- procedural guest: rounded capsule body + head, colored by mood ---
function buildGuest(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 4, 10), mat(color));
  body.position.y = 0.28;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(0xf0d8b8));
  head.position.y = 0.56;
  g.add(body, head);
  return g;
}

function buildWaiter(color, isPlayer) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), mat(color));
  body.position.y = 0.34;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0xf0d8b8));
  head.position.y = 0.66;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.05), mat(0xffffff, { roughness: 0.6 }));
  apron.position.set(0, 0.34, 0.15);
  g.add(body, head, apron);
  if (isPlayer) { // grounded selection marker ring under the player
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.3, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    g.add(ring);
    g.userData.marker = ring;
  }
  // tray (visible dish count pucks added in sync)
  const tray = new THREE.Group();
  tray.position.set(0, 0.55, 0.2);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 14), mat(0xd8d3c8, { roughness: 0.4 }));
  tray.add(plate);
  g.add(tray);
  g.userData.tray = tray;
  return g;
}

function buildTable(theme) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.06, 14), mat(theme.table));
  top.position.y = 0.42;
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 14), mat(theme.cloth));
  cloth.position.y = 0.46;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 8), mat(theme.wood));
  leg.position.y = 0.21;
  g.add(top, cloth, leg);
  // patience ring (hidden until a guest waits)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.44, 28),
    new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

function buildStove(theme) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.7), mat(theme.metal, { metalness: 0.5, roughness: 0.4 }));
  base.position.y = 0.25;
  const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.1, 14), mat(0x2c2c30, { metalness: 0.6, roughness: 0.35 }));
  pan.position.y = 0.55;
  const steam = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
  steam.position.y = 0.75;
  g.add(base, pan, steam);
  g.userData.steam = steam;
  return g;
}

function api(container, callbacks) {
  const renderer = makeRenderer(container);
  if (!renderer) return null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14100d);
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // lights: one dominant key, soft fill, contact grounding
  const key = new THREE.DirectionalLight(0xfff2dd, 2.2);
  key.position.set(6, 12, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const fill = new THREE.HemisphereLight(0xccc4b8, 0x30231a, 0.9);
  scene.add(key, fill);

  let world = null;        // group holding current board
  let pickMeshes = [];     // explicit interaction layer only
  let tableViews = [], stoveViews = [], waiterViews = [], guestViews = new Map();
  let queueSpots = [];
  let highlightMeshes = new Map(); // 'table:3' -> ring
  let cfg = null, theme = null;
  let camTarget = new THREE.Vector3();
  let shakeAmp = 0, shakeT = 0;
  let reducedMotion = false, tier = 'high';
  let highlightSet = new Set();
  let dirty = true;

  function gridToWorld(x, y) {
    return new THREE.Vector3((x - (cfg.grid.w - 1) / 2) * TILE, 0, (y - (cfg.grid.h - 1) / 2) * TILE);
  }

  function disposeGroup(g) {
    g.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
  }

  function build(state, themeIn, seed, settings) {
    cfg = state.cfg;
    theme = themeIn;
    reducedMotion = !!(settings && settings.reducedMotion);
    if (world) { scene.remove(world); disposeGroup(world); }
    pickMeshes = []; tableViews = []; stoveViews = []; waiterViews = [];
    guestViews.forEach(v => disposeGroup(v)); guestViews.clear();
    highlightMeshes.forEach(v => disposeGroup(v)); highlightMeshes.clear();
    world = new THREE.Group();
    scene.add(world);

    const decor = window.BBRNG.derive(seed >>> 0, window.BBRNG.STREAM_DECOR);

    // floor tiles (checkerboard, instanced)
    const tileGeo = new THREE.BoxGeometry(TILE * 0.98, 0.08, TILE * 0.98);
    const nTiles = cfg.grid.w * cfg.grid.h;
    const floor = new THREE.InstancedMesh(tileGeo, mat(0xffffff), nTiles);
    const m4 = new THREE.Matrix4(); const col = new THREE.Color();
    let fi = 0;
    for (let y = 0; y < cfg.grid.h; y++) for (let x = 0; x < cfg.grid.w; x++) {
      const p = gridToWorld(x, y);
      m4.setPosition(p.x, -0.04, p.z);
      floor.setMatrixAt(fi, m4);
      col.setHex((x + y) % 2 ? theme.floorAlt : theme.floor);
      floor.setColorAt(fi, col);
      fi++;
    }
    floor.receiveShadow = true;
    world.add(floor);

    // walls around the room + kitchen counter band on the top row
    const wallMat = mat(theme.wall);
    const wallGeoH = new THREE.BoxGeometry(cfg.grid.w * TILE + 0.4, 0.9, 0.3);
    const wallGeoV = new THREE.BoxGeometry(0.3, 0.9, cfg.grid.h * TILE + 0.4);
    const corners = [gridToWorld(0, 0), gridToWorld(cfg.grid.w - 1, cfg.grid.h - 1)];
    const top = new THREE.Mesh(wallGeoH, wallMat);
    top.position.set((corners[0].x + corners[1].x) / 2, 0.45, corners[0].z - TILE / 2 - 0.15);
    const bottom = top.clone(); bottom.position.z = corners[1].z + TILE / 2 + 0.15;
    const left = new THREE.Mesh(wallGeoV, wallMat);
    left.position.set(corners[0].x - TILE / 2 - 0.15, 0.45, (corners[0].z + corners[1].z) / 2);
    const right = left.clone(); right.position.x = corners[1].x + TILE / 2 + 0.15;
    world.add(top, bottom, left, right);

    // kitchen counter along row 0
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.grid.w * TILE * 0.9, 0.45, 0.5), mat(theme.wood));
    counter.position.set((corners[0].x + corners[1].x) / 2, 0.22, corners[0].z);
    counter.castShadow = true;
    world.add(counter);

    // decorative props (seeded decor stream; never affects rules)
    const propGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.5, 8);
    const props = new THREE.InstancedMesh(propGeo, mat(theme.wood), 6);
    for (let i = 0; i < 6; i++) {
      const px = corners[0].x - TILE * (0.9 + decor.next() * 0.6);
      const pz = corners[0].z + decor.next() * (corners[1].z - corners[0].z);
      m4.setPosition(px, 0.25, pz);
      props.setMatrixAt(i, m4);
    }
    world.add(props);

    // tables
    state.tables.forEach(t => {
      const v = buildTable(theme);
      const p = gridToWorld(t.x, t.y);
      v.position.copy(p);
      if (!t.open) {
        // walled-off spot: construction barrier
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.8), mat(0x777066, { roughness: 1 }));
        bar.position.y = 0.2; bar.rotation.y = 0.6;
        v.add(bar);
        v.userData.barrier = bar;
        v.traverse(o => {
          if (o.material && o !== bar) {
            var old = o.material;
            o.material = old.clone();
            old.dispose(); // each table owns its materials; don't leak the originals
            o.material.opacity = 0.35;
            o.material.transparent = true;
          }
        });
      }
      v.traverse(o => { if (o.isMesh) o.castShadow = true; });
      v.userData.tableId = t.id;
      // pick proxy on the pick layer
      const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 8),
        new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.y = 0.55;
      pick.layers.set(LAYER_PICK);
      pick.userData = { kind: 'table', id: t.id };
      v.add(pick);
      pickMeshes.push(pick);
      world.add(v);
      tableViews[t.id] = v;
    });

    // stoves
    state.stoves.forEach(s => {
      const v = buildStove(theme);
      v.position.copy(gridToWorld(s.x, s.y));
      const pick = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8),
        new THREE.MeshBasicMaterial({ visible: false }));
      pick.position.y = 0.3;
      pick.layers.set(LAYER_PICK);
      pick.userData = { kind: 'stove' };
      v.add(pick);
      pickMeshes.push(pick);
      world.add(v);
      stoveViews[s.id] = v;
    });

    // floor pick plane (goto)
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.grid.w * TILE, cfg.grid.h * TILE),
      new THREE.MeshBasicMaterial({ visible: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.layers.set(LAYER_PICK);
    plane.userData = { kind: 'floor' };
    world.add(plane);
    pickMeshes.push(plane);

    // door marker + queue spots on the right edge
    const doorP = gridToWorld(cfg.grid.w - 1, Math.floor(cfg.grid.h / 2));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 1.2), mat(theme.glow, { emissive: theme.glow, emissiveIntensity: 0.5 }));
    door.position.set(doorP.x + TILE / 2 + 0.15, 0.55, doorP.z);
    world.add(door);
    queueSpots = [];
    for (let i = 0; i < 8; i++) queueSpots.push(new THREE.Vector3(doorP.x, 0, doorP.z + (i + 0.6) * 0.7));

    // waiters
    state.waiters.forEach(w => {
      const v = buildWaiter(w.kind === 'player' ? 0xe8a54b : 0x7ec8e8, w.kind === 'player');
      v.position.copy(gridToWorld(w.x, w.y));
      v.traverse(o => { if (o.isMesh) o.castShadow = true; });
      world.add(v);
      waiterViews[w.id] = v;
    });

    frameCamera();
    dirty = true;
  }

  // Frames the whole room (plus the door queue and a margin) inside the
  // current viewport on both axes: the authored elevation/back ratio is kept
  // and the distance grows until every projected corner is inside the frame.
  function frameCamera() {
    if (!cfg) return;
    const c = gridToWorld((cfg.grid.w - 1) / 2, (cfg.grid.h - 1) / 2);
    const span = Math.max(cfg.grid.w, cfg.grid.h);
    camTarget.set(c.x, 0, c.z);
    const dir = new THREE.Vector3(0, CAM_ELEV, CAM_BACK).normalize();
    const hw = cfg.grid.w / 2 * TILE + 1.2, hd = cfg.grid.h / 2 * TILE + 1.2;
    const corners = [];
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) for (const y of [0, 1.6])
      corners.push(new THREE.Vector3(c.x + x, y, c.z + z));
    // Overlaid action tray: carve its edge out of the frame (view offset keeps
    // the room centred in what remains).
    const W = container.clientWidth || 1, H = container.clientHeight || 1;
    let sx = 0, sy = 0, sw = W, sh = H;
    const tray = container.querySelector('.hud-actions');
    if (tray && tray.offsetParent !== null) {
      const cr = container.getBoundingClientRect(), tr = tray.getBoundingClientRect();
      const t = { l: tr.left - cr.left, t: tr.top - cr.top, r: tr.right - cr.left, b: tr.bottom - cr.top };
      if (t.t > H * 0.55 && t.t < H) sh = t.t;
      else if (t.l > W * 0.55 && t.l < W) sw = t.l;
    }
    camera.aspect = sw / sh;
    camera.setViewOffset(sw, sh, -sx, -sy, W, H);
    camera.updateProjectionMatrix();
    const margin = 0.9; // NDC extent to keep clear of the HUD edges
    const v = new THREE.Vector3();
    let dist = Math.hypot(CAM_ELEV, CAM_BACK) * (span / 9);
    for (let i = 0; i < 12; i++) {
      camera.position.copy(camTarget).addScaledVector(dir, dist);
      camera.lookAt(camTarget);
      camera.updateMatrixWorld();
      let worst = 0;
      for (const p of corners) { v.copy(p).project(camera); worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y)); }
      if (worst <= margin) break;
      dist *= Math.min(1.6, worst / margin + 0.02);
    }
    camera.position.copy(camTarget).addScaledVector(dir, dist);
    camera.lookAt(camTarget);
  }

  // patience ring color: green → amber → red by remaining ratio
  const cGreen = new THREE.Color(0x7fd08a), cAmber = new THREE.Color(0xffb35c), cRed = new THREE.Color(0xe0574d);
  function patienceColor(ratio, out) {
    if (ratio > 0.5) out.copy(cAmber).lerp(cGreen, (ratio - 0.5) * 2);
    else out.copy(cRed).lerp(cAmber, ratio * 2);
    return out;
  }

  const tmpColor = new THREE.Color();
  function sync(state, prevState, alpha, settings) {
    if (!world || !state || state.cfg !== cfg) return;
    reducedMotion = !!(settings && settings.reducedMotion);

    // tables: open state changes + patience rings
    state.tables.forEach(t => {
      const v = tableViews[t.id]; if (!v) return;
      if (t.open && v.userData.barrier) {
        v.remove(v.userData.barrier);
        disposeGroup(v.userData.barrier);
        v.userData.barrier = null;
        v.traverse(o => { if (o.material && o.material.transparent) { o.material.opacity = 1; o.material.transparent = false; } });
      }
      const ring = v.userData.ring;
      let g = null;
      if (t.guestId != null) g = state.guests.find(x => x.id === t.guestId && x.status === 'seated') || null;
      if (g) {
        ring.visible = true;
        const ratio = Math.max(0, g.patience / g.maxPatience);
        ring.material.color.copy(patienceColor(ratio, tmpColor));
        if (highlightSet.has('table:' + t.id)) ring.scale.setScalar(1.18); else ring.scale.setScalar(1);
      } else if (highlightSet.has('table:' + t.id)) {
        ring.visible = true;
        ring.material.color.setHex(0xffd27a);
        ring.scale.setScalar(1.18);
      } else ring.visible = false;
    });

    // stoves: steam while cooking
    state.stoves.forEach(s => {
      const v = stoveViews[s.id]; if (!v) return;
      const steam = v.userData.steam;
      steam.visible = s.progress > 0 && !reducedMotion;
      if (steam.visible) steam.position.y = 0.75 + 0.12 * Math.sin(state.tick * 0.15 + s.id);
    });

    // waiters: interpolate between snapshot positions; tray dish pucks
    state.waiters.forEach(w => {
      const v = waiterViews[w.id];
      if (!v) { // helper hired mid-game
        const nv = buildWaiter(0x7ec8e8, false);
        nv.traverse(o => { if (o.isMesh) o.castShadow = true; });
        world.add(nv);
        waiterViews[w.id] = nv;
        return syncWaiter(nv, w, prevState, state, 1);
      }
      syncWaiter(v, w, prevState, state, alpha);
    });

    // guests: seated at tables, queue at the door
    const seen = new Set();
    let qi = 0;
    state.guests.forEach(g => {
      seen.add(g.id);
      let v = guestViews.get(g.id);
      if (!v) {
        const hue = [0xc96f4a, 0x6f8fc9, 0x8fc96f, 0xc9c06f, 0xa06fc9][g.id % 5];
        v = buildGuest(hue);
        v.traverse(o => { if (o.isMesh) o.castShadow = true; });
        world.add(v);
        guestViews.set(g.id, v);
      }
      if (g.status === 'queue' && g.tableId == null) {
        v.position.copy(queueSpots[Math.min(qi++, queueSpots.length - 1)]);
      } else if (g.tableId != null) {
        const t = state.tables[g.tableId];
        const p = gridToWorld(t.x, t.y);
        v.position.set(p.x + 0.55, 0, p.z); // sits beside the table
      }
      v.visible = true;
    });
    guestViews.forEach((v, id) => {
      if (!seen.has(id)) { world.remove(v); disposeGroup(v); guestViews.delete(id); }
    });

    // player marker pulse (cosmetic, disabled by reduced motion)
    const pv = waiterViews[0];
    if (pv && pv.userData.marker && !reducedMotion)
      pv.userData.marker.scale.setScalar(1 + 0.08 * Math.sin(performance.now() * 0.004));

    dirty = true;
  }

  function syncWaiter(v, w, prevState, state, alpha) {
    const p = gridToWorld(w.x, w.y);
    let prev = null;
    if (prevState) {
      const pw = prevState.waiters.find(x => x.id === w.id);
      if (pw && (pw.x !== w.x || pw.y !== w.y)) prev = gridToWorld(pw.x, pw.y);
    }
    if (prev && !reducedMotion) v.position.lerpVectors(prev, p, alpha);
    else v.position.copy(p);
    // tray pucks = carried dishes
    const tray = v.userData.tray;
    while (tray.children.length - 1 < w.carrying) {
      const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 10), mat(0xf0e6d2));
      puck.position.y = 0.02 + 0.035 * (tray.children.length - 1);
      tray.add(puck);
    }
    while (tray.children.length - 1 > w.carrying) {
      const puck = tray.children[tray.children.length - 1];
      tray.remove(puck); puck.geometry.dispose(); puck.material.dispose();
    }
  }

  // selection / legal-target highlights
  function setHighlights(list) {
    highlightSet = new Set(list || []);
  }

  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    raycaster.layers.set(LAYER_PICK);
    const hits = raycaster.intersectObjects(pickMeshes, false);
    if (!hits.length) return null;
    const ud = hits[0].object.userData;
    if (ud.kind === 'floor') {
      const pt = hits[0].point;
      const x = Math.round(pt.x / TILE + (cfg.grid.w - 1) / 2);
      const y = Math.round(pt.z / TILE + (cfg.grid.h - 1) / 2);
      if (x < 0 || y < 0 || x >= cfg.grid.w || y >= cfg.grid.h) return null;
      return { kind: 'tile', x, y };
    }
    return ud;
  }

  function event(kind) { // small camera impulse on high-tier events
    if (reducedMotion) return;
    if (kind === 'serve') { shakeAmp = 0.03; shakeT = 0.18; }
    else if (kind === 'win' || kind === 'lose') { shakeAmp = 0.08; shakeT = 0.4; }
  }

  function setQuality(t, settings) {
    tier = t;
    reducedMotion = !!(settings && settings.reducedMotion);
    const dprCap = t === 'low' ? 1 : t === 'medium' ? 1.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.shadowMap.enabled = t !== 'low';
    key.castShadow = t !== 'low';
    resize();
  }

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    frameCamera();
    dirty = true;
  }

  let lastHidden = false;
  function setHidden(hidden) { lastHidden = hidden; }

  function renderFrame(dt) {
    if (lastHidden || !world) return; // hidden tabs: zero rendering
    if (shakeT > 0) {
      shakeT -= dt;
      const a = shakeAmp * (shakeT > 0 ? shakeT : 0);
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.z += (Math.random() - 0.5) * a;
      if (shakeT <= 0) frameCamera();
    }
    renderer.render(scene, camera);
    dirty = false;
  }

  function dispose() {
    if (world) { scene.remove(world); disposeGroup(world); world = null; }
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return {
    build, sync, pick, setHighlights, event, setQuality, resize, renderFrame,
    frameCamera, setHidden, dispose,
    domElement: renderer.domElement
  };
}

export function create(container, callbacks) {
  if (R) { R.dispose(); R = null; }
  R = api(container, callbacks || {});
  return R; // null when WebGL unavailable → caller shows compatibility notice
}
