// Big-screen background effects: falling code, a drifting grid, a red pulse when time is short,
// and particles (answer "packets", reveal bursts, confetti). All drawn in the browser, no image or video files.
// Turn off with the ✨ button or the B key (remembered on this computer). Off by default if the computer asks for reduced motion.
const Fx = (() => {
  let on = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { const s = localStorage.getItem('eq-fx'); if (s != null) on = s === '1'; } catch {}

  const css = document.createElement('style');
  css.textContent = `
    #fx-rain, #fx-top, #fx-grid, #fx-vig, #fx-flash { position: fixed; inset: 0; pointer-events: none; }
    #fx-rain { z-index: 0; width: 100%; height: 100%; opacity: .5; }
    #fx-grid { z-index: 0; overflow: hidden; -webkit-mask-image: radial-gradient(ellipse at 50% 55%, #000 0, transparent 78%); mask-image: radial-gradient(ellipse at 50% 55%, #000 0, transparent 78%); }
    #fx-grid i { position: absolute; inset: -80px; background-size: 80px 80px; animation: fxGrid 16s linear infinite;
      background-image: linear-gradient(rgba(57,255,136,.075) 1px, transparent 1px), linear-gradient(90deg, rgba(57,255,136,.075) 1px, transparent 1px); }
    @keyframes fxGrid { to { transform: translate3d(80px, 80px, 0); } }
    #fx-vig { z-index: 0; box-shadow: inset 0 0 24vh 5vh rgba(0,0,0,.8); }
    #fx-vig::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 22vh 3vh rgba(255,40,80,.6); opacity: 0; transition: opacity .6s; will-change: opacity; }
    body.fx-danger #fx-vig::after { animation: fxPulse .5s ease-in-out infinite alternate; }
    @keyframes fxPulse { from { opacity: .3 } to { opacity: 1 } }
    #fx-top { z-index: 40; width: 100%; height: 100%; }
    #fx-flash { z-index: 39; opacity: 0; background: radial-gradient(circle at 50% 62%, rgba(57,255,136,.5), transparent 72%); }
    #fx-flash.go { animation: fxFlash .55s ease-out; }
    @keyframes fxFlash { 0% { opacity: 0 } 18% { opacity: 1 } 100% { opacity: 0 } }
    body.fx-off #fx-rain, body.fx-off #fx-grid, body.fx-off #fx-top, body.fx-off #fx-flash { display: none; }`;
  document.head.appendChild(css);

  const mk = (tag, id, html = '') => { const e = document.createElement(tag); e.id = id; e.setAttribute('aria-hidden', 'true'); e.innerHTML = html; return e; };
  const rain = mk('canvas', 'fx-rain'), top = mk('canvas', 'fx-top'), flashEl = mk('div', 'fx-flash');
  document.body.prepend(rain, mk('div', 'fx-grid', '<i></i>'), mk('div', 'fx-vig'), flashEl, top);
  const rc = rain.getContext('2d', { alpha: false }), tc = top.getContext('2d');
  document.body.classList.toggle('fx-off', !on);

  // ---- falling code ----
  const GLYPHS = '0123456789ABCDEF0101<>/{}[]#$%&*+=:;|'.split('');
  const MOODS = {                        // speed, color
    calm:   [0.7, [57, 255, 136]],
    live:   [1.0, [57, 255, 136]],
    danger: [2.6, [255, 60, 95]],
    win:    [1.3, [255, 205, 70]],
  };
  let W = 0, H = 0, cell = 20, coarse = 1, drops = [], speed = 0.7, rgb = [57, 255, 136], mood = 'calm';
  function resize() {
    W = rain.width = top.width = innerWidth; H = rain.height = top.height = innerHeight;
    cell = Math.round(Math.max(16, H / 44) * coarse);
    drops = Array.from({ length: Math.ceil(W / cell) }, () => ({ y: -Math.random() * 40, v: 0.3 + Math.random() * 0.7, row: -1, ch: '0' }));
    rc.fillStyle = '#040806'; rc.fillRect(0, 0, W, H);
  }
  function rainStep() {
    const [ts, tc3] = MOODS[mood];
    speed += (ts - speed) * 0.12;
    rgb = rgb.map((v, i) => v + (tc3[i] - v) * 0.12);
    const [r, g, b] = rgb.map(Math.round);
    rc.fillStyle = 'rgba(4,8,6,.1)'; rc.fillRect(0, 0, W, H);          // older glyphs fade into trails
    rc.font = `800 ${cell - 5}px "JetBrains Mono", Consolas, monospace`; rc.textAlign = 'center'; rc.textBaseline = 'top';
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i], x = i * cell + cell / 2;
      d.y += d.v * speed;
      const row = Math.floor(d.y);
      if (row === d.row) continue;
      if (d.row >= 0) { rc.fillStyle = `rgb(${r},${g},${b})`; rc.fillText(d.ch, x, d.row * cell); }   // old head becomes trail color
      d.row = row; d.ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      if (row >= 0) { rc.fillStyle = `rgb(${(r + 510) / 3 | 0},${(g + 510) / 3 | 0},${(b + 510) / 3 | 0})`; rc.fillText(d.ch, x, row * cell); }   // bright head
      if (row * cell > H && Math.random() > 0.94) { d.y = -Math.random() * 12; d.row = -1; d.v = 0.3 + Math.random() * 0.7; }
    }
  }

  // ---- particles ----
  let parts = [];
  const room = () => on && parts.length < 900;
  const CONFETTI = ['#39ff88', '#00d4ff', '#ffb627', '#ffffff', '#e5294e', '#8b46e0', '#1f6feb'];
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  function burst(x, y, color = '#39ff88', n = 54) {
    const k = H / 900;
    for (let i = 0; i < n && room(); i++) {
      const a = Math.random() * Math.PI * 2, s = (2 + Math.random() * 9) * k;
      parts.push({ t: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2 * k, life: 1, fade: 0.012 + Math.random() * 0.016, size: (2 + Math.random() * 3) * k, color });
    }
  }
  function confetti(n = 170) {
    const k = H / 900;
    for (let i = 0; i < n && room(); i++) parts.push({ t: 'conf', x: Math.random() * W, y: -20 - Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 2.4 * k,
      vy: (2 + Math.random() * 3.6) * k, rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.3, w: (7 + Math.random() * 8) * k, h: (4 + Math.random() * 5) * k,
      color: CONFETTI[(Math.random() * CONFETTI.length) | 0], life: 1, sway: Math.random() * 6.3 });
  }
  // A streak that flies to (tx, ty): one per answer that comes in. Starts at (sx, sy), or at the bottom edge if not given.
  function packet(tx, ty, sx, sy, color = '#39ff88') {
    if (!room()) return;
    if (sx == null) { sx = W * (0.15 + Math.random() * 0.7); sy = H + 10; }
    parts.push({ t: 'pkt', sx, sy, tx, ty, p: 0, sp: 0.035 + Math.random() * 0.02, color });
  }
  function drawParts(dt) {
    tc.clearRect(0, 0, W, H);
    const g = 0.16 * (H / 900) * dt;
    parts = parts.filter(p => {
      if (p.t === 'spark') {
        p.vy += g; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.fade * dt;
        if (p.life <= 0) return false;
        tc.globalAlpha = Math.min(1, p.life * 1.4); tc.fillStyle = p.color;
        tc.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else if (p.t === 'conf') {
        p.sway += 0.05 * dt; p.x += (p.vx + Math.sin(p.sway) * 0.9) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.y > H + 30) return false;
        tc.globalAlpha = 0.95; tc.fillStyle = p.color;
        tc.save(); tc.translate(p.x, p.y); tc.rotate(p.rot); tc.scale(1, Math.cos(p.sway * 2)); tc.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); tc.restore();
      } else {
        p.p += p.sp * dt;
        if (p.p >= 1) { burst(p.tx, p.ty, p.color, 5); return false; }
        const e = 1 - Math.pow(1 - p.p, 2), e0 = Math.max(0, e - 0.09);   // ease out, with a short tail
        const x = p.sx + (p.tx - p.sx) * e, y = p.sy + (p.ty - p.sy) * e;
        tc.globalAlpha = 0.75; tc.strokeStyle = p.color; tc.lineWidth = Math.max(2, H / 380); tc.lineCap = 'round';
        tc.beginPath(); tc.moveTo(p.sx + (p.tx - p.sx) * e0, p.sy + (p.ty - p.sy) * e0); tc.lineTo(x, y); tc.stroke();
      }
      return true;
    });
    tc.globalAlpha = 1;
  }

  // ---- one loop for everything; pauses itself when the tab is hidden ----
  let lastRain = 0, lastFrame = 0, slow = 0, dirty = false;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!on) return;
    if (ts - lastRain >= 46) {
      lastRain = ts;
      const t0 = performance.now(); rainStep();
      // Slow laptop? Use bigger (fewer) glyphs, at most twice.
      if (performance.now() - t0 > 12) { if (++slow > 40 && coarse < 2) { coarse *= 1.45; slow = 0; resize(); } } else slow = Math.max(0, slow - 1);
    }
    const dt = Math.min(3, (ts - lastFrame) / 16.7 || 1); lastFrame = ts;
    if (parts.length) { drawParts(dt); dirty = true; }
    else if (dirty) { tc.clearRect(0, 0, W, H); dirty = false; }
  }
  resize(); addEventListener('resize', resize); requestAnimationFrame(frame);

  return {
    // 'calm' (lobby, scoreboard), 'live' (question running), 'danger' (last seconds), 'win' (podium)
    mood(m) { if (MOODS[m]) mood = m; document.body.classList.toggle('fx-danger', m === 'danger'); },
    burst, confetti,
    burstAt(el, color, n) { if (el && on) burst(...centre(el), color, n); },
    // from = element the streak starts at (skipped if it is hidden)
    packetTo(el, from) {
      if (!el || !on) return;
      const r = from && from.getBoundingClientRect(), start = r && (r.left || r.top) ? [r.left + r.width / 2, r.top + r.height / 2] : [];
      packet(...centre(el), ...start);
    },
    flash() { if (!on) return; flashEl.classList.remove('go'); void flashEl.offsetWidth; flashEl.classList.add('go'); },
    toggle() {
      on = !on; try { localStorage.setItem('eq-fx', on ? '1' : '0'); } catch {}
      document.body.classList.toggle('fx-off', !on);
      if (on) resize(); else { parts = []; tc.clearRect(0, 0, W, H); }
      return on;
    },
    get on() { return on; },
  };
})();
