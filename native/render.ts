// The bistro diorama on starhermit:scene, ported from the browser build's
// three.js layer (js/render.js before the port): the instanced checkerboard
// floor, walls with cap rails, the kitchen counter and stone slab, tables
// with cloth, candle and patience ring, stoves with burner, pan and steam,
// capsule waiters (the player's pulsing ring, tray pucks per carried dish)
// and guests, the glowing door, the festoon of bulbs, the street pool of
// light, seeded props, the walled-off tables behind their barriers, the
// framed camera with its event impulses, and the look per graphics level
// from quality.ts. It consumes rules snapshots and never mutates rules state.
//
// What changed from three.js, and why:
// - The camera frames the room inside the playfield rectangle the HUD
//   leaves (screens.ts passes it) by moving camera and target sideways
//   (frameRoom), as the engine has no setViewOffset.
// - Picking: the engine's raycaster hits only visible meshes, so the
//   invisible pick proxies are a ray cast onto the table-top and floor
//   planes, mapped to the grid (tables and stoves sit on their tiles).
// - The EffectComposer chain (GTAO, UnrealBloom, OutputPass, the grade
//   ShaderPass, SMAA / FXAA / MSAA) is renderer.ao / bloom / grade /
//   antialias; the grade's GLSL is the built-in display-space grade with the
//   same curve, tints and vignette.
// - MeshPhongMaterial (Low's gloss) is Lambert; the festoon's Line cord is
//   thin cylinders; material.clone() (not available) is a new material.
// - The key light's shadow box is fitted to the room (fitShadow) as the
//   browser build's was.
// - Light intensities, shadow values and the PMREM RoomEnvironment(renderer)
//   are three.js r160's as the page had them (engine minor 28). Standard
//   materials get the room as their own envMap so their envMapIntensity
//   applies as r160 did with scene.environment. The canvas textures are CanvasTextures of starhermit:canvas
//   (sRGB, as the browser build's SRGBColorSpace CanvasTextures were).
import {
  ACESFilmicToneMapping, BoxGeometry, CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, OrthographicCamera, PCFSoftShadowMap, PMREMGenerator, PerspectiveCamera, PlaneGeometry, Raycaster, RoomEnvironment,
  RingGeometry, SRGBColorSpace, SphereGeometry, TorusGeometry, Vector3, pointerToNdc, renderer, scene,
} from "starhermit:scene";
import type { Material, Object3D, Texture } from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { RNG, type Cfg, type State, type Theme } from "./classic.ts";
import type { Budget, Look } from "./quality.ts";

const TILE = 1.0;
const CAM_ELEV = 11, CAM_BACK = 8.5, CAM_FOV = 38;
const BG = 0x14100d;
const PI = Math.PI;

const camera = new PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 100);
let look: Look | null = null;
let BUD: Budget = { material: "physical", segments: 1, texture: 1, steam: 6, bloomRes: 1 };
let reducedMotion = false;
let built = false;
const _m = new Matrix4();
const _v = new Vector3();
const seg = (n: number): number => Math.max(3, Math.round(n * BUD.segments));

// --- lights -------------------------------------------------------------------------
const KEY_DIR = new Vector3(6, 12, 4).normalize();
const keyLight = new DirectionalLight(0xffeedd, 2.2);
keyLight.position.copy(KEY_DIR).multiplyScalar(20);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
const fill = new HemisphereLight(0xd8ccbc, 0x30231a, 0.9);
/** The key light's orthographic shadow box fitted to the room (the browser build's fitShadow). */
function fitShadow(): void {
  if (!cfg) return;
  const c = gridToWorld((cfg.grid.w - 1) / 2, (cfg.grid.h - 1) / 2);
  const hw = (cfg.grid.w / 2) * TILE + 1.0, hd = (cfg.grid.h / 2) * TILE + 1.0;
  const r = Math.hypot(hw, hd) + 0.3;
  keyLight.target.position.copy(c);
  keyLight.position.copy(c).addScaledVector(KEY_DIR, 20);
  const cam = keyLight.shadow.camera as OrthographicCamera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 20 - r - 2; cam.far = 20 + r + 2;
  cam.updateProjectionMatrix();
}

