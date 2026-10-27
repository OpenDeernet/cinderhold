import * as THREE from 'three';

// Procedural low-poly models built from primitives. Geometries and materials
// are cached and shared; models are cheap Groups of Meshes.

const geoCache = new Map();
const matCache = new Map();

export function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(key)) {
    matCache.set(
      key,
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...opts }),
    );
  }
  return matCache.get(key);
}

function mesh(g, m, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx, sy, sz, shadow = true } = {}) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.scale.set(sx ?? s, sy ?? s, sz ?? s);
  o.castShadow = shadow;
  o.receiveShadow = shadow;
  return o;
}

const G = {
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (top = 1, bottom = 1, seg = 8) => geo(`cyl${top}|${bottom}|${seg}`, () => new THREE.CylinderGeometry(top, bottom, 1, seg)),
  sphere: (seg = 10) => geo(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, seg - 2))),
  ico: (detail = 0) => geo(`ico${detail}`, () => new THREE.IcosahedronGeometry(1, detail)),
  oct: () => geo('oct', () => new THREE.OctahedronGeometry(1, 0)),
  cone: (seg = 8) => geo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)),
  torus: (tube = 0.15, seg = 16) => geo(`tor${tube}|${seg}`, () => new THREE.TorusGeometry(1, tube, 6, seg)),
  capsule: () => geo('capsule', () => new THREE.CapsuleGeometry(0.5, 0.6, 3, 8)),
  dodec: () => geo('dodec', () => new THREE.DodecahedronGeometry(1, 0)),
};
export { G };

const STONE = 0x8e8a83;
const STONE_DARK = 0x6c6862;
const IRON = 0x45474d;
const BRASS = 0xc59a3c;
const GOLD = 0xf2c14e;

export const TOWER_COLORS = {
  bolt: 0x2fb5a6,
  cannon: 0xd9692b,
  frost: 0x7fd3ff,
  tesla: 0x9a7bff,
  mortar: 0x8a8f66,
  ember: 0xff7a2a,
};

// ------------------------------------------------------------------ towers

