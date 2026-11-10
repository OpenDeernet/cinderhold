// All sound is synthesised at runtime with the Web Audio API: no sample
// files, no network. The context is created on the first user gesture.

const THROTTLE = {
  bolt: 0.045, cannon: 0.06, frost: 0.06, tesla: 0.06, mortar: 0.08, ember: 0.12,
  hit: 0.05, boom: 0.06, bigboom: 0.1, frostHit: 0.07, death: 0.035, coin: 0.05,
  shield: 0.08, heal: 0.2, spawn: 0.12, dig: 0.15,
};

const MAX_VOICES = 28;

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

const MUSIC = {
  meadow: { bpm: 92, root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], lead: 'triangle' },
  autumn: { bpm: 84, root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], lead: 'triangle' },
  desert: { bpm: 96, root: 62, scale: [0, 1, 4, 5, 7, 8, 10], prog: [0, 6, 5, 6], lead: 'sawtooth' },
  snow: { bpm: 76, root: 64, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 3, 4, 1], lead: 'sine' },
  swamp: { bpm: 80, root: 55, scale: [0, 2, 3, 5, 7, 9, 10], prog: [0, 3, 6, 4], lead: 'triangle' },
  volcanic: { bpm: 104, root: 52, scale: [0, 1, 3, 5, 7, 8, 10], prog: [0, 5, 6, 4], lead: 'sawtooth' },
  title: { bpm: 70, root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 3, 4], lead: 'sine' },
};

export class Audio {
  // Takes the Save so settings stay current when a save is imported.
  constructor(save) {
    this.save = save;
    this.ctx = null;
    this.last = {};
    this.voices = 0;
    this.musicTheme = null;
    this.intensity = 0;
    this.step = 0;
    this.nextTime = 0;
  }

  get settings() {
    return this.save.settings;
  }

  // Must be called from a user gesture handler.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const c = this.ctx;
    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 6;
    this.master.connect(this.comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.musicBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);

    // A feedback delay gives the music some space.
    this.delay = c.createDelay(1);
    this.delay.delayTime.value = 0.36;
    this.fb = c.createGain();
    this.fb.gain.value = 0.32;
    const wet = c.createGain();
    wet.gain.value = 0.35;
    this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(wet).connect(this.musicBus);

    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.applyVolumes();
    this.scheduler = setInterval(() => this.schedule(), 30);
    if (this.pendingTheme) this.setMusic(this.pendingTheme);
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music * 0.55, t, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ---------------------------------------------------------------- synth helpers

  tone({ freq, to, dur = 0.1, type = 'sine', vol = 0.2, attack = 0.002, at = 0, bus, filter }) {
    const c = this.ctx;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(g);
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq;
      node = node.connect(f);
    }
    node.connect(bus || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track(o);
  }

  hiss({ dur = 0.2, freq = 1000, to, q = 1, type = 'lowpass', vol = 0.2, attack = 0.002, at = 0, bus }) {
    const c = this.ctx;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus || this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
    this.track(src);
  }

  track(node) {
    this.voices++;
    node.onended = () => this.voices--;
  }