// --- procedural textures (cached per size; shared across rebuilds) ---------------------
const texCache = new Map<string, Texture>();
function canvasTex(key: string, size: number, paint: (g: OffscreenCanvasRenderingContext2D, n: number) => void): Texture {
  const px = Math.max(16, Math.round(size * BUD.texture));
  const id = `${key}:${px}`;
  const hit = texCache.get(id);
  if (hit) return hit;
  const c = new OffscreenCanvas(px, px);
  const g = c.getContext("2d");
  g.scale(px / size, px / size); // patterns are authored at `size`, drawn at the budget's resolution
  paint(g, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(id, t);
  return t;
}
function seededNoise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Floor tile: fine speckle grain plus darkened bevel edges (multiplies the instance colour). */
function tileTexture(): Texture {
  return canvasTex("tile", 128, (g, n) => {
    const rnd = seededNoise(7);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1400; i++) {
      const v = 200 + Math.floor(rnd() * 55);
      g.fillStyle = `rgba(${v},${v - 6},${v - 12},0.5)`;
      g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    const grd = g.createLinearGradient(0, 0, n, n);
    grd.addColorStop(0, "rgba(255,245,230,0.10)"); grd.addColorStop(1, "rgba(0,0,0,0.10)");
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
    g.strokeStyle = "rgba(40,25,15,0.45)"; g.lineWidth = 5; g.strokeRect(0, 0, n, n);
  });
}
/** Wood grain streaks. */
function woodTexture(): Texture {
  return canvasTex("wood", 256, (g, n) => {
    const rnd = seededNoise(11);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 90; i++) {
      const y = rnd() * n, a = 0.05 + rnd() * 0.12, v = 120 + Math.floor(rnd() * 60);
      g.strokeStyle = `rgba(${v},${Math.floor(v * 0.75)},${Math.floor(v * 0.5)},${a})`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= n; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 3);
      g.stroke();
    }
  });
}
/** Plaster: soft mottling. */
function plasterTexture(): Texture {
  return canvasTex("plaster", 128, (g, n) => {
    const rnd = seededNoise(23);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 220; i++) {
      const r = 4 + rnd() * 14, v = 215 + Math.floor(rnd() * 40);
      g.fillStyle = `rgba(${v},${v - 8},${v - 16},0.18)`;
      g.beginPath(); g.arc(rnd() * n, rnd() * n, r, 0, PI * 2); g.fill();
    }
  });
}
/** Street outside: a dim pool of lamplight that fades into the backdrop colour. */
function streetTexture(): Texture {
  return canvasTex("street", 256, (g, n) => {
    const grd = g.createRadialGradient(n / 2, n / 2, n * 0.05, n / 2, n / 2, n / 2);
    grd.addColorStop(0, "#3b2e24"); grd.addColorStop(0.35, "#241b15"); grd.addColorStop(0.75, "#110d0a"); grd.addColorStop(1, "#0a0806");
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
  });
}

// --- materials -------------------------------------------------------------------------
interface MatOpts { map?: Texture | null; roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number; envMapIntensity?: number; clearcoat?: number; clearcoatRoughness?: number; opacity?: number }
/** Opacity of a walled-off table's pieces (0 = opaque). */
let ghost = 0;
function finish<M extends Material>(m: M): M {
  if (ghost) { m.transparent = true; m.opacity = ghost; }
  return m;
}
function mat(color: number | Color, o: MatOpts = {}): Material {
  if (BUD.material === "lambert") { // Low: Lambert, keeping colour, texture and glow
    return finish(new MeshLambertMaterial({ color, map: o.map ?? null, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1 }));
  }
  return finish(new MeshStandardMaterial({
    color, map: o.map ?? null, roughness: o.roughness ?? 0.85, metalness: o.metalness ?? 0.05,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1, envMapIntensity: o.envMapIntensity ?? 0.35,
  }));
}
/** Glossy pieces (table tops, plates, ceramic): clearcoat over a satin base. */
function gloss(color: number | Color, o: MatOpts = {}): Material {
  if (BUD.material === "lambert") return finish(new MeshLambertMaterial({ color, map: o.map ?? null }));
  const base = { color, map: o.map ?? null, roughness: o.roughness ?? (BUD.material === "standard" ? 0.4 : 0.45), metalness: o.metalness ?? 0, envMapIntensity: o.envMapIntensity ?? 0.5 };
  if (BUD.material === "standard") return finish(new MeshStandardMaterial(base));
  return finish(new MeshPhysicalMaterial({ ...base, clearcoat: o.clearcoat ?? 0.7, clearcoatRoughness: o.clearcoatRoughness ?? 0.25 }));
}
function glow(color: number, intensity: number): Material {
  if (BUD.material === "lambert") return new MeshLambertMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
  return new MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 });
}
type Emissive = MeshStandardMaterial | MeshLambertMaterial;
const em = (m: Mesh): Emissive => m.material as Emissive;