// Returns { root, head, muzzle, parts } where head is the part that yaws to
// aim and muzzle is the local point projectiles leave from.
export function makeTower(type, tier) {
  const root = new THREE.Group();
  const accent = TOWER_COLORS[type];
  const s = 1 + tier * 0.08;

  // Shared plinth: wider at higher tiers, with trims marking the tier.
  root.add(mesh(G.cyl(0.42, 0.46, 8), mat(STONE_DARK), { y: 0.06, sy: 0.12 }));
  root.add(mesh(G.cyl(0.36, 0.4, 8), mat(STONE), { y: 0.2, sy: 0.18 }));
  if (tier >= 1) root.add(mesh(G.cyl(0.41, 0.41, 8), mat(BRASS, { metalness: 0.6, roughness: 0.4 }), { y: 0.13, sy: 0.04 }));
  if (tier >= 2) {
    root.add(mesh(G.cyl(0.38, 0.38, 8), mat(GOLD, { metalness: 0.7, roughness: 0.3 }), { y: 0.3, sy: 0.04 }));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      root.add(mesh(G.oct(), mat(accent, { emissive: accent, emissiveIntensity: 0.8 }), {
        x: Math.cos(a) * 0.4, z: Math.sin(a) * 0.4, y: 0.22, s: 0.06,
      }));
    }
  }

  const head = new THREE.Group();
  head.position.y = 0.3;
  head.scale.setScalar(s);
  root.add(head);
  const muzzle = new THREE.Vector3(0, 0.35, 0);
  const anim = {};

  switch (type) {
    case 'bolt': {
      head.add(mesh(G.cyl(0.2, 0.26, 6), mat(IRON), { y: 0.1, sy: 0.2 }));
      head.add(mesh(G.box(), mat(accent), { y: 0.3, sx: 0.36, sy: 0.2, sz: 0.3 }));
      const barrels = tier + 1;
      for (let i = 0; i < barrels; i++) {
        const off = (i - (barrels - 1) / 2) * 0.1;
        head.add(mesh(G.cyl(0.035, 0.035, 6), mat(IRON, { metalness: 0.5 }), { x: 0.32, y: 0.32, z: off, rz: Math.PI / 2, sy: 0.4 }));
      }
      head.add(mesh(G.sphere(8), mat(accent, { emissive: accent, emissiveIntensity: 1.2 }), { x: -0.12, y: 0.42, s: 0.06 }));
      muzzle.set(0.5, 0.32, 0);
      break;
    }
    case 'cannon': {
      head.add(mesh(G.cyl(0.24, 0.28, 8), mat(IRON), { y: 0.1, sy: 0.2 }));
      head.add(mesh(G.sphere(10), mat(accent), { y: 0.32, s: 0.22 }));
      head.add(mesh(G.cyl(0.1, 0.13, 8), mat(IRON, { metalness: 0.4 }), { x: 0.25, y: 0.36, rz: Math.PI / 2 - 0.25, sy: 0.4 }));
      head.add(mesh(G.torus(0.25, 10), mat(BRASS, { metalness: 0.6 }), { x: 0.43, y: 0.41, ry: Math.PI / 2, rx: 0.25, s: 0.1 }));
      muzzle.set(0.45, 0.42, 0);
      break;
    }
    case 'frost': {
      head.add(mesh(G.cyl(0.12, 0.2, 6), mat(0xc9e7f5), { y: 0.15, sy: 0.3 }));
      const crystal = mesh(G.oct(), mat(accent, { emissive: 0x3aa6e0, emissiveIntensity: 0.9, transparent: true, opacity: 0.9 }), {
        y: 0.55, sx: 0.16, sy: 0.3, sz: 0.16,
      });
      head.add(crystal);
      anim.spin = crystal;
      anim.bob = crystal;
      for (let i = 0; i < 3 + tier; i++) {
        const a = (i / (3 + tier)) * Math.PI * 2;
        head.add(mesh(G.oct(), mat(0xdff4ff, { emissive: 0x7fd3ff, emissiveIntensity: 0.4 }), {
          x: Math.cos(a) * 0.22, z: Math.sin(a) * 0.22, y: 0.3, sx: 0.05, sy: 0.14, sz: 0.05, rz: Math.cos(a) * 0.4, rx: Math.sin(a) * 0.4,
        }));
      }
      muzzle.set(0, 0.55, 0);
      break;
    }
    case 'tesla': {
      head.add(mesh(G.cyl(0.08, 0.14, 8), mat(IRON), { y: 0.3, sy: 0.6 }));
      for (let i = 0; i < 3; i++) {
        head.add(mesh(G.torus(0.22, 14), mat(BRASS, { metalness: 0.7, roughness: 0.35 }), {
          y: 0.18 + i * 0.16, rx: Math.PI / 2, s: 0.16 - i * 0.025,
        }));
      }
      const orb = mesh(G.sphere(12), mat(accent, { emissive: accent, emissiveIntensity: 1.6 }), { y: 0.7, s: 0.11 + tier * 0.02 });
      head.add(orb);
      anim.pulse = orb;
      muzzle.set(0, 0.7, 0);
      break;
    }
    case 'mortar': {
      head.add(mesh(G.cyl(0.3, 0.32, 8), mat(IRON), { y: 0.08, sy: 0.16 }));
      head.add(mesh(G.cyl(0.17, 0.2, 8), mat(accent), { x: 0.05, y: 0.32, rz: -0.55, sy: 0.4 }));
      head.add(mesh(G.torus(0.3, 10), mat(IRON), { x: 0.16, y: 0.5, rz: -0.55, rx: Math.PI / 2, s: 0.17 }));
      head.add(mesh(G.box(), mat(STONE_DARK), { x: -0.18, y: 0.18, sx: 0.14, sy: 0.18, sz: 0.36 }));
      muzzle.set(0.18, 0.55, 0);
      break;
    }
    case 'ember': {
      head.add(mesh(G.cyl(0.08, 0.14, 6), mat(IRON), { y: 0.12, sy: 0.24 }));
      head.add(mesh(G.cyl(0.32, 0.18, 10), mat(IRON, { metalness: 0.5, roughness: 0.5 }), { y: 0.32, sy: 0.18 }));
      head.add(mesh(G.cyl(0.28, 0.28, 10), mat(0x2a1a12), { y: 0.41, sy: 0.02 }));
      const flame = mesh(G.cone(7), mat(accent, { emissive: 0xff5a00, emissiveIntensity: 2.2, transparent: true, opacity: 0.92 }), {
        y: 0.62, sx: 0.22, sy: 0.42, sz: 0.22, shadow: false,
      });
      const core = mesh(G.cone(7), mat(0xffe08a, { emissive: 0xffc040, emissiveIntensity: 2.5 }), {
        y: 0.56, sx: 0.11, sy: 0.26, sz: 0.11, shadow: false,
      });
      head.add(flame, core);
      anim.flame = flame;
      anim.core = core;
      muzzle.set(0, 0.6, 0);
      break;
    }
  }
  return { root, head, muzzle, anim };
}

