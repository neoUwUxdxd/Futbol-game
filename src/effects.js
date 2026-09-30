import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Partículas (césped, polvo, confeti), estela del balón y ondas de impacto
// ---------------------------------------------------------------------------

export class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, transparent: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), life: 0, max: 1, size: 0.1, drag: 1, grav: 9.8, flutter: 0 });
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.cursor = 0;
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.zero);
    scene.add(this.mesh);
    this.color = new THREE.Color();
  }

  spawn(o) {
    const it = this.items[this.cursor];
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    it.alive = true;
    it.p.copy(o.p);
    it.v.copy(o.v);
    it.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    it.rv.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
    it.life = 0;
    it.max = o.life;
    it.size = o.size;
    it.drag = o.drag ?? 1;
    it.grav = o.grav ?? 9.8;
    it.flutter = o.flutter ?? 0;
    this.color.set(o.color);
    this.mesh.setColorAt(idx, this.color);
    this.mesh.instanceColor.needsUpdate = true;
  }

  grass(pos, dir, amount = 10, power = 1) {
    for (let i = 0; i < amount; i++) {
      const v = new THREE.Vector3(
        dir.x * power * 3 + (Math.random() - 0.5) * 3,
        1.5 + Math.random() * 3 * power,
        dir.z * power * 3 + (Math.random() - 0.5) * 3
      );
      const c = Math.random() < 0.7 ? (Math.random() < 0.5 ? '#3c8a3f' : '#2c6b2f') : '#6b5a3a';
      this.spawn({ p: new THREE.Vector3(pos.x, 0.05, pos.z), v, life: 0.5 + Math.random() * 0.5, size: 0.035 + Math.random() * 0.04, color: c, drag: 2 });
    }
  }

  dust(pos, amount = 6) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 1.5, 0.5 + Math.random(), Math.sin(a) * 1.5);
      this.spawn({ p: new THREE.Vector3(pos.x, 0.05, pos.z), v, life: 0.35 + Math.random() * 0.3, size: 0.03 + Math.random() * 0.03, color: '#9fbf8a', drag: 3, grav: 2 });
    }
  }

  confetti(center, colors, amount = 260, spread = 10) {
    for (let i = 0; i < amount; i++) {
      const p = new THREE.Vector3(center.x + (Math.random() - 0.5) * spread, center.y + Math.random() * 4, center.z + (Math.random() - 0.5) * spread);
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 8, (Math.random() - 0.5) * 6);
      this.spawn({ p, v, life: 3 + Math.random() * 2.5, size: 0.12 + Math.random() * 0.08, color: colors[i % colors.length], drag: 1.6, grav: 4, flutter: 1 });
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (!it.alive) continue;
      any = true;
      it.life += dt;
      if (it.life >= it.max) {
        it.alive = false;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      it.v.y -= it.grav * dt;
      it.v.multiplyScalar(Math.exp(-it.drag * dt));
      if (it.flutter) {
        it.v.x += Math.sin(it.life * 7 + i) * dt * 3;
        it.v.z += Math.cos(it.life * 5 + i) * dt * 3;
      }
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < 0.01) { it.p.y = 0.01; it.v.set(0, 0, 0); it.rv.multiplyScalar(0.9); }
      it.r.x += it.rv.x * dt; it.r.y += it.rv.y * dt; it.r.z += it.rv.z * dt;
      const fade = 1 - Math.max(0, (it.life - it.max * 0.7) / (it.max * 0.3));
      this.q.setFromEuler(it.r);
      this.s.setScalar(it.size * fade);
      this.m4.compose(it.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class BallTrail {
  constructor(scene, n = 26) {
    this.n = n;
    this.points = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color('#fff2c8') } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.intensity = 0;
    this.tmp = new THREE.Vector3();
    this.side = new THREE.Vector3();
  }

  reset() { this.points.length = 0; }

  update(ballPos, speed, camera, dt) {
    const target = Math.max(0, Math.min(1, (speed - 15) / 12));
    this.intensity += (target - this.intensity) * Math.min(1, dt * 8);
    this.points.unshift(ballPos.clone());
    if (this.points.length > this.n) this.points.pop();
    const pts = this.points;
    for (let i = 0; i < this.n; i++) {
      const p = pts[Math.min(i, pts.length - 1)] || ballPos;
      const q = pts[Math.min(i + 1, pts.length - 1)] || p;
      this.tmp.subVectors(p, q);
      if (this.tmp.lengthSq() < 1e-8) this.tmp.set(1, 0, 0);
      const toCam = camera.position.clone().sub(p);
      this.side.crossVectors(this.tmp, toCam).normalize();
      const f = 1 - i / (this.n - 1);
      const w = 0.09 * f;
      this.pos.set([p.x + this.side.x * w, p.y + this.side.y * w, p.z + this.side.z * w], i * 6);
      this.pos.set([p.x - this.side.x * w, p.y - this.side.y * w, p.z - this.side.z * w], i * 6 + 3);
      const a = f * f * this.intensity * 0.55;
      this.alpha[i * 2] = a; this.alpha[i * 2 + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
    this.mesh.visible = this.intensity > 0.01;
  }
}

export class Shockwaves {
  constructor(scene) {
    this.list = [];
    this.scene = scene;
    this.geo = new THREE.RingGeometry(0.8, 1, 48);
  }
  spawn(pos, color = '#ffffff', size = 2.5) {
    const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.03, pos.z);
    this.scene.add(m);
    this.list.push({ m, t: 0, size });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t += dt;
      const k = s.t / 0.45;
      s.m.scale.setScalar(0.2 + k * s.size);
      s.m.material.opacity = 0.7 * (1 - k);
      if (k >= 1) { this.scene.remove(s.m); s.m.material.dispose(); this.list.splice(i, 1); }
    }
  }
}
