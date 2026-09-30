import * as THREE from 'three';
import { numberTexture } from './textures.js';

// ---------------------------------------------------------------------------
// Modelo de jugador jerárquico + animación procedimental.
// Toda la pose se calcula a partir de un pequeño estado `anim`
// ({speed, phase, action, t, dur, side, variant, lean}), lo que permite
// reproducir repeticiones exactas guardando sólo ese estado.
// El modelo mira hacia +Z en coordenadas locales.
// ---------------------------------------------------------------------------

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts }));
  return matCache.get(key);
}

const SKINS = ['#f1c7a5', '#d9a47e', '#b57a52', '#8a5a3b', '#5e3c28', '#e8b896'];
const HAIRS = ['#1b1512', '#3b2618', '#6b4423', '#c49a5a', '#0d0d0d', '#8b8b8b'];

function capsule(r, len, material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 12), material);
  m.castShadow = true;
  return m;
}

export function buildRig(kit, number, isGK, seed = Math.random()) {
  const skin = mat(SKINS[Math.floor(seed * 997) % SKINS.length], { roughness: 0.6 });
  const hair = mat(HAIRS[Math.floor(seed * 7919) % HAIRS.length], { roughness: 0.9 });
  const shirtC = isGK ? kit.gk : kit.shirt;
  const shirt = mat(shirtC, { roughness: 0.7 });
  const trim = mat(isGK ? '#1a1a1a' : kit.trim);
  const shorts = mat(isGK ? '#1a1a1a' : kit.shorts);
  const socks = mat(isGK ? kit.gk : kit.socks);
  const boots = mat(seed > 0.5 ? '#111111' : '#f5f5f5', { roughness: 0.35, metalness: 0.2 });
  const gloves = mat('#f4f4f4');

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  body.add(hips);

  const pelvis = capsule(0.15, 0.12, shorts);
  pelvis.rotation.z = Math.PI / 2;
  pelvis.scale.set(1, 1, 0.8);
  pelvis.position.y = 0.02;
  hips.add(pelvis);

  const torso = new THREE.Group();
  torso.position.y = 0.08;
  hips.add(torso);
  const chest = capsule(0.165, 0.3, shirt);
  chest.position.y = 0.26;
  chest.scale.set(1.25, 1, 0.78);
  torso.add(chest);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 16), trim);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.55;
  torso.add(collar);

  // dorsal
  const numMat = new THREE.MeshBasicMaterial({ map: numberTexture(number, isGK ? '#ffffff' : kit.num), transparent: true, depthWrite: false });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), numMat);
  back.position.set(0, 0.3, -0.135);
  back.rotation.y = Math.PI;
  torso.add(back);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), numMat);
  front.position.set(0.08, 0.4, 0.132);
  torso.add(front);

  const neck = capsule(0.05, 0.06, skin);
  neck.position.y = 0.58;
  torso.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.68;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 16), skin);
  skull.scale.set(0.92, 1.08, 1);
  skull.position.y = 0.04;
  skull.castShadow = true;
  head.add(skull);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.118, 20, 12, 0, Math.PI * 2, 0, Math.PI * (0.42 + (seed % 0.1))), hair);
  hairM.scale.set(0.95, 1.08, 1.04);
  hairM.position.set(0, 0.05, -0.008);
  hairM.rotation.x = -0.25;
  head.add(hairM);
  const eyeMat = mat('#101010');
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), eyeMat);
    eye.position.set(s * 0.038, 0.055, 0.1);
    head.add(eye);
  }

  const limbs = {};
  for (const [name, s] of [['L', 1], ['R', -1]]) {
    // pierna
    const thigh = new THREE.Group();
    thigh.position.set(s * 0.1, 0, 0);
    hips.add(thigh);
    const thighM = capsule(0.078, 0.28, skin);
    thighM.position.y = -0.22;
    thigh.add(thighM);
    const shortLeg = capsule(0.09, 0.1, shorts);
    shortLeg.position.y = -0.1;
    thigh.add(shortLeg);
    const shin = new THREE.Group();
    shin.position.y = -0.45;
    thigh.add(shin);
    const shinM = capsule(0.062, 0.3, socks);
    shinM.position.y = -0.2;
    shin.add(shinM);
    const foot = new THREE.Group();
    foot.position.y = -0.43;
    shin.add(foot);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), boots);
    boot.position.set(0, -0.02, 0.05);
    boot.castShadow = true;
    foot.add(boot);
    // brazo
    const arm = new THREE.Group();
    arm.position.set(s * 0.25, 0.49, 0);
    torso.add(arm);
    const sleeve = capsule(0.058, 0.14, shirt);
    sleeve.position.y = -0.1;
    arm.add(sleeve);
    const upper = capsule(0.047, 0.2, isGK ? shirt : skin);
    upper.position.y = -0.14;
    arm.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -0.29;
    arm.add(fore);
    const foreM = capsule(0.042, 0.2, isGK ? shirt : skin);
    foreM.position.y = -0.13;
    fore.add(foreM);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(isGK ? 0.07 : 0.048, 10, 8), isGK ? gloves : skin);
    hand.position.y = -0.28;
    hand.castShadow = true;
    fore.add(hand);
    limbs['thigh' + name] = thigh;
    limbs['shin' + name] = shin;
    limbs['foot' + name] = foot;
    limbs['arm' + name] = arm;
    limbs['fore' + name] = fore;
  }

  return { root, body, hips, torso, head, ...limbs };
}

