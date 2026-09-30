import * as THREE from 'three';
import { TEAMS, HALF_L } from './config.js';
import { Ball } from './ball.js';
import { ballTextures } from './textures.js';
import { buildStadium } from './stadium.js';
import { Particles, BallTrail, Shockwaves } from './effects.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { CameraRig, CAM_NAMES } from './camera.js';
import { Hud } from './hud.js';
import { Game } from './game.js';

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 20, 45);

const stadium = buildStadium(scene, renderer);
const ball = new Ball(ballTextures());
ball.addTo(scene);
const fx = new Particles(scene);
const trail = new BallTrail(scene);
const waves = new Shockwaves(scene);
const audio = new Sound();
const input = new Input();
input.bindTouch(document.getElementById('touch'));
const camRig = new CameraRig(camera);
const hud = new Hud();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Menú
// ---------------------------------------------------------------------------
const settings = { teams: [0, 1], difficulty: 'normal', minutes: 5, replays: true };
try {
  const saved = JSON.parse(localStorage.getItem('golazo-settings') || 'null');
  if (saved) Object.assign(settings, saved);
} catch { /* sin almacenamiento */ }

function buildTeamPicker(id, idx) {
  const box = document.getElementById(id);
  box.innerHTML = '';
  TEAMS.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kit';
    b.style.setProperty('--shirt', t.shirt);
    b.style.setProperty('--shorts', t.shorts);
    b.style.setProperty('--trim', t.trim);
    b.setAttribute('aria-pressed', settings.teams[idx] === i ? 'true' : 'false');
    b.innerHTML = `<span class="kit-shirt"></span><span class="kit-name"></span>`;
    b.querySelector('.kit-name').textContent = t.name;
    b.title = t.name;
    b.addEventListener('click', () => {
      settings.teams[idx] = i;
      if (settings.teams[0] === settings.teams[1]) settings.teams[1 - idx] = (i + 1) % TEAMS.length;
      buildTeamPicker('pick-home', 0);
      buildTeamPicker('pick-away', 1);
    });
    box.append(b);
  });
}

function bindSegment(id, key, parse = (v) => v) {
  const box = document.getElementById(id);
  const sync = () => box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(parse(b.dataset.v) === settings[key])));
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { settings[key] = parse(b.dataset.v); sync(); }));
  sync();
}

buildTeamPicker('pick-home', 0);
buildTeamPicker('pick-away', 1);
bindSegment('seg-diff', 'difficulty');
bindSegment('seg-min', 'minutes', Number);
bindSegment('seg-rep', 'replays', (v) => v === '1');

const menu = document.getElementById('menu');
const finalEl = document.getElementById('final');
const pauseEl = document.getElementById('pause');
const touchEl = document.getElementById('touch');
touchEl.hidden = true;

let game = null;
let demo = true;

function newGame(opts) {
  if (game) game.dispose();
  ball.reset(0, 0);
  trail.reset();
  game = new Game({ scene, ball, fx, trail, waves, audio, stadium, camRig, hud, settings: opts });
  hud.setTeams(TEAMS[opts.teams[0]], TEAMS[opts.teams[1]]);
}

function startDemo() {
  demo = true;
  hud.silent = true;
  hud.show(false);
  newGame({ teams: [settings.teams[0], settings.teams[1]], difficulty: 'normal', minutes: 90, replays: false, demo: true });
}

function startMatch() {
  try { localStorage.setItem('golazo-settings', JSON.stringify(settings)); } catch { /* sin almacenamiento */ }
  audio.init();
  demo = false;
  hud.silent = false;
  menu.hidden = true;
  touchEl.hidden = false;
  finalEl.hidden = true;
  pauseEl.hidden = true;
  hud.show(true);
  newGame({ ...settings, teams: [...settings.teams] });
  camRig.snap();
}

