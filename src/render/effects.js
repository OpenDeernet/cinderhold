import * as THREE from 'three';
import { geo } from './models.js';

// ------------------------------------------------------------------ particles

const VERT = /* glsl */ `
  attribute float size;
  attribute vec4 tint;
  varying vec4 vTint;
  uniform float scale;
  void main() {
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vTint;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vTint.rgb, vTint.a * a);
  }
`;

// A fixed-size pool of point sprites. Particles live in plain arrays and are
// copied into the GPU buffers every frame.
export class Particles {
  constructor(max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.startSize = new Float32Array(max);
    this.endSize = new Float32Array(max);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('tint', this.aCol);
    g.setAttribute('size', this.aSize);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { scale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.color = new THREE.Color();
  }

  emit({ x, y, z, vx = 0, vy = 0, vz = 0, color = 0xffffff, alpha = 1, life = 0.6, size = 0.2, endSize, gravity = 0, drag = 0 }) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.color.set(color);
    this.col.set([this.color.r, this.color.g, this.color.b, alpha], i * 4);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.startSize[i] = size;
    this.endSize[i] = endSize ?? size * 0.3;
    this.size[i] = size;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  burst(x, y, z, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = opts.up ?? 1;
      const sp = (opts.speed ?? 2) * (0.4 + Math.random() * 0.8);
      this.emit({
        ...opts,
        x: x + (Math.random() - 0.5) * (opts.spread ?? 0.1),
        y,
        z: z + (Math.random() - 0.5) * (opts.spread ?? 0.1),
        vx: Math.cos(a) * sp,
        vy: up * (0.5 + Math.random()) * sp * 0.8,
        vz: Math.sin(a) * sp,
        life: (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6),
        size: (opts.size ?? 0.2) * (0.7 + Math.random() * 0.6),
        color: Array.isArray(opts.color) ? opts.color[Math.floor(Math.random() * opts.color.length)] : opts.color,
      });
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const k = 1 - this.life[i] / this.maxLife[i];
      const d = 1 - Math.min(1, this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * k;
      const fade = this.life[i] / this.maxLife[i];
      this.col[i * 4 + 3] = Math.min(this.col[i * 4 + 3], fade * 1.5);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.count);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  // Swap-remove: move the last particle into slot i.
  kill(i) {
    const j = --this.count;
    if (i === j) return;
    for (let a = 0; a < 3; a++) {
      this.pos[i * 3 + a] = this.pos[j * 3 + a];
      this.vel[i * 3 + a] = this.vel[j * 3 + a];
    }
    for (let a = 0; a < 4; a++) this.col[i * 4 + a] = this.col[j * 4 + a];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.size[i] = this.size[j];
    this.startSize[i] = this.startSize[j];
    this.endSize[i] = this.endSize[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
  }

  clear() {
    this.count = 0;
  }
}

// ------------------------------------------------------------------ bolts of lightning

const UP = new THREE.Vector3(0, 1, 0);

export class Lightning {
  constructor(max = 160) {
    this.group = new THREE.Group();
    this.pool = [];
    this.live = [];
    const g = geo('beam', () => new THREE.CylinderGeometry(1, 1, 1, 4, 1, true).translate(0, 0.5, 0));
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xd9ccff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
      this.pool.push(m);
    }
    this.dir = new THREE.Vector3();
  }

  // Draws a jagged arc through the given world-space points.
  arc(points, { color = 0xc9b8ff, width = 0.035, life = 0.18, jag = 0.18 } = {}) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const steps = 4;
      let prev = a.clone();
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const next = a.clone().lerp(b, t);
        if (s < steps) {
          next.x += (Math.random() - 0.5) * jag;
          next.y += (Math.random() - 0.5) * jag;
          next.z += (Math.random() - 0.5) * jag;
        }
        this.segment(prev, next, color, width, life);
        prev = next;
      }
    }
  }

  segment(a, b, color, width, life) {
    const m = this.pool.pop();
    if (!m) return;
    this.dir.subVectors(b, a);
    const len = this.dir.length();
    if (len < 1e-4) {
      this.pool.push(m);
      return;
    }
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, this.dir.normalize());
    m.scale.set(width, len, width);
    m.material.color.set(color);
    m.material.opacity = 1;
    m.visible = true;
    m.userData.life = life;
    m.userData.maxLife = life;
    this.live.push(m);
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      m.userData.life -= dt;
      if (m.userData.life <= 0) {
        m.visible = false;
        this.live.splice(i, 1);
        this.pool.push(m);
      } else {
        m.material.opacity = m.userData.life / m.userData.maxLife;
      }
    }
  }

  clear() {
    for (const m of this.live) {
      m.visible = false;
      this.pool.push(m);
    }
    this.live.length = 0;
  }
}

// ------------------------------------------------------------------ expanding rings

export class Rings {
  constructor(max = 48) {
    this.group = new THREE.Group();
    this.pool = [];
    this.live = [];
    const g = geo('shock', () => new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2));
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.pool.push(m);
    }
  }

  spawn(x, y, z, { color = 0xffffff, from = 0.1, to = 1, life = 0.4, opacity = 0.8 } = {}) {
    const m = this.pool.pop();
    if (!m) return;
    m.position.set(x, y, z);
    m.material.color.set(color);
    m.userData = { life, maxLife: life, from, to, opacity };
    m.visible = true;
    this.live.push(m);
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const m = this.live[i];
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) {
        m.visible = false;
        this.live.splice(i, 1);
        this.pool.push(m);
        continue;
      }
      const k = 1 - u.life / u.maxLife;
      const s = u.from + (u.to - u.from) * (1 - (1 - k) * (1 - k));
      m.scale.set(s, 1, s);
      m.material.opacity = u.opacity * (1 - k);
    }
  }

  clear() {
    for (const m of this.live) {
      m.visible = false;
      this.pool.push(m);
    }
    this.live.length = 0;
  }
}

// ------------------------------------------------------------------ floating text

// Small DOM labels ("+5", "-2") that rise from a world position and fade.
export class FloatText {
  constructor(container, max = 40) {
    this.container = container;
    this.max = max;
    this.items = [];
    this.v = new THREE.Vector3();
  }

  spawn(x, y, z, text, cls) {
    if (this.items.length >= this.max) {
      const old = this.items.shift();
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = `float-text ${cls || ''}`;
    el.textContent = text;
    this.container.appendChild(el);
    this.items.push({ el, x, y, z, life: 1.1, maxLife: 1.1 });
  }

  update(dt, camera, width, height) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        it.el.remove();
        this.items.splice(i, 1);
        continue;
      }
      const k = 1 - it.life / it.maxLife;
      this.v.set(it.x, it.y + k * 0.8, it.z).project(camera);
      if (this.v.z > 1) {
        it.el.style.opacity = '0';
        continue;
      }
      const sx = (this.v.x * 0.5 + 0.5) * width;
      const sy = (-this.v.y * 0.5 + 0.5) * height;
      it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
      it.el.style.opacity = String(Math.min(1, it.life * 2));
    }
  }

  clear() {
    for (const it of this.items) it.el.remove();
    this.items.length = 0;
  }
}
