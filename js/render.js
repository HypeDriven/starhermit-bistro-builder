/* Bistro Builder — Three.js presentation layer.
 * Semantic meshes for stations/guests/waiters built from procedural geometry;
 * render layers separate environment/gameplay/selection/effects; picking
 * raycasts only explicit interaction meshes. Rendering consumes immutable
 * rules snapshots — this module never mutates game state.
 *
 * Graphics quality comes from gfx.js (resolved settings): shadow map size,
 * image-based lighting, the post chain (GTAO → bloom → output → grade →
 * FXAA/SMAA), surface detail, steam particles, ambient animation, and a
 * pixel ratio of min(dpr, 2) × preset scale × adaptive scale.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { resolve as resolveGfx, SHADOW_MAP } from './gfx.js';

const LAYER_ENV = 0, LAYER_PICK = 1; // pick meshes live on their own layer

const TILE = 1.0;            // world units per grid tile
const CAM_ELEV = 11;         // authored framing constants (no magic offsets)
const CAM_BACK = 8.5;
const CAM_FOV = 38;
const BG = 0x14100d;

let R = null; // module singleton (one renderer per page)

/** Unmasked GPU name. Firefox exposes it as RENDERER (and warns on the debug
 * extension), Chromium masks RENDERER and needs WEBGL_debug_renderer_info. */
export function gpuString(gl) {
  try {
    const plain = String(gl.getParameter(gl.RENDERER) || '');
    if (plain && !/^webkit webgl$|^webgl/i.test(plain.trim())) return plain;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || plain) : plain;
  } catch (e) { return ''; }
}

/** GPU name without a renderer (settings opened before the first round). */
export function probeGpu() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    return gpuString(gl); // (no loseContext: browsers log a warning for it)
  } catch (e) { return ''; }
}

function makeRenderer(antialias) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !!antialias, powerPreference: 'default' });
  } catch (e) { return null; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.userData = { antialias: !!antialias };
  return renderer;
}

// ---------- procedural textures (cached; shared across rebuilds, never disposed) ----------
const texCache = {};
function canvasTex(key, size, draw, srgb) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache[key] = t;
  return t;
}
function seededNoise(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Floor tile: fine speckle grain plus darkened bevel edges (multiplies instance colour).
function tileTexture() {
  return canvasTex('tile', 128, (g, n) => {
    const rnd = seededNoise(7);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1400; i++) {
      const v = 200 + Math.floor(rnd() * 55);
      g.fillStyle = `rgba(${v},${v - 6},${v - 12},0.5)`;
      g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    const grd = g.createLinearGradient(0, 0, n, n);
    grd.addColorStop(0, 'rgba(255,245,230,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
    g.strokeStyle = 'rgba(40,25,15,0.45)'; g.lineWidth = 5; g.strokeRect(0, 0, n, n);
  }, true);
}
// Wood grain streaks.
function woodTexture() {
  return canvasTex('wood', 256, (g, n) => {
    const rnd = seededNoise(11);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 90; i++) {
      const y = rnd() * n, a = 0.05 + rnd() * 0.12, v = 120 + Math.floor(rnd() * 60);
      g.strokeStyle = `rgba(${v},${Math.floor(v * 0.75)},${Math.floor(v * 0.5)},${a})`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= n; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
      g.stroke();
    }
  }, true);
}
// Plaster: soft mottling.
function plasterTexture() {
  return canvasTex('plaster', 128, (g, n) => {
    const rnd = seededNoise(23);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 220; i++) {
      const r = 4 + rnd() * 14, v = 215 + Math.floor(rnd() * 40);
      g.fillStyle = `rgba(${v},${v - 8},${v - 16},0.18)`;
      g.beginPath(); g.arc(rnd() * n, rnd() * n, r, 0, Math.PI * 2); g.fill();
    }
  }, true);
}
// Street outside: a dim pool of lamplight that fades into the backdrop colour.
function streetTexture() {
  return canvasTex('street', 256, (g, n) => {
    const grd = g.createRadialGradient(n / 2, n / 2, n * 0.05, n / 2, n / 2, n / 2);
    grd.addColorStop(0, '#3b2e24'); grd.addColorStop(0.35, '#241b15'); grd.addColorStop(0.75, '#110d0a'); grd.addColorStop(1, '#0a0806');
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
  }, true);
}