// --- figures and stations -------------------------------------------------------------------
function buildGuest(color: number): Group {
  const g = new Group();
  const body = new Mesh(new CapsuleGeometry(0.16, 0.22, seg(4), seg(12)), mat(color, { roughness: 0.6 }));
  body.position.y = 0.28;
  const head = new Mesh(new SphereGeometry(0.11, seg(14), seg(10)), mat(0xf0d8b8, { roughness: 0.55 }));
  head.position.y = 0.56;
  g.add(body, head);
  g.userData.phase = Math.random() * PI * 2; // cosmetic only
  return g;
}
function buildWaiter(color: number, isPlayer: boolean): Group {
  const g = new Group();
  const body = new Mesh(new CapsuleGeometry(0.17, 0.3, seg(4), seg(12)), mat(color, { roughness: 0.55 }));
  body.position.y = 0.34;
  const head = new Mesh(new SphereGeometry(0.12, seg(14), seg(10)), mat(0xf0d8b8, { roughness: 0.55 }));
  head.position.y = 0.66;
  const apron = new Mesh(new BoxGeometry(0.26, 0.24, 0.05), mat(0xf4efe6, { roughness: 0.7 }));
  apron.position.set(0, 0.34, 0.15);
  g.add(body, head, apron);
  if (isPlayer) { // grounded selection marker ring under the player
    const ring = new Mesh(new RingGeometry(0.24, 0.3, seg(32)),
      new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, side: DoubleSide }));
    ring.rotation.x = -PI / 2; ring.position.y = 0.02;
    ring.noAO = true;
    g.add(ring);
    g.userData.marker = ring;
  }
  // tray (a puck per carried dish is added in sync)
  const tray = new Group();
  tray.position.set(0, 0.55, 0.2);
  tray.add(new Mesh(new CylinderGeometry(0.16, 0.16, 0.02, seg(20)), mat(0xc9c2b4, { roughness: 0.3, metalness: 0.6 })));
  g.add(tray);
  g.userData.tray = tray;
  g.traverse((o) => { if (o instanceof Mesh) o.castShadow = true; });
  return g;
}
function buildTable(theme: Theme, detailed: boolean): Group {
  const g = new Group();
  const top = new Mesh(new CylinderGeometry(0.34, 0.36, 0.06, seg(24)), gloss(theme.table, detailed ? { map: woodTexture() } : {}));
  top.position.y = 0.42;
  const cloth = new Mesh(new CylinderGeometry(0.3, 0.3, 0.02, seg(24)), mat(theme.cloth, { roughness: 0.95 }));
  cloth.position.y = 0.46;
  const leg = new Mesh(new CylinderGeometry(0.05, 0.07, 0.42, seg(10)), mat(theme.wood, detailed ? { map: woodTexture() } : {}));
  leg.position.y = 0.21;
  g.add(top, cloth, leg);
  if (detailed) { // candle: wax stub + emissive flame (blooms; flickers when animated)
    const wax = new Mesh(new CylinderGeometry(0.035, 0.035, 0.08, seg(10)), mat(0xf3ead8, { roughness: 0.6 }));
    wax.position.y = 0.51;
    const flame = new Mesh(new SphereGeometry(0.022, seg(8), seg(6)), finish(glow(0xffb45a, 3.2)));
    flame.scale.set(1, 1.6, 1);
    flame.position.y = 0.575;
    g.add(wax, flame);
    g.userData.flame = flame;
  }
  g.traverse((o) => { if (o instanceof Mesh) o.castShadow = true; });
  if (g.userData.flame) (g.userData.flame as Mesh).castShadow = false;
  // patience ring (hidden until a guest waits)
  const ring = new Mesh(new RingGeometry(0.38, 0.44, seg(36)),
    new MeshBasicMaterial({ color: 0xffb35c, transparent: true, opacity: 0.95, side: DoubleSide }));
  ring.rotation.x = -PI / 2; ring.position.y = 0.03; ring.visible = false;
  ring.noAO = true;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}
function buildStove(theme: Theme, particlesHigh: boolean): Group {
  const g = new Group();
  const base = new Mesh(new BoxGeometry(0.8, 0.5, 0.7), mat(theme.metal, { metalness: 0.75, roughness: 0.32 }));
  base.position.y = 0.25;
  const burner = new Mesh(new TorusGeometry(0.2, 0.025, seg(6), seg(24)), glow(0xff6a2a, 0.15));
  burner.rotation.x = PI / 2; burner.position.y = 0.505;
  const pan = new Mesh(new CylinderGeometry(0.22, 0.24, 0.1, seg(20)), mat(0x2c2c30, { metalness: 0.8, roughness: 0.3 }));
  pan.position.y = 0.56;
  base.castShadow = pan.castShadow = true;
  g.add(base, burner, pan);
  const puffs: Mesh[] = [];
  const n = particlesHigh ? BUD.steam : 1;
  for (let i = 0; i < n; i++) {
    const steam = new Mesh(new SphereGeometry(0.08, seg(10), seg(8)),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }));
    steam.position.y = 0.75;
    steam.userData.offset = i / n;
    steam.noAO = true;
    g.add(steam);
    puffs.push(steam);
  }
  g.userData.steam = puffs;
  g.userData.burner = burner;
  return g;
}

