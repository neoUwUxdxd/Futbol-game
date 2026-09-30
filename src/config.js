// Dimensiones y constantes globales del juego (unidades en metros y segundos).
// Eje X = largo del campo, eje Z = ancho, eje Y = altura.

export const PITCH = {
  L: 72,          // largo
  W: 46,          // ancho
  goalW: 7.32,    // ancho de portería
  goalH: 2.44,    // alto de portería
  goalD: 2.2,     // profundidad de la red
  boxD: 13.5,     // área grande (profundidad)
  boxW: 32,       // área grande (ancho)
  smallD: 4.5,    // área chica
  smallW: 14,
  circleR: 7.5,   // círculo central
  spot: 9.5,      // punto de penal
  lineW: 0.12,
};

export const HALF_L = PITCH.L / 2;
export const HALF_W = PITCH.W / 2;
export const BALL_R = 0.11;
export const POST_R = 0.06;

export const TEAMS = [
  { id: 'LEO', name: 'Leones Rojos', shirt: '#d62839', shorts: '#f5f5f5', socks: '#d62839', trim: '#ffffff', gk: '#26c485', num: '#ffffff' },
  { id: 'MAR', name: 'Marea Azul', shirt: '#1f5fd1', shorts: '#0d1b3d', socks: '#1f5fd1', trim: '#9fd3ff', gk: '#f2c230', num: '#ffffff' },
  { id: 'SEL', name: 'Selva FC', shirt: '#14a44d', shorts: '#fbd33b', socks: '#14a44d', trim: '#fbd33b', gk: '#e9534d', num: '#fbd33b' },
  { id: 'DOR', name: 'Dorados', shirt: '#f2b705', shorts: '#161616', socks: '#161616', trim: '#161616', gk: '#7b61ff', num: '#161616' },
  { id: 'VIO', name: 'Violeta CF', shirt: '#6c2bd9', shorts: '#ffffff', socks: '#6c2bd9', trim: '#e6d8ff', gk: '#ff8a1f', num: '#ffffff' },
  { id: 'NIE', name: 'Nieve Real', shirt: '#f3f3f0', shorts: '#f3f3f0', socks: '#f3f3f0', trim: '#c9a227', gk: '#101010', num: '#1a1a1a' },
];

export const DIFFICULTY = {
  easy:   { name: 'Fácil',   reaction: 0.34, speed: 0.9,  gkReach: 0.78, passErr: 0.10, shotErr: 1.35, tackle: 0.55, press: 0.75 },
  normal: { name: 'Normal',  reaction: 0.22, speed: 0.98, gkReach: 0.95, passErr: 0.06, shotErr: 1.0,  tackle: 0.9,  press: 1.0 },
  hard:   { name: 'Difícil', reaction: 0.12, speed: 1.05, gkReach: 1.1,  passErr: 0.03, shotErr: 0.8,  tackle: 1.3,  press: 1.2 },
};

// Formación 1-2-3-1 para un equipo que ataca hacia +X.
// x ∈ [-1, 1] (−1 = propia portería), z ∈ [-1, 1].
export const FORMATION = [
  { role: 'GK',  x: -0.96, z: 0,     num: 1 },
  { role: 'DEF', x: -0.6,  z: -0.36, num: 4 },
  { role: 'DEF', x: -0.6,  z: 0.36,  num: 5 },
  { role: 'MID', x: -0.2,  z: -0.62, num: 7 },
  { role: 'MID', x: -0.3,  z: 0,     num: 8 },
  { role: 'MID', x: -0.2,  z: 0.62,  num: 11 },
  { role: 'FWD', x: 0.16,  z: 0,     num: 9 },
];

export const RUN_SPEED = 5.4;
export const SPRINT_SPEED = 7.4;