// ------------------------------------------------------------------ enemies

export const ENEMY_COLORS = {
  grunt: 0x6a605a,
  runner: 0xa0583c,
  swarm: 0xff8a2a,
  brute: 0x4b4542,
  wisp: 0x9aa0b0,
  mender: 0x5b7a52,
  warden: 0x6f87a0,
  splitter: 0x7a5a48,
  colossus: 0x3a302c,
  stormwing: 0x34405e,
};

const EYE = () => mat(0xffb347, { emissive: 0xff8a00, emissiveIntensity: 2 });
const LAVA = () => mat(0xff6a1a, { emissive: 0xff4a00, emissiveIntensity: 1.6 });

// Returns { root, body, height, parts } where body bobs and root is placed
// and yawed by the world. height is where the health bar floats.
export function makeEnemy(type) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const color = ENEMY_COLORS[type];
  const parts = {};
  let height = 0.9;

  const eyes = (y, z, spread, size = 0.05) => {
    body.add(mesh(G.sphere(6), EYE(), { x: z, y, z: -spread, s: size, shadow: false }));
    body.add(mesh(G.sphere(6), EYE(), { x: z, y, z: spread, s: size, shadow: false }));
  };

  switch (type) {
    case 'grunt':
      body.add(mesh(G.capsule(), mat(color), { y: 0.4, sx: 0.42, sy: 0.42, sz: 0.42 }));
      body.add(mesh(G.cone(6), LAVA(), { y: 0.72, s: 0.08, sy: 0.12 }));
      eyes(0.5, 0.18, 0.08);
      break;
    case 'runner':
      body.add(mesh(G.capsule(), mat(color), { y: 0.33, rz: -0.5, sx: 0.3, sy: 0.36, sz: 0.3 }));
      body.add(mesh(G.cone(5), mat(0x5a2f22), { x: -0.2, y: 0.4, rz: 1.9, s: 0.08, sy: 0.3 }));
      eyes(0.42, 0.18, 0.06, 0.04);
      height = 0.7;
      break;
    case 'swarm':
      body.add(mesh(G.ico(0), mat(color, { emissive: 0xff5a00, emissiveIntensity: 1.4 }), { y: 0.25, s: 0.13, shadow: false }));
      body.add(mesh(G.ico(0), mat(0x3a2a22), { y: 0.25, s: 0.1, ry: 0.6 }));
      height = 0.5;
      break;
    case 'brute':
      body.add(mesh(G.box(), mat(color), { y: 0.42, sx: 0.62, sy: 0.6, sz: 0.66 }));
      body.add(mesh(G.box(), mat(0x2f2b29), { y: 0.78, x: 0.05, sx: 0.5, sy: 0.16, sz: 0.56 }));
      body.add(mesh(G.box(), LAVA(), { y: 0.42, x: 0.32, sx: 0.02, sy: 0.08, sz: 0.4 }));
      body.add(mesh(G.box(), mat(0x2f2b29), { x: 0.1, y: 0.35, z: 0.42, sx: 0.22, sy: 0.4, sz: 0.18 }));
      body.add(mesh(G.box(), mat(0x2f2b29), { x: 0.1, y: 0.35, z: -0.42, sx: 0.22, sy: 0.4, sz: 0.18 }));
      eyes(0.6, 0.34, 0.12, 0.05);
      height = 1.1;
      break;
    case 'wisp': {
      const smoke = mat(color, { transparent: true, opacity: 0.75 });
      body.add(mesh(G.ico(1), smoke, { y: 0, s: 0.24, shadow: false }));
      body.add(mesh(G.ico(1), smoke, { x: -0.16, y: -0.05, s: 0.16, shadow: false }));
      body.add(mesh(G.ico(1), smoke, { x: -0.3, y: -0.08, s: 0.1, shadow: false }));
      eyes(0.04, 0.2, 0.08, 0.045);
      root.userData.air = true;
      height = 0.45;
      break;
    }
    case 'mender':
      body.add(mesh(G.cone(7), mat(color), { y: 0.36, s: 0.3, sy: 0.72 }));
      body.add(mesh(G.sphere(8), mat(0x3d5236), { y: 0.72, s: 0.14 }));
      parts.orb = mesh(G.sphere(10), mat(0x8dff9a, { emissive: 0x3dff5a, emissiveIntensity: 1.8 }), { y: 1.0, s: 0.09, shadow: false });
      body.add(parts.orb);
      eyes(0.74, 0.12, 0.05, 0.035);
      height = 1.2;
      break;
    case 'warden':
      body.add(mesh(G.capsule(), mat(color), { y: 0.42, sx: 0.44, sy: 0.46, sz: 0.44 }));
      body.add(mesh(G.box(), mat(0xbfd6ea, { metalness: 0.3 }), { x: 0.24, y: 0.45, sx: 0.06, sy: 0.4, sz: 0.34 }));
      eyes(0.55, 0.2, 0.08);
      parts.shield = mesh(G.ico(1), new THREE.MeshStandardMaterial({
        color: 0x9fe3ff, emissive: 0x2f8fd0, emissiveIntensity: 0.6, transparent: true, opacity: 0.28, depthWrite: false, flatShading: true,
      }), { y: 0.45, s: 0.55, shadow: false });
      body.add(parts.shield);
      height = 1.15;
      break;
    case 'splitter':
      body.add(mesh(G.dodec(), mat(color), { y: 0.32, s: 0.26 }));
      body.add(mesh(G.dodec(), mat(0x5e4436), { x: -0.12, y: 0.52, z: 0.1, s: 0.17 }));
      body.add(mesh(G.dodec(), mat(0x5e4436), { x: -0.08, y: 0.48, z: -0.14, s: 0.15 }));
      body.add(mesh(G.box(), LAVA(), { x: 0.2, y: 0.35, sx: 0.02, sy: 0.24, sz: 0.04, rx: 0.4 }));
      eyes(0.4, 0.24, 0.07);
      break;
    case 'colossus':
      body.add(mesh(G.box(), mat(color), { y: 0.9, sx: 1.0, sy: 1.1, sz: 1.2 }));
      body.add(mesh(G.box(), mat(0x2a2220), { y: 1.55, x: 0.1, sx: 0.6, sy: 0.4, sz: 0.6 }));
      body.add(mesh(G.box(), LAVA(), { y: 0.95, x: 0.51, sx: 0.02, sy: 0.7, sz: 0.12 }));
      body.add(mesh(G.box(), LAVA(), { y: 1.0, x: 0.51, z: 0.3, sx: 0.02, sy: 0.12, sz: 0.4 }));
      body.add(mesh(G.box(), mat(0x2a2220), { y: 0.25, z: 0.3, sx: 0.4, sy: 0.5, sz: 0.36 }));
      body.add(mesh(G.box(), mat(0x2a2220), { y: 0.25, z: -0.3, sx: 0.4, sy: 0.5, sz: 0.36 }));
      parts.armL = mesh(G.box(), mat(color), { y: 0.9, z: 0.78, sx: 0.36, sy: 1.0, sz: 0.34 });
      parts.armR = mesh(G.box(), mat(color), { y: 0.9, z: -0.78, sx: 0.36, sy: 1.0, sz: 0.34 });
      body.add(parts.armL, parts.armR);
      body.add(mesh(G.sphere(8), EYE(), { x: 0.42, y: 1.6, z: 0.14, s: 0.08, shadow: false }));
      body.add(mesh(G.sphere(8), EYE(), { x: 0.42, y: 1.6, z: -0.14, s: 0.08, shadow: false }));
      height = 2.2;
      break;
    case 'stormwing': {
      body.add(mesh(G.ico(1), mat(color), { s: 0.42, sx: 0.7 }));
      body.add(mesh(G.cone(6), mat(color), { x: -0.5, rz: Math.PI / 2, s: 0.18, sy: 0.6 }));
      const wingMat = mat(0x4a5a86, { side: THREE.DoubleSide, emissive: 0x1a2a66, emissiveIntensity: 0.5 });
      const wingGeo = geo('wing', () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.5, 0, 1.4, 0.4, 0, 1.0, 0.4, 0, 0], 3));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        return g;
      });
      parts.wingL = new THREE.Mesh(wingGeo, wingMat);
      parts.wingR = new THREE.Mesh(wingGeo, wingMat);
      parts.wingR.scale.z = -1;
      parts.wingL.castShadow = parts.wingR.castShadow = true;
      body.add(parts.wingL, parts.wingR);
      body.add(mesh(G.sphere(8), mat(0xbfe6ff, { emissive: 0x6fc8ff, emissiveIntensity: 2 }), { x: 0.3, y: 0.08, z: 0.12, s: 0.06, shadow: false }));
      body.add(mesh(G.sphere(8), mat(0xbfe6ff, { emissive: 0x6fc8ff, emissiveIntensity: 2 }), { x: 0.3, y: 0.08, z: -0.12, s: 0.06, shadow: false }));
      root.userData.air = true;
      height = 0.7;
      break;
    }
  }
  return { root, body, height, parts };
}

