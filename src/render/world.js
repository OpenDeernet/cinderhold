import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { routePos, TILE } from '../sim/map.js';
import { TOWERS } from '../sim/data/towers.js';
import { createRng, hashString } from '../sim/rng.js';
import { THEMES } from './themes.js';
import {
  ENEMY_COLORS, G, TOWER_COLORS, geo, makeEnemy, makeHold, makePortal, makeRangeRing, makeTower, mat,
} from './models.js';
import { FloatText, Lightning, Particles, Rings } from './effects.js';
import { coverageMap } from '../sim/coverage.js';

const AIR_HEIGHT = 1.15;

// Signal colours: "can / healthy" and "cannot / hurt". The colour-blind
// palette swaps green-red for blue-orange, which stays distinct for the
// common forms of colour blindness.
export const PALETTES = {
  standard: { ok: 0x9dffb0, okEmissive: 0x2a8a3a, bad: 0xff8a8a, badEmissive: 0x8a2a2a, hpHigh: 0x5ad04a, hpLow: 0xe0402a },
  colorblind: { ok: 0x7ec8ff, okEmissive: 0x1f5a9a, bad: 0xffb04a, badEmissive: 0x8a5010, hpHigh: 0x3a9cff, hpLow: 0xff9a1a },
};
const QUALITY = {
  low: { shadows: false, shadowSize: 0, pixelRatio: 1, particles: 0.5 },
  medium: { shadows: true, shadowSize: 1024, pixelRatio: 1.25, particles: 0.8 },
  high: { shadows: true, shadowSize: 2048, pixelRatio: 2, particles: 1 },
};

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Owns the WebGL renderer, the camera and every 3D object. A World lives for
// the whole session; load() swaps in the scene for a new Game.
export class World {
  constructor(container, overlay, { quality = 'high' } = {}) {
    this.container = container;
    this.quality = QUALITY[quality] ? quality : 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 16, 13);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 32;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = 1.2;
    this.panKeys = new Set();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.position.set(-8, 16, 6);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.fx = new Particles(2500, true);
    this.smoke = new Particles(1500, false);
    this.lightning = new Lightning();
    this.rings = new Rings();
    this.floats = new FloatText(overlay);
    this.scene.add(this.fx.points, this.smoke.points, this.lightning.group, this.rings.group);

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();

    this.root = null;
    this.game = null;
    this.towers = new Map();
    this.enemies = new Map();
    this.projectiles = new Map();
    this.shake = 0;
    this.time = 0;
    this.ambientTimer = 0;
    this.routeTimer = 0;
    this.routeSparks = [];
    this.dying = [];
    this.fireworks = 0;
    this.meteors = [];

