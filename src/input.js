// Entrada unificada: teclado, mando (Gamepad API) y controles táctiles.

const KEYMAP = {
  pass: ['KeyJ', 'KeyX'],
  shoot: ['KeyK', 'KeyR', 'Space'],
  lob: ['KeyL', 'KeyC'],
  switch: ['KeyQ', 'KeyU'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pause: ['KeyP', 'Escape'],
  camera: ['KeyV'],
  skip: ['Enter'],
  mute: ['KeyM'],
};
const BUTTONS = Object.keys(KEYMAP);

export class Input {
  constructor() {
    this.keys = new Set();
    this.taps = new Set(); // teclas pulsadas y soltadas entre dos fotogramas
    this.move = { x: 0, z: 0 };
    this.state = {};
    this.prev = {};
    this.touch = { x: 0, z: 0, buttons: {} };
    for (const b of BUTTONS) { this.state[b] = false; this.prev[b] = false; }
    this.anyKey = false;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.taps.add(e.code);
      this.anyKey = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#stick-knob');
    let id = null, cx = 0, cy = 0;
    const R = 50;
    const set = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.x = dx / R; this.touch.z = dy / R;
    };
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      stick.setPointerCapture(id);
      set(e.clientX, e.clientY);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX, e.clientY); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.touch.x = 0; this.touch.z = 0;
      knob.style.transform = 'translate(0,0)';
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    root.querySelectorAll('[data-btn]').forEach((el) => {
      const b = el.dataset.btn;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touch.buttons[b] = true; el.classList.add('on'); el.setPointerCapture(e.pointerId); });
      const up = () => { this.touch.buttons[b] = false; el.classList.remove('on'); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  poll() {
    for (const b of BUTTONS) this.prev[b] = this.state[b];
    const k = new Set([...this.keys, ...this.taps]);
    this.taps.clear();
    let x = 0, z = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    for (const b of BUTTONS) this.state[b] = KEYMAP[b].some((c) => k.has(c)) || !!this.touch.buttons[b];
    x += this.touch.x; z += this.touch.z;

    // mando
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0, az = gp.axes[1] || 0;
      if (Math.hypot(ax, az) > 0.18) { x += ax; z += az; }
      const btn = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (btn(14)) x -= 1; if (btn(15)) x += 1; if (btn(12)) z -= 1; if (btn(13)) z += 1;
      if (btn(0)) this.state.pass = true;
      if (btn(1)) this.state.shoot = true;
      if (btn(2)) this.state.lob = true;
      if (btn(4)) this.state.switch = true;
      if (btn(5) || btn(7)) this.state.sprint = true;
      if (btn(9)) this.state.pause = true;
      if (btn(3)) this.state.camera = true;
      if (btn(8)) this.state.skip = true;
      if (Object.values(gp.buttons).some((b) => b.pressed)) this.anyKey = true;
    }
    const l = Math.hypot(x, z);
    if (l > 1) { x /= l; z /= l; }
    this.move.x = x; this.move.z = z;
  }

  down(b) { return this.state[b]; }
  pressed(b) { return this.state[b] && !this.prev[b]; }
  released(b) { return !this.state[b] && this.prev[b]; }
  consumeAny() { const a = this.anyKey; this.anyKey = false; return a; }
}
