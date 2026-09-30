import * as THREE from 'three';
import { HALF_L, HALF_W } from './config.js';

// Cámara de retransmisión con suavizado crítico, varios modos y temblor.

export const CAM_MODES = ['broadcast', 'close', 'tactical'];
export const CAM_NAMES = { broadcast: 'TV', close: 'Cercana', tactical: 'Táctica' };

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'broadcast';
    this.pos = new THREE.Vector3(0, 20, 45);
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.fov = 42;
    this.override = null; // {pos, look, fov, k}
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
  }

  cycle() {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    return this.mode;
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }

  snap() {
    this.cam.position.copy(this.pos);
    this.cam.lookAt(this.look);
  }

  /** focus: punto de interés; vel: velocidad del balón */
  update(dt, focus, vel, zoomOut = 0) {
    const p = this._p, l = this._l;
    let k = 3.2, kl = 5.5, fov = 42;
    if (this.override) {
      p.copy(this.override.pos);
      l.copy(this.override.look);
      fov = this.override.fov ?? 40;
      k = this.override.k ?? 3;
      kl = this.override.kl ?? k * 1.6;
    } else if (this.mode === 'broadcast') {
      const fx = focus.x + vel.x * 0.25;
      p.set(THREE.MathUtils.clamp(fx * 0.86, -HALF_L + 5, HALF_L - 5), 14.5 + zoomOut * 3, HALF_W + 11 + focus.z * 0.3 + zoomOut * 4);
      l.set(fx, 0, focus.z * 0.72 + 1.2);
      fov = 40 + zoomOut * 4;
    } else if (this.mode === 'close') {
      const fx = focus.x + vel.x * 0.2;
      p.set(fx * 0.96, 8.5, focus.z + 15);
      l.set(fx, 0.8, focus.z + 0.5);
      fov = 44;
      k = 3.8;
    } else {
      p.set(focus.x * 0.55, 46, focus.z * 0.25 + 24);
      l.set(focus.x * 0.75, 0, focus.z * 0.5 + 0.5);
      fov = 45;
      k = 2.5;
    }
    this.pos.x = damp(this.pos.x, p.x, k, dt);
    this.pos.y = damp(this.pos.y, p.y, k, dt);
    this.pos.z = damp(this.pos.z, p.z, k, dt);
    this.look.x = damp(this.look.x, l.x, kl, dt);
    this.look.y = damp(this.look.y, l.y, kl, dt);
    this.look.z = damp(this.look.z, l.z, kl, dt);
    this.fov = damp(this.fov, fov, 3, dt);

    this.cam.position.copy(this.pos);
    if (this.shakeAmt > 0.001) {
      this.shakeT += dt * 40;
      const s = this.shakeAmt;
      this.cam.position.x += (Math.sin(this.shakeT * 1.3) + Math.sin(this.shakeT * 2.9)) * 0.5 * s;
      this.cam.position.y += (Math.sin(this.shakeT * 1.7) + Math.sin(this.shakeT * 3.3)) * 0.5 * s;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    this.cam.lookAt(this.look);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) {
      this.cam.fov = this.fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