    this.makeCursorObjects();
    this.setQuality(this.quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'high';
    const Q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
    this.renderer.shadowMap.enabled = Q.shadows;
    this.sun.castShadow = Q.shadows;
    if (Q.shadows) {
      this.sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.scene.traverse((o) => {
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => (m.needsUpdate = true));
      }
    });
    this.particleScale = Q.particles;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const scale = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.fx.material.uniforms.scale.value = scale;
    this.smoke.material.uniforms.scale.value = scale;
    // Rotating a phone flips the layout; re-frame so the board still fits.
    const portrait = w < h;
    if (this.map && this.portrait !== undefined && portrait !== this.portrait) this.frameCamera();
    this.portrait = portrait;
  }

  setPalette(name) {
    this.palette = PALETTES[name] || PALETTES.standard;
    const p = this.palette;
    this.ghostMats.ok.color.set(p.ok);
    this.ghostMats.ok.emissive.set(p.okEmissive);
    this.ghostMats.bad.color.set(p.bad);
    this.ghostMats.bad.emissive.set(p.badEmissive);
    this.hpHigh.set(p.hpHigh);
    this.hpLow.set(p.hpLow);
  }

  makeCursorObjects() {
    const hl = new THREE.Mesh(
      geo('tileHl', () => new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    hl.renderOrder = 2;
    hl.visible = false;
    this.hover = hl;
    this.scene.add(hl);

    this.ghostRing = makeRangeRing();
    this.ghostRing.root.visible = false;
    this.scene.add(this.ghostRing.root);
    this.selRing = makeRangeRing();
    this.selRing.root.visible = false;
    this.selRing.ring.material.color.set(0xffe08a);
    this.selRing.fill.material.color.set(0xffe08a);
    this.scene.add(this.selRing.root);
    this.minRing = makeRangeRing();
    this.minRing.root.visible = false;
    this.minRing.ring.material.color.set(0xff6a5a);
    this.minRing.fill.material.opacity = 0;
    this.scene.add(this.minRing.root);

    this.ghostMats = {
      ok: new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
      bad: new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
    };
    this.hpHigh = new THREE.Color();
    this.hpLow = new THREE.Color();
    this.setPalette('standard');
    this.ghost = null;
    this.ghostType = null;
  }

  // ---------------------------------------------------------------- level

  toWorld(x, y) {
    return { x: x - this.map.w / 2, z: y - this.map.h / 2 };
  }

  load(game) {
    this.unload();
    this.game = game;
    this.map = game.map;
    const theme = THEMES[game.level.theme] || THEMES.meadow;
    this.theme = theme;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.levelDisposables = [];

    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
    this.hemi.color.set(theme.hemiSky);
    this.hemi.groundColor.set(theme.hemiGround);
    this.sun.color.set(theme.sun);
    this.sun.intensity = theme.sunIntensity;
    const span = Math.max(this.map.w, this.map.h) * 0.75 + 2;
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 60;
    sc.updateProjectionMatrix();

    this.buildBoard(theme, hashString(game.level.id));
    this.frameCamera();
    this.routeTimer = 0;
    this.routeSparks = [];
    this.fireworks = 0;
    this.meteors = [];
    this.setAim(null);
  }

  unload() {
    if (!this.root) return;
    this.scene.remove(this.root);
    for (const d of this.levelDisposables || []) d.dispose();
    for (const id of [...this.enemies.keys()]) this.removeEnemy(id);
    for (const rec of this.dying) this.disposeEnemyModel(rec);
    this.dying = [];
    this.root = null;
    this.game = null;
    this.towers.clear();
    this.enemies.clear();
    this.projectiles.clear();
    this.fx.clear();
    this.smoke.clear();
    this.lightning.clear();
    this.rings.clear();
    this.floats.clear();
    this.setGhost(null);
    this.setSelected(null);
    this.setShowRanges(false);
    this.setHeatmap(null, null);
    this.hover.visible = false;
  }

  // Places the camera so the whole board fits the viewport, whatever its
  // aspect ratio, looking down at roughly 52 degrees.
  frameCamera() {
    const aspect = this.width / this.height;
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const distW = (this.map.w / 2 + 0.8) / Math.tan(hHalf);
    const distH = ((this.map.h / 2 + 1) / Math.tan(vHalf)) * 1.15;
    const dist = Math.max(12, distW, distH) * 1.04;
    this.controls.maxDistance = Math.max(32, dist * 1.3);
    // On tall screens the HUD covers the bottom, so aim a little below the
    // board centre to lift it up the screen.
    const tz = aspect < 1 ? 0.4 + this.map.h * 0.3 * (1 - aspect) : 0.4;
    this.controls.target.set(0, 0, tz);
    this.camera.position.set(0, dist * 0.79, dist * 0.61 + tz);
    this.controls.update();
  }

  instanced(geometry, material, matrices, colors) {
    const m = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
    if (colors) colors.forEach((c, i) => m.setColorAt(i, c));
    m.castShadow = true;
    m.receiveShadow = true;
    m.instanceMatrix.needsUpdate = true;
    this.root.add(m);
    this.levelDisposables.push(m);
    return m;
  }

  buildBoard(theme, seed) {
    const rng = createRng(seed);
    const { w, h, tiles } = this.map;
    const M = () => new THREE.Matrix4();
    const ground = [];
    const groundCol = [];
    const road = [];
    const roadCol = [];
    const bed = [];
    const water = [];
    const waterSpots = [];
    const trees = [];
    const rocks = [];
    const c1 = new THREE.Color(theme.ground);
    const c2 = new THREE.Color(theme.groundAlt);
    const r1 = new THREE.Color(theme.road);
    const r2 = new THREE.Color(theme.roadEdge);

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const t = tiles[r][c];
        const { x, z } = this.toWorld(c + 0.5, r + 0.5);
        if (t === TILE.ROAD || t === TILE.SPAWN || t === TILE.EXIT) {
          road.push(M().compose(new THREE.Vector3(x, -0.26, z), new THREE.Quaternion(), new THREE.Vector3(1, 0.36, 1)));
          roadCol.push(r1.clone().lerp(r2, rng.next() * 0.35));
        } else if (t === TILE.WATER) {
          bed.push(M().compose(new THREE.Vector3(x, -0.4, z), new THREE.Quaternion(), new THREE.Vector3(1, 0.2, 1)));
          water.push(M().makeTranslation(x, -0.14, z));
          waterSpots.push({ x, z });
        } else {
          ground.push(M().compose(new THREE.Vector3(x, -0.2, z), new THREE.Quaternion(), new THREE.Vector3(1, 0.4, 1)));
          groundCol.push(c1.clone().lerp(c2, (r + c) % 2 ? 0.2 : 0.4 + rng.next() * 0.25).offsetHSL(0, 0, (rng.next() - 0.5) * 0.02));
          if (t === TILE.TREE) trees.push({ x, z, s: 0.8 + rng.next() * 0.4, a: rng.next() * 6.28 });
          if (t === TILE.ROCK) rocks.push({ x, z, s: 0.25 + rng.next() * 0.12, a: rng.next() * 6.28 });
        }
      }
    }

    // Scenery on the skirt around the board.
    const skirtR = 9;
    for (let i = 0; i < 160; i++) {
      const x = (rng.next() - 0.5) * (w + skirtR * 2);
      const z = (rng.next() - 0.5) * (h + skirtR * 2);
      if (Math.abs(x) < w / 2 + 0.8 && Math.abs(z) < h / 2 + 0.8) continue;
      if (rng.next() < 0.7) trees.push({ x, z, y: -0.35, s: 0.8 + rng.next() * 0.7, a: rng.next() * 6.28 });
      else rocks.push({ x, z, y: -0.35, s: 0.2 + rng.next() * 0.35, a: rng.next() * 6.28 });
    }

    const box = G.box();
    this.instanced(box, mat(0xffffff), ground, groundCol);
    if (road.length) this.instanced(box, mat(0xffffff, { roughness: 0.95 }), road, roadCol);
    if (bed.length) this.instanced(box, mat(theme.roadEdge), bed);
    if (water.length) {
      const wg = geo('waterTile', () => new THREE.BoxGeometry(1, 0.06, 1));
      const wm = new THREE.MeshStandardMaterial({
        color: theme.water,
        emissive: theme.waterEmissive,
        emissiveIntensity: 1,
        transparent: true,
        opacity: theme.waterEmissive > 0x200000 ? 0.95 : 0.82,
        roughness: 0.2,
        metalness: 0.1,
      });
      this.levelDisposables.push(wm);
      this.water = this.instanced(wg, wm, water);
      this.water.castShadow = false;
    } else {
      this.water = null;
    }

    this.waterSpots = waterSpots;

    // Board base and the wider skirt it sits on.
    const base = new THREE.Mesh(box, mat(new THREE.Color(theme.skirt).multiplyScalar(0.7).getHex()));
    base.position.set(0, -0.75, 0);
    base.scale.set(w + 0.4, 0.7, h + 0.4);
    base.receiveShadow = true;
    this.root.add(base);
    const skirtGeo = new THREE.PlaneGeometry(w + skirtR * 2 + 30, h + skirtR * 2 + 30).rotateX(-Math.PI / 2);
    const skirt = new THREE.Mesh(skirtGeo, mat(theme.skirt));
    skirt.position.y = -0.36;
    skirt.receiveShadow = true;
    this.root.add(skirt);
    this.levelDisposables.push(skirtGeo);

    this.buildTrees(theme, trees, rng);
    if (rocks.length) {
      const rm = rocks.map((p) => M().compose(
        new THREE.Vector3(p.x, (p.y ?? 0) + p.s * 0.5, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(p.a, p.a * 1.7, 0)),
        new THREE.Vector3(p.s * 1.3, p.s, p.s * 1.1),
      ));
      this.instanced(G.dodec(), mat(theme.rock), rm);
    }

    // Spawn portals and the Hold.
    this.portals = this.map.routes.map((route) => {
      const p = makePortal();
      const a = route.points[1];
      const b = route.points[2] || route.points[1];
      const { x, z } = this.toWorld(a.x, a.y);
      p.root.position.set(x, 0, z);
      p.root.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      this.root.add(p.root);
      this.levelDisposables.push(p.swirl.material);
      return p;
    });
    this.hold = makeHold();
    const ex = this.toWorld(this.map.exit.c + 0.5, this.map.exit.r + 0.5);
    this.hold.root.position.set(ex.x, -0.08, ex.z);
    this.hold.root.scale.setScalar(0.9);
    this.root.add(this.hold.root);
    this.levelDisposables.push(this.hold.fire.material);
    this.holdFlash = 0;
  }

  buildTrees(theme, trees, rng) {
    if (!trees.length) return;
    const parts = [];
    const fol = theme.foliage;
    const P = (g, m, x, y, z, sx, sy, sz, rz = 0) => parts.push({
      g, m, local: new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz),
      ),
    });
    const trunk = mat(theme.trunk);
    switch (theme.tree) {
      case 'pine':
        P(G.cyl(1, 1, 6), trunk, 0, 0.15, 0, 0.07, 0.3, 0.07);
        P(G.cone(7), mat(fol[0]), 0, 0.55, 0, 0.36, 0.6, 0.36);
        P(G.cone(7), mat(fol[1]), 0, 0.9, 0, 0.26, 0.5, 0.26);
        P(G.cone(7), mat(0xf4f8fc), 0, 1.12, 0, 0.13, 0.22, 0.13);
        break;
      case 'cactus':
        P(G.cyl(1, 1, 7), mat(fol[0]), 0, 0.4, 0, 0.12, 0.8, 0.12);
        P(G.cyl(1, 1, 7), mat(fol[1]), 0.17, 0.45, 0, 0.07, 0.3, 0.07);
        P(G.cyl(1, 1, 7), mat(fol[1]), -0.15, 0.55, 0, 0.06, 0.26, 0.06);
        P(G.sphere(6), mat(0xe86a8a), 0, 0.82, 0, 0.06, 0.05, 0.06);
        break;
      case 'willow':
        P(G.cyl(0.8, 1, 6), trunk, 0, 0.3, 0, 0.09, 0.6, 0.09);
        P(G.sphere(8), mat(fol[0]), 0, 0.75, 0, 0.42, 0.3, 0.42);
        P(G.cone(8), mat(fol[1]), 0, 0.42, 0, 0.44, 0.55, 0.44, Math.PI);
        break;
      case 'dead':
        P(G.cyl(0.6, 1, 5), trunk, 0, 0.35, 0, 0.07, 0.7, 0.07);
        P(G.cyl(0.5, 1, 5), trunk, 0.12, 0.6, 0, 0.04, 0.35, 0.04, -0.8);
        P(G.cyl(0.5, 1, 5), trunk, -0.1, 0.5, 0.03, 0.035, 0.3, 0.035, 0.9);
        P(G.sphere(5), mat(0xff5a1a, { emissive: 0xff3a00, emissiveIntensity: 1.5 }), 0, 0.02, 0, 0.12, 0.04, 0.12);
        break;
      default:
        P(G.cyl(0.8, 1, 6), trunk, 0, 0.2, 0, 0.08, 0.4, 0.08);
        P(G.ico(0), mat(fol[0]), 0, 0.6, 0, 0.34, 0.34, 0.34);
        P(G.ico(0), mat(fol[1 % fol.length]), 0.1, 0.82, 0.05, 0.22, 0.22, 0.22);
    }
    const tm = new THREE.Matrix4();
    // Colour variety for round trees: pick a foliage colour per tree.
    for (const part of parts) {
      const mats = trees.map((t) => {
        tm.compose(new THREE.Vector3(t.x, t.y ?? 0, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.a, 0)), new THREE.Vector3(t.s, t.s, t.s));
        return tm.clone().multiply(part.local);
      });
      const isFoliage = part.m !== trunk && theme.tree === 'round';
      const cols = isFoliage ? trees.map(() => new THREE.Color(fol[Math.floor(rng.next() * fol.length)])) : null;
      const m = this.instanced(part.g, isFoliage ? mat(0xffffff) : part.m, mats, cols);
      m.castShadow = true;
    }
  }

  // ---------------------------------------------------------------- picking

  pickTile(clientX, clientY) {
    if (!this.map) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = (this.ndc || (this.ndc = new THREE.Vector2())).set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmp);
    if (!hit) return null;
    const c = Math.floor(hit.x + this.map.w / 2);
    const r = Math.floor(hit.z + this.map.h / 2);
    if (c < 0 || r < 0 || c >= this.map.w || r >= this.map.h) return null;
    return { c, r };
  }

  // Exact ground point under the pointer, in sim coordinates.
  pickPoint(clientX, clientY) {
    if (!this.map) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = (this.ndc || (this.ndc = new THREE.Vector2())).set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmp);
    if (!hit) return null;
    const x = hit.x + this.map.w / 2;
    const y = hit.z + this.map.h / 2;
    if (x < 0 || y < 0 || x > this.map.w || y > this.map.h) return null;
    return { x, y };
  }

  // Target circle for an aimed ability.
  setAim(point, radius) {
    if (!this.aimRing) {
      this.aimRing = makeRangeRing();
      this.aimRing.ring.material.color.set(0xff6a2a);
      this.aimRing.fill.material.color.set(0xff6a2a);
      this.aimRing.fill.material.opacity = 0.18;
      this.scene.add(this.aimRing.root);
    }
    if (!point) {
      this.aimRing.root.visible = false;
      return;
    }
    const { x, z } = this.toWorld(point.x, point.y);
    this.showRing(this.aimRing, x, z, radius);
    this.hover.visible = false;
  }

  setHover(tile, color = 0xffffff) {
    if (!tile) {
      this.hover.visible = false;
      return;
    }
    const { x, z } = this.toWorld(tile.c + 0.5, tile.r + 0.5);
    this.hover.position.set(x, 0.01, z);
    this.hover.material.color.set(color);
    this.hover.visible = true;
  }

  setGhost(type, tile, valid) {
    if (!type || !tile) {
      if (this.ghost) this.ghost.root.visible = false;
      this.ghostRing.root.visible = false;
      if (!this.selected) this.minRing.root.visible = false;
      return;
    }
    if (this.ghostType !== type) {
      if (this.ghost) this.scene.remove(this.ghost.root);
      this.ghost = makeTower(type, 0);
      this.ghost.root.traverse((o) => {
        if (o.isMesh) o.castShadow = false;
      });
      this.ghostType = type;
      this.scene.add(this.ghost.root);
    }
    const m = valid ? this.ghostMats.ok : this.ghostMats.bad;
    this.ghost.root.traverse((o) => {
      if (o.isMesh) o.material = m;
    });
    const { x, z } = this.toWorld(tile.c + 0.5, tile.r + 0.5);
    this.ghost.root.position.set(x, 0, z);
    this.ghost.root.visible = true;
    const s = this.game ? this.game.towerStats(type, 0) : TOWERS[type].tiers[0];
    this.showRing(this.ghostRing, x, z, s.range, valid ? this.palette.ok : this.palette.bad);
    if (s.minRange) this.showRing(this.minRing, x, z, s.minRange);
    else this.minRing.root.visible = false;
  }

  // Range preview for the tower under the cursor.
  setHoverTower(tower) {
    if (!tower || tower === this.selected) {
      if (!this.ghost || !this.ghost.root.visible) this.ghostRing.root.visible = false;
      return;
    }
    const { x, z } = this.toWorld(tower.x, tower.y);
    this.showRing(this.ghostRing, x, z, tower.s.range, 0xffe08a);
  }

  showRing(ring, x, z, radius, color) {
    ring.root.position.set(x, 0.03, z);
    ring.root.scale.set(radius, 1, radius);
    if (color !== undefined) {
      ring.ring.material.color.set(color);
      ring.fill.material.color.set(color);
    }
    ring.root.visible = true;
  }

  // Placement heatmap: while choosing where to build, shade every open tile
  // by how much road the chosen tower would cover from it (H toggles).
  setHeatmap(game, type) {
    const key = type && game ? `${type}|${game.towers.length}` : null;
    if (key === this.heatKey) return;
    this.heatKey = key;
    if (this.heat) {
      this.scene.remove(this.heat);
      this.heat.dispose();
      this.heat = null;
    }
    if (!key) return;
    const { scores } = coverageMap(game, type);
    const { w } = this.map;
    const tiles = [];
    for (let i = 0; i < scores.length; i++) if (scores[i] >= 0) tiles.push(i);
    const mesh = new THREE.InstancedMesh(
      geo('tileHl', () => new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2)),
      this.heatMat || (this.heatMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false })),
      tiles.length,
    );
    const m = new THREE.Matrix4();
    const cold = new THREE.Color(0x1c2f9a);
    const hot = new THREE.Color(0xff4a1a);
    const col = new THREE.Color();
    tiles.forEach((i, k) => {
      const { x, z } = this.toWorld((i % w) + 0.5, Math.floor(i / w) + 0.5);
      m.makeTranslation(x, 0.015, z);
      mesh.setMatrixAt(k, m);
      // Square the score so the best tiles stand out.
      mesh.setColorAt(k, col.copy(cold).lerp(hot, scores[i] * scores[i]));
    });
    mesh.renderOrder = 1;
    this.heat = mesh;
    this.scene.add(mesh);
  }

  // Range rings for every tower at once (R), to spot gaps in coverage.
  setShowRanges(on) {
    this.showRanges = on;
    if (!this.rangePool) this.rangePool = [];
    if (!on) for (const r of this.rangePool) r.root.visible = false;
  }

  updateRanges(game) {
    if (!this.showRanges) return;
    let i = 0;
    for (const t of game.towers) {
      let ring = this.rangePool[i];
      if (!ring) {
        ring = makeRangeRing();
        ring.ring.material.opacity = 0.35;
        ring.fill.material.opacity = 0.04;
        this.scene.add(ring.root);
        this.rangePool.push(ring);
      }
      const { x, z } = this.toWorld(t.x, t.y);
      this.showRing(ring, x, z, t.s.range, TOWER_COLORS[t.type]);
      i++;
    }
    for (; i < this.rangePool.length; i++) this.rangePool[i].root.visible = false;
  }

  setSelected(tower) {
    this.selected = tower || null;
    if (!tower) {
      this.selRing.root.visible = false;
      this.minRing.root.visible = false;
      return;
    }
    const { x, z } = this.toWorld(tower.x, tower.y);
    this.showRing(this.selRing, x, z, tower.s.range);
    if (tower.s.minRange) this.showRing(this.minRing, x, z, tower.s.minRange);
    else this.minRing.root.visible = false;
  }

  // ---------------------------------------------------------------- sync

  addTower(t) {
    const model = makeTower(t.type, t.tier);
    const { x, z } = this.toWorld(t.x, t.y);
    model.root.position.set(x, 0, z);
    model.head.rotation.y = -t.aim;
    model.root.scale.setScalar(0.01);
    this.root.add(model.root);
    this.towers.set(t.id, { model, tier: t.tier, grow: 0, recoil: 0 });
  }

  removeTower(id) {
    const rec = this.towers.get(id);
    if (!rec) return;
    this.root.remove(rec.model.root);
    this.towers.delete(id);
  }

  addEnemy(e) {
    const model = makeEnemy(e.type);
    if (e.boss) model.root.scale.setScalar(e.type === 'colossus' ? 1.0 : 1.4);
    if (e.air) {
      // A soft blob on the ground so fliers read as being in the air.
      const blob = new THREE.Mesh(
        geo('blob', () => new THREE.CircleGeometry(0.32, 20).rotateX(-Math.PI / 2)),
        this.blobMat || (this.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })),
      );
      blob.position.y = -AIR_HEIGHT + 0.03;
      blob.renderOrder = 1;
      model.root.add(blob);
    }
    this.root.add(model.root);
    const bar = this.makeBar(e);
    this.enemies.set(e.id, { model, bar, phase: Math.random() * 6.28, hitFlash: 0 });
  }

  makeBar(e) {
    const group = new THREE.Group();
    const g = geo('bar', () => new THREE.PlaneGeometry(1, 1));
    const width = e.boss ? 1.4 : 0.6;
    const bg = new THREE.Mesh(g, this.barMat || (this.barMat = new THREE.MeshBasicMaterial({ color: 0x1a1210, transparent: true, opacity: 0.75, depthWrite: false })));
    bg.scale.set(width + 0.04, e.maxShield ? 0.16 : 0.1, 1);
    const fg = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x6ee05a, depthWrite: false, transparent: true }));
    fg.scale.set(width, 0.06, 1);
    fg.position.z = 0.001;
    group.add(bg, fg);
    let sh = null;
    if (e.maxShield) {
      sh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x7fd3ff, depthWrite: false, transparent: true }));
      sh.scale.set(width, 0.04, 1);
      sh.position.set(0, 0.06, 0.002);
      group.add(sh);
    }
    group.renderOrder = 4;
    group.visible = false;
    this.scene.add(group);
    return { group, fg, sh, width };
  }

  // Per-enemy materials (warden shields) are not cached and must be freed.
  disposeEnemyModel(rec) {
    rec.model.parts.shield?.material.dispose();
  }

  removeEnemy(id) {
    const rec = this.enemies.get(id);
    if (!rec) return;
    this.root.remove(rec.model.root);
    this.disposeEnemyModel(rec);
    this.scene.remove(rec.bar.group);
    rec.bar.fg.material.dispose();
    if (rec.bar.sh) rec.bar.sh.material.dispose();
    this.enemies.delete(id);
  }

  addProjectile(p) {
    let m;
    const color = TOWER_COLORS[p.type];
    switch (p.type) {
      case 'bolt':
        m = new THREE.Mesh(G.box(), mat(0xbffff6, { emissive: color, emissiveIntensity: 2 }));
        m.scale.set(0.24, 0.05, 0.05);
        break;
      case 'frost':
        m = new THREE.Mesh(G.oct(), mat(0xe8f8ff, { emissive: 0x7fd3ff, emissiveIntensity: 1.5 }));
        m.scale.set(0.12, 0.07, 0.07);
        break;
      case 'mortar':
        m = new THREE.Mesh(G.sphere(8), mat(0x2b2b2e, { emissive: 0x401a00, emissiveIntensity: 1 }));
        m.scale.setScalar(0.13 + p.tier * 0.02);
        break;
      default:
        m = new THREE.Mesh(G.sphere(8), mat(0x2b2523, { emissive: 0x5a2000, emissiveIntensity: 1 }));
        m.scale.setScalar(0.09 + p.tier * 0.015);
    }
    m.castShadow = true;
    this.root.add(m);
    const rec = this.towers.get(p.tower);
    const h0 = rec ? (rec.model.muzzle.y * rec.model.head.scale.y + rec.model.head.position.y) : 0.7;
    const d0 = Math.hypot(p.tx - p.x, p.ty - p.y) || 1;
    let marker = null;
    if (p.arc) {
      // Telegraph where the shell will land.
      marker = new THREE.Mesh(
        geo('shock', () => new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2)),
        this.markerMat || (this.markerMat = new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.5, depthWrite: false })),
      );
      const w = this.toWorld(p.tx, p.ty);
      marker.position.set(w.x, 0.04, w.z);
      marker.scale.set(p.splash, 1, p.splash);
      marker.renderOrder = 2;
      this.root.add(marker);
    }
    this.projectiles.set(p.id, { mesh: m, h0, d0, marker });
  }

  // Reconciles 3D objects with the simulation state. alpha interpolates
  // between the previous and the current tick.
  sync(game, alpha) {
    const seen = new Set();
    for (const t of game.towers) {
      seen.add(t.id);
      let rec = this.towers.get(t.id);
      if (!rec) {
        this.addTower(t);
        rec = this.towers.get(t.id);
      } else if (rec.tier !== t.tier) {
        const keepAim = rec.model.head.rotation.y;
        this.removeTower(t.id);
        this.addTower(t);
        rec = this.towers.get(t.id);
        rec.grow = 0.6;
        rec.model.root.scale.setScalar(0.8);
        rec.model.head.rotation.y = keepAim;
      }
      rec.tower = t;
    }
    for (const id of [...this.towers.keys()]) if (!seen.has(id)) this.removeTower(id);

    seen.clear();
    for (const e of game.enemies) {
      seen.add(e.id);
      let rec = this.enemies.get(e.id);
      if (!rec) {
        this.addEnemy(e);
        rec = this.enemies.get(e.id);
      }
      rec.enemy = e;
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha;
      const w = this.toWorld(x, y);
      const root = rec.model.root;
      // Tunnelling enemies sink below the road; ease in and out of it.
      rec.sink = (rec.sink || 0) + ((e.hidden ? 1 : 0) - (rec.sink || 0)) * 0.2;
      root.position.set(w.x, e.air ? AIR_HEIGHT : -0.55 * rec.sink, w.z);
      root.rotation.y = lerpAngle(root.rotation.y, -e.dir, 0.25);
    }
    for (const id of [...this.enemies.keys()]) if (!seen.has(id)) this.removeEnemy(id);

    seen.clear();
    for (const p of game.projectiles) {
      seen.add(p.id);
      let rec = this.projectiles.get(p.id);
      if (!rec) {
        this.addProjectile(p);
        rec = this.projectiles.get(p.id);
      }
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      const w = this.toWorld(x, y);
      let hgt;
      if (p.arc) {
        const k = Math.min(1, (p.t + alpha * (1 / 30)) / p.flight);
        hgt = rec.h0 * (1 - k) + 0.1 * k + 4 * 2.2 * k * (1 - k);
      } else {
        const rem = Math.hypot(p.tx - x, p.ty - y);
        const k = Math.min(1, rem / rec.d0);
        const end = p.targetAir ? AIR_HEIGHT + 0.1 : 0.4;
        hgt = end + (rec.h0 - end) * k + (p.type === 'cannon' ? Math.sin((1 - k) * Math.PI) * 0.5 : 0);
      }
      rec.mesh.position.set(w.x, hgt, w.z);
      if (p.type === 'bolt' || p.type === 'frost') rec.mesh.rotation.y = -Math.atan2(p.ty - p.y, p.tx - p.x);
      if (rec.marker) {
        const k = Math.min(1, p.t / p.flight);
        const r = p.splash * (1 - 0.6 * k);
        rec.marker.scale.set(r, 1, r);
      }
      if (p.type === 'mortar' && Math.random() < 0.5) {
        this.smoke.emit({ x: w.x, y: hgt, z: w.z, color: 0x5a5550, alpha: 0.5, size: 0.18, endSize: 0.35, life: 0.5 });
      }
    }
    for (const [id, rec] of this.projectiles) {
      if (!seen.has(id)) {
        this.root.remove(rec.mesh);
        if (rec.marker) this.root.remove(rec.marker);
        this.projectiles.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------- events

  handle(ev) {
    switch (ev.type) {
      case 'build': {
        const { x, z } = this.toWorld(ev.tower.x, ev.tower.y);
        this.smoke.burst(x, 0.05, z, 14, { color: 0xb8a990, speed: 1.3, up: 0.4, life: 0.7, size: 0.3, endSize: 0.5, alpha: 0.6, drag: 3 });
        this.rings.spawn(x, 0.04, z, { color: 0xffffff, from: 0.2, to: 0.8, life: 0.35, opacity: 0.6 });
        break;
      }
      case 'upgrade': {
        const { x, z } = this.toWorld(ev.tower.x, ev.tower.y);
        this.fx.burst(x, 0.4, z, 24, { color: [0xffe08a, 0xffc14a, 0xffffff], speed: 1.6, up: 1.4, life: 0.8, size: 0.14, gravity: 1.5 });
        this.rings.spawn(x, 0.05, z, { color: 0xffd36a, from: 0.3, to: 1.2, life: 0.5 });
        break;
      }
      case 'sell': {
        const { x, z } = this.toWorld(ev.tower.x, ev.tower.y);
        this.fx.burst(x, 0.4, z, 16, { color: [0xffd34a, 0xffe9a0], speed: 1.4, up: 1.6, life: 0.7, size: 0.12, gravity: 4 });
        this.smoke.burst(x, 0.1, z, 10, { color: 0xb8a990, speed: 1, up: 0.5, life: 0.6, size: 0.3, endSize: 0.5, alpha: 0.5, drag: 3 });
        this.floats.spawn(x, 0.9, z, `+${ev.value}`, 'gold');
        break;
      }
      case 'fire': {
        const rec = this.towers.get(ev.tower.id);
        if (!rec) break;
        rec.recoil = 1;
        if (ev.tower.type === 'mortar' || ev.tower.type === 'cannon') {
          const m = rec.model;
          const p = m.muzzle.clone().multiply(m.head.scale).applyEuler(m.head.rotation).add(m.head.position).add(m.root.position);
          this.smoke.burst(p.x, p.y, p.z, ev.tower.type === 'mortar' ? 8 : 4, { color: 0x8a837a, speed: 0.8, up: 1, life: 0.6, size: 0.2, endSize: 0.4, alpha: 0.6, drag: 2 });
          this.fx.burst(p.x, p.y, p.z, 4, { color: 0xffb04a, speed: 1.2, up: 0.5, life: 0.15, size: 0.18 });
        }
        break;
      }
      case 'impact':
        this.impact(ev);
        break;
      case 'chain': {
        const pts = ev.points.map((p, i) => {
          const w = this.toWorld(p.x, p.y);
          if (i === 0) {
            const rec = this.towers.get(ev.tower.id);
            const hy = rec ? 0.3 + rec.model.muzzle.y * rec.model.head.scale.y : 1;
            return new THREE.Vector3(w.x, hy, w.z);
          }
          return new THREE.Vector3(w.x, p.air ? AIR_HEIGHT + 0.1 : 0.4, w.z);
        });
        const width = 0.025 + ev.tower.tier * 0.01;
        this.lightning.arc(pts, { color: 0xc9b8ff, width: width * 2.2, life: 0.16, jag: 0.25 });
        this.lightning.arc(pts, { color: 0xffffff, width, life: 0.12, jag: 0.12 });
        for (let i = 1; i < pts.length; i++) {
          this.fx.burst(pts[i].x, pts[i].y, pts[i].z, 4, { color: [0xd9ccff, 0x9a7bff], speed: 1.5, up: 0.5, life: 0.25, size: 0.1 });
        }
        break;
      }
      case 'pulse': {
        const t = ev.tower;
        const { x, z } = this.toWorld(t.x, t.y);
        this.rings.spawn(x, 0.06, z, { color: 0xff7a2a, from: 0.3, to: t.s.range, life: 0.45, opacity: 0.7 });
        for (let i = 0; i < 14 * this.particleScale; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * t.s.range;
          this.fx.emit({
            x: x + Math.cos(a) * r, y: 0.1, z: z + Math.sin(a) * r, vy: 0.8 + Math.random(),
            color: Math.random() < 0.5 ? 0xff7a2a : 0xffc04a, life: 0.5, size: 0.22, endSize: 0.05,
          });
        }
        break;
      }
      case 'death':
        this.death(ev.enemy, ev.bounty);
        break;
      case 'leak': {
        const { x, z } = this.toWorld(this.map.exit.c + 0.5, this.map.exit.r + 0.5);
        this.holdFlash = 1;
        this.shake = Math.max(this.shake, 0.12 + ev.lives * 0.03);
        this.floats.spawn(x, 1.6, z, `-${ev.lives}`, 'hurt');
        this.fx.burst(x, 0.8, z, 12, { color: [0xff4a3a, 0xff9a6a], speed: 1.5, up: 1, life: 0.5, size: 0.15 });
        break;
      }
      case 'heal': {
        const { x, z } = this.toWorld(ev.enemy.x, ev.enemy.y);
        this.rings.spawn(x, 0.08, z, { color: 0x6dff8a, from: 0.2, to: 1.6, life: 0.6, opacity: 0.5 });
        this.fx.burst(x, 0.5, z, 6, { color: 0x8dff9a, speed: 0.6, up: 1.5, life: 0.6, size: 0.12, spread: 0.6 });
        break;
      }
      case 'burrow':
      case 'surface': {
        const { x, z } = this.toWorld(ev.enemy.x, ev.enemy.y);
        this.smoke.burst(x, 0.05, z, 12, { color: [this.theme.road, this.theme.roadEdge], speed: 1.4, up: 1.4, life: 0.6, size: 0.14, gravity: 4, alpha: 0.9 });
        break;
      }
      case 'shieldBreak': {
        const rec = this.enemies.get(ev.enemy.id);
        const { x, z } = this.toWorld(ev.enemy.x, ev.enemy.y);
        this.fx.burst(x, 0.5, z, 14, { color: [0x9fe3ff, 0xffffff], speed: 2.2, up: 0.8, life: 0.4, size: 0.1, gravity: 5 });
        if (rec) rec.model.parts.shield.visible = false;
        break;
      }
      case 'spawn': {
        const route = this.map.routes[ev.enemy.route];
        const a = route.points[1];
        const { x, z } = this.toWorld(a.x, a.y);
        this.fx.burst(x, 0.5, z, 5, { color: [0xff6a2a, 0xffb04a], speed: 0.9, up: 0.6, life: 0.4, size: 0.15, spread: 0.4 });
        break;
      }
      case 'won':
        this.fireworks = 2.5;
        break;
      case 'cast':
        this.castEffect(ev);
        break;
      case 'meteor': {
        const { x, z } = this.toWorld(ev.x, ev.y);
        this.fx.burst(x, 0.3, z, 60, { color: [0xffb04a, 0xff5a1a, 0xffe08a, 0xff3a00], speed: 4.5, up: 1.2, life: 0.8, size: 0.35, drag: 2, gravity: 3, spread: 0.6 });
        this.smoke.burst(x, 0.3, z, 26, { color: 0x4a4038, speed: 2, up: 1.2, life: 1.6, size: 0.6, endSize: 1.3, alpha: 0.6, drag: 1.5, spread: 0.6 });
        this.rings.spawn(x, 0.06, z, { color: 0xff8a3a, from: 0.3, to: ev.radius * 1.15, life: 0.6, opacity: 0.9 });
        this.shake = Math.max(this.shake, 0.35);
        break;
      }
      case 'chest': {
        const h = this.hold.root.position;
        this.fx.burst(h.x, 1.4, h.z, 40, { color: [0xffd34a, 0xffe9a0, 0xf2c14e], speed: 2.4, up: 2.2, life: 1.1, size: 0.16, gravity: 5 });
        this.floats.spawn(h.x, 2, h.z, `+${ev.gold}`, 'gold');
        break;
      }
      case 'wave': {
        for (const p of this.portals) {
          const { x, z } = p.root.position;
          this.rings.spawn(x, 0.1, z, { color: ev.boss ? 0xff3a2a : 0xff8a3a, from: 0.3, to: ev.boss ? 3 : 1.6, life: 0.8 });
        }
        if (ev.boss) this.shake = Math.max(this.shake, 0.25);
        break;
      }
    }
  }

  castEffect(ev) {
    if (ev.ability === 'meteor') {
      // A rock falls from high above onto the marked spot.
      const { x, z } = this.toWorld(ev.x, ev.y);
      const rock = new THREE.Mesh(G.dodec(), mat(0x4b3a33, { emissive: 0xff4a10, emissiveIntensity: 0.9 }));
      rock.scale.setScalar(0.35);
      this.root.add(rock);
      this.meteors.push({ mesh: rock, x, z, t: 0, dur: 0.9 });
      this.rings.spawn(x, 0.05, z, { color: 0xff6a2a, from: 1.6, to: 0.2, life: 0.9, opacity: 0.6 });
    } else if (ev.ability === 'nova') {
      const span = Math.max(this.map.w, this.map.h);
      this.rings.spawn(0, 0.1, 0, { color: 0x9fe3ff, from: 0.5, to: span * 0.8, life: 1.0, opacity: 0.8 });
      for (const rec of this.enemies.values()) {
        const p = rec.model.root.position;
        this.fx.burst(p.x, p.y + 0.4, p.z, 6, { color: [0xe8f8ff, 0x7fd3ff], speed: 1.2, up: 0.8, life: 0.7, size: 0.12, gravity: 1 });
      }
    }
  }

  updateMeteors(dt) {
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      m.mesh.position.set(m.x - 4 * (1 - k), 0.2 + 12 * (1 - k) * (1 - k), m.z - 2 * (1 - k));
      m.mesh.rotation.x += dt * 6;
      this.fx.emit({ x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z, color: k > 0.5 ? 0xffb04a : 0xff6a1a, life: 0.4, size: 0.35, endSize: 0.05 });
      if (k >= 1) {
        this.root.remove(m.mesh);
        this.meteors.splice(i, 1);
      }
    }
  }

  impact(ev) {
    const p = ev.proj;
    const { x, z } = this.toWorld(ev.x, ev.y);
    const y = ev.air ? AIR_HEIGHT : 0.3;
    const pk = this.particleScale;
    switch (p.type) {
      case 'bolt':
        this.fx.burst(x, y, z, Math.ceil(3 * pk), { color: [0xbffff6, 0x2fb5a6], speed: 1.6, up: 0.5, life: 0.2, size: 0.08 });
        break;
      case 'cannon':
        this.fx.burst(x, y, z, Math.ceil(12 * pk), { color: [0xffb04a, 0xff6a1a, 0xffe08a], speed: 2.2, up: 0.8, life: 0.35, size: 0.22, drag: 2 });
        this.smoke.burst(x, y, z, Math.ceil(6 * pk), { color: 0x6a625a, speed: 0.8, up: 0.8, life: 0.8, size: 0.3, endSize: 0.6, alpha: 0.55, drag: 2 });
        this.rings.spawn(x, 0.05, z, { color: 0xffa04a, from: 0.2, to: p.splash, life: 0.3, opacity: 0.6 });
        break;
      case 'frost':
        this.fx.burst(x, y, z, Math.ceil(10 * pk), { color: [0xe8f8ff, 0x7fd3ff, 0xbfeaff], speed: 1.6, up: 0.7, life: 0.45, size: 0.12, gravity: 1, drag: 2 });
        this.rings.spawn(x, ev.air ? y : 0.05, z, { color: 0x9fe3ff, from: 0.2, to: p.splash, life: 0.4, opacity: 0.55 });
        break;
      case 'mortar':
        this.fx.burst(x, 0.2, z, Math.ceil(26 * pk), { color: [0xffb04a, 0xff5a1a, 0xffe08a, 0xff3a00], speed: 3.2, up: 1.1, life: 0.5, size: 0.3, drag: 2.5, gravity: 2 });
        this.smoke.burst(x, 0.2, z, Math.ceil(14 * pk), { color: 0x5a524a, speed: 1.4, up: 1, life: 1.2, size: 0.45, endSize: 1, alpha: 0.55, drag: 2 });
        this.rings.spawn(x, 0.05, z, { color: 0xffa04a, from: 0.3, to: p.splash, life: 0.4, opacity: 0.8 });
        this.shake = Math.max(this.shake, 0.06);
        break;
    }
  }

  death(e, bounty) {
    // Keep the model around briefly so it can sink away.
    const rec = this.enemies.get(e.id);
    if (rec) {
      this.enemies.delete(e.id);
      this.scene.remove(rec.bar.group);
      rec.bar.fg.material.dispose();
      if (rec.bar.sh) rec.bar.sh.material.dispose();
      rec.dying = 0.35;
      rec.baseScale = rec.model.root.scale.x;
      this.dying.push(rec);
    }
    const { x, z } = this.toWorld(e.x, e.y);
    const y = e.air ? AIR_HEIGHT : 0.4;
    const color = ENEMY_COLORS[e.type];
    const pk = this.particleScale;
    if (e.boss) {
      this.fx.burst(x, y + 0.5, z, 80, { color: [0xffb04a, 0xff5a1a, 0xffe08a, 0xffffff], speed: 4, up: 1.4, life: 1.1, size: 0.35, drag: 1.5, gravity: 2, spread: 1 });
      this.smoke.burst(x, y, z, 30, { color: 0x3a3430, speed: 2, up: 1, life: 2, size: 0.6, endSize: 1.4, alpha: 0.6, drag: 1.5, spread: 1 });
      this.rings.spawn(x, 0.06, z, { color: 0xffd36a, from: 0.5, to: 5, life: 0.9 });
      this.shake = 0.5;
    } else {
      this.fx.burst(x, y, z, Math.ceil(8 * pk), { color: [color, 0xff8a2a, 0xffc04a], speed: 1.8, up: 1, life: 0.45, size: 0.14, gravity: 3 });
      this.smoke.burst(x, y, z, Math.ceil(4 * pk), { color: 0x4a4440, speed: 0.6, up: 1, life: 0.7, size: 0.25, endSize: 0.5, alpha: 0.5, drag: 2 });
    }
    if (bounty) this.floats.spawn(x, y + 0.6, z, `+${bounty}`, 'gold');
  }

  // ---------------------------------------------------------------- frame

  update(dt, game) {
    this.time += dt;
    const t = this.time;
    this.updatePan(dt);
    this.controls.update();
    this.clampTarget();

    if (this.root && game) {
      for (const rec of this.towers.values()) this.animateTower(rec, dt, t);
      for (const rec of this.enemies.values()) this.animateEnemy(rec, dt, t);
      this.animateDying(dt);
      // Portals flare while they are still spawning.
      const active = game.spawners.length > 0;
      for (const p of this.portals) {
        p.swirl.rotation.x = t * (active ? 5 : 2);
        const m = p.swirl.material;
        const target = active ? 2.6 + Math.sin(t * 9) * 0.4 : 1.1;
        m.emissiveIntensity += (target - m.emissiveIntensity) * Math.min(1, dt * 4);
      }
      if (this.hold) {
        this.hold.flag.rotation.y = Math.sin(t * 3) * 0.3;
        this.hold.fire.scale.y = 0.22 + Math.sin(t * 17) * 0.03;
        this.holdFlash = Math.max(0, this.holdFlash - dt * 2);
        this.hold.fire.material.emissive.setRGB(1, 0.42 - this.holdFlash * 0.4, 0);
        // A battered Hold smokes, more heavily the closer it is to falling.
        const hurt = 1 - game.lives / game.maxLives;
        if (hurt > 0.5 && Math.random() < dt * 14 * (hurt - 0.4)) {
          const p = this.hold.root.position;
          this.smoke.emit({
            x: p.x + (Math.random() - 0.5) * 0.5, y: 1.1, z: p.z + (Math.random() - 0.5) * 0.5,
            vx: 0.15, vy: 0.7, color: 0x3a3430, alpha: 0.6, life: 2.2, size: 0.35, endSize: 0.9, drag: 0.5,
          });
        }
      }
      if (this.water) {
        this.water.position.y = Math.sin(t * 1.3) * 0.015;
        if (this.theme.waterEmissive > 0x200000) this.water.material.emissiveIntensity = 0.8 + Math.sin(t * 2) * 0.25;
      }
      if (this.selected) {
        if (!game.towers.includes(this.selected)) this.setSelected(null);
        else this.setSelected(this.selected);
      }
      this.updateRanges(game);
      this.updateFireworks(dt);
      this.updateMeteors(dt);
      this.ambient(dt);
      this.routePreview(dt, game);
      this.shakeBoard(dt);
    }

    this.fx.update(dt);
    this.smoke.update(dt);
    this.lightning.update(dt);
    this.rings.update(dt);
    this.floats.update(dt, this.camera, this.width, this.height);
  }

  animateTower(rec, dt, t) {
    const { model, tower } = rec;
    if (rec.grow < 1) {
      rec.grow = Math.min(1, rec.grow + dt * 4);
      const k = rec.grow;
      model.root.scale.setScalar(Math.max(0.01, 1 + Math.sin(k * Math.PI) * 0.15 - (1 - k) * 0.6));
    }
    if (!tower) return;
    const kind = TOWERS[tower.type].kind;
    if (kind === 'projectile' || kind === 'mortar') {
      model.head.rotation.y = lerpAngle(model.head.rotation.y, -tower.aim, Math.min(1, dt * 12));
    }
    if (rec.recoil > 0) {
      rec.recoil = Math.max(0, rec.recoil - dt * 6);
      const k = rec.recoil * 0.06;
      model.head.position.x = -Math.cos(-model.head.rotation.y) * k;
      model.head.position.z = Math.sin(-model.head.rotation.y) * k;
    }
    const a = model.anim;
    if (a.cloth) {
      a.cloth.rotation.y = Math.sin(t * 2.2 + tower.id) * 0.35;
      a.cloth.rotation.z = Math.sin(t * 3.1 + tower.id) * 0.05;
      // A slow golden ring shows the banner's reach.
      rec.auraTimer = (rec.auraTimer ?? Math.random() * 2.5) - dt;
      if (rec.auraTimer <= 0) {
        rec.auraTimer = 2.5;
        const p = model.root.position;
        this.rings.spawn(p.x, 0.05, p.z, { color: 0xffc35a, from: 0.3, to: tower.s.range, life: 1.2, opacity: 0.35 });
      }
    }
    if (a.spin) a.spin.rotation.y += dt * 1.5;
    if (a.bob) a.bob.position.y = 0.55 + Math.sin(t * 2 + tower.id) * 0.04;
    if (a.pulse) {
      const s = 0.11 + tower.tier * 0.02;
      a.pulse.scale.setScalar(s * (1 + Math.sin(t * 6 + tower.id) * 0.12 + rec.recoil * 0.5));
    }
    if (a.flame) {
      a.flame.scale.y = 0.42 + Math.sin(t * 13 + tower.id) * 0.05 + rec.recoil * 0.2;
      a.core.scale.y = 0.26 + Math.sin(t * 19 + tower.id) * 0.04;
      if (Math.random() < dt * 6) {
        const p = model.root.position;
        this.fx.emit({ x: p.x + (Math.random() - 0.5) * 0.15, y: 0.95, z: p.z + (Math.random() - 0.5) * 0.15, vy: 0.8, color: 0xffa040, life: 0.5, size: 0.1, endSize: 0.02 });
      }
    }
  }

  animateEnemy(rec, dt, t) {
    const { model, enemy: e, bar } = rec;
    if (!e) return;
    const body = model.body;

    // Squash briefly whenever health or shield drops.
    const total = e.hp + e.shield;
    if (rec.lastTotal !== undefined && total < rec.lastTotal - 0.5) rec.hitFlash = 1;
    rec.lastTotal = total;
    if (rec.hitFlash > 0) {
      rec.hitFlash = Math.max(0, rec.hitFlash - dt * 8);
      const k = rec.hitFlash * 0.18;
      body.scale.set(1 + k, 1 - k, 1 + k);
    } else if (body.scale.x !== 1) {
      body.scale.set(1, 1, 1);
    }
    const ph = rec.phase;
    const slow = e.slowMul < 1;
    const speed = e.speed * e.slowMul;
    switch (e.type) {
      case 'wisp':
      case 'stormwing':
        body.position.y = Math.sin(t * 2.5 + ph) * 0.1;
        break;
      case 'swarm':
        body.position.y = Math.abs(Math.sin(t * 12 + ph)) * 0.12;
        body.rotation.y += dt * 4;
        break;
      default:
        body.position.y = Math.abs(Math.sin(t * speed * 7 + ph)) * 0.06;
        body.rotation.z = Math.sin(t * speed * 7 + ph) * 0.06;
    }
    const p = model.parts;
    if (p.wingL) {
      const f = Math.sin(t * 6 + ph) * 0.6;
      p.wingL.rotation.x = f;
      p.wingR.rotation.x = -f;
    }
    if (p.armL) {
      p.armL.rotation.z = Math.sin(t * 2 + ph) * 0.3;
      p.armR.rotation.z = -Math.sin(t * 2 + ph) * 0.3;
    }
    if (p.orb) p.orb.position.y = 1.0 + Math.sin(t * 3 + ph) * 0.06;
    if (p.shield) {
      p.shield.visible = e.shield > 0;
      p.shield.material.opacity = 0.12 + 0.25 * (e.shield / (e.maxShield || 1));
      p.shield.rotation.y += dt;
    }

    if (slow && Math.random() < dt * 5) {
      const r = model.root.position;
      this.fx.emit({ x: r.x + (Math.random() - 0.5) * 0.3, y: r.y + 0.3, z: r.z + (Math.random() - 0.5) * 0.3, vy: -0.2, color: 0xbfeaff, life: 0.5, size: 0.08 });
    }
    if (e.burnTime > 0 && Math.random() < dt * 8) {
      const r = model.root.position;
      this.fx.emit({ x: r.x + (Math.random() - 0.5) * 0.25, y: r.y + 0.4, z: r.z + (Math.random() - 0.5) * 0.25, vy: 0.9, color: 0xff7a2a, life: 0.4, size: 0.14, endSize: 0.03 });
    }

    // Health bar: only once damaged, always facing the camera.
    const damaged = (e.hp < e.maxHp || (e.maxShield && e.shield < e.maxShield) || e.boss) && !e.hidden;
    bar.group.visible = !!damaged;
    if (p.drill) p.drill.rotation.x += dt * 14;
    if (e.hidden && Math.random() < dt * 10) {
      const r = model.root.position;
      this.smoke.emit({ x: r.x + (Math.random() - 0.5) * 0.3, y: 0.02, z: r.z + (Math.random() - 0.5) * 0.3, vy: 0.4, color: this.theme.road, alpha: 0.8, life: 0.6, size: 0.14, endSize: 0.05 });
    }
    if (damaged) {
      const r = model.root.position;
      bar.group.position.set(r.x, r.y + model.height * model.root.scale.y + 0.15, r.z);
      bar.group.quaternion.copy(this.camera.quaternion);
      const f = Math.max(0, e.hp / e.maxHp);
      bar.fg.scale.x = Math.max(0.001, bar.width * f);
      bar.fg.position.x = -(bar.width * (1 - f)) / 2;
      bar.fg.material.color.copy(this.hpLow).lerp(this.hpHigh, f);
      if (bar.sh) {
        const s = e.maxShield ? e.shield / e.maxShield : 0;
        bar.sh.visible = s > 0;
        bar.sh.scale.x = Math.max(0.001, bar.width * s);
        bar.sh.position.x = -(bar.width * (1 - s)) / 2;
      }
    }
  }

  // Victory: bursts of gold and ember sparks over the Hold.
  updateFireworks(dt) {
    if (!(this.fireworks > 0)) return;
    this.fireworks -= dt;
    if (Math.random() > dt * 5) return;
    const h = this.hold.root.position;
    const x = h.x + (Math.random() - 0.5) * 4;
    const z = h.z + (Math.random() - 0.5) * 4;
    const y = 2.5 + Math.random() * 1.5;
    const color = [0xffd34a, 0xff8a3a, 0xfff1c0, 0x9fe3ff][Math.floor(Math.random() * 4)];
    this.fx.burst(x, y, z, 40, { color: [color, 0xffffff], speed: 2.6, up: 0.3, life: 1.1, size: 0.16, gravity: 2.5, drag: 1.2 });
  }

  animateDying(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const rec = this.dying[i];
      rec.dying -= dt;
      const root = rec.model.root;
      if (rec.dying <= 0) {
        this.root.remove(root);
        this.disposeEnemyModel(rec);
        this.dying.splice(i, 1);
        continue;
      }
      const k = rec.dying / 0.35;
      root.scale.setScalar(rec.baseScale * k);
      root.position.y -= dt * (rec.enemy.air ? 2.5 : 0.8);
      root.rotation.z += dt * 4;
    }
  }

  ambient(dt) {
    // Lava pools spit the odd glowing ember.
    if (this.theme.waterEmissive > 0x200000 && this.waterSpots.length && Math.random() < dt * 3 * this.particleScale) {
      const w = this.waterSpots[Math.floor(Math.random() * this.waterSpots.length)];
      this.fx.burst(w.x + (Math.random() - 0.5) * 0.7, -0.05, w.z + (Math.random() - 0.5) * 0.7, 3, {
        color: [0xffb04a, 0xff6a1a], speed: 0.5, up: 3, life: 0.7, size: 0.12, gravity: 3, spread: 0.1,
      });
    }
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 0.05 / this.particleScale;
    const { w, h } = this.map;
    const x = (Math.random() - 0.5) * (w + 6);
    const z = (Math.random() - 0.5) * (h + 6);
    switch (this.theme.ambient) {
      case 'snow':
        this.smoke.emit({ x, y: 6, z, vx: 0.2, vy: -0.8, color: 0xffffff, alpha: 0.9, life: 8, size: 0.08, endSize: 0.08 });
        break;
      case 'embers':
        this.fx.emit({ x, y: 0, z, vx: (Math.random() - 0.5) * 0.3, vy: 0.5 + Math.random() * 0.5, color: Math.random() < 0.5 ? 0xff6a1a : 0xffa040, life: 4, size: 0.07, endSize: 0.02 });
        break;
      case 'fireflies':
        if (Math.random() < 0.3) this.fx.emit({ x, y: 0.3 + Math.random() * 1.2, z, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.1, vz: (Math.random() - 0.5) * 0.3, color: 0xd8ff7a, life: 3, size: 0.07, endSize: 0.07 });
        break;
      case 'leaves':
        if (Math.random() < 0.4) this.smoke.emit({ x, y: 4, z, vx: 0.4, vy: -0.5, color: Math.random() < 0.5 ? 0xd2642a : 0xe0a03a, alpha: 0.95, life: 8, size: 0.09, endSize: 0.09 });
        break;
      case 'dust':
        if (Math.random() < 0.3) this.smoke.emit({ x, y: 0.2 + Math.random() * 0.6, z, vx: 0.8, color: 0xe8cf9a, alpha: 0.35, life: 4, size: 0.3, endSize: 0.5 });
        break;
    }
  }

  // Between waves, sparks run down each road to show where enemies will go.
  routePreview(dt, game) {
    const building = game.status === 'ready' || game.countdown !== null;
    if (building) {
      this.routeTimer -= dt;
      if (this.routeTimer <= 0) {
        this.routeTimer = 1.4;
        this.map.routes.forEach((route, i) => this.routeSparks.push({ route: i, d: 0, emit: 0 }));
      }
    }
    for (let i = this.routeSparks.length - 1; i >= 0; i--) {
      const s = this.routeSparks[i];
      const route = this.map.routes[s.route];
      s.d += dt * 5;
      if (s.d >= route.length) {
        this.routeSparks.splice(i, 1);
        continue;
      }
      s.emit -= dt;
      if (s.emit > 0) continue;
      s.emit = 0.035;
      const p = routePos(route, s.d);
      const { x, z } = this.toWorld(p.x, p.y);
      this.fx.emit({ x, y: 0.08, z, color: 0xffb070, alpha: 0.9, life: 0.5, size: 0.14, endSize: 0.02 });
    }
  }

  shakeBoard(dt) {
    if (this.reduceMotion) this.shake = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.2);
      const s = this.shake * 0.3;
      this.root.position.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5, (Math.random() - 0.5) * s);
    } else {
      this.root.position.set(0, 0, 0);
    }
  }

  setPanKey(key, down) {
    if (down) this.panKeys.add(key);
    else this.panKeys.delete(key);
  }

  updatePan(dt) {
    if (!this.panKeys.size) return;
    const fwd = this.panFwd || (this.panFwd = new THREE.Vector3());
    const right = this.panRight || (this.panRight = new THREE.Vector3());
    const move = this.panMove || (this.panMove = new THREE.Vector3());
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, this.camera.up);
    move.set(0, 0, 0);
    if (this.panKeys.has('up')) move.add(fwd);
    if (this.panKeys.has('down')) move.sub(fwd);
    if (this.panKeys.has('right')) move.add(right);
    if (this.panKeys.has('left')) move.sub(right);
    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(dt * 10);
    this.camera.position.add(move);
    this.controls.target.add(move);
  }

  // Gamepad camera: yaw around the target and move in or out.
  orbit(yaw, zoom) {
    const t = this.controls.target;
    const off = this.tmp.subVectors(this.camera.position, t);
    const r = Math.hypot(off.x, off.z);
    const a = Math.atan2(off.z, off.x) + yaw;
    off.x = Math.cos(a) * r;
    off.z = Math.sin(a) * r;
    const len = off.length();
    const next = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, len + zoom));
    off.multiplyScalar(next / len);
    this.camera.position.copy(t).add(off);
    this.camera.lookAt(t);
  }

  // Turns a screen-space step (right, down) into a grid step, so pushing up
  // always moves the cursor away from the camera.
  screenToGrid(dx, dy) {
    if (!dx && !dy) return [0, 0];
    const fwd = this.camera.getWorldDirection(this.tmp2);
    const fx = fwd.x;
    const fz = fwd.z;
    // Snap the camera's forward direction to the nearest grid axis.
    const [ax, az] = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
    // Screen up is forward; screen right is forward rotated a quarter turn.
    return [Math.round(dx * -az + -dy * ax), Math.round(dx * ax + -dy * az)];
  }

  clampTarget() {
    if (!this.map) return;
    const t = this.controls.target;
    const lx = this.map.w / 2 + 1;
    const lz = this.map.h / 2 + 1;
    const cx = Math.max(-lx, Math.min(lx, t.x));
    const cz = Math.max(-lz, Math.min(lz, t.z));
    if (cx !== t.x || cz !== t.z || t.y !== 0) {
      const dx = cx - t.x;
      const dz = cz - t.z;
      const dy = -t.y;
      t.set(cx, 0, cz);
      this.camera.position.x += dx;
      this.camera.position.y += dy;
      this.camera.position.z += dz;
    }
  }

  // Projects a sim position to screen pixels (for anchoring UI panels).
  screenPos(x, y, height = 0) {
    const w = this.toWorld(x, y);
    this.tmp2.set(w.x, height, w.z).project(this.camera);
    return { x: (this.tmp2.x * 0.5 + 0.5) * this.width, y: (-this.tmp2.y * 0.5 + 0.5) * this.height, visible: this.tmp2.z < 1 };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  // Renders a frame and returns it as a PNG data URL. Read straight after
  // rendering, so the drawing buffer does not need to be preserved.
  capture() {
    const showHover = this.hover.visible;
    this.hover.visible = false;
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.hover.visible = showHover;
    return url;
  }
}

