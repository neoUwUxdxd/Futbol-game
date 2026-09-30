import { HALF_L, HALF_W, PITCH } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), homeName: $('sb-home'), awayName: $('sb-away'), homeScore: $('sb-hs'), awayScore: $('sb-as'),
      homeBar: $('sb-hbar'), awayBar: $('sb-abar'), clock: $('sb-clock'),
      banner: $('banner'), bannerT: $('banner-title'), bannerS: $('banner-sub'),
      flash: $('flash'), goal: $('goal'), goalWord: $('goal-word'), goalSub: $('goal-sub'),
      replay: $('replay'), hint: $('hint'), power: $('power'), powerFill: $('power-fill'),
      pause: $('pause'), final: $('final'), finalScore: $('final-score'), finalList: $('final-list'), finalTitle: $('final-title'),
      toast: $('toast'), mini: $('minimap'),
    };
    this.ctx = this.el.mini.getContext('2d');
    this.timers = {};
    this.silent = false;
  }

  setTeams(home, away) {
    const e = this.el;
    e.homeName.textContent = home.id;
    e.awayName.textContent = away.id;
    e.homeBar.style.background = home.shirt;
    e.awayBar.style.background = away.shirt;
    e.homeScore.textContent = '0';
    e.awayScore.textContent = '0';
  }

  show(on) { this.el.hud.hidden = !on; }

  clock(matchTime, duration) {
    const m = Math.min(90, Math.floor(matchTime / duration * 90));
    const s = Math.floor((matchTime / duration * 90 * 60) % 60);
    this.el.clock.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  _timed(key, el, ms, cls = 'show') {
    clearTimeout(this.timers[key]);
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    this.timers[key] = setTimeout(() => el.classList.remove(cls), ms);
  }

  message(title, sub, color) {
    if (this.silent) return;
    const e = this.el;
    e.bannerT.textContent = title;
    e.bannerS.textContent = sub || '';
    e.banner.style.setProperty('--team', color || '#ffb627');
    this._timed('banner', e.banner, 2200);
  }

  flash(text) {
    if (this.silent) return;
    this.el.flash.textContent = text;
    this._timed('flash', this.el.flash, 1300);
  }

  toast(text) {
    this.el.toast.textContent = text;
    this._timed('toast', this.el.toast, 1400);
  }

  goal(team, number, own, hs, as) {
    this.el.homeScore.textContent = hs;
    this.el.awayScore.textContent = as;
    if (this.silent) return;
    const e = this.el;
    e.goal.style.setProperty('--team', team.kit.shirt);
    e.goal.style.setProperty('--team2', team.kit.shorts);
    e.goalWord.textContent = '¡GOOOL!';
    e.goalSub.textContent = own ? `Gol en propia puerta · ${team.kit.name}` : `${team.kit.name} · dorsal ${number}`;
    this._timed('goal', e.goal, 3600);
  }

  replay(on) {
    if (this.silent) return;
    const small = this.el.replay.querySelector('small');
    if (small && document.body.classList.contains('touch')) small.textContent = 'PASE · saltar';
    this.el.replay.classList.toggle('show', on);
  }

  hint(text) {
    if (this.silent) text = '';
    if (document.body.classList.contains('touch')) {
      text = text.replace('Pulsa J (o A) para sacar', 'Pulsa PASE para sacar')
        .replace('J saque corto · L saque largo', 'PASE saque corto · CENTRO saque largo')
        .replace('L centro al área · J pase corto · K disparo', 'CENTRO al área · PASE corto · TIRO');
    }
    this.el.hint.textContent = text;
    this.el.hint.classList.toggle('show', !!text);
  }

  pause(on) { if (!this.silent) this.el.pause.hidden = !on; }

  power(v, x, y, visible) {
    const p = this.el.power;
    if (!visible || this.silent) { p.classList.remove('show'); return; }
    p.classList.add('show');
    p.style.transform = `translate(${x - 40}px, ${y - 40}px)`;
    this.el.powerFill.style.width = `${Math.round(v * 100)}%`;
    p.classList.toggle('hot', v > 0.88);
  }

  final(teams, goals) {
    if (this.silent) return;
    const e = this.el;
    const [a, b] = teams;
    e.finalTitle.textContent = a.score === b.score ? 'Empate' : (a.score > b.score ? `Gana ${a.kit.name}` : `Gana ${b.kit.name}`);
    e.finalScore.innerHTML = '';
    const mk = (t) => {
      const d = document.createElement('div');
      d.className = 'fs-team';
      d.innerHTML = `<span class="fs-chip" style="background:${t.kit.shirt}"></span><span class="fs-name"></span><span class="fs-goals">${t.score}</span>`;
      d.querySelector('.fs-name').textContent = t.kit.name;
      return d;
    };
    e.finalScore.append(mk(a), mk(b));
    e.finalList.innerHTML = '';
    if (!goals.length) {
      const li = document.createElement('li');
      li.textContent = 'Sin goles. Partido cerrado.';
      e.finalList.append(li);
    }
    for (const g of goals) {
      const li = document.createElement('li');
      const t = teams[g.team];
      li.innerHTML = `<span class="fl-min">${g.minute}'</span><span class="fs-chip" style="background:${t.kit.shirt}"></span>`;
      const s = document.createElement('span');
      s.textContent = `${t.kit.id} · dorsal ${g.number}${g.own ? ' (p.p.)' : ''}`;
      li.append(s);
      e.finalList.append(li);
    }
    setTimeout(() => { e.final.hidden = false; }, 1800);
  }

  minimap(game) {
    const c = this.ctx;
    const W = this.el.mini.width, H = this.el.mini.height;
    const pad = 6;
    const sx = (W - pad * 2) / PITCH.L, sz = (H - pad * 2) / PITCH.W;
    const X = (x) => pad + (x + HALF_L) * sx;
    const Z = (z) => pad + (z + HALF_W) * sz;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(8,20,14,0.72)';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1;
    c.strokeRect(X(-HALF_L), Z(-HALF_W), PITCH.L * sx, PITCH.W * sz);
    c.beginPath(); c.moveTo(X(0), Z(-HALF_W)); c.lineTo(X(0), Z(HALF_W)); c.stroke();
    c.beginPath(); c.arc(X(0), Z(0), PITCH.circleR * sx, 0, Math.PI * 2); c.stroke();
    for (const s of [-1, 1]) {
      const bx = s * (HALF_L - PITCH.boxD);
      c.strokeRect(Math.min(X(s * HALF_L), X(bx)), Z(-PITCH.boxW / 2), PITCH.boxD * sx, PITCH.boxW * sz);
    }
    for (const t of game.teams) {
      c.fillStyle = t.kit.shirt;
      for (const p of t.players) {
        c.beginPath();
        c.arc(X(p.pos.x), Z(p.pos.z), p === game.human ? 4.2 : 3.2, 0, Math.PI * 2);
        c.fill();
        if (p === game.human) { c.strokeStyle = '#ffd23f'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1; }
      }
    }
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(X(game.ball.p.x), Z(game.ball.p.z), 2.4, 0, Math.PI * 2);
    c.fill();
  }
}