// --- the board ------------------------------------------------------------------------------
let world: Group | null = null;
let cfg: Cfg | null = null;
let theme: Theme | null = null;
let tableViews: Group[] = [];
let stoveViews: Group[] = [];
let waiterViews: Group[] = [];
const guestViews = new Map<number, Group>();
let queueSpots: Vector3[] = [];
let flickers: Mesh[] = [];
let highlightSet = new Set<string>();
let builtKey = "";
let shakeAmp = 0, shakeT = 0;
let time = 0;

function gridToWorld(x: number, y: number, out = new Vector3()): Vector3 {
  return out.set((x - (cfg!.grid.w - 1) / 2) * TILE, 0, (y - (cfg!.grid.h - 1) / 2) * TILE);
}
function disposeGroup(g: Object3D): void {
  g.traverse((o) => {
    if (o instanceof Mesh) { o.geometry.dispose(); o.material.dispose(); }
  });
}
function lookKey(): string { return look ? [look.detailed, look.particles, BUD.material, BUD.segments, BUD.texture, BUD.steam].join("|") : ""; }

function setup(): void {
  built = true;
  scene.add(keyLight, keyLight.target, fill);
  scene.background = new Color(BG);
  renderer.camera = camera;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
}

let lastSeed = 0;
let lastState: State | null = null;
/** Builds the room for a state (a new round, an undo, a theme or budget change). */
export function build(state: State, themeIn: Theme, seed: number): void {
  if (!built) setup();
  cfg = state.cfg;
  theme = themeIn;
  lastSeed = seed;
  lastState = state;
  builtKey = lookKey();
  const detailed = !!look?.detailed;
  if (world) { scene.remove(world); disposeGroup(world); }
  tableViews = []; stoveViews = []; waiterViews = []; flickers = [];
  guestViews.clear();
  world = new Group();
  scene.add(world);
  const decor = RNG.derive(seed >>> 0, RNG.STREAM_DECOR);
  const { w, h } = cfg.grid;

  // floor tiles (checkerboard, instanced)
  const floor = new InstancedMesh(new BoxGeometry(TILE * 0.98, 0.08, TILE * 0.98),
    detailed ? gloss(0xffffff, { map: tileTexture(), roughness: 0.6, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.45 }) : mat(0xffffff), w * h);
  const col = new Color();
  let fi = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = gridToWorld(x, y);
    _m.makeTranslation(p.x, -0.04, p.z);
    floor.setMatrixAt(fi, _m);
    col.setHex((x + y) % 2 ? theme.floorAlt : theme.floor);
    floor.setColorAt(fi, col);
    fi++;
  }
  floor.instanceMatrix.needsUpdate = true;
  floor.receiveShadow = true;
  world.add(floor);

  // walls around the room
  const wallMat = mat(theme.wall, detailed ? { map: plasterTexture(), roughness: 0.92 } : {});
  const c0 = gridToWorld(0, 0), c1 = gridToWorld(w - 1, h - 1);
  const cx = (c0.x + c1.x) / 2, cz = (c0.z + c1.z) / 2;
  const walls: { x: number; z: number; sx: number; sz: number }[] = [
    { x: cx, z: c0.z - TILE / 2 - 0.15, sx: w * TILE + 0.4, sz: 0.3 },
    { x: cx, z: c1.z + TILE / 2 + 0.15, sx: w * TILE + 0.4, sz: 0.3 },
    { x: c0.x - TILE / 2 - 0.15, z: cz, sx: 0.3, sz: h * TILE + 0.4 },
    { x: c1.x + TILE / 2 + 0.15, z: cz, sx: 0.3, sz: h * TILE + 0.4 },
  ];
  for (const wl of walls) {
    const m = new Mesh(new BoxGeometry(wl.sx, 0.9, wl.sz), wallMat);
    m.position.set(wl.x, 0.45, wl.z);
    m.castShadow = m.receiveShadow = true;
    world.add(m);
  }
  // kitchen counter along row 0
  const counter = new Mesh(new BoxGeometry(w * TILE * 0.9, 0.45, 0.5), mat(theme.wood, detailed ? { map: woodTexture() } : {}));
  counter.position.set(cx, 0.22, c0.z);
  counter.castShadow = counter.receiveShadow = true;
  world.add(counter);

  if (detailed) {
    // wooden cap rail along every wall top
    const railMat = mat(new Color(theme.wood).multiplyScalar(0.55), { map: woodTexture(), roughness: 0.6 });
    for (const wl of walls) {
      const rail = new Mesh(new BoxGeometry(wl.sx + 0.04, 0.06, wl.sz + 0.04), railMat);
      rail.position.set(wl.x, 0.93, wl.z);
      rail.castShadow = true;
      world.add(rail);
    }
    // counter top: polished stone slab
    const slab = new Mesh(new BoxGeometry(w * TILE * 0.9 + 0.06, 0.04, 0.56),
      gloss(0x847869, { roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.4 }));
    slab.position.set(cx, 0.465, c0.z);
    slab.castShadow = slab.receiveShadow = true;
    world.add(slab);
    // festoon of warm bulbs strung above the back wall
    const backZ = walls[0]!.z;
    const span = w * TILE + 0.2, n = Math.max(6, Math.round(w * 1.4));
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = cx - span / 2 + t * span;
      const y = 1.35 - Math.sin(t * PI * 3) ** 2 * 0.14;
      pts.push(new Vector3(x, y + 0.04, backZ));
      if (i > 0 && i < n) {
        const bulb = new Mesh(new SphereGeometry(0.06, seg(10), seg(8)), glow(0xffc47a, 1.9));
        bulb.position.set(x, y, backZ);
        bulb.userData.base = 1.9; bulb.userData.phase = i * 1.7;
        bulb.noAO = true;
        world.add(bulb);
        flickers.push(bulb);
      }
    }
    // the cord between the bulbs (the browser build's Line): thin cylinders
    const cordMat = new MeshBasicMaterial({ color: 0x1a120c });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const len = a.distanceTo(b);
      const cord = new Mesh(new CylinderGeometry(0.008, 0.008, len, 4), cordMat);
      cord.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, a.z);
      cord.rotation.z = Math.atan2(b.y - a.y, b.x - a.x) - PI / 2;
      cord.noAO = true;
      world.add(cord);
    }
    // posts holding the festoon at both ends
    for (const p of [pts[0]!, pts[pts.length - 1]!]) {
      const post = new Mesh(new CylinderGeometry(0.03, 0.03, 0.5, seg(8)), mat(0x2a2320, { metalness: 0.6, roughness: 0.4 }));
      post.position.set(p.x, 1.13, p.z);
      world.add(post);
    }
    // street outside: warm pool of light that fades into the backdrop
    const street = new Mesh(new PlaneGeometry(60, 60), mat(0x9a9a9a, { map: streetTexture(), roughness: 1, envMapIntensity: 0.1 }));
    street.rotation.x = -PI / 2;
    street.position.set(cx, -0.085, cz);
    street.receiveShadow = true;
    world.add(street);
  }

  // decorative props (seeded decor stream; never affects rules)
  const props = new InstancedMesh(new CylinderGeometry(0.09, 0.11, 0.5, seg(10)), mat(theme.wood, detailed ? { map: woodTexture() } : {}), 6);
  for (let i = 0; i < 6; i++) {
    const px = c0.x - TILE * (0.9 + decor.next() * 0.6);
    const pz = c0.z + decor.next() * (c1.z - c0.z);
    _m.makeTranslation(px, 0.25, pz);
    props.setMatrixAt(i, _m);
  }
  props.instanceMatrix.needsUpdate = true;
  props.castShadow = true;
  world.add(props);

  // tables (walled-off spots: 35 % opacity behind a construction barrier)
  for (const t of state.tables) {
    ghost = t.open ? 0 : 0.35;
    const v = buildTable(theme, detailed);
    ghost = 0;
    v.position.copy(gridToWorld(t.x, t.y));
    if (!t.open) {
      const bar = new Mesh(new BoxGeometry(0.8, 0.4, 0.8), mat(0x777066, { roughness: 1 }));
      bar.position.y = 0.2; bar.rotation.y = 0.6;
      bar.castShadow = true;
      v.add(bar);
      v.userData.barrier = bar;
    }
    const flame = v.userData.flame as Mesh | undefined;
    if (flame) { flame.userData.base = 3.2; flame.userData.phase = t.id * 2.3; flickers.push(flame); }
    world.add(v);
    tableViews[t.id] = v;
  }
  // stoves
  for (const s of state.stoves) {
    const v = buildStove(theme, look?.particles === "high");
    v.position.copy(gridToWorld(s.x, s.y));
    world.add(v);
    stoveViews[s.id] = v;
  }
  // door marker + queue spots on the right edge
  const doorP = gridToWorld(w - 1, Math.floor(h / 2));
  const door = new Mesh(new BoxGeometry(0.2, 1.1, 1.2), mat(theme.glow, { emissive: theme.glow, emissiveIntensity: 1.1 }));
  door.position.set(doorP.x + TILE / 2 + 0.15, 0.55, doorP.z);
  world.add(door);
  queueSpots = [];
  for (let i = 0; i < 8; i++) queueSpots.push(new Vector3(doorP.x, 0, doorP.z + (i + 0.6) * 0.7));
  // waiters
  for (const wt of state.waiters) {
    const v = buildWaiter(wt.kind === "player" ? 0xe8a54b : 0x7ec8e8, wt.kind === "player");
    v.position.copy(gridToWorld(wt.x, wt.y));
    world.add(v);
    waiterViews[wt.id] = v;
  }
  fitKey = "";
  fitShadow();
  applyEnvMaps();
}

