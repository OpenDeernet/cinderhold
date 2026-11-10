import * as THREE from 'three';

// Passing weather, purely visual: rain showers over meadows and the fen (the
// fen gets lightning and thunder too), sandstorms in the desert. Weather comes
// and goes on its own timer and never touches the simulation.

const KINDS = {
  meadow: ['rain'],
  autumn: ['rain'],
  swamp: ['storm', 'rain'],
  desert: ['sand'],
};

const RAIN_DROPS = 900;
const AREA = 30;

export class Weather {
  constructor(world) {
    this.world = world;
    this.kind = null;
    this.active = 0;
    this.strength = 0;
    this.timer = 20 + Math.random() * 20;
    this.flash = 0;

    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(RAIN_DROPS * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xbcd8ff, transparent: true, opacity: 0, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    for (let i = 0; i < RAIN_DROPS; i++) this.respawn(i, Math.random() * 8);
    world.scene.add(this.rain);
  }

  load(theme) {
    this.choices = KINDS[theme] || [];
    this.kind = null;
    this.active = 0;
    this.strength = 0;
    this.timer = 15 + Math.random() * 25;
    this.baseFog = this.world.scene.fog ? this.world.scene.fog.density : 0;
    this.rain.visible = false;
  }

  respawn(i, y = 8 + Math.random() * 2) {
    const x = (Math.random() - 0.5) * AREA;
    const z = (Math.random() - 0.5) * AREA;
    this.pos.set([x, y, z, x + 0.06, y + 0.45, z + 0.03], i * 6);
  }

  update(dt, onThunder) {
    if (!this.choices || !this.choices.length) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.active > 0) {
        this.active = 0;
        this.timer = 40 + Math.random() * 50;
      } else {
        this.kind = this.choices[Math.floor(Math.random() * this.choices.length)];
        this.active = 1;
        this.timer = 25 + Math.random() * 25;
      }
    }
    // Fade weather in and out over a few seconds.
    this.strength += ((this.active ? 1 : 0) - this.strength) * Math.min(1, dt * 0.5);
    const s = this.strength;
    const wet = this.kind === 'rain' || this.kind === 'storm';
    this.rain.visible = wet && s > 0.02;
    this.rain.material.opacity = 0.35 * s;
    if (this.rain.visible) this.fall(dt, s);

    const fog = this.world.scene.fog;
    if (fog) fog.density = this.baseFog * (1 + (this.kind === 'sand' ? 1.6 : wet ? 0.5 : 0) * s);
    if (this.kind === 'sand' && s > 0.1 && Math.random() < dt * 40 * s) {
      const x = (Math.random() - 0.5) * AREA;
      const z = (Math.random() - 0.5) * AREA;
      this.world.smoke.emit({ x, y: 0.2 + Math.random(), z, vx: 3, vz: 0.6, color: 0xe2c48a, alpha: 0.35 * s, life: 3, size: 0.6, endSize: 1.2 });
    }

    if (this.kind === 'storm' && s > 0.6 && Math.random() < dt * 0.12) {
      this.flash = 1;
      onThunder?.();
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3);
      this.world.hemi.intensity = 1.2 + this.flash * 2.5;
    } else if (this.world.hemi.intensity !== 1.2) {
      this.world.hemi.intensity = 1.2;
    }
  }

  fall(dt, s) {
    const n = Math.floor(RAIN_DROPS * s);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const o = i * 6;
      if (i >= n) {
        this.pos[o + 1] = this.pos[o + 4] = -50;
        continue;
      }
      const dy = dt * 14;
      this.pos[o + 1] -= dy;
      this.pos[o + 4] -= dy;
      this.pos[o] += dt * 0.8;
      this.pos[o + 3] += dt * 0.8;
      if (this.pos[o + 1] < -0.2) this.respawn(i);
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }
}
