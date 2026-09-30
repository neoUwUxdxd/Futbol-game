import * as THREE from 'three';
import { PITCH, HALF_L, HALF_W, POST_R } from './config.js';
import { NET_PLANES } from './ball.js';
import { grassTexture, grassDetail, netTexture, adTexture, glowTexture, lampPanelTexture, GRASS_EXTENT } from './textures.js';

const GW2 = PITCH.goalW / 2;
const GH = PITCH.goalH;
const GD = PITCH.goalD;

// ---------------------------------------------------------------------------
// Redes deformables: cada vértice es un pequeño muelle amortiguado que se
// desplaza en la normal de su plano. Un impacto crea un "bulto" que ondula.
// ---------------------------------------------------------------------------
class NetPanel {
  constructor(plane, tex, mat) {
    this.plane = plane;
    const [a1, lo1, hi1] = plane.b1;
    const [a2, lo2, hi2] = plane.b2;
    const len1 = hi1 - lo1, len2 = hi2 - lo2;
    const s1 = Math.max(4, Math.round(len1 / 0.25)), s2 = Math.max(4, Math.round(len2 / 0.25));
    const geo = new THREE.PlaneGeometry(1, 1, s1, s2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    // reconstruir posiciones en coordenadas de mundo
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      const p = { x: 0, y: 0, z: 0 };
      p[plane.axis] = plane.value;
      p[a1] = lo1 + u * len1;
      p[a2] = lo2 + v * len2;
      pos.setXYZ(i, p.x, p.y, p.z);
      uv.setXY(i, u * len1 / 0.12, v * len2 / 0.12);
    }
    geo.computeVertexNormals();
    this.rest = Float32Array.from(pos.array);
    this.u = new Float32Array(pos.count);
    this.vel = new Float32Array(pos.count);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.axisIndex = { x: 0, y: 1, z: 2 }[plane.axis];
    // hacia dónde se abomba (hacia fuera de la portería)
    this.outward = plane.axis === 'x' ? plane.side : plane.axis === 'y' ? 1 : Math.sign(plane.value);
    this.active = false;
    this.cols = s1 + 1;
    this.rows = s2 + 1;
  }

  hit(point, strength) {
    const pos = this.mesh.geometry.attributes.position;
    const [a1] = this.plane.b1;
    const [a2] = this.plane.b2;
    const idx = { x: 0, y: 1, z: 2 };
    const i1 = idx[a1], i2 = idx[a2];
    const amp = Math.min(strength, 30) * 0.09;
    for (let i = 0; i < pos.count; i++) {
      const d1 = this.rest[i * 3 + i1] - point[a1];
      const d2 = this.rest[i * 3 + i2] - point[a2];
      const f = Math.exp(-(d1 * d1 + d2 * d2) / 0.55);
      this.vel[i] += amp * f * 9;
    }
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    const pos = this.mesh.geometry.attributes.position;
    const { u, vel, rest, cols, rows } = this;
    let energy = 0;
    const k = 90, c = 7.5, couple = 30;
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const i = r * cols + q;
        // bordes fijos
        if (r === 0 || q === 0 || r === rows - 1 || q === cols - 1) { u[i] = 0; vel[i] = 0; continue; }
        const lap = u[i - 1] + u[i + 1] + u[i - cols] + u[i + cols] - 4 * u[i];
        vel[i] += (-k * u[i] - c * vel[i] + couple * lap) * dt;
      }
    }
    for (let i = 0; i < u.length; i++) {
      u[i] += vel[i] * dt;
      energy += Math.abs(u[i]) + Math.abs(vel[i]);
      const o = i * 3 + this.axisIndex;
      pos.array[o] = rest[o] + u[i] * this.outward;
    }
    pos.needsUpdate = true;
    if (energy < 1e-3) this.active = false;
  }
}