  // ---------------------------------------------------------------- sound effects

  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running' || this.settings.muted) return;
    const now = this.ctx.currentTime;
    const gap = THROTTLE[name];
    if (gap && this.last[name] && now - this.last[name] < gap) return;
    if (this.voices > MAX_VOICES && !opts.force) return;
    this.last[name] = now;
    const j = 1 + (Math.random() - 0.5) * 0.08;
    switch (name) {
      case 'bolt':
        this.tone({ freq: 1100 * j, to: 650, dur: 0.06, type: 'square', vol: 0.05 });
        this.hiss({ dur: 0.04, freq: 5000, type: 'highpass', vol: 0.05 });
        break;
      case 'cannon':
        this.hiss({ dur: 0.22, freq: 900, to: 200, vol: 0.22 });
        this.tone({ freq: 140 * j, to: 50, dur: 0.18, vol: 0.25 });
        break;
      case 'frost':
        this.hiss({ dur: 0.14, freq: 4000, type: 'highpass', vol: 0.06 });
        this.tone({ freq: 1600 * j, to: 2600, dur: 0.1, type: 'triangle', vol: 0.05 });
        break;
      case 'tesla':
        for (let i = 0; i < 3; i++) {
          this.tone({ freq: 250 + Math.random() * 700, to: 120 + Math.random() * 300, dur: 0.06, type: 'sawtooth', vol: 0.05, at: i * 0.025, filter: { freq: 3000 } });
        }
        this.hiss({ dur: 0.14, freq: 2500, type: 'bandpass', q: 3, vol: 0.12 });
        break;
      case 'mortar':
        this.tone({ freq: 95 * j, to: 40, dur: 0.3, vol: 0.32 });
        this.hiss({ dur: 0.25, freq: 500, to: 150, vol: 0.18 });
        break;
      case 'ember':
        this.hiss({ dur: 0.4, freq: 400, to: 1400, type: 'bandpass', q: 1.5, vol: 0.14, attack: 0.08 });
        break;
      case 'hit':
        this.hiss({ dur: 0.03, freq: 3000, type: 'bandpass', vol: 0.05 });
        break;
      case 'boom':
        this.hiss({ dur: 0.3, freq: 1200, to: 150, vol: 0.2 });
        break;
      case 'bigboom':
        this.hiss({ dur: 0.7, freq: 800, to: 80, vol: 0.35 });
        this.tone({ freq: 70, to: 28, dur: 0.6, vol: 0.35 });
        break;
      case 'frostHit':
        this.hiss({ dur: 0.18, freq: 6000, type: 'highpass', vol: 0.05 });
        break;
      case 'death':
        this.tone({ freq: 480 * j, to: 160, dur: 0.1, type: 'triangle', vol: 0.06 });
        break;
      case 'bossDeath':
        this.hiss({ dur: 2.2, freq: 1500, to: 60, vol: 0.4, attack: 0.02 });
        this.tone({ freq: 90, to: 25, dur: 2.0, vol: 0.4, type: 'sawtooth', filter: { freq: 400 } });
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.5, type: 'triangle', vol: 0.12, at: 0.6 + i * 0.12 }));
        break;
      case 'leak':
        this.tone({ freq: 220, to: 110, dur: 0.3, type: 'square', vol: 0.1, filter: { freq: 1500 } });
        this.tone({ freq: 233, to: 116, dur: 0.3, type: 'square', vol: 0.08, at: 0.02, filter: { freq: 1500 } });
        break;
      case 'build':
        this.hiss({ dur: 0.15, freq: 300, vol: 0.25 });
        this.tone({ freq: 220, to: 330, dur: 0.12, type: 'triangle', vol: 0.12 });
        break;
      case 'upgrade':
        [523, 659, 784].forEach((f, i) => this.tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.1, at: i * 0.06 }));
        break;
      case 'coin':
      case 'sell':
        this.tone({ freq: 1320, dur: 0.07, type: 'square', vol: 0.04, filter: { freq: 4000 } });
        this.tone({ freq: 1760, dur: 0.15, type: 'square', vol: 0.04, at: 0.06, filter: { freq: 4000 } });
        break;
      case 'wave':
        this.tone({ freq: 196, dur: 0.7, type: 'sawtooth', vol: 0.09, attack: 0.06, filter: { freq: 1100 } });
        this.tone({ freq: 294, dur: 0.7, type: 'sawtooth', vol: 0.07, attack: 0.06, filter: { freq: 1100 } });
        this.tone({ freq: 392, dur: 0.5, type: 'sawtooth', vol: 0.05, attack: 0.08, at: 0.25, filter: { freq: 1400 } });
        break;
      case 'bossWave':
        this.tone({ freq: 73, dur: 1.6, type: 'sawtooth', vol: 0.16, attack: 0.1, filter: { freq: 600 } });
        this.tone({ freq: 110, dur: 1.6, type: 'sawtooth', vol: 0.12, attack: 0.1, filter: { freq: 600 } });
        this.tone({ freq: 104, dur: 1.2, type: 'sawtooth', vol: 0.1, attack: 0.2, at: 0.4, filter: { freq: 800 } });
        this.hiss({ dur: 1.4, freq: 200, vol: 0.2, attack: 0.3 });
        break;
      case 'shield':
        this.tone({ freq: 2400, to: 700, dur: 0.18, type: 'triangle', vol: 0.07 });
        this.hiss({ dur: 0.15, freq: 7000, type: 'highpass', vol: 0.07 });
        break;
      case 'heal':
        this.tone({ freq: 520, to: 880, dur: 0.25, type: 'sine', vol: 0.05, attack: 0.05 });
        break;
      case 'dig':
        this.hiss({ dur: 0.25, freq: 250, to: 120, type: 'lowpass', vol: 0.12 });
        break;
      case 'tick':
        this.tone({ freq: 1200, dur: 0.05, type: 'triangle', vol: 0.06 });
        break;
      case 'click':
        this.tone({ freq: 760, dur: 0.04, type: 'sine', vol: 0.07, force: true });
        break;
      case 'error':
        this.tone({ freq: 150, dur: 0.14, type: 'square', vol: 0.06, filter: { freq: 900 } });
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.35, type: 'triangle', vol: 0.12, at: i * 0.13 }));
        break;
      case 'lose':
        [392, 349, 311, 262].forEach((f, i) => this.tone({ freq: f, dur: 0.5, type: 'triangle', vol: 0.12, at: i * 0.22 }));
        break;
    }
  }

  // Maps simulation events to sounds.
  handle(ev) {
    switch (ev.type) {
      case 'fire':
        this.play(ev.tower.type);
        break;
      case 'chain':
        this.play('tesla');
        break;
      case 'pulse':
        this.play('ember');
        break;
      case 'impact':
        if (ev.proj.type === 'mortar') this.play('bigboom');
        else if (ev.proj.type === 'cannon') this.play('boom');
        else if (ev.proj.type === 'frost') this.play('frostHit');
        else this.play('hit');
        break;
      case 'death':
        this.play(ev.enemy.boss ? 'bossDeath' : 'death', { force: ev.enemy.boss });
        break;
      case 'leak':
        this.play('leak', { force: true });
        break;
      case 'build':
        this.play('build', { force: true });
        break;
      case 'upgrade':
        this.play('upgrade', { force: true });
        break;
      case 'sell':
        this.play('sell', { force: true });
        break;
      case 'wave':
        this.play(ev.boss ? 'bossWave' : 'wave', { force: true });
        break;
      case 'shieldBreak':
        this.play('shield');
        break;
      case 'heal':
        this.play('heal');
        break;
      case 'burrow':
      case 'surface':
        this.play('dig');
        break;
    }
  }

  // ---------------------------------------------------------------- music

  setMusic(theme) {
    this.pendingTheme = theme;
    if (!this.ctx) return;
    if (this.musicTheme === theme) return;
    const first = !this.musicTheme;
    const t = this.ctx.currentTime;
    const level = this.settings.music * 0.55;
    // Fade the old track out, switch, then fade the new one in.
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(0, t, 0.12);
    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => {
      this.musicTheme = theme;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.05;
      this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55, this.ctx.currentTime, 0.4);
    }, first ? 0 : 450);
    if (first) this.musicBus.gain.setTargetAtTime(level, t, 0.4);
  }

  setIntensity(v) {
    this.intensity = v;
  }

  schedule() {
    if (!this.ctx || !this.musicTheme || this.ctx.state !== 'running') return;
    const m = MUSIC[this.musicTheme] || MUSIC.meadow;
    const stepDur = 60 / m.bpm / 2; // eighth notes
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.05;
    while (this.nextTime < now + 0.15) {
      this.playStep(m, this.step, this.nextTime - now, stepDur);
      this.step++;
      this.nextTime += stepDur;
    }
  }

  degree(m, deg, octave = 0) {
    const n = m.scale.length;
    const o = Math.floor(deg / n);
    const i = ((deg % n) + n) % n;
    return m.root + m.scale[i] + 12 * (o + octave);
  }

  playStep(m, step, at, stepDur) {
    const bar = Math.floor(step / 8) % m.prog.length;
    const beat = step % 8;
    const chord = m.prog[bar];
    const bus = this.musicBus;
    const I = this.intensity;

    if (beat === 0) {
      // Pad: the chord's three tones, swelling over the bar.
      for (const k of [0, 2, 4]) {
        this.tone({ freq: NOTE(this.degree(m, chord + k, -1)), dur: stepDur * 8.5, type: 'sine', vol: 0.035, attack: stepDur * 3, at, bus });
      }
    }
    if (beat % 4 === 0) {
      this.tone({ freq: NOTE(this.degree(m, chord, -2)), dur: stepDur * 3.5, type: 'triangle', vol: 0.08, attack: 0.01, at, bus });
    }
    if (I > 0.3 && beat % 4 === 2) {
      this.tone({ freq: NOTE(this.degree(m, chord + 4, -2)), dur: stepDur * 1.5, type: 'triangle', vol: 0.05, at, bus });
    }

    // Arpeggio, sparser when calm. Deterministic per step so it repeats.
    const h = Math.sin(step * 12.9898 + bar * 78.233) * 43758.5453;
    const r = h - Math.floor(h);
    if (r < 0.25 + I * 0.45) {
      const deg = chord + [0, 2, 4, 7, 4, 2, 5, 9][(step * 3 + bar) % 8];
      const f = NOTE(this.degree(m, deg, 0));
      this.tone({ freq: f, dur: stepDur * 1.6, type: m.lead, vol: m.lead === 'sawtooth' ? 0.022 : 0.04, at, bus, filter: { freq: 2200 } });
      this.tone({ freq: f, dur: stepDur * 1.4, type: m.lead, vol: 0.02, at, bus: this.delay, filter: { freq: 1800 } });
    }

    if (I > 0.5) {
      if (beat === 0 || beat === 4) this.tone({ freq: 110, to: 40, dur: 0.18, type: 'sine', vol: 0.12, at, bus });
      if (beat % 2 === 1) this.hiss({ dur: 0.04, freq: 7000, type: 'highpass', vol: 0.025, at, bus });
      if (I > 0.8 && (beat === 2 || beat === 6)) this.hiss({ dur: 0.12, freq: 1800, type: 'bandpass', vol: 0.05, at, bus });
    }
  }
}
