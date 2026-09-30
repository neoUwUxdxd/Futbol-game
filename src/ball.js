import * as THREE from 'three';
import { PITCH, HALF_L, HALF_W, BALL_R, POST_R } from './config.js';

// ---------------------------------------------------------------------------
// Física del balón
//  - gravedad + arrastre aerodinámico cuadrático
//  - efecto Magnus (la rotación curva la trayectoria: rosca, liftado, topspin)
//  - rebotes con fricción tangencial que convierte velocidad en giro y viceversa
//    (esfera hueca, I = 2/3·m·r²): el efecto "muerde" al tocar el césped
//  - rodadura con resistencia del césped
//  - colisiones con postes, travesaño, redes y vallas publicitarias
// ---------------------------------------------------------------------------

const G = 9.81;
const K_DRAG = 0.0125;       // ½·ρ·Cd·A / m
const K_MAGNUS = 0.0034;     // coeficiente de sustentación por giro
const AIR_SPIN_DECAY = 0.22;
const MU_BOUNCE = 0.5;
const MU_ROLL_SLIP = 3.5;    // fricción de deslizamiento en suelo (m/s²)
const ROLL_DECEL = 0.75;     // resistencia a la rodadura (m/s²)
const ROLL_DRAG = 0.1;       // arrastre del césped proporcional (1/s)
const SHELL = 2.5;           // 1 + m·r²/I para esfera hueca

const GOAL_X = HALF_L;
const GW2 = PITCH.goalW / 2;
const GH = PITCH.goalH;
const GD = PITCH.goalD;
const BOARD_X = HALF_L + 6;
const BOARD_Z = HALF_W + 4.5;

// Segmentos de los postes y travesaños (ambas porterías)
export const FRAME_SEGMENTS = [];
for (const side of [-1, 1]) {
  const x = side * (GOAL_X + POST_R);
  for (const zs of [-1, 1]) {
    FRAME_SEGMENTS.push({ a: new THREE.Vector3(x, 0, zs * (GW2 + POST_R)), b: new THREE.Vector3(x, GH + POST_R * 2, zs * (GW2 + POST_R)), r: POST_R, side });
  }
  FRAME_SEGMENTS.push({ a: new THREE.Vector3(x, GH + POST_R, -(GW2 + POST_R)), b: new THREE.Vector3(x, GH + POST_R, GW2 + POST_R), r: POST_R, side });
}