function toMenu() {
  finalEl.hidden = true;
  pauseEl.hidden = true;
  menu.hidden = false;
  touchEl.hidden = true;
  startDemo();
}

document.getElementById('btn-play').addEventListener('click', startMatch);
document.getElementById('btn-again').addEventListener('click', startMatch);
document.getElementById('btn-menu').addEventListener('click', toMenu);
document.getElementById('btn-resume').addEventListener('click', () => { if (game) { game.paused = false; hud.pause(false); } });
document.getElementById('btn-quit').addEventListener('click', toMenu);
const muteBtn = document.getElementById('btn-mute');
let muted = false;
const toggleMute = () => {
  muted = !muted;
  audio.setMuted(muted);
  muteBtn.setAttribute('aria-pressed', String(muted));
  muteBtn.textContent = muted ? 'Sonido: no' : 'Sonido: sí';
};
muteBtn.addEventListener('click', toggleMute);

if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

startDemo();

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let elapsed = 0;
const focus = new THREE.Vector3();
const headPos = new THREE.Vector3();
let miniT = 0;

function frame() {
  tick(Math.min(clock.getDelta(), 1 / 20));
  renderer.render(scene, camera);
}

function tick(dt) {
  elapsed += dt;
  input.poll();

  if (demo && !menu.hidden && input.pressed('skip')) startMatch();
  if (!demo) {
    if (input.pressed('camera')) hud.toast(`Cámara: ${CAM_NAMES[camRig.cycle()]}`);
    if (input.pressed('mute')) toggleMute();
  }

  game.update(dt, demo ? idleInput : input);
  if (demo && game.state === 'end') startDemo();
  game.syncVisuals(dt);

  // cámara
  if (game.state === 'goal' && game.scorer) {
    // cámara al goleador: desde el campo, con la grada de fondo
    const s = game.scorer.pos;
    const toC = new THREE.Vector3(-s.x, 0, -s.z * 0.4 + 6).normalize();
    camRig.override = {
      pos: new THREE.Vector3(s.x + toC.x * 8, 3.4, s.z + toC.z * 8),
      look: new THREE.Vector3(s.x, 1.2, s.z),
      fov: 38, k: 3, kl: 6,
    };
  } else if (game.state === 'end') {
    const t = elapsed * 0.08;
    camRig.override = { pos: new THREE.Vector3(Math.sin(t) * 40, 18, Math.cos(t) * 40), look: new THREE.Vector3(0, 0, 0), fov: 44, k: 0.8 };
  } else if (demo) {
    camRig.override = null;
    camRig.mode = 'broadcast';
  } else if (game.state !== 'replay') {
    camRig.override = null;
  }
  const b = ball.p;
  if (game.state === 'play' && !demo) focus.set(b.x * 0.82 + game.human.pos.x * 0.18, 0, b.z * 0.82 + game.human.pos.z * 0.18);
  else focus.set(b.x, 0, b.z);
  const zoom = Math.min(1, ball.speed / 28);
  camRig.update(dt, focus, ball.v, zoom);

  // efectos
  stadium.update(dt, elapsed, game.excite);
  fx.update(dt);
  waves.update(dt);
  trail.update(ball.p, ball.speed, camera, dt);

  // HUD
  if (!demo) {
    hud.clock(game.matchTime, game.duration);
    headPos.copy(game.human.pos).setY(2.6).project(camera);
    const x = (headPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-headPos.y * 0.5 + 0.5) * window.innerHeight;
    hud.power(game.charge, x, y, game.charging && game.state === 'play');
    miniT -= dt;
    if (miniT <= 0) { hud.minimap(game); miniT = 1 / 30; }
  }
}

const idleInput = {
  move: { x: 0, z: 0 },
  pressed: () => false, released: () => false, down: () => false,
};

renderer.setAnimationLoop(frame);
// acceso para pruebas automatizadas
window.__golazo = { get game() { return game; }, scene, camera, renderer, tick, HALF_L };
