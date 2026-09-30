// Grabación de las últimas jugadas para la repetición a cámara lenta.
// Sólo se guarda la posición del balón y el estado de animación de cada
// jugador: la pose se recalcula exactamente igual al reproducir.

const ACTIONS = ['none', 'kick', 'header', 'slide', 'tackle', 'dive', 'fall', 'catch', 'hold', 'throw', 'celebrate', 'sad'];
const PF = 12; // floats por jugador

export class Recorder {
  constructor(players, seconds = 8) {
    this.players = players;
    this.seconds = seconds;
    this.frames = [];
  }

  clear() { this.frames.length = 0; }

  record(time, ball) {
    const n = this.players.length;
    const arr = new Float32Array(7 + n * PF);
    arr[0] = ball.p.x; arr[1] = ball.p.y; arr[2] = ball.p.z;
    const q = ball.mesh.quaternion;
    arr[3] = q.x; arr[4] = q.y; arr[5] = q.z; arr[6] = q.w;
    for (let i = 0; i < n; i++) {
      const p = this.players[i];
      const a = p.anim;
      const o = 7 + i * PF;
      arr[o] = p.pos.x; arr[o + 1] = p.pos.z; arr[o + 2] = p.heading;
      arr[o + 3] = a.speed; arr[o + 4] = a.phase;
      arr[o + 5] = Math.max(0, ACTIONS.indexOf(a.action || 'none'));
      arr[o + 6] = a.t; arr[o + 7] = a.dur; arr[o + 8] = a.side; arr[o + 9] = a.variant || 0; arr[o + 10] = a.lean || 0;
      arr[o + 11] = p.pos.y;
    }
    this.frames.push({ t: time, d: arr });
    while (this.frames.length && this.frames[0].t < time - this.seconds) this.frames.shift();
  }

  get start() { return this.frames.length ? this.frames[0].t : 0; }
  get end() { return this.frames.length ? this.frames[this.frames.length - 1].t : 0; }

  /** Aplica el instante `time` a los objetos de la escena. */
  apply(time, ball, poseFn) {
    const f = this.frames;
    if (!f.length) return;
    let i = 0;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m].t <= time) lo = m; else hi = m - 1; }
    i = lo;
    const A = f[i], B = f[Math.min(i + 1, f.length - 1)];
    const k = B.t > A.t ? Math.min(1, Math.max(0, (time - A.t) / (B.t - A.t))) : 0;
    const a = A.d, b = B.d;
    const L = (j) => a[j] + (b[j] - a[j]) * k;
    ball.p.set(L(0), L(1), L(2));
    ball.mesh.quaternion.set(L(3), L(4), L(5), L(6)).normalize();
    for (let n = 0; n < this.players.length; n++) {
      const p = this.players[n];
      const o = 7 + n * PF;
      p.pos.set(L(o), L(o + 11), L(o + 1));
      let dh = b[o + 2] - a[o + 2];
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      p.heading = a[o + 2] + dh * k;
      const an = p.anim;
      an.speed = L(o + 3);
      an.phase = Math.abs(b[o + 4] - a[o + 4]) < 3 ? L(o + 4) : a[o + 4];
      const actA = a[o + 5], actB = b[o + 5];
      an.action = ACTIONS[actA];
      an.t = actA === actB ? L(o + 6) : a[o + 6];
      an.dur = a[o + 7]; an.side = a[o + 8]; an.variant = a[o + 9]; an.lean = L(o + 10);
      poseFn(p);
    }
  }
}