/** No round: the room stays as it was (the menus draw over it). */
export function hasRoom(): boolean { return !!world; }

// --- camera ------------------------------------------------------------------------------
/** The playfield rectangle in normalized device coordinates (−1..1, y up). */
export interface Rect { x0: number; y0: number; x1: number; y1: number }
let fitKey = "";
let camBase = { pos: new Vector3(0, 10, 10), target: new Vector3() };
/** Frames the whole room (plus the door queue and a margin) inside `rect`
 * on both axes: the authored elevation/back ratio is kept, the distance
 * grows until every projected corner is inside, and camera and target slide
 * sideways so the room sits in the rectangle's centre. */
export function frameRoom(rect: Rect, aspect: number): void {
  if (!cfg) return;
  const key = [rect.x0, rect.y0, rect.x1, rect.y1, aspect].map((n) => n.toFixed(4)).join(",") + cfg.id;
  if (key === fitKey) return;
  fitKey = key;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const { w, h } = cfg.grid;
  const c = gridToWorld((w - 1) / 2, (h - 1) / 2);
  const hw = (w / 2) * TILE + 1.2, hd = (h / 2) * TILE + 1.2;
  const pts: Vector3[] = [];
  for (const x of [-hw, hw]) for (const z of [-hd, hd]) for (const y of [0, 1.6]) pts.push(new Vector3(c.x + x, y, c.z + z));
  const dir = new Vector3(0, CAM_ELEV, CAM_BACK).normalize();
  const right = new Vector3(1, 0, 0);
  const up = new Vector3(0, dir.z, -dir.y); // the view's up, perpendicular to its axis
  const rw = (rect.x1 - rect.x0) / 2, rh = (rect.y1 - rect.y0) / 2;
  const mx = (rect.x0 + rect.x1) / 2, my = (rect.y0 + rect.y1) / 2;
  const tanHalf = Math.tan((CAM_FOV * PI) / 180 / 2);
  const margin = 0.9;
  let d = Math.hypot(CAM_ELEV, CAM_BACK) * (Math.max(w, h) / 9);
  let ox = 0, oy = 0;
  const pos = new Vector3(), target = new Vector3();
  for (let i = 0; i < 48; i++) {
    target.copy(c).addScaledVector(right, ox).addScaledVector(up, oy);
    pos.copy(target).addScaledVector(dir, d);
    camera.position.copy(pos);
    camera.lookAt(target);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      _v.copy(p).project(camera);
      minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x); minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y);
    }
    const over = Math.max((maxX - minX) / 2 / (rw * margin), (maxY - minY) / 2 / (rh * margin));
    const ex = mx - (minX + maxX) / 2, ey = my - (minY + maxY) / 2;
    if (over > 1.001) { d *= Math.min(1.6, over + 0.02); continue; }
    if (Math.abs(ex) < 0.002 && Math.abs(ey) < 0.002) break;
    // Sliding camera and target by Δ moves the image by −Δ over half the view's extent there.
    ox -= ex * tanHalf * d * aspect;
    oy -= ey * tanHalf * d;
  }
  camera.far = Math.max(100, d * 4);
  camBase = { pos: camera.position.clone(), target: target.clone() };
}
/** The C key: frame the room again (and stop an impulse). */
export function reframe(): void { fitKey = ""; shakeT = 0; }

