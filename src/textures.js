import * as THREE from 'three';
import { PITCH, HALF_L, HALF_W } from './config.js';

// Texturas procedurales generadas en canvas: no se descarga ninguna imagen.

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Balón: icosaedro truncado real proyectado sobre la esfera (12 pentágonos,
// 20 hexágonos) con costuras hundidas en el mapa de relieve.
// ---------------------------------------------------------------------------
export function ballTextures() {
  const W = 1024, H = 512;
  const phi = (1 + Math.sqrt(5)) / 2;
  const pent = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    pent.push([0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a]);
  }
  const hex = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) hex.push([a, b, c]);
  const ip = 1 / phi;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    hex.push([0, a * ip, b * phi], [a * ip, b * phi, 0], [b * phi, 0, a * ip]);
  }
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  // distancia del centro a cada cara del icosaedro truncado (arista = 1)
  const faces = [
    ...pent.map((v) => ({ n: norm(v), k: 1 / 2.3274, pent: true })),
    ...hex.map((v) => ({ n: norm(v), k: 1 / 2.2672, pent: false })),
  ];

  const cMap = canvas(W, H), cBump = canvas(W, H);
  const g1 = cMap.getContext('2d'), g2 = cBump.getContext('2d');
  const img = g1.createImageData(W, H), bmp = g2.createImageData(W, H);
  const accent = [18, 30, 58];
  const stripe = [230, 57, 70];
  for (let j = 0; j < H; j++) {
    const th = (j + 0.5) / H * Math.PI;
    const st = Math.sin(th), ct = Math.cos(th);
    for (let i = 0; i < W; i++) {
      const ph = (i + 0.5) / W * Math.PI * 2;
      const x = -Math.cos(ph) * st, y = ct, z = Math.sin(ph) * st;
      let best = -1, second = -1, bf = null;
      for (const f of faces) {
        const s = (f.n[0] * x + f.n[1] * y + f.n[2] * z) / f.k;
        if (s > best) { second = best; best = s; bf = f; }
        else if (s > second) second = s;
      }
      const edge = (best - second) * 22; // 0 en la costura
      const seam = Math.min(1, edge / 0.9);
      const puff = Math.min(1, edge / 3.5);
      let r, g, b;
      if (bf.pent) { [r, g, b] = accent; }
      else {
        r = 246; g = 246; b = 242;
        // franja decorativa en los hexágonos del "ecuador"
        if (Math.abs(bf.n[1]) < 0.2 && edge > 1.3 && edge < 2.2) { [r, g, b] = stripe; }
      }
      const shade = 0.78 + 0.22 * puff;
      const sk = seam < 1 ? 0.35 + 0.65 * seam : 1;
      const o = (j * W + i) * 4;
      img.data[o] = r * shade * sk; img.data[o + 1] = g * shade * sk; img.data[o + 2] = b * shade * sk; img.data[o + 3] = 255;
      const bv = 255 * (0.25 + 0.75 * Math.sqrt(puff));
      bmp.data[o] = bmp.data[o + 1] = bmp.data[o + 2] = bv; bmp.data[o + 3] = 255;
    }
  }
  g1.putImageData(img, 0, 0);
  g2.putImageData(bmp, 0, 0);
  const map = new THREE.CanvasTexture(cMap);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(cBump);

  // sombra difusa bajo el balón
  const cb = canvas(64, 64), gb = cb.getContext('2d');
  const grad = gb.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  gb.fillStyle = grad; gb.fillRect(0, 0, 64, 64);
  const blob = new THREE.CanvasTexture(cb);
  return { map, bump, blob };
}

// ---------------------------------------------------------------------------
// Césped con franjas de corte y líneas reglamentarias
// ---------------------------------------------------------------------------
export const GRASS_EXTENT = { x: PITCH.L + 16, z: PITCH.W + 12 };