export function buildStadium(scene, renderer) {
  const out = { nets: [], crowdUniforms: null, adTex: null, update: null };
  const maxTex = renderer.capabilities.maxTextureSize;

  // --- cielo nocturno ---
  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 top = vec3(0.012, 0.02, 0.06);
        vec3 mid = vec3(0.04, 0.07, 0.17);
        vec3 hor = vec3(0.18, 0.16, 0.24);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, top, smoothstep(0.18, 0.8, h));
        vec3 q = floor(vDir * 260.0);
        float s = hash(q);
        col += vec3(step(0.9965, s) * smoothstep(0.08, 0.4, h) * (0.5 + 0.5*hash(q+3.1)));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0x0b1224, 120, 330);

  // --- luces ---
  const hemi = new THREE.HemisphereLight(0x9fb8ff, 0x1d3a1f, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff3dd, 2.6);
  key.position.set(-28, 55, 30);
  key.castShadow = true;
  const small = matchMedia('(pointer: coarse)').matches || maxTex < 8192;
  key.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
  const sc = key.shadow.camera;
  sc.left = -52; sc.right = 52; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 160;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9);
  fill.position.set(35, 40, -30);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe6c4, 0.5);
  rim.position.set(0, 30, -60);
  scene.add(rim);

  // --- césped ---
  const grassMap = grassTexture(maxTex >= 8192 ? 4096 : 2048);
  const detail = grassDetail();
  const grassMat = new THREE.MeshStandardMaterial({ map: grassMap, roughness: 0.92, metalness: 0 });
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.detailMap = { value: detail };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D detailMap;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 duv = vMapUv * vec2(${(GRASS_EXTENT.x / 1.6).toFixed(1)}, ${(GRASS_EXTENT.z / 1.6).toFixed(1)});
        float dd = texture2D(detailMap, duv).r * 0.6 + texture2D(detailMap, duv * 0.27).r * 0.4;
        diffuseColor.rgb *= 0.72 + dd * 0.58;`);
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GRASS_EXTENT.x, GRASS_EXTENT.z), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // pista alrededor
  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(GRASS_EXTENT.x + 60, GRASS_EXTENT.z + 60),
    new THREE.MeshStandardMaterial({ color: 0x1f3d25, roughness: 1 })
  );
  track.rotation.x = -Math.PI / 2;
  track.position.y = -0.02;
  track.receiveShadow = true;
  scene.add(track);

  // --- porterías ---
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.25, metalness: 0.3 });
  const netTex = netTexture();
  const netMat = new THREE.MeshStandardMaterial({
    map: netTex, alphaMap: netTex, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, roughness: 0.8, color: 0xf2f4f7, alphaTest: 0.05,
  });
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    const x = side * (HALF_L + POST_R);
    const postGeo = new THREE.CylinderGeometry(POST_R, POST_R, GH + POST_R * 2, 20);
    for (const zs of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, (GH + POST_R * 2) / 2, zs * (GW2 + POST_R));
      post.castShadow = true;
      g.add(post);
      // soporte trasero
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, GH, 8), postMat);
      back.position.set(side * (HALF_L + GD), GH / 2, zs * (GW2 + POST_R));
      g.add(back);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, GD, 8), postMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(side * (HALF_L + GD / 2), GH + POST_R, zs * (GW2 + POST_R));
      g.add(bar);
    }
    const cross = new THREE.Mesh(new THREE.CylinderGeometry(POST_R, POST_R, PITCH.goalW + POST_R * 4, 20), postMat);
    cross.rotation.x = Math.PI / 2;
    cross.position.set(x, GH + POST_R, 0);
    cross.castShadow = true;
    g.add(cross);
    scene.add(g);
  }
  for (const plane of NET_PLANES) {
    const panel = new NetPanel(plane, netTex, netMat);
    scene.add(panel.mesh);
    out.nets.push(panel);
  }

  // banderines de córner
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xffb627, side: THREE.DoubleSide, roughness: 0.6 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 });
  out.flags = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), poleMat);
    pole.position.set(sx * HALF_L, 0.75, sz * HALF_W);
    pole.castShadow = true;
    scene.add(pole);
    const fgeo = new THREE.PlaneGeometry(0.4, 0.28, 6, 1);
    fgeo.translate(0.2, 0, 0);
    const flag = new THREE.Mesh(fgeo, flagMat);
    flag.position.set(sx * HALF_L, 1.35, sz * HALF_W);
    scene.add(flag);
    out.flags.push({ mesh: flag, rest: Float32Array.from(fgeo.attributes.position.array), phase: Math.random() * 6 });
  }

  // --- vallas publicitarias (LED con desplazamiento) ---
  const adTex = adTexture();
  out.adTex = adTex;
  const adMat = new THREE.MeshStandardMaterial({ map: adTex, emissive: 0xffffff, emissiveMap: adTex, emissiveIntensity: 0.55, roughness: 0.5 });
  const boardH = 0.9;
  const mkBoard = (len, x, z, rotY, rep) => {
    const t = adTex.clone(); t.needsUpdate = true; t.repeat.set(rep, 1);
    const m = adMat.clone(); m.map = t; m.emissiveMap = t;
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, boardH, 0.12), [
      new THREE.MeshStandardMaterial({ color: 0x111418 }), new THREE.MeshStandardMaterial({ color: 0x111418 }),
      new THREE.MeshStandardMaterial({ color: 0x111418 }), new THREE.MeshStandardMaterial({ color: 0x111418 }),
      m, new THREE.MeshStandardMaterial({ color: 0x111418 }),
    ]);
    b.position.set(x, boardH / 2, z);
    b.rotation.y = rotY;
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    return t;
  };
  const bx = HALF_L + 6, bz = HALF_W + 4.5;
  out.adTexs = [
    mkBoard(bx * 2, 0, -bz, 0, 3),
    mkBoard(bx * 2, 0, bz, Math.PI, 3),
    mkBoard(bz * 2, -bx, 0, Math.PI / 2, 1.5),
    mkBoard(bz * 2, bx, 0, -Math.PI / 2, 1.5),
  ];

  // --- gradas ---
  const standMat = new THREE.MeshStandardMaterial({ color: 0x3a4254, roughness: 0.9 });
  const standMat2 = new THREE.MeshStandardMaterial({ color: 0x2a3040, roughness: 0.9 });
  const rows = 16, rowD = 0.85, rowH = 0.55;
  const seats = [];
  const buildStand = (cx, cz, len, rotY, startDist, hasRoof = true) => {
    const g = new THREE.Group();
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, rowH * (r + 1) + 1.2, rowD), r % 2 ? standMat : standMat2);
      step.position.set(0, (rowH * (r + 1) + 1.2) / 2 - 1.2 + 1.0, -(startDist + r * rowD));
      step.receiveShadow = true;
      g.add(step);
    }
    // pared frontal y techo
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x0e1726, roughness: 0.7 }));
    wall.position.set(0, 0.8, -startDist + rowD / 2 + 0.2);
    g.add(wall);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.4, rows * rowD + 4), new THREE.MeshStandardMaterial({ color: 0x151b28, roughness: 0.6, metalness: 0.3 }));
    roof.position.set(0, rows * rowH + 7, -(startDist + rows * rowD / 2 - 1));
    roof.rotation.x = -0.08;
    if (hasRoof) g.add(roof);
    g.position.set(cx, 0, cz);
    g.rotation.y = rotY;
    scene.add(g);
    g.updateMatrixWorld(true);
    // asientos para el público
    const per = Math.floor(len / 0.62);
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < per; i++) {
        if (Math.random() < 0.1) continue;
        const lx = -len / 2 + (i + 0.5) * (len / per) + (Math.random() - 0.5) * 0.12;
        const v = new THREE.Vector3(lx, rowH * (r + 1) + 1.0, -(startDist + r * rowD) + 0.1);
        v.applyMatrix4(g.matrixWorld);
        seats.push({ p: v, rot: rotY, home: cx * Math.sign(cz || 1) });
      }
    }
  };
  const sideLen = PITCH.L + 20;
  const endLen = PITCH.W + 14;
  buildStand(0, bz + 1.5, sideLen, Math.PI, 0.5, false); // tribuna de la cámara: sin techo
  buildStand(0, -bz - 1.5, sideLen, 0, 0.5);
  buildStand(-bx - 1.5, 0, endLen, Math.PI / 2, 0.5);
  buildStand(bx + 1.5, 0, endLen, -Math.PI / 2, 0.5);

  // --- público (instanciado, animado en GPU) ---
  const personGeo = mergeBoxes([
    { w: 0.42, h: 0.62, d: 0.28, y: 0.31 },
    { w: 0.22, h: 0.24, d: 0.22, y: 0.76 },
  ]);
  const crowdMat = new THREE.MeshLambertMaterial({ vertexColors: false });
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0.1 }, uSideHome: { value: 0 }, uSideAway: { value: 0 } };
  crowdMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uExcite;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ip = instanceMatrix[3];
        float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float jump = abs(sin(uTime * (5.0 + ph * 4.0) + ph * 30.0));
        float idle = sin(uTime * (1.2 + ph) + ph * 20.0) * 0.03;
        float amt = smoothstep(ph * 0.8, ph * 0.8 + 0.2, uExcite);
        transformed.y += idle + jump * 0.45 * amt;
        transformed.x += sin(uTime * 2.0 + ph * 10.0) * 0.03 * (0.3 + uExcite);`);
  };
  const crowd = new THREE.InstancedMesh(personGeo, crowdMat, seats.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const palette = ['#d62839', '#f5f5f5', '#1f5fd1', '#ffb627', '#2d2d2d', '#14a44d', '#8e44ad', '#e67e22'];
  seats.forEach((s, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
    const sc = 0.9 + Math.random() * 0.2;
    m4.compose(s.p, q, new THREE.Vector3(sc, sc, sc));
    crowd.setMatrixAt(i, m4);
    col.set(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.55 + Math.random() * 0.45);
    crowd.setColorAt(i, col);
  });
  crowd.instanceMatrix.needsUpdate = true;
  scene.add(crowd);
  out.crowd = crowd;
  out.crowdSeats = seats;
  out.crowdUniforms = uniforms;

  // --- torres de iluminación ---
  const glowTex = glowTexture();
  const lampTex = lampPanelTexture();
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x2b3240, metalness: 0.6, roughness: 0.4 });
  const lampMat = new THREE.MeshBasicMaterial({ map: lampTex });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (HALF_L + 16), z = sz * (HALF_W + 18);
    const h = 38;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, h, 10), towerMat);
    tower.position.set(x, h / 2, z);
    scene.add(tower);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 0.4), [towerMat, towerMat, towerMat, towerMat, lampMat, towerMat]);
    panel.position.set(x, h + 1.5, z);
    panel.lookAt(0, 0, 0);
    scene.add(panel);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    glow.scale.set(26, 26, 1);
    glow.position.set(x * 0.985, h + 1.5, z * 0.985);
    scene.add(glow);
  }

  // anillo exterior del estadio
  const ringGeo = new THREE.CylinderGeometry(120, 125, 26, 64, 1, true);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x0c1220, side: THREE.BackSide, roughness: 1 }));
  ring.position.y = 8;
  scene.add(ring);

  let adScroll = 0;
  out.update = (dt, time, excite) => {
    uniforms.uTime.value = time;
    uniforms.uExcite.value += (excite - uniforms.uExcite.value) * Math.min(1, dt * 2);
    adScroll += dt * 0.02;
    for (const t of out.adTexs) t.offset.x = adScroll;
    for (const n of out.nets) n.update(Math.min(dt, 1 / 30));
    for (const f of out.flags) {
      const pos = f.mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = f.rest[i * 3];
        pos.array[i * 3 + 2] = Math.sin(time * 6 + f.phase + x * 12) * x * 0.25;
      }
      pos.needsUpdate = true;
    }
  };
  out.hitNet = (plane, point, strength) => {
    const panel = out.nets.find((n) => n.plane === plane);
    if (panel) panel.hit(point, strength);
    // las redes contiguas también se mueven un poco
    for (const n of out.nets) if (n !== panel && n.plane.side === plane.side) n.hit(point, strength * 0.25);
  };
  return out;
}

// Une cajas en una sola geometría (evita depender de BufferGeometryUtils)
function mergeBoxes(boxes) {
  const pos = [], nor = [], idx = [];
  let off = 0;
  for (const b of boxes) {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    g.translate(0, b.y, 0);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (const i of g.index.array) idx.push(i + off);
    off += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}
