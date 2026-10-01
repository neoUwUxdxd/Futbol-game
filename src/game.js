import * as THREE from 'three';
import { PITCH, HALF_L, HALF_W, BALL_R, TEAMS, DIFFICULTY, FORMATION, RUN_SPEED, SPRINT_SPEED } from './config.js';
import { solveLaunch, solveGroundPass, solveLob, predict } from './ball.js';
import { buildRig, poseRig, advancePhase } from './player.js';
import { Recorder } from './replay.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const GW2 = PITCH.goalW / 2;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const LOCKING = new Set(['kick', 'header', 'slide', 'tackle', 'dive', 'fall', 'throw']);

// ---------------------------------------------------------------------------
class Player {
  constructor(game, team, slot, idx) {
    this.game = game;
    this.team = team;
    this.idx = idx;
    this.role = slot.role;
    this.isGK = slot.role === 'GK';
    this.number = slot.num;
    this.home = { x: slot.x, z: slot.z };
    this.pos = V();
    this.vel = V();
    this.heading = 0;
    this.desired = V();
    this.faceDir = null;
    this.anim = { speed: 0, phase: Math.random() * 6, action: 'none', t: 0, dur: 0, side: 1, variant: 0, lean: 0 };
    this.rig = buildRig(team.kit, this.number, this.isGK, Math.random());
    this.lock = 0;
    this.touchCd = 0;
    this.dribbleT = 0;
    this.stun = 0;
    this.pending = null;
    this.sprint = false;
    this.aiT = Math.random() * 0.3;
    this.aiTarget = V();
    this.aiDir = V(1, 0, 0);
    this.supportOff = V();
    this.supportT = 0;
    this.tackleCd = 0;
    this.diveCd = 0;
    this.reactT = 0;
    this.holding = false;
    this.holdT = 0;
    this.intercept = { t: 99, x: 0, z: 0 };
    const roleMul = { GK: 0.92, DEF: 0.98, MID: 1.0, FWD: 1.04 }[this.role];
    this.speedMul = roleMul * (team.i === 1 ? game.diff.speed : 1);
    this.leanS = 0;
  }
  get fwd() { return V(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get left() { return V(Math.cos(this.heading), 0, -Math.sin(this.heading)); }
  get maxSpeed() { return SPRINT_SPEED * this.speedMul; }
  setAction(name, dur, side = 1, variant = 0) {
    const a = this.anim;
    a.action = name; a.t = 0; a.dur = dur; a.side = side; a.variant = variant;
  }
  get acting() { return LOCKING.has(this.anim.action); }
}

// ---------------------------------------------------------------------------
export class Game {
  constructor(opts) {
    Object.assign(this, opts); // scene, ball, fx, trail, waves, audio, stadium, camRig, hud
    this.diff = DIFFICULTY[opts.settings.difficulty] || DIFFICULTY.normal;
    this.duration = opts.settings.minutes * 60;
    this.teams = [0, 1].map((i) => ({
      i, kit: TEAMS[opts.settings.teams[i]], side: i === 0 ? 1 : -1, players: [], score: 0,
      gk: null, chaser: null, presser: null, cover: null,
    }));
    this.players = [];
    for (const t of this.teams) {
      FORMATION.forEach((slot, k) => {
        const p = new Player(this, t, slot, this.players.length);
        t.players.push(p);
        if (p.isGK) t.gk = p;
        this.players.push(p);
        this.scene.add(p.rig.root);
      });
    }
    this.human = this.teams[0].players.find((p) => p.role === 'FWD');
    this.owner = null;
    this.lastTouch = null;
    this.receiver = null;
    this.receiverUntil = 0;
    this.lastKick = null;
    this.buffer = null;
    this.charge = 0;
    this.charging = false;
    this.time = 0;
    this.matchTime = 0;
    this.state = 'kickoff';
    this.stateT = 0;
    this.pred = [];
    this.excite = 0.15;
    this.recorder = new Recorder(this.players, 9);
    this.goals = [];
    this.restart = null;
    this.taker = null;
    this.paused = false;
    this.replayEnabled = opts.settings.replays !== false;
    this.demo = !!opts.settings.demo;
    this.whistled = false;

    // indicador del jugador controlado
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 2;
    this.scene.add(this.ring);
    const arrowGeo = new THREE.ConeGeometry(0.16, 0.3, 4);
    arrowGeo.rotateX(Math.PI);
    this.arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    this.scene.add(this.arrow);
    // marcador de dirección (flecha en el césped)
    const dirShape = new THREE.Shape();
    dirShape.moveTo(0, 0.95); dirShape.lineTo(0.16, 0.66); dirShape.lineTo(-0.16, 0.66); dirShape.closePath();
    const dg = new THREE.ShapeGeometry(dirShape);
    dg.rotateX(-Math.PI / 2);
    dg.scale(1, 1, -1);
    this.dirMark = new THREE.Mesh(dg, ringMat);
    this.dirMark.renderOrder = 2;
    this.scene.add(this.dirMark);

    this.setupKickoff(0);
  }

  // =========================================================================
  // Bucle principal
  // =========================================================================
  update(dt, input) {
    if (input.pressed('pause') && this.state !== 'end') {
      this.paused = !this.paused;
      this.hud.pause(this.paused);
    }
    if (this.paused) return;
    this.time += dt;
    this.stateT += dt;

    if (this.state === 'replay') { this.updateReplay(dt, input); return; }

    if (['play', 'dead', 'setpiece'].includes(this.state)) {
      this.matchTime += dt;
      if (this.matchTime >= this.duration && this.state !== 'setpiece' || this.matchTime >= this.duration + 8) {
        this.endMatch();
      }
    }

    this.pred = predict(this.ball.p, this.ball.v, this.ball.w, 3, 4, this.pred);
    this.assignRoles();

    for (const p of this.players) {
      p.desired.set(0, 0, 0);
      p.sprint = false;
      if (this.state === 'goal') this.celebrationAI(p, dt);
      else if (this.state === 'end') this.endAI(p);
      else if (this.state === 'kickoff') this.kickoffAI(p, input);
      else if (p === this.human && this.state !== 'dead' && !this.demo) this.humanControl(p, input, dt);
      else if (p.isGK) this.gkAI(p, dt);
      else this.outfieldAI(p, dt);
    }
    if (this.state === 'setpiece') this.setpieceUpdate(dt, input);
    if (this.state === 'kickoff') this.kickoffUpdate(input);

    for (const p of this.players) this.movePlayer(p, dt);
    this.separate();

    for (const p of this.players) {
      if (!p.pending) continue;
      p.pending.t -= dt;
      if (p.pending.t <= 0) {
        const k = p.pending;
        p.pending = null;
        if (k.type === 'tackle') this.executeTackle(p);
        else this.executeKick(p, k);
      }
    }

    this.dribble(dt);

    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      if (this.owner && this.owner.holding) break;
      this.ball.step(h);
      this.bodyCollisions();
      this.keeperHands();
    }
    this.control();
    this.handleBallEvents();
    if (this.state === 'play') this.checkRules();
    if (this.state === 'dead' && this.stateT > 1.6) this.setupRestart();
    if (this.state === 'goal' && this.stateT > 4.8) this.startReplay();

    // emoción de la grada
    let ex = 0.15;
    const bx = Math.abs(this.ball.p.x);
    if (this.state === 'play' && bx > HALF_L - 22) ex = 0.25 + (bx - (HALF_L - 22)) / 22 * 0.45 * (1 - Math.min(1, Math.abs(this.ball.p.z) / HALF_W));
    if (this.state === 'goal') ex = 1;
    if (this.state === 'end') ex = 0.8;
    this.excite += (ex - this.excite) * Math.min(1, dt * 1.5);
    this.audio.crowd(this.excite);

    if (this.state !== 'end') this.recorder.record(this.time, this.ball);
  }

  // =========================================================================
  // Roles tácticos: quién presiona, quién cubre, quién va al balón
  // =========================================================================
  assignRoles() {
    for (const p of this.players) { p.intercept = this.computeIntercept(p); p.mark = null; }
    for (const t of this.teams) {
      t.chaser = t.presser = t.cover = t.support = null;
      const hasBall = this.owner && this.owner.team === t;
      if (hasBall) continue;
      const out = t.players.filter((p) => !p.isGK && p.anim.action !== 'fall');
      // el jugador que maneja el usuario no cuenta para los roles de la IA:
      // si el usuario no va al balón, un compañero tiene que ir igualmente
      const human = this.demo ? null : (t === this.human.team ? this.human : null);
      const ai = out.filter((p) => p !== human);
      if (!this.owner) {
        let best = null;
        for (const p of ai) if (!best || p.intercept.t < best.intercept.t) best = p;
        if (!best) continue;
        t.chaser = best;
        if (human && human.intercept.t + 0.45 < best.intercept.t) {
          // el usuario llega antes: el compañero acompaña la jugada por detrás
          t.chaser = null;
          t.support = best;
        }
        // el portero sale si el balón suelto llega a su área
        const gk = t.gk;
        const ix = gk.intercept;
        const fastest = human && human.intercept.t < best.intercept.t ? human : best;
        if (Math.abs(ix.x) > HALF_L - PITCH.boxD + 1 && Math.sign(ix.x) === -t.side && Math.abs(ix.z) < PITCH.boxW / 2 - 2 && ix.t < fastest.intercept.t - 0.2) { t.chaser = gk; t.support = null; }
      } else if (!this.owner.holding) {
        const o = this.owner.pos;
        const sorted = ai.slice().sort((a, b) => hdist(a.pos, o) - hdist(b.pos, o));
        const humanOn = human && hdist(human.pos, o) < 3.2;
        if (humanOn) { t.cover = sorted[0]; }
        else { t.presser = sorted[0]; t.cover = sorted[1]; }
        // marcaje: cada atacante peligroso con un defensor distinto
        const free = ai.filter((p) => p !== t.presser && p !== t.cover && p.role !== 'FWD');
        const ownGoal = V(-t.side * HALF_L, 0, 0);
        const threats = this.opponents(t)
          .filter((q) => !q.isGK && q !== this.owner)
          .sort((a, b) => hdist(a.pos, ownGoal) - hdist(b.pos, ownGoal));
        for (const q of threats) {
          let bd = 18, who = null;
          for (const d of free) {
            const home = this.formationTarget(d, V());
            const dd = hdist(d.pos, q.pos) * 0.6 + hdist(home, q.pos) * 0.4;
            if (dd < bd) { bd = dd; who = d; }
          }
          if (who) { who.mark = q; free.splice(free.indexOf(who), 1); }
        }
      }
    }
  }

  computeIntercept(p) {
    const spd = p.maxSpeed * 0.95;
    const maxY = p.isGK ? 2.3 : 1.7;
    for (const s of this.pred) {
      if (s.y > maxY) continue;
      const d = Math.max(0, Math.hypot(s.x - p.pos.x, s.z - p.pos.z) - 0.6);
      if (d / spd + 0.1 <= s.t) return { t: s.t, x: s.x, z: s.z };
    }
    const last = this.pred[this.pred.length - 1] || { t: 0, x: this.ball.p.x, z: this.ball.p.z };
    const d = Math.hypot(last.x - p.pos.x, last.z - p.pos.z);
    return { t: last.t + d / spd, x: last.x, z: last.z };
  }

  opponents(team) { return this.teams[1 - team.i].players; }

  nearestOpp(pos, team, exclude = null) {
    let best = 1e9, who = null;
    for (const o of this.opponents(team)) {
      if (o === exclude) continue;
      const d = hdist(o.pos, pos);
      if (d < best) { best = d; who = o; }
    }
    return { d: best, p: who };
  }

  laneRisk(a, b, team) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    let risk = 0;
    for (const o of this.opponents(team)) {
      const t = clamp(((o.pos.x - a.x) * dx + (o.pos.z - a.z) * dz) / (len * len), 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = Math.hypot(o.pos.x - px, o.pos.z - pz);
      const reach = 0.9 + t * len * 0.09;
      risk = Math.max(risk, Math.exp(-((d / reach) ** 2)) * (t > 0.02 ? 1 : 0.3));
    }
    return risk;
  }

  // =========================================================================
  // Control humano
  // =========================================================================
  humanControl(p, input, dt) {
    const m = input.move;
    const mag = Math.hypot(m.x, m.z);
    const has = this.owner === p;
    if (this.state === 'setpiece' && this.taker === p) return; // lo gestiona setpieceUpdate
    const actions = this.state === 'play';
    let speed = input.down('sprint') ? SPRINT_SPEED : RUN_SPEED;
    if (has) speed *= input.down('sprint') ? 0.9 : 0.95;
    p.sprint = input.down('sprint') && mag > 0.2;
    p.desired.set(m.x, 0, m.z).multiplyScalar(speed);
    if (mag < 0.15 && this.receiver === p) {
      const ix = p.intercept;
      this.seek(p, V(ix.x, 0, ix.z), 6, 0.3);
    }
    const dir = mag > 0.2 ? V(m.x, 0, m.z).normalize() : p.fwd;
    if (input.pressed('switch')) this.switchPlayer();
    if (!actions) return;

    if (has) {
      if (input.pressed('pass')) this.doPass(p, dir, 'pass');
      else if (input.pressed('lob')) this.doPass(p, dir, 'lob');
      if (input.down('shoot') && !p.pending) {
        this.charging = true;
        this.charge = Math.min(1, this.charge + dt / 0.85);
      }
      if (input.released('shoot') && this.charging) {
        this.doShot(p, Math.max(0.25, this.charge), mag > 0.25 ? m.z : null);
        this.charging = false;
        this.charge = 0;
      }
    } else {
      // disparo cargado mientras llega el balón (volea / remate de primeras)
      if (input.down('shoot')) {
        this.charge = Math.min(1, this.charge + dt / 0.85);
        this.charging = true;
      }
      if (input.released('shoot') && this.charging) {
        if (this.canFirstTime(p)) this.doShot(p, Math.max(0.4, this.charge), mag > 0.25 ? m.z : null, true);
        else if (this.charge < 0.3 && Math.hypot(p.vel.x, p.vel.z) > 2.5) this.trySlide(p);
        else this.buffer = { type: 'shot', power: Math.max(0.5, this.charge), aim: mag > 0.25 ? m.z : null, until: this.time + 0.7 };
        this.charging = false; this.charge = 0;
      }
      if (input.pressed('pass')) {
        if (this.canFirstTime(p)) this.doPass(p, dir, 'pass', true);
        else if (this.owner && this.owner.team !== p.team && hdist(this.owner.pos, p.pos) < 2.2) this.tryTackle(p);
        else if (this.isIncoming(p)) this.buffer = { type: 'pass', dir: dir.clone(), until: this.time + 0.7 };
        else if (this.owner && this.owner.team !== p.team) this.tryTackle(p);
      }
      if (input.pressed('lob')) {
        if (this.canFirstTime(p)) this.doPass(p, dir, 'lob', true);
        else if (this.isIncoming(p)) this.buffer = { type: 'lob', dir: dir.clone(), until: this.time + 0.7 };
        else this.switchPlayer();
      }
    }
  }

  isIncoming(p) {
    return !this.owner && (this.receiver === p || p.intercept.t < 1.2) && hdist(this.ball.p, p.pos) < 14;
  }

  canFirstTime(p) {
    if (this.owner && this.owner !== p) return false;
    if (p.touchCd > 0 || p.acting) return false;
    const b = this.ball;
    const fx = b.p.x + b.v.x * 0.12, fz = b.p.z + b.v.z * 0.12;
    const d = Math.hypot(fx - p.pos.x, fz - p.pos.z);
    return d < 1.5 && b.p.y < 2.5;
  }

  switchPlayer() {
    const t = this.human.team;
    let best = null, bt = 1e9;
    for (const p of t.players) {
      if (p.isGK || p === this.human) continue;
      let score = this.owner && this.owner.team !== t ? hdist(p.pos, this.owner.pos) / p.maxSpeed : p.intercept.t;
      // preferir jugadores por delante de la jugada defensiva
      if (score < bt) { bt = score; best = p; }
    }
    if (best) this.setHuman(best);
  }

  setHuman(p) {
    if (this.human === p) return;
    this.human = p;
    this.charging = false;
    this.charge = 0;
  }

  // =========================================================================
  // IA de campo
  // =========================================================================
  seek(p, target, sprintDist = 7, stop = 0.35, slowR = 1.4) {
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stop) { p.desired.set(0, 0, 0); return d; }
    const sprint = d > sprintDist;
    let s = (sprint ? SPRINT_SPEED : RUN_SPEED * 0.85) * p.speedMul;
    s *= Math.min(1, d / slowR);
    p.sprint = sprint;
    p.desired.set(dx / d * s, 0, dz / d * s);
    return d;
  }