// ---------- materials ----------
function mat(color, opts) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.05, envMapIntensity: 0.35 }, opts || {}));
}
// Glossy pieces (table tops, plates, ceramic): clearcoat over a satin base.
function gloss(color, opts) {
  return new THREE.MeshPhysicalMaterial(Object.assign({
    color, roughness: 0.45, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.25, envMapIntensity: 0.5
  }, opts || {}));
}
function glow(color, intensity) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 });
}

// --- procedural guest: rounded capsule body + head, colored by mood ---
function buildGuest(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 4, 12), mat(color, { roughness: 0.6 }));
  body.position.y = 0.28;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), mat(0xf0d8b8, { roughness: 0.55 }));
  head.position.y = 0.56;
  g.add(body, head);
  g.userData.phase = Math.random() * Math.PI * 2; // cosmetic only
  return g;
}

function buildWaiter(color, isPlayer) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 12), mat(color, { roughness: 0.55 }));
  body.position.y = 0.34;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), mat(0xf0d8b8, { roughness: 0.55 }));
  head.position.y = 0.66;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.05), mat(0xf4efe6, { roughness: 0.7 }));
  apron.position.set(0, 0.34, 0.15);
  g.add(body, head, apron);
  if (isPlayer) { // grounded selection marker ring under the player
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.3, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    g.add(ring);
    g.userData.marker = ring;
  }
  // tray (visible dish count pucks added in sync)
  const tray = new THREE.Group();
  tray.position.set(0, 0.55, 0.2);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 20), mat(0xc9c2b4, { roughness: 0.3, metalness: 0.6 }));
  tray.add(plate);
  g.add(tray);
  g.userData.tray = tray;
  return g;
}

function buildTable(theme, detailed) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.06, 24),
    gloss(theme.table, detailed ? { map: woodTexture() } : null));
  top.position.y = 0.42;
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 24), mat(theme.cloth, { roughness: 0.95 }));
  cloth.position.y = 0.46;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 10), mat(theme.wood, detailed ? { map: woodTexture() } : null));
  leg.position.y = 0.21;
  g.add(top, cloth, leg);
  if (detailed) { // candle: wax stub + emissive flame (blooms; flickers when animated)
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), mat(0xf3ead8, { roughness: 0.6 }));
    wax.position.y = 0.51;
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), glow(0xffb45a, 3.2));
    flame.scale.set(1, 1.6, 1);
    flame.position.y = 0.575;
    g.add(wax, flame);
    g.userData.flame = flame;
  }
  // patience ring (hidden until a guest waits)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.44, 36),
    new THREE.MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.visible = false;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

function buildStove(theme, particlesHigh) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.7), mat(theme.metal, { metalness: 0.75, roughness: 0.32 }));
  base.position.y = 0.25;
  const burner = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 24), glow(0xff6a2a, 0.15));
  burner.rotation.x = Math.PI / 2; burner.position.y = 0.505;
  const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.1, 20), mat(0x2c2c30, { metalness: 0.8, roughness: 0.3 }));
  pan.position.y = 0.56;
  g.add(base, burner, pan);
  const puffs = [];
  const n = particlesHigh ? 6 : 1;
  for (let i = 0; i < n; i++) {
    const steam = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
    steam.position.y = 0.75;
    steam.userData.offset = i / n;
    g.add(steam);
    puffs.push(steam);
  }
  g.userData.steam = puffs;
  g.userData.burner = burner;
  return g;
}