// Planos de red: eje normal, valor, y límites en los otros dos ejes
export const NET_PLANES = [];
for (const side of [-1, 1]) {
  const x0 = Math.min(side * GOAL_X, side * (GOAL_X + GD));
  const x1 = Math.max(side * GOAL_X, side * (GOAL_X + GD));
  NET_PLANES.push({ side, id: 'back', axis: 'x', value: side * (GOAL_X + GD), b1: ['y', 0, GH], b2: ['z', -GW2, GW2] });
  NET_PLANES.push({ side, id: 'left', axis: 'z', value: -GW2 - POST_R, b1: ['x', x0, x1], b2: ['y', 0, GH] });
  NET_PLANES.push({ side, id: 'right', axis: 'z', value: GW2 + POST_R, b1: ['x', x0, x1], b2: ['y', 0, GH] });
  NET_PLANES.push({ side, id: 'top', axis: 'y', value: GH + POST_R, b1: ['x', x0, x1], b2: ['z', -GW2, GW2] });
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _slip = new THREE.Vector3();
const _rc = new THREE.Vector3(0, -BALL_R, 0);

export function makeState(p, v, w) {
  return {
    p: p ? p.clone() : new THREE.Vector3(0, BALL_R, 0),
    v: v ? v.clone() : new THREE.Vector3(),
    w: w ? w.clone() : new THREE.Vector3(),
    prev: new THREE.Vector3(),
  };
}

/**
 * Integra un paso de física. `ev` (opcional) recibe eventos: bounce, post, net.
 * `full` activa colisiones con la portería y vallas.
 */
export function stepBall(s, dt, full, ev) {
  const { p, v, w } = s;
  s.prev.copy(p);
  const airborne = p.y > BALL_R + 0.005 || v.y > 0.05;
  const speed = v.length();

  // --- fuerzas aerodinámicas ---
  _a.set(0, -G, 0);
  _a.addScaledVector(v, -K_DRAG * speed);
  if (airborne) {
    _b.crossVectors(w, v).multiplyScalar(K_MAGNUS);
    _a.add(_b);
    w.multiplyScalar(Math.exp(-AIR_SPIN_DECAY * dt));
  }
  v.addScaledVector(_a, dt);
  p.addScaledVector(v, dt);

  // --- contacto con el suelo ---
  if (p.y < BALL_R) {
    p.y = BALL_R;
    if (v.y < 0) {
      const vn = -v.y;
      if (vn > 0.7) {
        const e = 0.66 - Math.min(vn, 20) * 0.006;
        v.y = vn * e;
        // impulso de fricción en el punto de contacto
        _slip.crossVectors(w, _rc).add(v); _slip.y = 0;
        const slipLen = _slip.length();
        if (slipLen > 1e-5) {
          const jMax = MU_BOUNCE * vn * (1 + e);
          const j = Math.min(slipLen / SHELL, jMax);
          _c.copy(_slip).multiplyScalar(-j / slipLen);   // Δv por unidad de masa
          v.add(_c);
          _d.crossVectors(_rc, _c).multiplyScalar(1.5 / (BALL_R * BALL_R));
          w.add(_d);
        }
        if (ev) ev.bounce = Math.max(ev.bounce || 0, vn);
      } else {
        v.y = 0;
      }
    }
  }

  // --- rodadura ---
  if (p.y <= BALL_R + 0.002 && Math.abs(v.y) < 0.05) {
    v.y = 0;
    _slip.crossVectors(w, _rc).add(v); _slip.y = 0;
    const slipLen = _slip.length();
    if (slipLen > 1e-4) {
      const j = Math.min(slipLen / SHELL, MU_ROLL_SLIP * dt);
      _c.copy(_slip).multiplyScalar(-j / slipLen);
      v.add(_c);
      _d.crossVectors(_rc, _c).multiplyScalar(1.5 / (BALL_R * BALL_R));
      w.add(_d);
    }
    const hs = Math.hypot(v.x, v.z);
    if (hs > 1e-4) {
      const dec = (ROLL_DECEL + ROLL_DRAG * hs) * dt;
      const k = Math.max(0, hs - dec) / hs;
      v.x *= k; v.z *= k;
      if (hs - dec <= 0.02) { v.x = 0; v.z = 0; }
    }
    // el giro lateral muere rápido sobre el césped
    w.y *= Math.exp(-4 * dt);
    // mantener giro de rodadura coherente
    const wx = v.z / BALL_R, wz = -v.x / BALL_R;
    const kk = 1 - Math.exp(-10 * dt);
    w.x += (wx - w.x) * kk;
    w.z += (wz - w.z) * kk;
  }

  if (!full) return;

  // --- postes y travesaños ---
  if (Math.abs(p.x) > GOAL_X - 1.5 && Math.abs(p.x) < GOAL_X + GD + 1 && Math.abs(p.z) < GW2 + 1 && p.y < GH + 1) {
    for (const seg of FRAME_SEGMENTS) collideSegment(s, seg, ev);
    for (const np of NET_PLANES) collideNet(s, np, ev);
  }

  // --- vallas publicitarias ---
  if (p.y < 1.0) {
    if (Math.abs(p.x) > BOARD_X - BALL_R) {
      p.x = Math.sign(p.x) * (BOARD_X - BALL_R);
      if (v.x * Math.sign(p.x) > 0) { v.x *= -0.35; v.z *= 0.7; if (ev) ev.board = Math.abs(v.x); }
    }
    if (Math.abs(p.z) > BOARD_Z - BALL_R) {
      p.z = Math.sign(p.z) * (BOARD_Z - BALL_R);
      if (v.z * Math.sign(p.z) > 0) { v.z *= -0.35; v.x *= 0.7; if (ev) ev.board = Math.abs(v.z); }
    }
  }
}

function collideSegment(s, seg, ev) {
  const { p, v, w } = s;
  _a.subVectors(seg.b, seg.a);
  const t = THREE.MathUtils.clamp(_b.subVectors(p, seg.a).dot(_a) / _a.lengthSq(), 0, 1);
  _c.copy(seg.a).addScaledVector(_a, t);
  _d.subVectors(p, _c);
  const dist = _d.length();
  const minD = BALL_R + seg.r;
  if (dist < minD && dist > 1e-6) {
    _d.multiplyScalar(1 / dist);
    p.copy(_c).addScaledVector(_d, minD);
    const vn = v.dot(_d);
    if (vn < 0) {
      v.addScaledVector(_d, -vn * 1.7);
      v.multiplyScalar(0.94);
      w.multiplyScalar(0.4);
      if (ev) { ev.post = Math.max(ev.post || 0, -vn); ev.postPoint = _c.clone(); }
    }
  }
}

function collideNet(s, np, ev) {
  const { p, v, w, prev } = s;
  const [a1, lo1, hi1] = np.b1;
  const [a2, lo2, hi2] = np.b2;
  if (p[a1] < lo1 - BALL_R || p[a1] > hi1 + BALL_R) return;
  if (p[a2] < lo2 - BALL_R || p[a2] > hi2 + BALL_R) return;
  const ax = np.axis;
  const d = p[ax] - np.value;
  if (Math.abs(d) >= BALL_R) {
    // detectar cruce en un solo paso
    const dp = prev[ax] - np.value;
    if (Math.sign(dp) === Math.sign(d) || dp === 0) return;
  }
  let side = Math.sign(prev[ax] - np.value);
  if (side === 0) side = -Math.sign(v[ax]) || 1;
  p[ax] = np.value + side * BALL_R;
  const vn = v[ax];
  if (vn * side < 0) {
    v[ax] = -vn * 0.06;
    for (const k of ['x', 'y', 'z']) if (k !== ax) v[k] *= 0.55;
    w.multiplyScalar(0.3);
    if (ev && Math.abs(vn) > 0.5) {
      if (!ev.net || ev.net.strength < Math.abs(vn)) {
        ev.net = { plane: np, point: p.clone(), strength: Math.abs(vn) };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Predicción y resolución de trayectorias.
// El mismo integrador se usa para "apuntar": dado un objetivo, velocidad y
// efecto, se corrige iterativamente la dirección de salida para que el balón,
// con su curva real, pase por el objetivo.
// ---------------------------------------------------------------------------

const SIM_DT = 1 / 120;
const _sim = makeState();

export function predict(p, v, w, duration, stepEvery = 4, out = []) {
  out.length = 0;
  _sim.p.copy(p); _sim.v.copy(v); _sim.w.copy(w);
  const n = Math.ceil(duration / SIM_DT);
  for (let i = 1; i <= n; i++) {
    stepBall(_sim, SIM_DT, false);
    if (i % stepEvery === 0) out.push({ t: i * SIM_DT, x: _sim.p.x, y: _sim.p.y, z: _sim.p.z, s: _sim.v.length() });
  }
  return out;
}

/** Simula hasta recorrer `dist` en la dirección horizontal `dir`. */
function simToDistance(p0, v0, w0, dir, dist, maxT = 5) {
  _sim.p.copy(p0); _sim.v.copy(v0); _sim.w.copy(w0);
  let t = 0;
  let lastAlong = 0;
  const lp = new THREE.Vector3().copy(p0);
  while (t < maxT) {
    lp.copy(_sim.p);
    stepBall(_sim, SIM_DT, false);
    t += SIM_DT;
    const along = (_sim.p.x - p0.x) * dir.x + (_sim.p.z - p0.z) * dir.z;
    if (along >= dist) {
      const f = (dist - lastAlong) / Math.max(1e-6, along - lastAlong);
      return { reached: true, t, point: lp.lerp(_sim.p, f), speed: _sim.v.length() };
    }
    if (_sim.v.lengthSq() < 0.01 && _sim.p.y <= BALL_R + 0.01) break;
    lastAlong = along;
  }
  return { reached: false, t, point: _sim.p.clone(), speed: 0 };
}

/** Velocidad de salida para que el balón pase por `target` a `speed` con el giro `spin`. */
export function solveLaunch(from, target, speed, spin, maxPitch = 1.2) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.max(0.5, Math.hypot(dx, dz));
  const dir = new THREE.Vector3(dx / D, 0, dz / D);
  const lat = new THREE.Vector3(-dir.z, 0, dir.x);
  let yaw = Math.atan2(dz, dx);
  const dy = target.y - from.y;
  const v2 = speed * speed;
  const disc = v2 * v2 - G * (G * D * D + 2 * dy * v2);
  let pitch = disc > 0 ? Math.atan((v2 - Math.sqrt(disc)) / (G * D)) : Math.PI / 4;
  const v0 = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    v0.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)).multiplyScalar(speed);
    const r = simToDistance(from, v0, spin, dir, D, 4);
    const errLat = (r.point.x - target.x) * lat.x + (r.point.z - target.z) * lat.z;
    const errH = r.point.y - target.y;
    yaw -= Math.atan2(errLat, D);
    pitch -= Math.atan2(errH, D) * (r.reached ? 1 : 0.6);
    if (!r.reached) pitch += 0.05;
    pitch = THREE.MathUtils.clamp(pitch, -0.25, maxPitch);
    if (Math.abs(errLat) < 0.03 && Math.abs(errH) < 0.03) break;
  }
  v0.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)).multiplyScalar(speed);
  return v0;
}