  formationTarget(p, out = V()) {
    const s = p.team.side;
    const b = this.ball.p;
    const bx = b.x * s;
    const own = this.owner && this.owner.team === p.team;
    const opp = this.owner && this.owner.team !== p.team;
    const shift = own ? 6 : opp ? -3 : 1;
    let x = p.home.x * HALF_L * 0.62 + bx * 0.48 + shift;
    let z = p.home.z * HALF_W * 0.74 + b.z * 0.32;
    if (p.role === 'DEF') x = clamp(x, -HALF_L + 5, HALF_L * 0.3);
    if (p.role === 'MID') x = clamp(x, -HALF_L + 9, HALF_L - 11);
    if (p.role === 'FWD') x = clamp(x, -HALF_L * 0.15, HALF_L - 7);
    if (opp && p.role !== 'FWD') x = Math.min(x, bx - 1.5);
    if (own && p.role === 'FWD') x = Math.min(x + 3, HALF_L - 5);
    z = clamp(z, -HALF_W + 2, HALF_W - 2);
    out.set(x * s, 0, z);
    return out;
  }

  outfieldAI(p, dt) {
    const t = p.team;
    if (this.owner === p) { this.carrierAI(p, dt); return; }
    const target = this.formationTarget(p, p.aiTarget);
    const oppHas = this.owner && this.owner.team !== t;
    const own = this.owner && this.owner.team === t;
    const b = this.ball.p;

    if (this.state === 'dead') { this.seek(p, target, 12, 0.6); this.faceBall(p); return; }
    if (this.state === 'setpiece') {
      if (p === this.taker) return;
      if (this.restart && this.restart.team !== t) {
        // mantener distancia en balón parado
        const sp = this.restart.spot;
        const d = hdist(target, sp);
        if (d < 7) { const dir = V(target.x - sp.x, 0, target.z - sp.z).normalize(); target.copy(sp).addScaledVector(dir, 7); }
      }
      if (this.restart && this.restart.kind === 'corner' && this.restart.team === t && p.role !== 'DEF') {
        const gx = t.side * (HALF_L - 7);
        target.set(gx + rnd(-2, 2) * 0, 0, (p.home.z) * 6);
      }
      this.seek(p, target, 10, 0.5);
      this.faceBall(p);
      return;
    }

    if (this.receiver === p && this.time < this.receiverUntil) {
      const ix = p.intercept;
      this.seek(p, V(ix.x, 0, ix.z), 3, 0.25, 0.8);
      return;
    }
    if (!this.owner && t.chaser === p) {
      const ix = p.intercept;
      this.seek(p, V(ix.x, 0, ix.z), 4, 0.1, 0.5);
      return;
    }
    if (!this.owner && t.support === p) {
      // acompañar: cerca del punto de corte, cubriendo por detrás
      const ix = p.intercept;
      const back = V(-t.side, 0, -Math.sign(ix.z) * 0.3).normalize();
      this.seek(p, V(ix.x, 0, ix.z).addScaledVector(back, 3.5), 5, 0.5);
      return;
    }
    if (oppHas && t.presser === p && !this.owner.holding) {
      const o = this.owner;
      const ownGoal = V(-t.side * HALF_L, 0, 0);
      const gs = V().subVectors(ownGoal, o.pos).setY(0).normalize();
      const aim = o.pos.clone().addScaledVector(gs, 0.9).addScaledVector(o.vel, 0.25);
      const d = this.seek(p, aim, 3, 0.2, 0.6);
      p.desired.multiplyScalar(this.diff.press > 1 || t.i === 0 ? 1 : this.diff.press);
      if (t !== this.human.team || p !== this.human) {
        const dd = hdist(p.pos, o.pos);
        if (dd < 1.7 && p.tackleCd <= 0 && Math.random() < dt * 1.6 * (t.i === 1 ? this.diff.tackle : 0.8)) this.tryTackle(p);
        else if (dd > 1.8 && dd < 3.2 && p.tackleCd <= 0 && Math.random() < dt * 0.12 * (t.i === 1 ? this.diff.tackle : 0.6)) {
          p.heading = Math.atan2(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
          this.trySlide(p);
        }
      }
      void d;
      return;
    }
    if (oppHas && t.cover === p) {
      const ownGoal = V(-t.side * HALF_L, 0, 0);
      const dir = V().subVectors(ownGoal, b).setY(0);
      const l = dir.length();
      dir.normalize();
      const aim = b.clone().addScaledVector(dir, Math.min(6, l * 0.4));
      aim.lerp(target, 0.3);
      this.seek(p, aim, 6, 0.5);
      this.faceBall(p);
      return;
    }
    if (oppHas && p.mark) {
      // marcaje al hombre asignado: entre el atacante y la portería, del lado del balón
      const m = p.mark;
      const ownGoal = V(-t.side * HALF_L, 0, 0);
      const gs = V().subVectors(ownGoal, m.pos).setY(0).normalize();
      const tb = V().subVectors(b, m.pos).setY(0);
      const dB = tb.length();
      tb.normalize();
      const tight = clamp(1 - (dB - 8) / 20, 0.45, 1); // más pegado cuanto más cerca está del balón
      const mp = m.pos.clone().addScaledVector(gs, 1.5).addScaledVector(tb, 0.9).addScaledVector(m.vel, 0.3);
      target.lerp(mp, tight);
      this.seek(p, target, 5, 0.3, 1.2);
      if (p.desired.lengthSq() < 0.5) this.faceBall(p);
      return;
    }
    if (own && this.owner) {
      target.copy(this.supportSpot(p, target, dt));
      this.seek(p, target, 6, 0.5, 1.8);
      if (p.desired.lengthSq() < 0.5) this.faceBall(p);
      return;
    }
    this.seek(p, target, 9, 0.6, 2.2);
    if (p.desired.lengthSq() < 0.5) this.faceBall(p);
  }

  /**
   * Busca un hueco para recibir: abierto, con línea de pase limpia desde el
   * poseedor, a distancia útil, separado de los compañeros y, si se puede,
   * a la espalda de la defensa para un pase al hueco.
   */
  supportSpot(p, base, dt) {
    p.supportT -= dt;
    if (p.supportT > 0 && p.supportSpot && p.supportOwner === this.owner) return p.supportSpot;
    p.supportT = rnd(0.4, 0.6);
    p.supportOwner = this.owner;
    const t = p.team;
    const s = t.side;
    const c = this.owner;
    const press = this.nearestOpp(c.pos, t).d;
    let lastDef = -HALF_L;
    for (const o of this.opponents(t)) if (!o.isGK) lastDef = Math.max(lastDef, o.pos.x * s);
    const fwdW = { DEF: 0.1, MID: 0.45, FWD: 0.7 }[p.role];
    const xs = p.role === 'DEF' ? [-6, -3, 0, 3] : p.role === 'FWD' ? [-4, 0, 4, 8, 12] : [-5, -2, 1, 4, 7];
    let best = null, bs = -1e9;
    const spot = V();
    for (const dx of xs) {
      for (const dz of [-9, -4.5, 0, 4.5, 9]) {
        spot.set(clamp(base.x + dx * s, -HALF_L + 3, HALF_L - 3), 0, clamp(base.z + dz, -HALF_W + 2, HALF_W - 2));
        const open = Math.min(this.nearestOpp(spot, t).d, 7) / 7;
        const lane = 1 - this.laneRisk(c.pos, spot, t);
        const d = hdist(c.pos, spot);
        let sc = open * 1.0 + lane * 1.3;
        if (d < 7) sc -= (7 - d) / 7 * 0.9;
        if (d > 28) sc -= (d - 28) / 10;
        const prog = (spot.x - c.pos.x) * s;
        sc += prog / 20 * fwdW;
        // a la espalda de la defensa: pase al hueco si el poseedor tiene tiempo
        const ax = spot.x * s;
        if (p.role !== 'DEF' && ax > lastDef + 1 && ax < HALF_L - 4 && press > 3) sc += 0.35;
        // los defensas no se descuelgan por delante del balón
        if (p.role === 'DEF' && ax > c.pos.x * s + 2) sc -= 0.8;
        // separación con los compañeros
        for (const q of t.players) {
          if (q === p || q === c || q.isGK) continue;
          const qp = q.supportSpot && q.supportOwner === c ? q.supportSpot : q.pos;
          const dq = hdist(qp, spot);
          if (dq < 7) sc -= (7 - dq) / 7 * 0.9;
        }
        sc -= hdist(p.pos, spot) / 25 * 0.5;
        sc -= hdist(base, spot) / 14 * 0.35;
        if (sc > bs) { bs = sc; best = spot.clone(); }
      }
    }
    p.supportSpot = best;
    return best;
  }

  faceBall(p) {
    if (p.vel.lengthSq() < 1) {
      const b = this.ball.p;
      p.faceDir = V(b.x - p.pos.x, 0, b.z - p.pos.z).normalize();
    }
  }

  shotQuality(p) {
    const s = p.team.side;
    const gx = s * HALF_L;
    const dx = gx - p.pos.x;
    const dG = Math.hypot(dx, p.pos.z);
    const a1 = Math.atan2(GW2 - p.pos.z, Math.abs(dx));
    const a2 = Math.atan2(-GW2 - p.pos.z, Math.abs(dx));
    const ang = Math.abs(a1 - a2);
    let q = clamp(ang / 0.45, 0, 1) * clamp(1.15 - dG / 28, 0, 1);
    const goalC = V(gx, 0, 0);
    for (const o of this.opponents(p.team)) {
      if (o.isGK) continue;
      const risk = this.laneRisk(p.pos, goalC, p.team);
      q *= 1 - risk * 0.4;
      break;
    }
    const gk = this.opponents(p.team).find((o) => o.isGK);
    if (gk) {
      const gd = hdist(gk.pos, p.pos);
      if (gd < 3) q *= 0.6;
    }
    return q;
  }

  carrierAI(p, dt) {
    const t = p.team;
    const s = t.side;
    if (p.holding) return;
    if (this.state !== 'play') return;
    p.aiT -= dt;
    const goal = V(s * HALF_L, 0, 0);
    if (p.aiT > 0) {
      const sp = (p.sprint ? SPRINT_SPEED * 0.9 : RUN_SPEED * 0.92) * p.speedMul;
      p.desired.copy(p.aiDir).multiplyScalar(sp);
      return;
    }
    p.aiT = 0.16 + this.diff.reaction * (t.i === 1 ? 0.7 : 0.5) + Math.random() * 0.12;

    const dG = hdist(p.pos, goal);
    const press = this.nearestOpp(p.pos, t);
    const q = this.shotQuality(p);
    if (dG < 27 && (q > 0.4 + Math.random() * 0.12 || (dG < 11 && q > 0.18))) {
      const power = clamp(0.5 + dG / 38 + rnd(-0.08, 0.12), 0.45, 0.95);
      this.doShot(p, power, null);
      return;
    }

    // evaluar pases
    let best = null;
    for (const r of t.players) {
      if (r === p) continue;
      const d = hdist(r.pos, p.pos);
      if (d < 4 || d > 42) continue;
      if (r.isGK && press.d > 2.5) continue;
      const risk = this.laneRisk(p.pos, r.pos, t);
      const open = this.nearestOpp(r.pos, t).d;
      const prog = (r.pos.x - p.pos.x) * s;
      let score = 0.35 + prog / 18 + Math.min(open, 7) / 10 - risk * 1.5 - (d > 28 ? 0.25 : 0) - (r.isGK ? 0.7 : 0);
      if (hdist(r.pos, goal) < 18 && open > 3) score += 0.35;
      if (!best || score > best.score) best = { r, score, risk, d, prog };
    }
    const underPressure = press.d < 2.6;
    if (best && ((underPressure && best.score > 0.3) || best.score > 1.05 + Math.random() * 0.35 || (dG > 45 && best.prog > 8 && best.score > 0.6))) {
      const kind = best.risk > 0.45 && best.d > 11 ? 'lob' : 'pass';
      this.doPassTo(p, best.r, kind);
      return;
    }

    // regate hacia portería esquivando rivales
    const dir = V().subVectors(goal, p.pos).setY(0).normalize();
    if (dG < 16) dir.z += -Math.sign(p.pos.z) * 0.4;
    for (const o of this.opponents(t)) {
      const rel = V().subVectors(p.pos, o.pos).setY(0);
      const d = rel.length();
      if (d > 6 || d < 0.01) continue;
      const ahead = -rel.dot(dir) / d;
      if (ahead < -0.3) continue;
      const side = V(-dir.z, 0, dir.x);
      const sgn = Math.sign(rel.dot(side)) || (Math.random() < 0.5 ? 1 : -1);
      dir.addScaledVector(side, sgn * (6 - d) / 6 * 1.4 * (0.5 + ahead));
    }
    if (Math.abs(p.pos.z) > HALF_W - 3) dir.z -= Math.sign(p.pos.z) * 0.8;
    if (Math.abs(p.pos.x) > HALF_L - 3) dir.x -= Math.sign(p.pos.x) * 0.8;
    dir.normalize();
    p.aiDir.copy(dir);
    p.sprint = press.d > 4;
    p.desired.copy(dir).multiplyScalar((p.sprint ? SPRINT_SPEED * 0.9 : RUN_SPEED * 0.92) * p.speedMul);
  }

  // =========================================================================
  // Portero
  // =========================================================================
  gkAI(p, dt) {
    const t = p.team;
    const s = t.side;
    const gx = -s * HALF_L;
    const b = this.ball;
    if (this.state === 'setpiece' && this.taker === p) return;

    if (this.owner === p && p.holding) {
      p.holdT += dt;
      p.faceDir = V(s, 0, 0);
      if (p.anim.action === 'none') p.setAction('hold', 99);
      if (p.holdT > 1.4 && this.state === 'play') this.gkDistribute(p);
      return;
    }
    if (this.owner === p) {
      // balón en los pies fuera del área: jugarlo rápido
      p.holdT += dt;
      if (p.holdT > 0.35 && !p.pending && this.state === 'play') this.gkDistribute(p);
      return;
    }
    if (p.anim.action === 'dive') return;
    p.diveCd -= dt;

    // amenaza: balón viajando hacia la portería
    const toward = b.v.x * -s;
    if (!this.owner && toward > 5 && p.diveCd <= 0 && this.lastTouch && this.lastTouch.team !== t) {
      let cross = null;
      for (const smp of this.pred) {
        if ((smp.x - p.pos.x) * -s >= 0) { cross = smp; break; }
      }
      if (cross && Math.abs(cross.z) < GW2 + 1.6 && cross.y < PITCH.goalH + 0.7) {
        p.reactT += dt;
        if (p.reactT >= this.diff.reaction * 0.8) {
          const lat = cross.z - p.pos.z;
          const lv = V(0, 0, lat);
          if (Math.abs(lat) > 0.85 || cross.y > 1.9) {
            const side = Math.sign(lv.dot(p.left)) || 1;
            const tt = Math.max(0.22, cross.t);
            const reach = 6.2 * this.diff.gkReach * (t.i === 0 ? 1 : 1);
            const vz = clamp(lat / tt, -reach, reach);
            p.setAction('dive', 1.25, side, clamp(cross.y / 2.2, 0, 1));
            p.vel.set(0, 0, vz);
            p.lock = 1.15;
            p.diveCd = 1.6;
            p.diving = true;
            p.diveVy = 0;
          } else {
            this.seek(p, V(p.pos.x, 0, cross.z), 1, 0.05, 0.3);
            p.setAction('catch', 0.5, 1, clamp(cross.y / 2.2, 0, 1));
          }
          p.reactT = 0;
          return;
        }
      }
    } else {
      p.reactT = 0;
    }

    // salir a por balones sueltos en el área
    if (!this.owner && t.chaser === p) {
      const ix = p.intercept;
      this.seek(p, V(ix.x, 0, ix.z), 2, 0.1, 0.5);
      return;
    }
    // posición: sobre la bisectriz balón-portería
    const goalC = V(gx, 0, 0);
    const toB = V().subVectors(b.p, goalC).setY(0);
    const dist = toB.length();
    toB.normalize();
    const adv = clamp(dist * 0.12, 0.6, 3.2);
    const target = goalC.clone().addScaledVector(toB, adv);
    target.z = clamp(target.z, -GW2 + 0.3, GW2 - 0.3);
    if (Math.abs(b.p.x - gx) > HALF_L) target.x = gx + s * 4;
    this.seek(p, target, 5, 0.12, 0.8);
    p.faceDir = V(b.p.x - p.pos.x, 0, b.p.z - p.pos.z).normalize();
  }

  gkDistribute(p) {
    const t = p.team;
    let best = null;
    for (const r of t.players) {
      if (r === p) continue;
      const open = this.nearestOpp(r.pos, t).d;
      const d = hdist(r.pos, p.pos);
      const score = Math.min(open, 8) / 8 + (r.role === 'DEF' ? 0.3 : 0) - this.laneRisk(p.pos, r.pos, t) - d / 80;
      if (!best || score > best.score) best = { r, score, d };
    }
    p.holding = false;
    this.owner = p;
    const kind = best.d > 22 || best.score < 0.5 ? 'lob' : 'pass';
    this.doPassTo(p, best.r, kind);
  }

  /** Paradas: se comprueba en cada subpaso de física */
  keeperHands() {
    const b = this.ball;
    if (this.owner) return;
    for (const t of this.teams) {
      const gk = t.gk;
      if (gk.touchCd > 0 || this.state !== 'play') continue;
      const s = t.side;
      const inBox = (b.p.x * -s) > HALF_L - PITCH.boxD && Math.abs(b.p.z) < PITCH.boxW / 2 && Math.abs(b.p.x) < HALF_L + 0.2;
      if (!inBox) continue;
      const a = gk.anim;
      let c, r;
      if (a.action === 'dive') {
        const k = a.t / a.dur;
        const lift = 0.35 + (a.variant || 0.5) * 1.1;
        const dir = gk.left.multiplyScalar(a.side);
        c = gk.pos.clone().addScaledVector(dir, 0.75).setY(lift * (k < 0.7 ? 1 : 0.3));
        r = 0.85 * this.diff.gkReach * (t.i === 1 ? 1 : 0.95);
      } else {
        c = gk.pos.clone().setY(clamp(b.p.y, 0.3, 2.1));
        r = a.action === 'catch' ? 0.8 : 0.55;
      }
      if (b.p.distanceTo(c) > r + 0.11) continue;
      const speed = b.speed;
      const shotFromOpp = this.lastTouch && this.lastTouch.team !== t;
      const catchable = speed < 15 + (a.action === 'dive' ? 0 : 6) && Math.random() < 0.85;
      if (catchable || !shotFromOpp) {
        this.owner = gk;
        gk.holding = true;
        gk.holdT = 0;
        b.v.set(0, 0, 0);
        b.w.multiplyScalar(0.1);
        this.lastTouch = gk;
        this.receiver = null;
        if (a.action !== 'dive') gk.setAction('hold', 99);
        this.audio.touch();
        if (shotFromOpp && speed > 10) { this.hud.flash('¡PARADÓN!'); this.audio.ooh(); }
      } else {
        // despeje con las manos
        const out = -s;
        const vz = (Math.sign(b.p.z - gk.pos.z) || 1) * rnd(3, 7);
        b.v.set(-out * Math.abs(b.v.x) * rnd(0.2, 0.4), rnd(2, 5), b.v.z * 0.3 + vz);
        b.w.set(rnd(-10, 10), rnd(-10, 10), rnd(-10, 10));
        gk.touchCd = 0.6;
        this.lastTouch = gk;
        this.receiver = null;
        this.audio.kick(0.4);
        this.audio.ooh();
        this.hud.flash('¡QUÉ PARADA!');
        this.camRig.shake(0.15);
      }
      return;
    }
  }

  // =========================================================================
  // Acciones: pase, tiro, entradas
  // =========================================================================
  pickReceiver(p, dir) {
    let best = null, bs = -1e9;
    for (const r of p.team.players) {
      if (r === p) continue;
      const to = V().subVectors(r.pos, p.pos).setY(0);
      const d = to.length();
      if (d < 2.5 || d > 50) continue;
      const cos = to.dot(dir) / d;
      if (cos < 0.45) continue;
      if (r.isGK && cos < 0.85) continue;
      const open = this.nearestOpp(r.pos, p.team).d;
      const score = cos * 2.2 - d / 38 + Math.min(open, 8) / 18 - this.laneRisk(p.pos, r.pos, p.team) * 0.6;
      if (score > bs) { bs = score; best = r; }
    }
    return best;
  }

  footSide(p) {
    const rel = V().subVectors(this.ball.p, p.pos);
    return rel.dot(p.left) > 0.05 ? -1 : 1;
  }

  doPass(p, dir, kind, firstTime = false) {
    const r = this.pickReceiver(p, dir);
    if (r) { this.doPassTo(p, r, kind, firstTime); return; }
    const target = p.pos.clone().addScaledVector(dir, kind === 'lob' ? 22 : 13);
    target.x = clamp(target.x, -HALF_L + 1, HALF_L - 1);
    target.z = clamp(target.z, -HALF_W + 1, HALF_W - 1);
    this.startKick(p, { type: kind, target, recv: null, firstTime });
  }

  doPassTo(p, r, kind, firstTime = false) {
    const d = hdist(p.pos, r.pos);
    const lead = kind === 'lob' ? d / 15 : d / 17;
    const target = r.pos.clone().addScaledVector(r.vel, lead);
    if (kind === 'lob' && !r.isGK) {
      // pase al hueco: un poco por delante en dirección de ataque
      target.x += r.team.side * Math.min(4, d * 0.12);
    }
    target.x = clamp(target.x, -HALF_L + 1, HALF_L - 1);
    target.z = clamp(target.z, -HALF_W + 1, HALF_W - 1);
    this.startKick(p, { type: kind, target, recv: r, firstTime });
  }

  doShot(p, power, aim, firstTime = false) {
    this.startKick(p, { type: 'shot', power, aim, firstTime });
  }

  startKick(p, k) {
    if (p.pending || p.acting) return;
    const shot = k.type === 'shot';
    const dur = shot ? 0.46 : 0.36;
    const contact = shot ? 0.16 : 0.12;
    const b = this.ball;
    const heading = b.p.y > 1.25 && hdist(b.p, p.pos) < 1.6;
    if (heading) {
      p.setAction('header', 0.55, 1, 1);
      k.header = true;
      p.pending = { ...k, t: 0.14 };
      p.lock = 0.3;
    } else {
      p.setAction('kick', dur, this.footSide(p), shot ? 0.6 + k.power * 0.4 : (k.type === 'lob' ? 0.8 : 0.55));
      p.pending = { ...k, t: contact };
      p.lock = contact + 0.06;
    }
    // girar hacia el objetivo
    let aimPt = k.target;
    if (shot) aimPt = V(p.team.side * HALF_L, 0, 0);
    if (aimPt) p.faceDir = V(aimPt.x - p.pos.x, 0, aimPt.z - p.pos.z).normalize();
  }

  executeKick(p, k) {
    const b = this.ball;
    const foot = p.pos.clone().addScaledVector(p.fwd, 0.4);
    const dh = Math.hypot(b.p.x - foot.x, b.p.z - foot.z);
    const header = k.header;
    const ok = k.type === 'throw' || (header ? (dh < 1.3 && b.p.y > 0.9 && b.p.y < 2.8) : (dh < 1.3 && b.p.y < 1.35));
    if (!ok || (this.owner && this.owner !== p)) { p.faceDir = null; return; }
    const from = b.p.clone();
    if (from.y < BALL_R) from.y = BALL_R;
    const team = p.team;
    const isHuman = team.i === 0;
    let v, w = V();
    const err = (isHuman ? 0.025 : this.diff.passErr) * (k.firstTime ? 1.6 : 1);
    let power = 0.5;

    if (k.type === 'shot') {
      const s = team.side;
      const gx = s * HALF_L;
      const gk = this.opponents(team).find((o) => o.isGK);
      let zt;
      if (k.aim != null) zt = clamp(k.aim, -1, 1) * (GW2 - 0.4);
      else {
        const gz = gk ? gk.pos.z : 0;
        const side = (GW2 - gz) > (gz + GW2) ? 1 : -1;
        zt = side * (GW2 - 0.55) * rnd(0.7, 1);
      }
      power = k.power;
      const d = Math.hypot(gx - from.x, zt - from.z);
      let ty = 0.25 + power * power * 1.7;
      if (header) ty = rnd(0.2, 1.2);
      const pressure = this.nearestOpp(p.pos, team).d < 1.8 ? 1.35 : 1;
      let e = (isHuman ? 0.32 : 0.42 * this.diff.shotErr) * (1 + d / 24) * pressure * (k.firstTime ? 1.3 : 1);
      if (power > 0.88) e *= 1 + (power - 0.88) * 9;
      zt += gauss() * e;
      ty += Math.abs(gauss()) * e * 0.55 + (power > 0.9 ? (power - 0.9) * rnd(0, 7) : 0);
      ty = Math.max(0.15, ty);
      let speed = header ? 11 + power * 6 : 14 + power * 18;
      if (k.firstTime) speed *= 0.92;
      const target = V(gx, ty, zt);
      const f = V(gx - from.x, 0, zt - from.z).normalize();
      const left = V(f.z, 0, -f.x);
      if (!header) {
        const finesse = !p.sprint && power < 0.86 && d > 10 && Math.abs(zt) > 0.8;
        if (finesse) {
          const bend = V(0, 0, -Math.sign(zt));
          w.y = Math.sign(bend.dot(left)) * (16 + 16 * (1 - power));
        } else {
          w.addScaledVector(left, power * 22); // efecto liftado: el balón cae
          w.y += rnd(-3, 3);
        }
      }
      v = solveLaunch(from, target, speed, w, header ? 0.5 : 0.6);
      this.lastKick = { type: 'shot', team, time: this.time, power };
    } else if (k.type === 'lob') {
      const d = hdist(from, k.target);
      const ang = header ? 0.5 : d < 16 ? 0.78 : d < 30 ? 0.62 : 0.52;
      const sol = solveLob(from, k.target, ang, header ? 4 : 11, BALL_R);
      v = sol.v; w = sol.w;
      if (v.length() > 31) v.setLength(31);
      power = 0.6;
      this.lastKick = { type: 'lob', team, time: this.time };
    } else if (k.type === 'throw') {
      const sol = solveLob(from, k.target, 0.42, 0, 0.35);
      v = sol.v; w.set(0, 0, 0);
      if (v.length() > 16) v.setLength(16);
      power = 0.2;
      this.lastKick = { type: 'throw', team, time: this.time };
    } else {
      // pase raso (o volea/cabezazo de pase si el balón está alto)
      const d = hdist(from, k.target);
      if (from.y > 0.45) {
        const sp = clamp(d * 0.9 + 5, 8, 22);
        v = solveLaunch(from, V(k.target.x, 0.4, k.target.z), sp, w, 0.9);
      } else {
        const sol = solveGroundPass(from, k.target, clamp(4.5 + d * 0.1, 5, 9.5), 29);
        v = sol.v; w = sol.w;
      }
      power = clamp(v.length() / 30, 0.2, 0.7);
      this.lastKick = { type: 'pass', team, time: this.time };
    }
    // imprecisión
    const yaw = gauss() * err;
    v.applyAxisAngle(V(0, 1, 0), yaw);
    v.multiplyScalar(1 + gauss() * err * 0.35);

    b.v.copy(v);
    b.w.copy(w);
    if (this.owner === p) {
      this.owner = null;
      p.holding = false;
    }
    p.touchCd = 0.32;
    this.lastTouch = p;
    this.receiver = k.recv || null;
    this.receiverUntil = this.time + 3.5;
    if (k.recv && k.recv.team === this.teams[0] && k.type !== 'shot') this.setHuman(k.recv);
    if (this.state === 'kickoff' || this.state === 'setpiece') {
      this.state = 'play';
      this.stateT = 0;
      this.hud.hint('');
      if (this.taker) this.taker.setAction('none', 0);
      this.taker = null;
    }

    // efectos
    this.audio.kick(power);
    const dir = V(v.x, 0, v.z).normalize();
    if (!header && from.y < 0.5) this.fx.grass(from, dir, 6 + Math.round(power * 16), 0.5 + power);
    if (k.type === 'shot' && power > 0.72 && !header) {
      this.waves.spawn(from, '#ffffff', 2 + power * 2);
      this.camRig.shake(0.05 + power * 0.08);
    }
    p.faceDir = null;
  }

  tryTackle(p) {
    if (p.tackleCd > 0 || p.acting) return;
    p.setAction('tackle', 0.42, this.footSide(p));
    p.tackleCd = 0.9;
    p.lock = 0.3;
    p.pending = { type: 'tackle', t: 0.13 };
    if (this.owner) p.faceDir = V(this.ball.p.x - p.pos.x, 0, this.ball.p.z - p.pos.z).normalize();
  }

  executeTackle(p) {
    const b = this.ball;
    const foot = p.pos.clone().addScaledVector(p.fwd, 0.8);
    const d = Math.hypot(b.p.x - foot.x, b.p.z - foot.z);
    p.faceDir = null;
    if (d > 1.0 || b.p.y > 0.6) { p.stun = 0.35; return; }
    const o = this.owner;
    if (o && o.team === p.team) return;
    let chance = 1;
    if (o) {
      const fromBehind = o.fwd.dot(V().subVectors(p.pos, o.pos).setY(0).normalize()) < -0.3;
      chance = (p.team.i === 1 ? 0.55 * this.diff.tackle : 0.68) * (fromBehind ? 0.55 : 1) * (o.sprint ? 0.85 : 1);
    }
    if (Math.random() < chance) {
      if (o) { o.touchCd = 0.55; o.stun = 0.3; }
      this.owner = null;
      const dir = p.fwd;
      b.v.set(dir.x * rnd(2.5, 5) + rnd(-1.5, 1.5), 0.3, dir.z * rnd(2.5, 5) + rnd(-1.5, 1.5));
      this.lastTouch = p;
      this.receiver = null;
      p.touchCd = 0.08;
      this.audio.kick(0.25);
      this.fx.grass(b.p, dir, 6, 0.6);
    } else {
      p.stun = 0.5;
    }
  }

  trySlide(p) {
    if (p.tackleCd > 0 || p.acting) return;
    const dir = p.fwd;
    p.setAction('slide', 1.0, this.footSide(p));
    p.lock = 0.95;
    p.tackleCd = 1.6;
    const sp = Math.max(Math.hypot(p.vel.x, p.vel.z), 5.5) + 1.2;
    p.vel.set(dir.x * sp, 0, dir.z * sp);
    p.slideHit = false;
    this.fx.grass(p.pos, dir, 10, 0.8);
  }

  slideContact(p) {
    const a = p.anim;
    if (a.action !== 'slide' || a.t > 0.65 || p.slideHit) return;
    const b = this.ball;
    const foot = p.pos.clone().addScaledVector(p.fwd, 0.95);
    const d = Math.hypot(b.p.x - foot.x, b.p.z - foot.z);
    if (d < 0.8 && b.p.y < 0.6) {
      p.slideHit = true;
      const o = this.owner;
      if (o && o !== p) { o.touchCd = 0.7; if (o.team !== p.team) { o.setAction('fall', 1.5); o.lock = 1.4; } }
      this.owner = null;
      const dir = p.fwd;
      b.v.set(dir.x * rnd(5, 9), rnd(0.5, 2), dir.z * rnd(5, 9));
      this.lastTouch = p;
      this.receiver = null;
      this.audio.kick(0.5);
      this.fx.grass(b.p, dir, 14, 1);
      return;
    }
    // derribo sin tocar balón
    for (const o of this.opponents(p.team)) {
      if (o.acting) continue;
      if (hdist(o.pos, foot) < 0.7) {
        o.setAction('fall', 1.5);
        o.lock = 1.4;
        o.vel.multiplyScalar(0.4);
        if (this.owner === o) { this.owner = null; o.touchCd = 1; }
        p.slideHit = true;
        this.hud.flash('¡Entrada!');
      }
    }
  }

  // =========================================================================
  // Movimiento
  // =========================================================================
  movePlayer(p, dt) {
    p.touchCd = Math.max(0, p.touchCd - dt);
    p.tackleCd = Math.max(0, p.tackleCd - dt);
    p.stun = Math.max(0, p.stun - dt);
    const a = p.anim;
    a.t += dt;
    if (a.action !== 'none' && a.t >= a.dur) {
      if (a.action === 'dive') p.diving = false;
      a.action = 'none';
    }
    if (p.lock > 0) {
      p.lock -= dt;
      switch (a.action) {
        case 'slide': p.vel.multiplyScalar(Math.exp(-2.4 * dt)); this.slideContact(p); break;
        case 'dive': {
          if (a.t > 0.62) p.vel.multiplyScalar(Math.exp(-8 * dt));
          break;
        }
        case 'fall': p.vel.multiplyScalar(Math.exp(-5 * dt)); break;
        case 'celebrate': p.vel.multiplyScalar(Math.exp(-1.6 * dt)); break;
        default: p.vel.multiplyScalar(Math.exp(-7 * dt));
      }
    } else {
      let des = p.desired;
      if (p.stun > 0) des = des.clone().multiplyScalar(0.35);
      const acc = (this.owner === p ? 13 : 17) * (p.sprint ? 0.9 : 1);
      const dv = V().subVectors(des, p.vel).setY(0);
      const l = dv.length();
      const maxDv = acc * dt;
      if (l > maxDv) dv.multiplyScalar(maxDv / l);
      p.vel.add(dv);
    }
    p.pos.addScaledVector(p.vel, dt);
    p.pos.x = clamp(p.pos.x, -HALF_L - 4, HALF_L + 4);
    p.pos.z = clamp(p.pos.z, -HALF_W - 3.5, HALF_W + 3.5);
    if (this.state === 'play' && !p.isGK) {
      // nadie se mete dentro de la portería
      if (Math.abs(p.pos.x) > HALF_L && Math.abs(p.pos.z) < GW2 + 0.3) p.pos.x = Math.sign(p.pos.x) * HALF_L;
    }

    // orientación
    const sp = Math.hypot(p.vel.x, p.vel.z);
    let targetH = p.heading;
    if (p.faceDir && (a.action === 'kick' || a.action === 'header' || a.action === 'tackle' || sp < 1.5 || p.pending)) targetH = Math.atan2(p.faceDir.x, p.faceDir.z);
    else if (sp > 0.35 && a.action !== 'dive' && a.action !== 'slide' && a.action !== 'fall') targetH = Math.atan2(p.vel.x, p.vel.z);
    if (sp > 0.35 && p.faceDir && !p.pending && a.action === 'none') p.faceDir = null;
    const diff = wrapAngle(targetH - p.heading);
    const rate = (a.action === 'kick' || a.action === 'header' ? 18 : 11) * dt;
    const turn = clamp(diff, -rate, rate);
    p.heading = wrapAngle(p.heading + turn);
    const leanT = clamp(-(turn / Math.max(dt, 1e-4)) * sp * 0.012, -0.35, 0.35);
    p.leanS += (leanT - p.leanS) * Math.min(1, dt * 8);
    a.lean = p.leanS;
    a.speed = a.action === 'dive' ? 0 : sp;
    advancePhase(a, dt);
  }

  separate() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.62 * 0.62 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (0.62 - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push; a.pos.z -= nz * push;
          b.pos.x += nx * push; b.pos.z += nz * push;
        }
      }
    }
  }

  // =========================================================================
  // Balón: conducción, control, colisiones
  // =========================================================================
  dribble(dt) {
    const p = this.owner;
    const b = this.ball;
    if (!p) return;
    if (p.holding) {
      const hand = p.pos.clone().addScaledVector(p.fwd, 0.32);
      hand.y = p.anim.action === 'throw' ? 2.18 : 1.02;
      if (p.anim.action === 'dive') hand.copy(p.pos).addScaledVector(p.left, 0.8 * p.anim.side).setY(0.5);
      b.p.copy(hand);
      b.v.copy(p.vel);
      b.w.multiplyScalar(0.9);
      return;
    }
    const fwd = p.fwd;
    const spd = Math.hypot(p.vel.x, p.vel.z);
    const target = p.pos.clone().addScaledVector(fwd, 0.4 + spd * 0.07);
    if (p.pending) {
      // preparar el golpeo: el balón se queda junto al pie
      const k = 1 - Math.exp(-10 * dt);
      b.v.x += (p.vel.x + (target.x - b.p.x) * 4 - b.v.x) * k;
      b.v.z += (p.vel.z + (target.z - b.p.z) * 4 - b.v.z) * k;
      return;
    }
    if (p.lock > 0) return;
    if (this.state === 'setpiece') return;
    p.dribbleT -= dt;
    if (b.p.y > 0.35) return; // esperar a que baje
    const dBall = Math.hypot(b.p.x - p.pos.x, b.p.z - p.pos.z);
    if (dBall > 1.25) return; // fuera de alcance: hay que llegar a él
    // dirección deseada: la del jugador (o la de su intención si está girando)
    const dir = p.desired.lengthSq() > 1 ? V(p.desired.x, 0, p.desired.z).normalize() : fwd;
    const toBall = V(b.p.x - p.pos.x, 0, b.p.z - p.pos.z);
    const along = toBall.dot(dir);
    const lead = 0.42 + spd * 0.06;
    const tgt = p.pos.clone().addScaledVector(dir, lead);
    const off = Math.hypot(tgt.x - b.p.x, tgt.z - b.p.z);
    const turning = dir.dot(fwd) < 0.7;
    if (p.dribbleT > 0 && off < 0.55 && along > 0.2 && !turning) return;
    if (dir.dot(fwd) < 0.2 && spd > 1.5) {
      // giro brusco: frenar el balón con la suela y arrastrarlo hacia el nuevo rumbo
      b.v.x = p.vel.x + dir.x * 2.2;
      b.v.z = p.vel.z + dir.z * 2.2;
      p.dribbleT = 0.1;
      return;
    }
    if (spd < 0.9 && p.desired.lengthSq() < 1) {
      // parado: acomodar el balón junto al pie
      b.v.x = (tgt.x - b.p.x) * 5; b.v.z = (tgt.z - b.p.z) * 5;
      p.dribbleT = 0.08;
      return;
    }
    // toque: el balón debe llegar a la posición adelantada dentro de T segundos
    // teniendo en cuenta la deceleración del césped
    const T = p.sprint ? 0.36 : 0.27;
    const pv = p.desired.lengthSq() > 1 ? V(p.desired.x, 0, p.desired.z).multiplyScalar(0.85).add(p.vel.clone().multiplyScalar(0.15)) : p.vel.clone();
    const dx = p.pos.x + pv.x * T + dir.x * lead - b.p.x;
    const dz = p.pos.z + pv.z * T + dir.z * lead - b.p.z;
    const disp = Math.hypot(dx, dz);
    if (disp > 1e-3) {
      let u = disp / T;
      const dec = 0.75 + 0.1 * u;
      u = (disp + 0.5 * dec * T * T) / T;
      u = Math.min(u, 13);
      b.v.x = dx / disp * u; b.v.z = dz / disp * u; b.v.y = 0;
    }
    p.dribbleT = T;
    if (p === this.human) this.audio.touch();
    if (Math.random() < 0.25) this.fx.dust(b.p, 2);
  }

  control() {
    const b = this.ball;
    if (this.state === 'goal' || this.state === 'end' || this.state === 'dead') {
      if (this.owner && !this.owner.holding) this.owner = null;
      return;
    }
    if (this.owner) {
      const o = this.owner;
      if (o.holding) return;
      const d = hdist(o.pos, b.p);
      if (d > 2.0 || b.p.y > 1.5 || o.anim.action === 'fall') { this.owner = null; }
      else if (!o.pending && this.state === 'play') {
        // disputa: un rival que llega al balón entre toques se lo lleva
        for (const q of this.opponents(o.team)) {
          if (q.touchCd > 0 || q.acting) continue;
          const dq = hdist(q.pos, b.p);
          if (dq < 0.55 && d > 0.6 && b.p.y < 0.5) {
            o.touchCd = 0.4;
            this.gain(q);
            return;
          }
        }
      }
      if (this.owner) return;
    }
    // balón suelto: ¿quién lo controla?
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.touchCd > 0 || (p.acting && p.anim.action !== 'tackle')) continue;
      if (p.pending) continue;
      const d = hdist(p.pos, b.p);
      const rel = V().subVectors(b.v, p.vel).length();
      const recv = this.receiver === p;
      const reach = recv ? 0.85 : 0.7;
      const chestY = recv || p === this.human ? 1.9 : 1.45;
      if (b.p.y > chestY && b.p.y < 2.7 && d < 0.8 && !p.isGK) {
        const attackHead = hdist(p.pos, V(p.team.side * HALF_L, 0, 0)) < 16;
        // el receptor deja caer el balón para controlarlo con el pecho
        if (!(recv && b.v.y < 0 && !attackHead)) {
          this.autoHeader(p);
          return;
        }
      }
      if (d > reach || b.p.y > chestY) continue;
      const limit = recv ? 22 : 14;
      if (rel > limit) continue;
      if (d < bd) { bd = d; best = p; }
    }
    if (best) this.gain(best, true);
  }

  gain(p, firstTouch = false) {
    const b = this.ball;
    const prevTeam = this.owner ? this.owner.team : this.lastTouch ? this.lastTouch.team : null;
    this.owner = p;
    this.lastTouch = p;
    if (this.receiver !== p) this.receiver = null;
    this.receiver = null;
    p.dribbleT = 0.12;
    p.holdT = 0;
    if (firstTouch) {
      const rel = V().subVectors(b.v, p.vel);
      const q = clamp(1 - rel.length() / 26, 0.35, 1);
      const fwd = p.fwd;
      b.v.set(
        p.vel.x * 0.95 + fwd.x * 0.6 + rel.x * (1 - q) * 0.25,
        Math.min(b.v.y, 0) * 0.2,
        p.vel.z * 0.95 + fwd.z * 0.6 + rel.z * (1 - q) * 0.25
      );
      b.w.multiplyScalar(0.15);
      if (rel.length() > 6) { this.audio.touch(); this.fx.dust(b.p, 4); }
    }
    // el equipo humano siempre controla al poseedor
    if (p.team.i === 0 && !p.isGK) this.setHuman(p);
    else if (prevTeam && prevTeam.i === 0) {
      // perdida: pasar al defensor más útil si el actual está lejos
      const h = this.human;
      if (hdist(h.pos, p.pos) > 14) this.switchPlayer();
    }
    // acción memorizada (primer toque)
    if (p === this.human && this.buffer && this.time < this.buffer.until) {
      const bf = this.buffer;
      this.buffer = null;
      if (bf.type === 'shot') this.doShot(p, bf.power, bf.aim, true);
      else this.doPass(p, bf.dir, bf.type, true);
    }
    this.buffer = null;
  }

  autoHeader(p) {
    const t = p.team;
    const s = t.side;
    const b = this.ball;
    const goal = V(s * HALF_L, 0, 0);
    const dG = hdist(p.pos, goal);
    p.setAction('header', 0.55, 1, 1);
    p.touchCd = 0.4;
    this.lastTouch = p;
    this.receiver = null;
    const from = b.p.clone();
    let v;
    if (dG < 15 && (p.pos.x * s) > 0) {
      const zt = rnd(-GW2 + 0.5, GW2 - 0.5);
      const e = 0.5 * (t.i === 1 ? this.diff.shotErr : 0.9);
      v = solveLaunch(from, V(goal.x, rnd(0.2, 1.4), zt + gauss() * e), rnd(12, 17), V(), 0.4);
      this.lastKick = { type: 'shot', team: t, time: this.time, power: 0.6 };
    } else if ((p.pos.x * s) < -HALF_L * 0.3) {
      // despeje
      const target = V(p.pos.x + s * 22, 0, p.pos.z * 0.5 + rnd(-8, 8));
      v = solveLob(from, target, 0.7, 4).v;
      if (v.length() > 20) v.setLength(20);
    } else {
      const r = this.pickReceiver(p, V(s, 0, 0)) || this.pickReceiver(p, p.fwd);
      const target = r ? r.pos : V(p.pos.x + s * 10, 0, p.pos.z);
      v = solveLob(from, target, 0.45, 3).v;
      if (v.length() > 16) v.setLength(16);
      if (r) { this.receiver = r; this.receiverUntil = this.time + 3; if (t.i === 0) this.setHuman(r); }
    }
    b.v.copy(v);
    b.w.set(0, 0, 0);
    this.audio.kick(0.35);
  }

  bodyCollisions() {
    const b = this.ball;
    if (b.p.y > 1.95) return;
    for (const p of this.players) {
      if (p === this.owner || p.pending) continue;
      if (p.anim.action === 'dive' && p.isGK) continue;
      const dx = b.p.x - p.pos.x, dz = b.p.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const R = p.anim.action === 'slide' || p.anim.action === 'fall' ? 0 : 0.26;
      if (R === 0 || d > R + BALL_R || d < 1e-4) continue;
      const canControl = p.touchCd <= 0 && b.p.y < 1.45 && V().subVectors(b.v, p.vel).length() < 14 && !p.acting;
      if (canControl) continue;
      if (this.lastTouch === p && p.touchCd > 0.15) continue; // recién golpeado por él
      const nx = dx / d, nz = dz / d;
      const rvx = b.v.x - p.vel.x, rvz = b.v.z - p.vel.z;
      const vn = rvx * nx + rvz * nz;
      if (vn >= 0) continue;
      b.p.x = p.pos.x + nx * (R + BALL_R);
      b.p.z = p.pos.z + nz * (R + BALL_R);
      b.v.x -= nx * vn * 1.4;
      b.v.z -= nz * vn * 1.4;
      b.v.multiplyScalar(0.7);
      b.w.multiplyScalar(0.5);
      if (Math.abs(vn) > 6) { this.audio.kick(0.2); this.lastTouch = p; }
      this.receiver = null;
    }
  }

  handleBallEvents() {
    const e = this.ball.takeEvents();
    if (e.bounce && e.bounce > 1.5) {
      this.audio.bounce(e.bounce);
      if (e.bounce > 4) this.fx.dust(this.ball.p, Math.round(e.bounce));
    }
    if (e.post) {
      this.audio.post(e.post);
      this.camRig.shake(0.1 + Math.min(0.3, e.post * 0.01));
      if (e.post > 8 && this.state === 'play') { this.audio.ooh(); this.hud.flash('¡AL PALO!'); this.excite = 0.9; }
    }
    if (e.net) {
      this.stadium.hitNet(e.net.plane, e.net.point, e.net.strength);
      this.audio.net(e.net.strength);
    }
    if (e.board && e.board > 3) this.audio.bounce(e.board * 0.6);
  }

  // =========================================================================
  // Reglas y reanudaciones
  // =========================================================================
  checkRules() {
    const b = this.ball.p;
    if (Math.abs(b.x) > HALF_L + BALL_R) {
      const sgn = Math.sign(b.x);
      if (Math.abs(b.z) < GW2 && b.y < PITCH.goalH) {
        this.onGoal(this.teams.find((t) => t.side === sgn));
        return;
      }
      const defending = this.teams.find((t) => t.side === -sgn);
      const attacking = this.teams[1 - defending.i];
      if (this.lastKick && this.lastKick.type === 'shot' && this.time - this.lastKick.time < 3 && Math.abs(b.z) < GW2 + 3.5) {
        this.audio.ooh();
        this.hud.flash('¡Uyyy!');
      }
      if (this.lastTouch && this.lastTouch.team === defending) {
        const spot = V(sgn * (HALF_L - 0.4), 0, Math.sign(b.z || 1) * (HALF_W - 0.4));
        this.startDead('corner', attacking, spot, 'CÓRNER');
      } else {
        const spot = V(sgn * (HALF_L - PITCH.smallD), 0, Math.sign(b.z || 1) * 3);
        this.startDead('goalkick', defending, spot, 'SAQUE DE PUERTA');
      }
      return;
    }
    if (Math.abs(b.z) > HALF_W + BALL_R) {
      const team = this.lastTouch ? this.teams[1 - this.lastTouch.team.i] : this.teams[0];
      const spot = V(clamp(b.x, -HALF_L + 1, HALF_L - 1), 0, Math.sign(b.z) * (HALF_W + 0.25));
      this.startDead('throw', team, spot, 'SAQUE DE BANDA');
    }
  }

  startDead(kind, team, spot, msg) {
    this.state = 'dead';
    this.stateT = 0;
    this.restart = { kind, team, spot };
    if (this.owner && this.owner.holding) this.owner.holding = false;
    this.owner = null;
    this.receiver = null;
    this.buffer = null;
    this.charging = false; this.charge = 0;
    this.audio.whistle([0.22]);
    this.hud.message(msg, team.kit.name, team.kit.shirt);
  }

  setupRestart() {
    const r = this.restart;
    const b = this.ball;
    b.reset(r.spot.x, r.spot.z);
    this.trail.reset();
    const t = r.team;
    let taker;
    if (r.kind === 'goalkick') taker = t.gk;
    else {
      taker = null;
      let bd = 1e9;
      for (const p of t.players) {
        if (p.isGK) continue;
        const d = hdist(p.pos, r.spot);
        if (d < bd) { bd = d; taker = p; }
      }
    }
    const into = V(-Math.sign(r.spot.x) * (r.kind === 'throw' ? 0 : 1), 0, r.kind === 'throw' ? -Math.sign(r.spot.z) : -Math.sign(r.spot.z) * 0.6).normalize();
    if (r.kind === 'goalkick') into.set(t.side, 0, 0);
    r.into = into;
    const stand = r.spot.clone().addScaledVector(into, r.kind === 'throw' ? 0.05 : -0.55);
    if (hdist(taker.pos, stand) > 14) taker.pos.copy(stand).addScaledVector(into, -5);
    r.stand = stand;
    this.taker = taker;
    this.state = 'setpiece';
    this.stateT = 0;
    r.ready = false;
    r.readyT = 0;
    if (t.i === 0 && !taker.isGK) this.setHuman(taker);
    else if (t.i === 1) {
      // el humano defiende con el jugador más cercano
      let best = null, bd = 1e9;
      for (const p of this.teams[0].players) { if (p.isGK) continue; const d = hdist(p.pos, r.spot); if (d < bd) { bd = d; best = p; } }
      this.setHuman(best);
    }
  }

  setpieceUpdate(dt, input) {
    const r = this.restart;
    const p = this.taker;
    if (!p) return;
    const b = this.ball;
    if (!r.ready) {
      const d = this.seek(p, r.stand, 3, 0.15, 0.6);
      p.faceDir = r.into.clone();
      if (d < 0.2 || this.stateT > 6) {
        p.pos.copy(r.stand);
        p.vel.set(0, 0, 0);
        p.heading = Math.atan2(r.into.x, r.into.z);
        r.ready = true;
        r.readyT = 0;
        this.owner = p;
        if (r.kind === 'throw') { p.holding = true; p.setAction('throw', 99, 1, 0); }
        if (r.kind === 'goalkick') b.reset(r.spot.x, r.spot.z);
        if (p.team.i === 0 && !p.isGK) this.hud.hint(r.kind === 'throw' ? 'J saque corto · L saque largo' : r.kind === 'corner' ? 'L centro al área · J pase corto · K disparo' : '');
      }
      return;
    }
    r.readyT += dt;
    p.desired.set(0, 0, 0);
    if (p.pending) return;
    if (r.kind !== 'throw') {
      const spot = r.spot;
      b.p.set(spot.x, BALL_R, spot.z);
      b.v.set(0, 0, 0);
    }
    const human = p.team.i === 0 && !p.isGK && !this.demo;
    if (human) {
      const m = input.move;
      const mag = Math.hypot(m.x, m.z);
      const dir = mag > 0.2 ? V(m.x, 0, m.z).normalize() : r.into.clone();
      if (mag > 0.2) p.faceDir = dir.clone();
      if (input.pressed('pass')) this.restartKick(p, dir, 'pass');
      else if (input.pressed('lob')) this.restartKick(p, dir, 'lob');
      else if (input.pressed('shoot') && r.kind !== 'throw') this.restartKick(p, dir, 'shot');
    } else if (r.readyT > 1.1) {
      if (r.kind === 'corner') {
        const cands = p.team.players.filter((q) => q !== p && !q.isGK);
        cands.sort((a, c) => hdist(a.pos, V(p.team.side * (HALF_L - 8), 0, 0)) - hdist(c.pos, V(p.team.side * (HALF_L - 8), 0, 0)));
        const tgt = cands[0];
        this.restartKick(p, V().subVectors(tgt.pos, p.pos).setY(0).normalize(), 'lob', tgt);
      } else {
        let best = null;
        for (const q of p.team.players) {
          if (q === p || q.isGK) continue;
          const d = hdist(q.pos, p.pos);
          if (r.kind === 'throw' && d > 20) continue;
          const sc = Math.min(8, this.nearestOpp(q.pos, p.team).d) / 8 - this.laneRisk(p.pos, q.pos, p.team) + (q.pos.x - p.pos.x) * p.team.side / 40;
          if (!best || sc > best.sc) best = { q, sc, d };
        }
        if (!best) {
          // nadie a tiro: al compañero más cercano
          for (const q of p.team.players) {
            if (q === p || q.isGK) continue;
            const d = hdist(q.pos, p.pos);
            if (!best || d < best.d) best = { q, sc: 0, d };
          }
        }
        const kind = r.kind === 'goalkick' ? (best.d > 20 ? 'lob' : 'pass') : (best.d > 10 ? 'lob' : 'pass');
        this.restartKick(p, V().subVectors(best.q.pos, p.pos).setY(0).normalize(), kind, best.q);
      }
    }
  }

  restartKick(p, dir, kind, recv = null) {
    const r = this.restart;
    if (r.kind === 'throw') {
      const q = recv || this.pickReceiver(p, dir);
      const d = q ? hdist(q.pos, p.pos) : 10;
      const range = kind === 'lob' ? clamp(d, 8, 22) : clamp(d, 4, 12);
      const target = q ? q.pos.clone().addScaledVector(q.vel, 0.5) : p.pos.clone().addScaledVector(dir, range);
      target.x = clamp(target.x, -HALF_L + 1, HALF_L - 1);
      target.z = clamp(target.z, -HALF_W + 1, HALF_W - 1);
      p.setAction('throw', 0.6, 1, 1);
      p.holding = true;
      this.owner = p;
      p.pending = { type: 'throw', target, recv: q, t: 0.2 };
      p.lock = 0.4;
      // el balón debe estar en las manos en el momento del lanzamiento
      this.ball.p.copy(p.pos).addScaledVector(p.fwd, 0.2).setY(2.2);
      return;
    }
    if (kind === 'shot') { this.doShot(p, 0.85, null); return; }
    if (recv) this.doPassTo(p, recv, kind);
    else if (r.kind === 'corner' && kind === 'lob') {
      // centro al área: al compañero mejor situado
      const cands = p.team.players.filter((q) => q !== p && !q.isGK);
      const tp = V(p.team.side * (HALF_L - 8), 0, 0);
      cands.sort((a, c) => hdist(a.pos, tp) - hdist(c.pos, tp));
      this.doPassTo(p, cands[0], 'lob');
    } else this.doPass(p, dir, kind);
  }

  // =========================================================================
  // Saque inicial
  // =========================================================================
  setupKickoff(teamIdx) {
    this.state = 'kickoff';
    this.stateT = 0;
    this.kickoffTeam = this.teams[teamIdx];
    this.owner = null;
    this.receiver = null;
    this.buffer = null;
    this.lastKick = null;
    this.ball.reset(0, 0);
    this.trail.reset();
    for (const t of this.teams) {
      for (const p of t.players) {
        let x = p.home.x * HALF_L * 0.9;
        let z = p.home.z * HALF_W * 0.7;
        if (p.role === 'FWD') x = -2.5;
        if (p.role === 'MID' && p.home.z === 0) x = -9;
        x = Math.min(x, -1.2);
        if (t !== this.kickoffTeam) {
          const d = Math.hypot(x, z);
          if (d < PITCH.circleR + 0.8) { const k = (PITCH.circleR + 1) / Math.max(0.1, d); x *= k; z *= k; if (Math.abs(x) < 0.5) x = -(PITCH.circleR + 1); }
        }
        p.pos.set(x * t.side, 0, z);
        p.vel.set(0, 0, 0);
        p.heading = t.side > 0 ? Math.PI / 2 : -Math.PI / 2;
        p.anim.action = 'none';
        p.anim.speed = 0;
        p.lock = 0; p.pending = null; p.holding = false; p.touchCd = 0; p.faceDir = null; p.diving = false;
      }
    }
    const kt = this.kickoffTeam;
    const taker = kt.players.find((p) => p.role === 'FWD');
    taker.pos.set(-kt.side * 0.45, 0, 0);
    this.taker = taker;
    this.owner = taker;
    this.kickMate = kt.players.find((p) => p.role === 'MID' && p.home.z === 0);
    this.kickMate.pos.set(-kt.side * 8, 0, 1.5);
    this.setHuman(kt.i === 0 ? taker : this.teams[0].players.find((p) => p.role === 'FWD'));
    this.hud.hint(kt.i === 0 ? 'Pulsa J (o A) para sacar' : '');
    this.recorder.clear();
    this.camRig.override = null;
  }

  kickoffAI(p) {
    p.desired.set(0, 0, 0);
    this.faceBall(p);
  }

  kickoffUpdate(input) {
    const p = this.taker;
    if (!p || p.pending) return;
    const human = this.kickoffTeam.i === 0 && !this.demo;
    if (human) {
      const go = input.pressed('pass') || input.pressed('lob') || input.pressed('shoot');
      if (go) this.doPassTo(p, this.kickMate, 'pass');
    } else if (this.stateT > 1.6) {
      this.doPassTo(p, this.kickMate, 'pass');
    }
    if (this.stateT > 0.5 && this.stateT < 0.6 && !this.whistled) { this.audio.whistle([0.45]); this.whistled = true; }
  }

  // =========================================================================
  // Gol, celebración, repetición y final
  // =========================================================================
  onGoal(team) {
    team.score++;
    this.state = 'goal';
    this.stateT = 0;
    this.goalTime = this.time;
    const own = this.lastTouch && this.lastTouch.team !== team;
    const scorer = own ? team.players.find((p) => p.role === 'FWD') : (this.lastTouch || team.players.find((p) => p.role === 'FWD'));
    this.scorer = scorer;
    const minute = Math.min(90, Math.floor(this.matchTime / this.duration * 90) + 1);
    this.goals.push({ team: team.i, number: scorer.number, minute, own });
    if (this.owner && this.owner.holding) this.owner.holding = false;
    this.owner = null;
    this.receiver = null;
    this.charging = false; this.charge = 0;
    const s = team.side;
    this.celebrateTarget = V(s * (HALF_L - 3), 0, (Math.sign(scorer.pos.z) || 1) * (HALF_W - 3));
    const variant = Math.floor(Math.random() * 4);
    this.celebrateVariant = variant;
    if (variant !== 2) scorer.setAction('celebrate', 4.6, 1, variant);
    for (const p of this.opponents(team)) {
      if (p.isGK && p.anim.action === 'dive') continue;
      p.celebrateDelay = rnd(0.4, 1.2);
    }
    this.audio.roar(5, 0.75);
    this.audio.whistle([0.15]);
    this.hud.goal(team, scorer.number, own, this.teams[0].score, this.teams[1].score);
    this.fx.confetti(V(s * (HALF_L - 2), 10, 0), [team.kit.shirt, team.kit.shorts, '#ffd23f', '#ffffff'], 320, 30);
    this.camRig.shake(0.35);
    this.excite = 1;
  }

  celebrationAI(p, dt) {
    const scorer = this.scorer;
    const t = scorer.team;
    const T = this.stateT;
    if (p === scorer) {
      if (this.celebrateVariant === 2) {
        if (T < 1.3) { this.seek(p, this.celebrateTarget, 1, 0.5); p.sprint = true; }
        else if (p.anim.action !== 'celebrate') {
          p.setAction('celebrate', 3.4, 1, 2);
          p.lock = 1.3;
        }
      } else if (T < 2.6) { this.seek(p, this.celebrateTarget, 1, 0.8); }
      else this.faceBall(p);
      return;
    }
    if (p.team === t) {
      if (p.isGK) { if (T > 0.5 && p.anim.action !== 'celebrate') p.setAction('celebrate', 4, 1, 0); return; }
      const d = this.seek(p, scorer.pos, 6, 1.3);
      if (d < 1.6 && p.anim.action !== 'celebrate') p.setAction('celebrate', 3.5, 1, 0);
    } else {
      if (T > (p.celebrateDelay || 0.8) && p.anim.action === 'none') p.setAction('sad', 4.5);
      p.desired.multiplyScalar(0);
    }
    void dt;
  }

  startReplay() {
    if (this.recorder.frames.length < 30 || !this.replayEnabled) { this.afterGoal(); return; }
    this.state = 'replay';
    this.stateT = 0;
    this.replayStart = Math.max(this.recorder.start, this.goalTime - 3.6);
    this.replayEnd = Math.min(this.recorder.end, this.goalTime + 1.1);
    this.replayClock = this.replayStart;
    this.hud.replay(true);
    this.trail.reset();
    this.replayAngle = this.goals.length % 2;
  }

  updateReplay(dt, input) {
    this.replayClock += dt * 0.55;
    const skip = input.pressed('pass') || input.pressed('shoot') || input.pressed('skip') || input.pressed('lob');
    if (this.replayClock >= this.replayEnd || skip) {
      this.hud.replay(false);
      this.afterGoal();
      return;
    }
    this.recorder.apply(this.replayClock, this.ball, () => {});
    // cámara de repetición: a ras de césped junto a la portería
    const b = this.ball.p;
    const s = Math.sign(this.scorer.team.side);
    const pos = this.replayAngle === 0
      ? V(s * (HALF_L + 7), 2.4, b.z * 0.5 + (b.z >= 0 ? -9 : 9))
      : V(b.x - s * 9, 3.2, b.z + 9);
    this.camRig.override = { pos, look: b.clone(), fov: 34, k: 2.2, kl: 6 };
  }

  afterGoal() {
    this.camRig.override = null;
    const conceding = this.scorer ? this.teams[1 - this.scorer.team.i] : this.teams[0];
    if (this.matchTime >= this.duration) { this.endMatch(); return; }
    this.setupKickoff(conceding.i);
    this.whistled = false;
  }

  endMatch() {
    if (this.state === 'end') return;
    this.state = 'end';
    this.stateT = 0;
    this.camRig.override = null;
    this.owner = null;
    this.audio.whistle([0.3, 0.3, 0.8]);
    const [a, b] = this.teams;
    const winner = a.score === b.score ? null : a.score > b.score ? a : b;
    for (const p of this.players) {
      p.lock = 0; p.pending = null;
      if (winner && p.team === winner) p.setAction('celebrate', 99, 1, [0, 1, 3][Math.floor(Math.random() * 3)]);
      else if (winner) p.setAction('sad', 99);
    }
    this.hud.final(this.teams, this.goals);
  }

  endAI(p) {
    p.desired.set(0, 0, 0);
    this.faceBall(p);
  }

  dispose() {
    for (const p of this.players) this.scene.remove(p.rig.root);
    this.scene.remove(this.ring, this.arrow, this.dirMark);
  }

  // =========================================================================
  // Visual
  // =========================================================================
  syncVisuals(dt) {
    for (const p of this.players) {
      const r = p.rig.root;
      r.position.copy(p.pos);
      r.rotation.y = p.heading;
      const alert = p.isGK && Math.abs(this.ball.p.x - p.pos.x) < 30;
      poseRig(p.rig, p.anim, alert);
    }
    this.ball.sync();
    const h = this.human;
    const show = this.state !== 'replay' && this.state !== 'end' && !this.demo;
    this.ring.visible = this.arrow.visible = this.dirMark.visible = show;
    this.ring.position.set(h.pos.x, 0.02, h.pos.z);
    const pulse = 1 + Math.sin(this.time * 6) * 0.06;
    this.ring.scale.setScalar(pulse);
    this.arrow.position.set(h.pos.x, 2.25 + Math.sin(this.time * 4) * 0.07, h.pos.z);
    this.arrow.rotation.y += dt * 2;
    this.dirMark.position.set(h.pos.x, 0.025, h.pos.z);
    this.dirMark.rotation.y = h.heading;
  }
}