// ------------------------------------------------------------------ props

export function makeHold() {
  const root = new THREE.Group();
  const wall = mat(0xb9b2a5);
  const dark = mat(0x6e675e);
  root.add(mesh(G.box(), dark, { y: 0.15, sx: 1.1, sy: 0.3, sz: 1.1 }));
  root.add(mesh(G.box(), wall, { y: 0.75, sx: 0.8, sy: 1.0, sz: 0.8 }));
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 0.32 : -0.32;
    const z = i < 2 ? 0.32 : -0.32;
    root.add(mesh(G.box(), wall, { x, z, y: 1.33, sx: 0.18, sy: 0.18, sz: 0.18 }));
  }
  root.add(mesh(G.box(), mat(0x3a2a1e), { x: 0.41, y: 0.5, sx: 0.02, sy: 0.4, sz: 0.3 }));
  root.add(mesh(G.cyl(0.02, 0.02, 5), mat(0x3a2a1e), { y: 1.7, sy: 0.8 }));
  const flag = mesh(G.box(), mat(0xd94a2b, { side: THREE.DoubleSide }), { x: 0.18, y: 1.92, sx: 0.36, sy: 0.22, sz: 0.01 });
  root.add(flag);
  // Own material: the world tints it when the Hold is hit, which must not
  // leak into the shared material cache.
  const fire = mesh(G.cone(6), mat(0xffa040, { emissive: 0xff6a00, emissiveIntensity: 2 }).clone(), { y: 1.38, s: 0.1, sy: 0.22, shadow: false });
  root.add(fire);
  return { root, flag, fire };
}