/** Pase raso: velocidad inicial para llegar a `to` con `arrive` m/s. */
export function solveGroundPass(from, to, arrive = 6, maxSpeed = 30) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const D = Math.max(0.3, Math.hypot(dx, dz));
  const dir = new THREE.Vector3(dx / D, 0, dz / D);
  const p0 = new THREE.Vector3(from.x, BALL_R, from.z);
  const zero = new THREE.Vector3();
  let lo = 1, hi = maxSpeed;
  const v0 = new THREE.Vector3();
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    v0.copy(dir).multiplyScalar(mid);
    zero.set(dir.z / BALL_R * mid, 0, -dir.x / BALL_R * mid);
    const r = simToDistance(p0, v0, zero, dir, D, 6);
    if (!r.reached || r.speed < arrive) lo = mid; else hi = mid;
  }
  const s = (lo + hi) / 2;
  return {
    v: dir.clone().multiplyScalar(s),
    w: new THREE.Vector3(dir.z / BALL_R * s, 0, -dir.x / BALL_R * s),
  };
}

/** Pase elevado: ángulo fijo, busca la velocidad para caer en `to`. */
export function solveLob(from, to, angle = 0.62, backspin = 12, targetY = BALL_R) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const D = Math.max(1, Math.hypot(dx, dz));
  const dir = new THREE.Vector3(dx / D, 0, dz / D);
  const lat = new THREE.Vector3(-dir.z, 0, dir.x);
  // backspin: eje = lateral izquierdo respecto a la dirección de viaje
  const w = lat.clone().multiplyScalar(backspin);
  let lo = 3, hi = 38;
  const v0 = new THREE.Vector3();
  const c = Math.cos(angle), sn = Math.sin(angle);
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    v0.set(dir.x * c * mid, sn * mid, dir.z * c * mid);
    // simular hasta que el balón baje de targetY tras subir
    _sim.p.copy(from); _sim.v.copy(v0); _sim.w.copy(w);
    let t = 0, land = null;
    while (t < 6) {
      const vyPrev = _sim.v.y;
      stepBall(_sim, SIM_DT, false);
      t += SIM_DT;
      if (vyPrev < 0 && _sim.p.y <= Math.max(targetY, BALL_R) + 1e-3) { land = _sim.p; break; }
    }
    const along = land ? (land.x - from.x) * dir.x + (land.z - from.z) * dir.z : 0;
    if (along < D) lo = mid; else hi = mid;
  }
  const s = (lo + hi) / 2;
  return { v: new THREE.Vector3(dir.x * c * s, sn * s, dir.z * c * s), w };
}