// Colour grade + vignette (display-space in, display-space out; after OutputPass).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.24 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // Gentle S-curve contrast, a touch more saturation, warm highlights / cool shadows.
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.97, 0.98, 1.03), vec3(1.04, 1.0, 0.95), smoothstep(0.2, 0.8, l));
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.0, 0.85));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`
};

function api(container, callbacks) {
  let renderer = makeRenderer(callbacks.antialias !== false);
  if (!renderer) return null;
  container.appendChild(renderer.domElement);
  if (callbacks.onCanvas) callbacks.onCanvas(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // lights: one dominant warm key (shadow frustum fitted to the room), soft hemisphere fill
  const key = new THREE.DirectionalLight(0xffeedd, 2.2);
  const KEY_DIR = new THREE.Vector3(6, 12, 4).normalize();
  key.position.copy(KEY_DIR).multiplyScalar(20);
  key.castShadow = false;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.HemisphereLight(0xd8ccbc, 0x30231a, 0.9);
  scene.add(key, key.target, fill);

  let world = null;        // group holding current board
  let pickMeshes = [];     // explicit interaction layer only
  let tableViews = [], stoveViews = [], waiterViews = [], guestViews = new Map();
  let queueSpots = [];
  let highlightMeshes = new Map(); // 'table:3' -> ring
  let flickers = [];       // emissive meshes that shimmer when animated
  let cfg = null, theme = null;
  let camTarget = new THREE.Vector3();
  let shakeAmp = 0, shakeT = 0;
  let reducedMotion = false;
  let highlightSet = new Set();
  let dirty = true;

  // graphics state
  const gpu = gpuString(renderer.getContext());
  let q = resolveGfx({}, 'low');
  let builtWith = null;    // {detail, particles} used by the current world
  let envTex = null;
  let composer = null, postKey = null, postFailed = false;
  let pixelRatio = 0, size = [0, 0];
  let adaptiveScale = 1, frames = [], fps = 0, lastT = 0;

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
    const detailed = q.detail === 'detailed';
    builtWith = { detail: q.detail, particles: q.particles };
    if (world) { scene.remove(world); disposeGroup(world); }
    pickMeshes = []; tableViews = []; stoveViews = []; waiterViews = []; flickers = [];
    guestViews.forEach(v => disposeGroup(v)); guestViews.clear();
    highlightMeshes.forEach(v => disposeGroup(v)); highlightMeshes.clear();
    world = new THREE.Group();
    scene.add(world);

    const decor = window.BBRNG.derive(seed >>> 0, window.BBRNG.STREAM_DECOR);

    // floor tiles (checkerboard, instanced)
    const tileGeo = new THREE.BoxGeometry(TILE * 0.98, 0.08, TILE * 0.98);
    const nTiles = cfg.grid.w * cfg.grid.h;
    const floor = new THREE.InstancedMesh(tileGeo,
      detailed ? gloss(0xffffff, { map: tileTexture(), roughness: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.45 }) : mat(0xffffff), nTiles);
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
    const wallMat = mat(theme.wall, detailed ? { map: plasterTexture(), roughness: 0.92 } : null);
    const wallGeoH = new THREE.BoxGeometry(cfg.grid.w * TILE + 0.4, 0.9, 0.3);
    const wallGeoV = new THREE.BoxGeometry(0.3, 0.9, cfg.grid.h * TILE + 0.4);
    const corners = [gridToWorld(0, 0), gridToWorld(cfg.grid.w - 1, cfg.grid.h - 1)];
    const top = new THREE.Mesh(wallGeoH, wallMat);
    top.position.set((corners[0].x + corners[1].x) / 2, 0.45, corners[0].z - TILE / 2 - 0.15);
    const bottom = top.clone(); bottom.position.z = corners[1].z + TILE / 2 + 0.15;
    const left = new THREE.Mesh(wallGeoV, wallMat);
    left.position.set(corners[0].x - TILE / 2 - 0.15, 0.45, (corners[0].z + corners[1].z) / 2);
    const right = left.clone(); right.position.x = corners[1].x + TILE / 2 + 0.15;
    [top, bottom, left, right].forEach(w => { w.receiveShadow = true; w.castShadow = true; });
    world.add(top, bottom, left, right);

    // kitchen counter along row 0
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.grid.w * TILE * 0.9, 0.45, 0.5), mat(theme.wood, detailed ? { map: woodTexture() } : null));
    counter.position.set((corners[0].x + corners[1].x) / 2, 0.22, corners[0].z);
    counter.castShadow = true; counter.receiveShadow = true;
    world.add(counter);

    if (detailed) {
      // wooden cap rail along every wall top
      const railMat = mat(new THREE.Color(theme.wood).multiplyScalar(0.55), { map: woodTexture(), roughness: 0.6 });
      [top, bottom, left, right].forEach(w => {
        const p = w.geometry.parameters;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.04, 0.06, p.depth + 0.04), railMat);
        rail.position.copy(w.position); rail.position.y = 0.93;
        rail.castShadow = true;
        world.add(rail);
      });
      // counter top: polished stone slab
      const slab = new THREE.Mesh(new THREE.BoxGeometry(cfg.grid.w * TILE * 0.9 + 0.06, 0.04, 0.56),
        gloss(0x847869, { roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.4 }));
      slab.position.set(counter.position.x, 0.465, counter.position.z);
      slab.castShadow = true; slab.receiveShadow = true;
      world.add(slab);
      // festoon of warm bulbs strung above the back wall
      const span = cfg.grid.w * TILE + 0.2, n = Math.max(6, Math.round(cfg.grid.w * 1.4));
      const pts = [];
      const bulbMat = glow(0xffc47a, 1.9);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = top.position.x - span / 2 + t * span;
        const y = 1.35 - Math.sin(t * Math.PI * 3) ** 2 * 0.14;
        pts.push(new THREE.Vector3(x, y + 0.04, top.position.z));
        if (i > 0 && i < n) {
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), bulbMat.clone());
          bulb.position.set(x, y, top.position.z);
          bulb.userData.base = 1.9; bulb.userData.phase = i * 1.7;
          world.add(bulb);
          flickers.push(bulb);
        }
      }
      const cord = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1a120c }));
      world.add(cord);
      // posts holding the festoon at both ends
      [pts[0], pts[pts.length - 1]].forEach(p => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), mat(0x2a2320, { metalness: 0.6, roughness: 0.4 }));
        post.position.set(p.x, 1.13, p.z);
        world.add(post);
      });
      // street outside: warm pool of light that fades into the backdrop
      const street = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(0x9a9a9a, { map: streetTexture(), roughness: 1, envMapIntensity: 0.1 }));
      street.rotation.x = -Math.PI / 2;
      street.position.set((corners[0].x + corners[1].x) / 2, -0.085, (corners[0].z + corners[1].z) / 2);
      street.receiveShadow = true;
      world.add(street);
    }

    // decorative props (seeded decor stream; never affects rules)
    const propGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.5, 10);
    const props = new THREE.InstancedMesh(propGeo, mat(theme.wood, detailed ? { map: woodTexture() } : null), 6);
    for (let i = 0; i < 6; i++) {
      const px = corners[0].x - TILE * (0.9 + decor.next() * 0.6);
      const pz = corners[0].z + decor.next() * (corners[1].z - corners[0].z);
      m4.setPosition(px, 0.25, pz);
      props.setMatrixAt(i, m4);
    }
    props.castShadow = true;
    world.add(props);

    // tables
    state.tables.forEach(t => {
      const v = buildTable(theme, detailed);
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
      if (v.userData.flame) { v.userData.flame.castShadow = false; v.userData.flame.userData.base = 3.2; v.userData.flame.userData.phase = t.id * 2.3; flickers.push(v.userData.flame); }
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
      const v = buildStove(theme, q.particles === 'high');
      v.position.copy(gridToWorld(s.x, s.y));
      v.traverse(o => { if (o.isMesh && o.material && !o.material.transparent) o.castShadow = true; });
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
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 1.2), mat(theme.glow, { emissive: theme.glow, emissiveIntensity: 1.1 }));
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

    fitShadow();
    frameCamera();
    dirty = true;
  }

  // Key-light shadow box fitted tightly to the room (plus the door queue).
  function fitShadow() {
    if (!cfg) return;
    const c = gridToWorld((cfg.grid.w - 1) / 2, (cfg.grid.h - 1) / 2);
    const hw = cfg.grid.w / 2 * TILE + 1.0, hd = cfg.grid.h / 2 * TILE + 1.0;
    const r = Math.hypot(hw, hd) + 0.3;
    key.target.position.copy(c);
    key.position.copy(c).addScaledVector(KEY_DIR, 20);
    const cam = key.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 20 - r - 2; cam.far = 20 + r + 2;
    cam.updateProjectionMatrix();
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
    const now = performance.now() / 1000;
    const moving = !reducedMotion && q.animation === 'animated';

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

    // stoves: burner glow + steam while cooking
    state.stoves.forEach(s => {
      const v = stoveViews[s.id]; if (!v) return;
      const cooking = s.progress > 0;
      const burner = v.userData.burner;
      burner.material.emissiveIntensity = cooking ? 2.2 + (moving ? 0.35 * Math.sin(now * 9 + s.id) : 0) : 0.15;
      const puffs = v.userData.steam;
      puffs.forEach((steam, i) => {
        steam.visible = cooking && !reducedMotion;
        if (!steam.visible) return;
        if (puffs.length === 1) {
          steam.position.y = 0.75 + 0.12 * Math.sin(state.tick * 0.15 + s.id);
          return;
        }
        const ph = (now * 0.45 + steam.userData.offset) % 1; // rise, swell, fade
        steam.position.set(Math.sin((ph + i) * 5) * 0.06, 0.66 + ph * 0.7, Math.cos((ph + i) * 4) * 0.05);
        steam.scale.setScalar(0.6 + ph * 1.1);
        steam.material.opacity = 0.32 * Math.sin(ph * Math.PI);
      });
    });

    // candle + festoon shimmer (cosmetic)
    for (let i = 0; i < flickers.length; i++) {
      const f = flickers[i], b = f.userData.base;
      f.material.emissiveIntensity = moving
        ? b * (0.86 + 0.1 * Math.sin(now * 7.3 + f.userData.phase) + 0.06 * Math.sin(now * 17.1 + f.userData.phase * 2))
        : b;
    }

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
      if (moving) v.position.y += 0.012 * (1 + Math.sin(now * 2.2 + v.userData.phase)); // idle bob
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
    // tray pucks = carried dishes (glossy ceramic)
    const tray = v.userData.tray;
    while (tray.children.length - 1 < w.carrying) {
      const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), gloss(0xf0e6d2, { roughness: 0.3, clearcoat: 0.9 }));
      puck.position.y = 0.02 + 0.035 * (tray.children.length - 1);
      puck.castShadow = true;
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

  // ---------- graphics settings ----------
  function ensureEnv() {
    if (envTex) return envTex;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(renderer);
    envTex = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    return envTex;
  }

  // Canvas MSAA is fixed at context creation: swap the renderer when the
  // direct (no post chain) path needs a different setting.
  function swapRenderer(aa) {
    const nr = makeRenderer(aa);
    if (!nr) return;
    const old = renderer;
    container.insertBefore(nr.domElement, old.domElement);
    old.domElement.remove();
    if (composer) { disposeComposer(composer); composer = null; }
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    if (envTex) { envTex.dispose(); envTex = null; }
    old.dispose();
    renderer = nr;
    if (callbacks.onCanvas) callbacks.onCanvas(nr.domElement);
    pixelRatio = 0; size = [0, 0]; postKey = null;
  }

  function disposeComposer(c) {
    c.passes.forEach(p => { if (p.dispose) p.dispose(); });
    c.dispose();
  }

  function markMaterials() {
    scene.traverse(o => {
      if (!o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; });
    });
  }

  /** Apply resolved graphics settings live. Returns { rebuild } when the
   * board must be rebuilt (surface detail / particle count changed). */
  function setGraphics(resolved, settings) {
    q = resolved;
    reducedMotion = !!(settings && settings.reducedMotion);
    if (!q.post && renderer.userData.antialias !== (q.antialias === 'msaa')) swapRenderer(q.antialias === 'msaa');
    const sm = SHADOW_MAP[q.shadows];
    renderer.shadowMap.enabled = sm > 0;
    key.castShadow = sm > 0;
    if (sm > 0 && key.shadow.mapSize.x !== sm) {
      key.shadow.mapSize.set(sm, sm);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
    if (q.reflections === 'on') { scene.environment = ensureEnv(); fill.intensity = 0.55; }
    else { scene.environment = null; fill.intensity = 0.9; }
    markMaterials();
    adaptiveScale = 1; frames = [];
    postKey = null;
    dirty = true;
    return { rebuild: !!(world && builtWith && (builtWith.detail !== q.detail || builtWith.particles !== q.particles)) };
  }

  function currentPixels() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * q.scale * adaptiveScale;
    return [Math.round(w * ratio), Math.round(h * ratio)];
  }

  function graphicsInfo() {
    return { gpu, resolved: q, pixels: currentPixels(), fps: Math.round(fps), adaptiveScale, postFailed };
  }

  function postKeyFor(w, h) {
    return q.post && !postFailed ? [q.ao, q.bloom, q.grade, q.antialias, w, h, pixelRatio].join('|') : 'none';
  }

  function buildPost(w, h) {
    if (composer) { disposeComposer(composer); composer = null; }
    if (!q.post || postFailed) return;
    try {
      const pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0
      });
      const c = new EffectComposer(renderer, target);
      c.setPixelRatio(pixelRatio);
      c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (q.ao !== 'off') {
        const ao = new GTAOPass(scene, camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        const hi = q.ao === 'high';
        ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: hi ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
        c.addPass(ao);
      }
      // High threshold: only emissive lamps, candles, burners and the door glow bloom.
      if (q.bloom === 'on') c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.3, 0.92));
      c.addPass(new OutputPass());
      if (q.grade === 'on') c.addPass(new ShaderPass(GradeShader));
      if (q.antialias === 'smaa') c.addPass(new SMAAPass(pw, ph));
      if (q.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        c.addPass(fxaa);
      }
      composer = c;
    } catch (e) {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      postFailed = true;
      composer = null;
    }
  }

  // Adaptive resolution: ~90-frame average; slow → step down 0.1 (min 0.6), fast → up 0.05 (max 1).
  function adapt(ms) {
    frames.push(ms);
    if (frames.length < 90) return;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    frames.length = 0;
    fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(fps) + ' fps · ' + (Math.round(pixelRatio * 100) / 100) + '×';
    if (!q.adaptive) { adaptiveScale = 1; return; }
    if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
    else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
  }

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    size = [w, h];
    camera.aspect = w / h;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    frameCamera();
    dirty = true;
  }

  let lastHidden = false;
  function setHidden(hidden) { lastHidden = hidden; lastT = 0; }

  function renderFrame(dt) {
    if (lastHidden || !world) return; // hidden tabs: zero rendering
    const now = performance.now();
    if (lastT) adapt(Math.min(250, now - lastT));
    lastT = now;
    if (shakeT > 0) {
      shakeT -= dt;
      const a = shakeAmp * (shakeT > 0 ? shakeT : 0);
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.z += (Math.random() - 0.5) * a;
      if (shakeT <= 0) frameCamera();
    }
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * q.scale * adaptiveScale;
    if (w !== size[0] || h !== size[1] || ratio !== pixelRatio) {
      const moved = w !== size[0] || h !== size[1];
      pixelRatio = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h, false);
      size = [w, h];
      if (moved) { camera.aspect = w / h; camera.clearViewOffset(); frameCamera(); }
    }
    const k = postKeyFor(w, h);
    if (k !== postKey) { postKey = k; buildPost(w, h); }
    if (composer) {
      try { composer.render(dt); }
      catch (e) { postFailed = true; disposeComposer(composer); composer = null; postKey = null; renderer.render(scene, camera); }
    } else renderer.render(scene, camera);
    dirty = false;
  }

  function dispose() {
    if (world) { scene.remove(world); disposeGroup(world); world = null; }
    if (composer) { disposeComposer(composer); composer = null; }
    if (envTex) { envTex.dispose(); envTex = null; }
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return {
    build, sync, pick, setHighlights, event, setGraphics, graphicsInfo, resize, renderFrame,
    frameCamera, setHidden, dispose,
    get domElement() { return renderer.domElement; }
  };
}

export function create(container, callbacks) {
  if (R) { R.dispose(); R = null; }
  R = api(container, callbacks || {});
  return R; // null when WebGL unavailable → caller shows compatibility notice
}