export function makePortal() {
  const root = new THREE.Group();
  const stone = mat(0x3d3533);
  root.add(mesh(G.box(), stone, { y: 0.55, z: 0.45, sx: 0.2, sy: 1.1, sz: 0.2 }));
  root.add(mesh(G.box(), stone, { y: 0.55, z: -0.45, sx: 0.2, sy: 1.1, sz: 0.2 }));
  root.add(mesh(G.box(), stone, { y: 1.15, sx: 0.24, sy: 0.18, sz: 1.14 }));
  const swirl = mesh(G.cyl(1, 1, 18), new THREE.MeshStandardMaterial({
    color: 0x2a0a00, emissive: 0xff4a10, emissiveIntensity: 1.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  }), { y: 0.55, rz: Math.PI / 2, sx: 0.38, sy: 0.02, sz: 0.5, shadow: false });
  root.add(swirl);
  return { root, swirl };
}

export function makeRangeRing() {
  const g = geo('ring', () => new THREE.RingGeometry(0.97, 1, 64));
  const ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  const fill = new THREE.Mesh(
    geo('disc', () => new THREE.CircleGeometry(1, 64)),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false }),
  );
  fill.rotation.x = -Math.PI / 2;
  const root = new THREE.Group();
  root.add(ring, fill);
  root.renderOrder = 2;
  return { root, ring, fill };
}