// --- picking -------------------------------------------------------------------------------
const _ray = new Raycaster();
export type Pick = { kind: "table"; id: number } | { kind: "stove" } | { kind: "tile"; x: number; y: number };
/** The tile under the ray on the plane y = `height`, or null. */
function tileAt(height: number): { x: number; y: number; fx: number; fy: number } | null {
  const o = _ray.ray.origin, dir = _ray.ray.direction;
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (height - o.y) / dir.y;
  if (t <= 0) return null;
  const fx = (o.x + dir.x * t) / TILE + (cfg!.grid.w - 1) / 2;
  const fy = (o.z + dir.z * t) / TILE + (cfg!.grid.h - 1) / 2;
  return { x: Math.round(fx), y: Math.round(fy), fx, fy };
}
/** What a window pixel points at: a table (its pick cylinder, radius 0.5),
 * a stove (its box), else a floor tile. */
export function pick(x: number, y: number): Pick | null {
  if (!cfg || !lastState) return null;
  _ray.setFromCamera(pointerToNdc(x, y), camera);
  for (const height of [0.6, 0.3]) {
    const hit = tileAt(height);
    if (!hit) continue;
    for (const t of lastState.tables) if (Math.hypot(hit.fx - t.x, hit.fy - t.y) <= 0.5) return { kind: "table", id: t.id };
    for (const s of lastState.stoves) if (Math.abs(hit.fx - s.x) <= 0.45 && Math.abs(hit.fy - s.y) <= 0.4) return { kind: "stove" };
  }
  const floor = tileAt(0);
  if (!floor || floor.x < 0 || floor.y < 0 || floor.x >= cfg.grid.w || floor.y >= cfg.grid.h) return null;
  return { kind: "tile", x: floor.x, y: floor.y };
}