// ---------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------

const P = {};
function resetPose() {
  P.bodyY = 0; P.bodyRx = 0; P.bodyRz = 0;
  P.hipsY = 0.95;
  P.torsoRx = 0; P.torsoRy = 0; P.torsoRz = 0;
  P.headRx = 0; P.headRy = 0;
  P.thL = 0; P.thR = 0; P.knL = 0.05; P.knR = 0.05; P.hoL = 0; P.hoR = 0; P.ftL = 0; P.ftR = 0;
  P.shL = 0; P.shR = 0; P.soL = 0.12; P.soR = 0.12; P.elL = 0.2; P.elR = 0.2;
}

const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolación suave entre fotogramas clave [[t, v], ...] */
function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return lerp(v0, v1, smooth((t - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}

// mezcla parcial de valores de P hacia una pose objetivo
function blend(target, w) {
  for (const k in target) P[k] = lerp(P[k], target[k], w);
}

function locomotion(a, gk) {
  const sp = clamp01(a.speed / 7.5);
  const run = smooth(clamp01(a.speed / 2.0));
  const amp = 0.3 + 0.62 * sp;
  const ph = a.phase;
  const s = Math.sin(ph), c = Math.cos(ph);

  // reposo: respiración y postura atenta
  const br = Math.sin(ph * 1.0) * 0.5 + 0.5;
  const idle = {
    bodyY: -0.02 - (gk ? 0.1 : 0),
    torsoRx: 0.06 + br * 0.02 + (gk ? 0.3 : 0),
    thL: 0.08 + (gk ? 0.35 : 0), thR: 0.02 + (gk ? 0.35 : 0),
    knL: 0.18 + (gk ? 0.6 : 0), knR: 0.12 + (gk ? 0.6 : 0),
    hoL: gk ? 0.18 : 0.06, hoR: gk ? 0.18 : 0.06,
    shL: gk ? 0.6 : 0.05 + br * 0.03, shR: gk ? 0.6 : 0.05 + br * 0.03,
    soL: gk ? 0.45 : 0.14, soR: gk ? 0.45 : 0.14,
    elL: gk ? 0.9 : 0.35, elR: gk ? 0.9 : 0.35,
    headRx: gk ? -0.25 : -0.02,
  };
  blend(idle, 1 - run);

  const L = Math.max(0, c);
  const R = Math.max(0, -c);
  const runP = {
    bodyY: -Math.abs(s) * 0.06 * amp - 0.03 * sp,
    torsoRx: 0.1 + 0.2 * sp,
    torsoRy: s * 0.18 * amp,
    thL: s * amp, thR: -s * amp,
    knL: 0.25 + 1.35 * amp * L * L + 0.2 * amp, knR: 0.25 + 1.35 * amp * R * R + 0.2 * amp,
    ftL: -0.2 * s, ftR: 0.2 * s,
    shL: -s * amp * 0.9, shR: s * amp * 0.9,
    soL: 0.15, soR: 0.15,
    elL: 1.2 + 0.2 * sp, elR: 1.2 + 0.2 * sp,
    headRx: -0.1 - 0.15 * sp,
  };
  blend(runP, run);
  P.bodyRz = a.lean || 0;
}

function envelope(t, dur, inT = 0.06, outT = 0.12) {
  return clamp01(Math.min(t / inT, (dur - t) / outT));
}

const ACTIONS = {
  kick(a) {
    const k = a.t / a.dur;
    const pw = a.variant || 1;           // 0.5 pase suave, 1 disparo
    const kick = {}, sup = {};
    const sw = kf(k, [[0, 0], [0.34, -0.85 * pw], [0.48, 1.25 * pw], [0.7, 1.45 * pw], [1, 0.2]]);
    const kn = kf(k, [[0, 0.2], [0.34, 1.7 * pw], [0.48, 0.15], [0.7, 0.3], [1, 0.3]]);
    const R = a.side >= 0;
    kick[R ? 'thR' : 'thL'] = sw; kick[R ? 'knR' : 'knL'] = kn;
    kick[R ? 'thL' : 'thR'] = kf(k, [[0, 0], [0.34, 0.25], [0.5, -0.15], [1, 0]]);
    kick[R ? 'knL' : 'knR'] = kf(k, [[0, 0.2], [0.34, 0.5], [0.5, 0.35], [1, 0.2]]);
    kick[R ? 'hoR' : 'hoL'] = pw < 0.8 ? 0.25 : 0.05;
    kick.torsoRx = kf(k, [[0, 0.1], [0.34, 0.05], [0.5, -0.18 * pw], [1, 0.05]]);
    kick.torsoRy = (R ? 1 : -1) * kf(k, [[0, 0], [0.34, 0.35 * pw], [0.55, -0.25 * pw], [1, 0]]);
    kick[R ? 'soL' : 'soR'] = kf(k, [[0, 0.2], [0.4, 1.1 * pw], [1, 0.3]]);
    kick[R ? 'shL' : 'shR'] = kf(k, [[0, 0], [0.4, 0.5], [1, 0]]);
    kick[R ? 'shR' : 'shL'] = kf(k, [[0, 0], [0.4, -0.6 * pw], [1, 0]]);
    kick[R ? 'soR' : 'soL'] = kf(k, [[0, 0.2], [0.4, 0.5 * pw], [1, 0.2]]);
    kick.bodyY = kf(k, [[0, 0], [0.34, -0.06], [0.5, 0.02], [1, 0]]);
    kick.headRx = 0.25;
    blend(kick, envelope(a.t, a.dur, 0.05, 0.14));
    void sup;
  },
  header(a) {
    const k = a.t / a.dur;
    const h = (a.variant || 1) * 0.5;
    const j = Math.sin(clamp01(k) * Math.PI);
    blend({
      bodyY: j * h,
      torsoRx: kf(k, [[0, 0], [0.35, -0.45], [0.55, 0.45], [1, 0.1]]),
      headRx: kf(k, [[0, 0], [0.35, -0.5], [0.55, 0.5], [1, 0]]),
      thL: 0.3, thR: -0.1, knL: 1.1 * j + 0.2, knR: 0.8 * j + 0.2,
      shL: 0.7, shR: 0.7, soL: 0.9, soR: 0.9, elL: 0.8, elR: 0.8,
    }, envelope(a.t, a.dur, 0.05, 0.12));
  },
  slide(a) {
    const k = a.t / a.dur;
    const R = a.side >= 0;
    const t = {
      bodyY: -0.28,
      bodyRx: -0.95,
      torsoRx: 0.45,
      headRx: 0.5,
      soL: 0.9, soR: 0.9, shL: -0.4, shR: -0.4, elL: 0.4, elR: 0.4,
    };
    t[R ? 'thR' : 'thL'] = 1.75; t[R ? 'knR' : 'knL'] = 0.08;
    t[R ? 'thL' : 'thR'] = 1.1; t[R ? 'knL' : 'knR'] = 1.9;
    blend(t, envelope(a.t, a.dur, 0.08, 0.28) * (k < 1 ? 1 : 0));
  },
  tackle(a) {
    const R = a.side >= 0;
    const k = a.t / a.dur;
    const t = { torsoRx: 0.35, bodyY: -0.12, headRx: 0.3, soL: 0.6, soR: 0.6 };
    t[R ? 'thR' : 'thL'] = kf(k, [[0, 0], [0.4, 1.2], [1, 0.4]]);
    t[R ? 'knR' : 'knL'] = kf(k, [[0, 0.8], [0.4, 0.15], [1, 0.4]]);
    t[R ? 'thL' : 'thR'] = -0.2; t[R ? 'knL' : 'knR'] = 0.6;
    t[R ? 'hoR' : 'hoL'] = 0.3;
    blend(t, envelope(a.t, a.dur, 0.05, 0.15));
  },
  dive(a) {
    const k = a.t / a.dur;
    const s = a.side; // +1 hacia su izquierda (+X local)
    const air = kf(k, [[0, 0], [0.12, 0], [0.35, 1], [0.62, 1], [0.8, 0.25], [1, 0]]);
    const high = a.variant || 0.5;
    blend({
      bodyY: kf(k, [[0, -0.15], [0.12, -0.25], [0.35, 0.25 + high * 0.6], [0.6, 0.15], [0.72, -0.05], [1, 0]]),
      bodyRz: -s * 1.35 * air,
      torsoRx: 0.1,
      torsoRz: -s * 0.2 * air,
      shL: kf(k, [[0, 0.6], [0.3, 2.9], [0.8, 2.6], [1, 0.4]]),
      shR: kf(k, [[0, 0.6], [0.3, 2.9], [0.8, 2.6], [1, 0.4]]),
      soL: 0.2 + (s > 0 ? 0.2 : 0.1), soR: 0.2 + (s < 0 ? 0.2 : 0.1),
      elL: 0.15, elR: 0.15,
      thL: 0.2 + 0.2 * air, thR: 0.1 + 0.3 * air, knL: 0.5 * air + 0.3, knR: 0.3,
      hoL: s > 0 ? 0.25 * air : 0, hoR: s < 0 ? 0.25 * air : 0,
      headRy: s * 0.4 * air,
    }, envelope(a.t, a.dur, 0.06, 0.25));
  },
  fall(a) {
    const k = a.t / a.dur;
    const down = kf(k, [[0, 0], [0.18, 1], [0.62, 1], [0.9, 0.2], [1, 0]]);
    blend({
      bodyRx: 1.42 * down,
      bodyY: -0.08 * down,
      torsoRx: 0.1,
      shL: 2.4 * down, shR: 2.1 * down, soL: 0.5, soR: 0.5, elL: 0.6, elR: 0.6,
      thL: -0.2 * down, thR: 0.1, knL: 0.6 * down, knR: 0.3,
      headRx: -0.6 * down,
    }, envelope(a.t, a.dur, 0.05, 0.2));
  },
  catch(a) {
    const high = a.variant || 0.5;
    blend({
      torsoRx: 0.25 - high * 0.2,
      bodyY: -0.15 + high * 0.1,
      shL: 0.9 + high * 1.4, shR: 0.9 + high * 1.4, soL: 0.25, soR: 0.25, elL: 0.9 - high * 0.5, elR: 0.9 - high * 0.5,
      knL: 0.5, knR: 0.5, thL: 0.3, thR: 0.3,
      headRx: -0.2,
    }, envelope(a.t, a.dur, 0.05, 0.1));
  },
  hold(a) {
    blend({ shL: 1.0, shR: 1.0, soL: 0.05, soR: 0.05, elL: 1.4, elR: 1.4, torsoRx: 0.12 }, envelope(a.t, a.dur, 0.1, 0.1));
  },
  throw(a) {
    // variant: 0 sosteniendo, 1 lanzando
    const k = a.variant ? clamp01(a.t / 0.35) : 0;
    blend({
      shL: kf(k, [[0, 2.95], [0.5, 3.2], [1, 1.3]]), shR: kf(k, [[0, 2.95], [0.5, 3.2], [1, 1.3]]),
      soL: 0.15, soR: 0.15,
      elL: kf(k, [[0, 1.5], [0.5, 1.7], [1, 0.1]]), elR: kf(k, [[0, 1.5], [0.5, 1.7], [1, 0.1]]),
      torsoRx: kf(k, [[0, -0.2], [0.5, -0.35], [1, 0.35]]),
      headRx: -0.2,
    }, envelope(a.t, a.dur, 0.1, 0.12));
  },
  celebrate(a) {
    const v = a.variant | 0;
    const e = envelope(a.t, a.dur, 0.15, 0.3);
    const t = a.t;
    if (v === 0) {
      // saltos con puño en alto
      const cyc = (t * 1.6) % 1;
      const j = Math.sin(cyc * Math.PI);
      blend({
        bodyY: j * 0.42, knL: 0.3 + j * 0.9, knR: 0.3 + j * 0.9, thL: j * 0.6, thR: j * 0.4,
        shR: 3.0, soR: 0.2, elR: 0.3 + 0.4 * Math.sin(t * 12),
        shL: 0.5 + j * 1.8, soL: 0.6, elL: 1.0,
        torsoRx: -0.15, headRx: -0.35,
      }, e);
    } else if (v === 1) {
      // avión
      blend({ soL: 1.5, soR: 1.5, shL: 0.1, shR: 0.1, elL: 0.05, elR: 0.05, torsoRx: 0.2, headRx: -0.2 }, e);
      P.bodyRz += Math.sin(t * 2.4) * 0.35 * e;
    } else if (v === 2) {
      // rodillas deslizando
      const slide = clamp01(t / 0.25) * (t < a.dur - 0.5 ? 1 : 0);
      blend({
        bodyY: -0.52, thL: -0.05, thR: -0.05, knL: 1.55, knR: 1.55, ftL: -0.4, ftR: -0.4,
        torsoRx: -0.45, headRx: -0.5,
        shL: 2.6, shR: 2.6, soL: 0.7, soR: 0.7, elL: 0.25, elR: 0.25,
      }, e * slide);
    } else {
      // señalar al cielo
      blend({ shL: 3.0, shR: 3.0, soL: 0.35, soR: 0.35, elL: 0.05, elR: 0.05, headRx: -0.6, torsoRx: -0.1 }, e);
    }
  },
  sad(a) {
    blend({ headRx: 0.55, torsoRx: 0.25, shL: -0.1, shR: -0.1, soL: 0.35, soR: 0.35, elL: 2.1, elR: 2.1 }, envelope(a.t, a.dur, 0.3, 0.3));
  },
};

export function poseRig(rig, a, gk = false) {
  resetPose();
  locomotion(a, gk);
  if (a.action && ACTIONS[a.action]) ACTIONS[a.action](a);

  rig.body.position.y = P.bodyY;
  rig.body.rotation.set(P.bodyRx, 0, P.bodyRz);
  rig.hips.position.y = P.hipsY;
  rig.torso.rotation.set(P.torsoRx, P.torsoRy, P.torsoRz);
  rig.head.rotation.set(P.headRx, P.headRy, 0);
  rig.thighL.rotation.set(-P.thL, 0, P.hoL);
  rig.thighR.rotation.set(-P.thR, 0, -P.hoR);
  rig.shinL.rotation.x = P.knL;
  rig.shinR.rotation.x = P.knR;
  rig.footL.rotation.x = P.ftL - 0.1;
  rig.footR.rotation.x = P.ftR - 0.1;
  rig.armL.rotation.set(-P.shL, 0, P.soL);
  rig.armR.rotation.set(-P.shR, 0, -P.soR);
  rig.foreL.rotation.x = -P.elL;
  rig.foreR.rotation.x = -P.elR;
}

/** Avanza la fase del ciclo de carrera según la velocidad. */
export function advancePhase(a, dt) {
  const run = clamp01(a.speed / 2.0);
  const stride = 1.1 + clamp01(a.speed / 7.5) * 0.9;
  a.phase += dt * ((1 - run) * 1.6 + run * (a.speed / stride) * Math.PI);
  if (a.phase > 1e4) a.phase -= Math.PI * 2 * 1000;
}