// ---------------------------------------------------------------------------
// Objeto balón visible
// ---------------------------------------------------------------------------

export class Ball {
  constructor(textures) {
    this.state = makeState();
    this.p = this.state.p;
    this.v = this.state.v;
    this.w = this.state.w;
    const geo = new THREE.SphereGeometry(BALL_R, 48, 32);
    const mat = new THREE.MeshStandardMaterial({
      map: textures.map,
      bumpMap: textures.bump,
      bumpScale: 1.2,
      roughness: 0.42,
      metalness: 0.0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;

    // sombra de contacto (ayuda a leer la altura del balón)
    const sh = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 24),
      new THREE.MeshBasicMaterial({ map: textures.blob, transparent: true, depthWrite: false, opacity: 0.6 })
    );
    sh.rotation.x = -Math.PI / 2;
    sh.renderOrder = 1;
    this.shadow = sh;
    this.events = {};
    this._q = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
  }

  addTo(scene) { scene.add(this.mesh); scene.add(this.shadow); }

  reset(x, z, y = BALL_R) {
    this.p.set(x, y, z);
    this.v.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.state.prev.copy(this.p);
  }

  get speed() { return this.v.length(); }
  get grounded() { return this.p.y <= BALL_R + 0.03 && Math.abs(this.v.y) < 0.6; }

  step(dt) {
    stepBall(this.state, dt, true, this.events);
    this.spinVisual(dt);
  }

  spinVisual(dt) {
    const wl = this.w.length();
    if (wl > 1e-4) {
      this._axis.copy(this.w).multiplyScalar(1 / wl);
      this._q.setFromAxisAngle(this._axis, wl * dt);
      this.mesh.quaternion.premultiply(this._q);
    }
  }

  sync() {
    this.mesh.position.copy(this.p);
    const h = Math.max(0, this.p.y - BALL_R);
    const s = 1 + h * 0.25;
    this.shadow.position.set(this.p.x, 0.012, this.p.z);
    this.shadow.scale.setScalar(s);
    this.shadow.material.opacity = 0.55 / (1 + h * 0.8);
  }

  takeEvents() {
    const e = this.events;
    this.events = {};
    return e;
  }
}