// --- state → scene --------------------------------------------------------------------------
export function setHighlights(list: string[]): void { highlightSet = new Set(list); }
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
/** A small camera impulse on serve and a stronger one on win / lose. */
export function event(kind: string): void {
  if (reducedMotion) return;
  if (kind === "serve") { shakeAmp = 0.03; shakeT = 0.18; }
  else if (kind === "win" || kind === "lose") { shakeAmp = 0.08; shakeT = 0.4; }
}

const cGreen = new Color(0x7fd08a), cAmber = new Color(0xffb35c), cRed = new Color(0xe0574d);
function patienceColor(ratio: number, out: Color): Color {
  if (ratio > 0.5) out.copy(cAmber).lerp(cGreen, (ratio - 0.5) * 2);
  else out.copy(cRed).lerp(cAmber, ratio * 2);
  return out;
}
const tmpColor = new Color();
const _a = new Vector3(), _b = new Vector3();

/** The room as of `state`; waiters between `prev`'s tiles and theirs by `alpha`. */
export function sync(state: State, prev: { id: number; x: number; y: number }[] | null, alpha: number): void {
  if (!world || state.cfg.id !== cfg?.id) return;
  lastState = state;
  const moving = !reducedMotion && !!look?.animated;
  // tables: open state changes + patience rings
  for (const t of state.tables) {
    const v = tableViews[t.id];
    if (!v) continue;
    if (t.open && v.userData.barrier) {
      const bar = v.userData.barrier as Mesh;
      v.remove(bar);
      disposeGroup(bar);
      v.userData.barrier = null;
      v.traverse((o) => { if (o instanceof Mesh && o !== v.userData.ring && o.material.transparent && o.material.opacity < 0.5) { o.material.opacity = 1; o.material.transparent = false; } });
    }
    const ring = v.userData.ring as Mesh;
    const g = t.guestId != null ? state.guests.find((x) => x.id === t.guestId && x.status === "seated") : undefined;
    const lit = highlightSet.has("table:" + t.id);
    if (g) {
      ring.visible = true;
      ring.material.color.copy(patienceColor(Math.max(0, g.patience / g.maxPatience), tmpColor));
      ring.scale.setScalar(lit ? 1.18 : 1);
    } else if (lit) {
      ring.visible = true;
      ring.material.color.setHex(0xffd27a);
      ring.scale.setScalar(1.18);
    } else ring.visible = false;
  }
  // stoves: burner glow + steam while cooking
  for (const s of state.stoves) {
    const v = stoveViews[s.id];
    if (!v) continue;
    const cooking = s.progress > 0;
    em(v.userData.burner as Mesh).emissiveIntensity = cooking ? 2.2 + (moving ? 0.35 * Math.sin(time * 9 + s.id) : 0) : 0.15;
    const puffs = v.userData.steam as Mesh[];
    puffs.forEach((steam, i) => {
      steam.visible = cooking && !reducedMotion;
      if (!steam.visible) return;
      if (puffs.length === 1) { steam.position.y = 0.75 + 0.12 * Math.sin(state.tick * 0.15 + s.id); return; }
      const ph = (time * 0.45 + (steam.userData.offset as number)) % 1; // rise, swell, fade
      steam.position.set(Math.sin((ph + i) * 5) * 0.06, 0.66 + ph * 0.7, Math.cos((ph + i) * 4) * 0.05);
      steam.scale.setScalar(0.6 + ph * 1.1);
      steam.material.opacity = 0.32 * Math.sin(ph * PI);
    });
  }
  // candle + festoon shimmer (cosmetic)
  for (const f of flickers) {
    const b = f.userData.base as number, ph = f.userData.phase as number;
    em(f).emissiveIntensity = moving ? b * (0.86 + 0.1 * Math.sin(time * 7.3 + ph) + 0.06 * Math.sin(time * 17.1 + ph * 2)) : b;
  }
  // waiters: interpolate between snapshot positions; tray dish pucks
  for (const wt of state.waiters) {
    let v = waiterViews[wt.id];
    let a = alpha;
    if (!v) { // helper hired mid-game
      v = buildWaiter(0x7ec8e8, false);
      world.add(v);
      waiterViews[wt.id] = v;
      a = 1;
    }
    gridToWorld(wt.x, wt.y, _b);
    const pw = prev?.find((x) => x.id === wt.id);
    if (pw && (pw.x !== wt.x || pw.y !== wt.y) && !reducedMotion) {
      gridToWorld(pw.x, pw.y, _a);
      v.position.set(_a.x + (_b.x - _a.x) * a, 0, _a.z + (_b.z - _a.z) * a);
    } else v.position.copy(_b);
    const tray = v.userData.tray as Group;
    while (tray.children.length - 1 < wt.carrying) {
      const puck = new Mesh(new CylinderGeometry(0.1, 0.1, 0.03, seg(16)), gloss(0xf0e6d2, { roughness: 0.3, clearcoat: 0.9 }));
      puck.position.y = 0.02 + 0.035 * (tray.children.length - 1);
      puck.castShadow = true;
      tray.add(puck);
    }
    while (tray.children.length - 1 > wt.carrying) {
      const puck = tray.children[tray.children.length - 1]!;
      tray.remove(puck);
      disposeGroup(puck);
    }
  }
  // guests: seated at tables, queue at the door
  const seen = new Set<number>();
  let qi = 0;
  for (const g of state.guests) {
    seen.add(g.id);
    let v = guestViews.get(g.id);
    if (!v) {
      v = buildGuest([0xc96f4a, 0x6f8fc9, 0x8fc96f, 0xc9c06f, 0xa06fc9][g.id % 5]!);
      v.traverse((o) => { if (o instanceof Mesh) o.castShadow = true; });
      world.add(v);
      guestViews.set(g.id, v);
    }
    if (g.status === "queue" && g.tableId == null) {
      v.position.copy(queueSpots[Math.min(qi++, queueSpots.length - 1)]!);
    } else if (g.tableId != null) {
      const t = state.tables[g.tableId]!;
      gridToWorld(t.x, t.y, _a);
      v.position.set(_a.x + 0.55, 0, _a.z); // sits beside the table
    }
    if (moving) v.position.y += 0.012 * (1 + Math.sin(time * 2.2 + (v.userData.phase as number))); // idle bob
  }
  for (const [id, v] of guestViews) {
    if (!seen.has(id)) { world.remove(v); disposeGroup(v); guestViews.delete(id); }
  }
  // player marker pulse (cosmetic, off under reduced motion)
  const marker = waiterViews[0]?.userData.marker as Mesh | undefined;
  if (marker) marker.scale.setScalar(reducedMotion ? 1 : 1 + 0.08 * Math.sin(time * 4));
}