export function grassTexture(maxSize) {
  const W = Math.min(maxSize, 4096);
  const ppm = W / GRASS_EXTENT.x;
  const H = Math.round(GRASS_EXTENT.z * ppm);
  const c = canvas(W, H), g = c.getContext('2d');
  const X = (x) => (x + GRASS_EXTENT.x / 2) * ppm;
  const Z = (z) => (z + GRASS_EXTENT.z / 2) * ppm;

  g.fillStyle = '#2f7a34';
  g.fillRect(0, 0, W, H);
  // franjas de corte
  const stripes = 18;
  const sw = PITCH.L / stripes;
  for (let i = -3; i < stripes + 3; i++) {
    const x0 = -HALF_L + i * sw;
    g.fillStyle = i % 2 === 0 ? '#347f39' : '#2b7030';
    g.fillRect(X(x0), 0, sw * ppm + 1, H);
  }
  // cruce leve en círculos (patrón de corte)
  g.globalAlpha = 0.05;
  for (let r = 3; r < 60; r += 6) {
    g.strokeStyle = r % 12 === 3 ? '#ffffff' : '#000000';
    g.lineWidth = 3 * ppm;
    g.beginPath(); g.arc(X(0), Z(0), r * ppm, 0, Math.PI * 2); g.stroke();
  }
  g.globalAlpha = 1;
  // desgaste en las áreas y centro
  const wear = (x, z, rx, rz, a) => {
    const grd = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rx * ppm);
    grd.addColorStop(0, `rgba(120,110,60,${a})`);
    grd.addColorStop(1, 'rgba(120,110,60,0)');
    g.save(); g.translate(X(x), Z(z)); g.scale(1, rz / rx); g.translate(-X(x), -Z(z));
    g.fillStyle = grd; g.beginPath(); g.arc(X(x), Z(z), rx * ppm, 0, Math.PI * 2); g.fill(); g.restore();
  };
  wear(-HALF_L + 2.5, 0, 4, 3, 0.22);
  wear(HALF_L - 2.5, 0, 4, 3, 0.22);
  wear(0, 0, 3, 3, 0.1);
  // ruido fino
  const r = rand(7);
  for (let i = 0; i < W * H / 60; i++) {
    const v = r();
    g.fillStyle = v > 0.5 ? 'rgba(255,255,200,0.035)' : 'rgba(0,30,0,0.05)';
    g.fillRect(r() * W, r() * H, 1 + r() * 2 * ppm / 10, 1 + r() * 2 * ppm / 10);
  }

  // líneas
  g.strokeStyle = 'rgba(245,248,240,0.93)';
  g.fillStyle = 'rgba(245,248,240,0.93)';
  g.lineWidth = PITCH.lineW * ppm;
  const rect = (x0, z0, x1, z1) => g.strokeRect(X(x0), Z(z0), (x1 - x0) * ppm, (z1 - z0) * ppm);
  rect(-HALF_L, -HALF_W, HALF_L, HALF_W);
  g.beginPath(); g.moveTo(X(0), Z(-HALF_W)); g.lineTo(X(0), Z(HALF_W)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), PITCH.circleR * ppm, 0, Math.PI * 2); g.stroke();
  const dot = (x, z, rr) => { g.beginPath(); g.arc(X(x), Z(z), rr * ppm, 0, Math.PI * 2); g.fill(); };
  dot(0, 0, 0.22);
  for (const s of [-1, 1]) {
    const gx = s * HALF_L;
    const bx = gx - s * PITCH.boxD;
    rect(Math.min(gx, bx), -PITCH.boxW / 2, Math.max(gx, bx), PITCH.boxW / 2);
    const sx = gx - s * PITCH.smallD;
    rect(Math.min(gx, sx), -PITCH.smallW / 2, Math.max(gx, sx), PITCH.smallW / 2);
    const px = gx - s * PITCH.spot;
    dot(px, 0, 0.2);
    // media luna del área
    const rr = PITCH.circleR * 0.95;
    const dx = Math.abs(PITCH.boxD - PITCH.spot);
    const ang = Math.acos(Math.min(1, dx / rr));
    g.beginPath();
    if (s > 0) g.arc(X(px), Z(0), rr * ppm, Math.PI - ang, Math.PI + ang);
    else g.arc(X(px), Z(0), rr * ppm, -ang, ang);
    g.stroke();
    // arcos de esquina
    for (const zs of [-1, 1]) {
      g.beginPath();
      const a0 = s > 0 ? (zs > 0 ? Math.PI : Math.PI * 0.5) : (zs > 0 ? Math.PI * 1.5 : 0);
      g.arc(X(gx), Z(zs * HALF_W), 1 * ppm, a0, a0 + Math.PI / 2);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

// Textura de detalle en mosaico para dar grano al césped de cerca
export function grassDetail() {
  const S = 256;
  const c = canvas(S, S), g = c.getContext('2d');
  const r = rand(42);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S;
    const l = 90 + r() * 90;
    g.strokeStyle = `rgba(${l},${l},${l},0.55)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 3, y + (r() - 0.5) * 3 - 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Red de portería
export function netTexture() {
  const S = 128;
  const c = canvas(S, S), g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 7;
  g.beginPath();
  for (let i = 0; i <= 1; i++) {
    g.moveTo(0, i * S); g.lineTo(S, i * S);
    g.moveTo(i * S, 0); g.lineTo(i * S, S);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Vallas publicitarias (marcas ficticias)
export function adTexture() {
  const W = 2048, H = 64;
  const c = canvas(W, H), g = c.getContext('2d');
  const ads = [
    ['GOLAZO 3D', '#0b1a33', '#ffb627'],
    ['THREE.JS', '#111111', '#ffffff'],
    ['CAMPEONES', '#c1121f', '#ffffff'],
    ['TIKI TAKA', '#14a44d', '#ffffff'],
    ['VAMOS', '#1f5fd1', '#ffffff'],
    ['LA GRADA', '#ffb627', '#0b1a33'],
    ['CHILENA', '#6c2bd9', '#ffffff'],
    ['CÉSPED+', '#0f766e', '#e6fffb'],
  ];
  const w = W / ads.length;
  ads.forEach(([txt, bg, fg], i) => {
    g.fillStyle = bg; g.fillRect(i * w, 0, w, H);
    g.fillStyle = fg;
    g.font = '800 40px "Saira Condensed", "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, i * w + w / 2, H / 2 + 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Dorsal
export function numberTexture(num, color) {
  const c = canvas(128, 128), g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.font = '800 96px "Saira Condensed", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Halo para focos
export function glowTexture() {
  const c = canvas(128, 128), g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,245,1)');
  grd.addColorStop(0.15, 'rgba(255,250,225,0.65)');
  grd.addColorStop(0.45, 'rgba(255,240,200,0.12)');
  grd.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Panel de focos (rejilla de lámparas)
export function lampPanelTexture() {
  const c = canvas(256, 128), g = c.getContext('2d');
  g.fillStyle = '#1a1d24'; g.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    const grd = g.createRadialGradient(16 + x * 32, 16 + y * 32, 0, 16 + x * 32, 16 + y * 32, 14);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.6, '#fff4d6'); grd.addColorStop(1, '#6b6150');
    g.fillStyle = grd;
    g.beginPath(); g.arc(16 + x * 32, 16 + y * 32, 13, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
