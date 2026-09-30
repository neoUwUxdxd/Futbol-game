// Sonido sintetizado con Web Audio: nada se descarga.

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    // buffer de ruido reutilizable
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    this.startCrowd();
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  startCrowd() {
    const c = this.ctx;
    const src = this.noiseSrc(true);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
    const bp2 = c.createBiquadFilter();
    bp2.type = 'peaking'; bp2.frequency.value = 1800; bp2.gain.value = 4;
    this.crowdGain = c.createGain();
    this.crowdGain.gain.value = 0.12;
    src.connect(bp).connect(bp2).connect(this.crowdGain).connect(this.master);
    src.start();
    // ondulación lenta, como un murmullo
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.23;
    const lg = c.createGain();
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(this.crowdGain.gain);
    lfo.start();
    this.crowdFilter = bp;
  }

  crowd(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.1 + level * 0.3, t, 0.4);
    this.crowdFilter.frequency.setTargetAtTime(650 + level * 500, t, 0.4);
  }

  kick(power = 0.5) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 + power * 60, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5 + power * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
    const n = this.noiseSrc();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.25 + power * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(hp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + 0.06);
  }

  touch() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }

  bounce(strength) {
    if (!this.ctx || strength < 1.2) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(Math.min(0.35, strength * 0.03), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.14);
  }

  post(strength) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const vol = Math.min(0.5, 0.1 + strength * 0.025);
    for (const [f, d] of [[523, 1.4], [1187, 0.9], [1741, 0.6], [2856, 0.4]]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(vol * (600 / f), t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + d);
    }
    this.kick(0.8);
  }

  net(strength) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSrc();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.min(0.4, strength * 0.02), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.4);
  }

  whistle(pattern = [0.25]) {
    if (!this.ctx) return;
    const c = this.ctx;
    let t = c.currentTime + 0.02;
    for (const d of pattern) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 2650;
      const lfo = c.createOscillator();
      lfo.frequency.value = 38;
      const lg = c.createGain();
      lg.gain.value = 120;
      lfo.connect(lg).connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.setValueAtTime(0.16, t + d - 0.04);
      g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(g).connect(this.master);
      o.start(t); lfo.start(t);
      o.stop(t + d + 0.02); lfo.stop(t + d + 0.02);
      t += d + 0.12;
    }
  }

  roar(duration = 4, peak = 0.7) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSrc(true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.35);
    g.gain.setTargetAtTime(peak * 0.6, t + 1.2, 0.8);
    g.gain.setTargetAtTime(0.0001, t + duration, 0.6);
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(1300, t + 0.4);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t); n.stop(t + duration + 3);
  }

  ooh() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSrc(true);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.linearRampToValueAtTime(380, t + 1.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t); n.stop(t + 1.7);
  }
}