// --- graphics level -------------------------------------------------------------------------
let envTex: Texture | null = null;
/** three.js's RoomEnvironment prefiltered once (the browser build's PMREM room). */
function buildEnvironment(): void {
  if (envTex) return;
  try {
    envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
  } catch (e) {
    console.warn("environment:", e instanceof Error ? e.message : String(e));
  }
}

/** r160 scaled scene.environment by each material's envMapIntensity; the
 * engine (as three r163+) does that only for a material's own envMap, so
 * every standard material carries the room while reflections are on. */
function applyEnvMaps(): void {
  const env = look?.reflections ? envTex : null;
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material;
    if (m instanceof MeshStandardMaterial && m.envMap !== env) { m.envMap = env; }
  });
}

/** The look for the frame's graphics level; cheap when nothing changed.
 * Rebuilds the room when its detail, particles or budget changed. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  BUD = next.budget;
  if (!built) setup();
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  keyLight.castShadow = shadows;
  if (shadows) keyLight.shadow.mapSize = next.shadows;
  if (next.reflections) {
    buildEnvironment();
    scene.environment = envTex;
    fill.intensity = 0.55;
  } else {
    scene.environment = null;
    fill.intensity = 0.9;
  }
  applyEnvMaps();
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.35, distanceExponent: 1.4, thickness: 1.0, scale: 1.0,
    samples: next.ao === "high" ? 16 : 8,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only the emissive lamps, candles, burners and the door glow bloom.
  // The page's r160 UnrealBloomPass strength squared (minor 29 bloom follows r185).
  renderer.bloom = next.bloom ? { strength: 0.3, radius: 0.3, threshold: 0.92, resolution: next.budget.bloomRes } : null;
  // The browser build's grade ShaderPass after OutputPass: a gentle S-curve
  // (0.22 of c²(3−2c)), saturation 1.1, cool shadows / warm highlights, and
  // the 0.24 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.11, saturation: 1.1,
    shadows: [0.97, 0.98, 1.03], highlights: [1.04, 1.0, 0.95], split: [0.2, 0.8],
    vignette: { amount: 0.24, inner: 0.38, outer: 0.85 },
  } : null;
  renderer.antialias = next.antialias;
  if (world && lastState && theme && builtKey !== lookKey()) build(lastState, theme, lastSeed);
}

// --- per frame ---------------------------------------------------------------------------
export function frame(dtRaw: number): void {
  if (!built || !look) return;
  const dt = Math.min(0.1, Math.max(0, dtRaw));
  time += dt; // flicker and idle bob read `moving`; steam and the marker pulse hide or rest under reduced motion
  if (!world) return;
  camera.position.copy(camBase.pos);
  camera.lookAt(camBase.target);
  if (shakeT > 0) {
    shakeT -= dt;
    const a = shakeAmp * Math.max(0, shakeT);
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.z += (Math.random() - 0.5) * a;
  }
}
