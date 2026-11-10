// Event Quiz - live Kahoot-style quiz server with QR check-in.
// One process holds all game state in memory (run Cloud Run with max-instances=1).
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { createLeadSync } = require('./leads');
const { isRudeName } = require('./names');

const PORT = process.env.PORT || 8080;
const HOST_KEY = process.env.HOST_KEY || 'changeme';          // host/admin password
if (process.env.K_SERVICE && (!process.env.HOST_KEY || HOST_KEY.length < 12)) {
  console.error('Set HOST_KEY (12+ chars) before running on Cloud Run'); process.exit(1);
}
const PUBLIC_URL = process.env.PUBLIC_URL || '';                // e.g. https://quiz-xyz.run.app
const EVENTS_DIR = process.env.EVENTS_DIR || path.join(__dirname, 'events');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const leads = createLeadSync({ dataDir: DATA_DIR });

const app = express();
app.set('trust proxy', true);   // Cloud Run terminates HTTPS; makes QR links https://
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
app.use(express.json({ limit: '1mb' }));
app.get('/', (_, res) => res.redirect('/host.html'));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const games = new Map(); // pin -> game
const newPin = () => { let p; do { p = String(crypto.randomInt(100000, 1000000)); } while (games.has(p)); return p; };
const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const isHost = (key) => typeof key === 'string' && key.length === HOST_KEY.length &&
  crypto.timingSafeEqual(Buffer.from(key), Buffer.from(HOST_KEY));

function listEvents() {
  return fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json')).flatMap(f => {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, f), 'utf8'));
      return [{ id: f.replace(/\.json$/, ''), title: e.title, questions: e.questions?.length || 0 }];
    } catch { return []; }   // one broken file shouldn't hide the rest
  });
}
// Throws a readable error if an event file is unusable. Returns a cleaned copy.
function validateEvent(e) {
  if (!e || typeof e !== 'object') throw new Error('event must be an object');
  const title = clean(e.title, 80);
  if (!title) throw new Error('title is required');
  const tpq = Number(e.timePerQuestion) || 20;
  if (tpq < 5 || tpq > 120) throw new Error('time per question must be 5-120 seconds');
  if (!Array.isArray(e.questions) || !e.questions.length) throw new Error('add at least one question');
  if (e.questions.length > 200) throw new Error('200 questions max');
  const questions = e.questions.map((q, i) => {
    const n = `question ${i + 1}`;
    const text = clean(q?.q, 300);
    if (!text) throw new Error(`${n} has no text`);
    if (!Array.isArray(q.answers)) throw new Error(`${n} has no answers`);
    const answers = q.answers.map(a => clean(a, 80));
    if (answers.length < 2 || answers.length > 4) throw new Error(`${n} needs 2-4 answers`);
    if (answers.some(a => !a)) throw new Error(`${n} has a blank answer`);
    if (!(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < answers.length)) throw new Error(`${n} has no correct answer marked`);
    const out = { q: text, answers, correct: q.correct };
    if (clean(q.fact, 200)) out.fact = clean(q.fact, 200);   // fun fact shown on the big screen after the answer
    if (q.time != null && q.time !== '') {
      const t = Number(q.time);
      if (!(t >= 5 && t <= 120)) throw new Error(`${n} time must be 5-120 seconds`);
      out.time = t;
    }
    return out;
  });
  const out = { title, timePerQuestion: tpq, questions };
  const dbl = Number(e.doubleLast) || 0;   // double points on the last N questions
  if (!(Number.isInteger(dbl) && dbl >= 0 && dbl <= 10)) throw new Error('double-points questions must be 0-10');
  if (dbl) out.doubleLast = dbl;
  if (clean(e.subtitle, 120)) out.subtitle = clean(e.subtitle, 120);
  // Optional logo: only images shipped in public/logos/, never an outside URL.
  const logo = clean(e.logo, 100);
  if (logo) {
    if (!/^\/logos\/[\w.-]+\.(png|jpe?g|svg|webp)$/i.test(logo)) throw new Error('logo must be a file in /logos/');
    out.logo = logo;
  }
  return out;
}
const eventPath = (id) => {
  if (typeof id !== 'string' || !/^[\w-]{1,60}$/.test(id)) throw new Error('bad event id');
  return path.join(EVENTS_DIR, id + '.json');
};
function loadEvent(id) {
  try { return validateEvent(JSON.parse(fs.readFileSync(eventPath(id), 'utf8'))); }
  catch (e) { throw new Error(e.code === 'ENOENT' ? 'event not found' : e.message); }
}
function saveEvent(id, e) {
  const file = eventPath(id), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(e, null, 2) + '\n');
  fs.renameSync(tmp, file);   // atomic: a crash mid-save never leaves a half-written file
}
// Sort by score and give tied players the same rank.
function rankAll(g) {
  const list = [...g.players.values()].sort((a, b) => b.score - a.score);
  let r = 0;
  list.forEach((p, i) => { if (!i || p.score !== list[i - 1].score) r = i + 1; p.rank = r; });
  return list;
}
const leaderboard = (list, n = 5) => list.slice(0, n).map(p => ({ name: p.name, score: p.score, rank: p.rank, moved: p.moved || 0 }));
const qTime = (g, q) => q.time || g.event.timePerQuestion || 20;
const isDouble = (g, i) => i >= g.event.questions.length - (g.event.doubleLast || 0);
// Current question as players/host see it, with the seconds left (full time when just sent).
function questionPayload(g) {
  const q = g.event.questions[g.qIndex], total = qTime(g, q);
  const time = Math.max(1, Math.round(total - (Date.now() - g.qStart) / 1000));
  return { index: g.qIndex, total: g.event.questions.length, count: q.answers.length, time, q: q.q, answers: q.answers, double: isDouble(g, g.qIndex) };
}

let regWrites = Promise.resolve();
function saveRegistration(g, p) {
  const row = { pin: g.pin, event: g.eventId, time: new Date().toISOString(),
    name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin, consent: p.consent };
  // Serialized async write: on Cloud Run DATA_DIR is a Cloud Storage mount where each
  // append takes ~100ms+, so a blocking write would freeze the game during a check-in rush.
  regWrites = regWrites.then(() => fs.promises.appendFile(path.join(DATA_DIR, 'registrations.jsonl'), JSON.stringify(row) + '\n'))
    .catch(e => console.error('registration write failed:', e.message, JSON.stringify(row)));
  leads.push({ ...row, eventTitle: g.event.title });
}

// ---------- game flow ----------
function sendQuestion(g) {
  g.phase = 'question'; g.answers = new Map(); g.qStart = Date.now();
  const pub = questionPayload(g);
  io.to(g.pin + ':host').emit('question', pub);
  io.to(g.pin + ':players').emit('question', pub);
  clearTimeout(g.timer);
  g.timer = setTimeout(() => reveal(g), qTime(g, g.event.questions[g.qIndex]) * 1000 + 500);
}

function reveal(g) {
  if (g.phase !== 'question') return;
  clearTimeout(g.timer);
  g.phase = 'reveal';
  const q = g.event.questions[g.qIndex];
  const counts = q.answers.map(() => 0);
  let right = 0;
  for (const a of g.answers.values()) { counts[a.choice]++; if (a.correct) right++; }
  const pct = g.answers.size ? Math.round(100 * right / g.answers.size) : 0;
  const list = rankAll(g);
  let ahead = null;   // lowest-scoring player who is still ahead of the current one
  let nextIdx = 0;    // first player with a lower score than the current one
  list.forEach((p, i) => {
    if (i && p.score !== list[i - 1].score) ahead = list[i - 1];
    if (nextIdx <= i) { nextIdx = i; while (nextIdx < list.length && list[nextIdx].score >= p.score) nextIdx++; }
    const next = list[nextIdx];
    p.moved = p.prevRank ? p.prevRank - p.rank : 0;
    if (p.firstRank == null) p.firstRank = p.rank;   // for the "biggest climber" prize
    const a = g.answers.get(p.id);
    if (!a) p.streak = 0;
    io.to(p.id).emit('result', { correct: !!a?.correct, answered: !!a, points: a?.points || 0, double: isDouble(g, g.qIndex),
      score: p.score, rank: p.rank, of: list.length, streak: p.streak, moved: p.moved, pct,
      behind: p.rank > 1 && ahead ? { name: ahead.name, gap: ahead.score - p.score } : null,
      leadBy: p.rank === 1 && next ? p.score - next.score : null });
  });
  g.lastReveal = { q: g.qIndex, correct: q.correct, counts, answered: g.answers.size, pct, fact: q.fact || '',
    leaderboard: leaderboard(list), last: g.qIndex === g.event.questions.length - 1 };
  io.to(g.pin + ':host').emit('reveal', g.lastReveal);
  list.forEach(p => { p.prevRank = p.rank; });
}

// Bonus prizes so more people win than the top 3. Each goes to the best player outside the podium
// (skipped if nobody there qualifies) and nobody wins two.
function awards(list) {
  const out = [], used = new Set();
  const give = (title, emoji, value, detail) => {
    const pool = list.filter(p => p.rank > 3 && !used.has(p.id)).map(p => [p, value(p)]).filter(([, v]) => v != null && v > 0);
    if (!pool.length) return;
    pool.sort((a, b) => b[1] - a[1] || a[0].rank - b[0].rank);
    const [p, v] = pool[0]; used.add(p.id);
    p.award = `${emoji} ${title}`;
    out.push({ title, emoji, name: p.name, detail: detail(p, v) });
  };
  give('Longest streak', '🔥', p => p.bestStreak >= 3 ? p.bestStreak : null, (p) => `${p.bestStreak} right in a row`);
  give('Biggest climber', '🚀', p => p.firstRank != null ? p.firstRank - p.rank : null, (p, v) => `up ${v} place${v > 1 ? 's' : ''}`);
  give('Fastest finger', '⚡', p => p.fastest != null ? 1e7 - p.fastest : null, (p) => `${(p.fastest / 1000).toFixed(1)}s right answer`);
  return out;
}

function finish(g) {
  clearTimeout(g.timer);
  g.phase = 'final';
  const list = rankAll(g);
  list.forEach(p => { delete p.award; });
  const bonus = awards(list);
  g.finalData = { podium: leaderboard(list, 10), awards: bonus };
  io.to(g.pin + ':host').emit('final', g.finalData);
  list.forEach(p => io.to(p.id).emit('final', { rank: p.rank, of: list.length, score: p.score, award: p.award || '' }));
}

const lobbyUpdate = (g) => io.to(g.pin + ':host').emit('lobby', {
  count: g.players.size, names: [...g.players.values()].slice(-60).map(p => p.name) });

// ---------- sockets ----------
// ---------- idle shutoff ----------
// Open pages keep sockets open, and open sockets keep Cloud Run running (and billing). After IDLE_HOURS with
// no real game activity, tell every page to disconnect without reconnecting so the service can scale to zero.
// Automatic reconnects (host:rejoin / player:rejoin) don't count as activity.
const IDLE_MS = (+process.env.IDLE_HOURS || 3) * 3600e3;
const ACTIVITY = new Set(['host:create', 'host:next', 'host:kick', 'player:join', 'player:answer']);
let lastActivity = Date.now(), idled = false;
setInterval(() => {
  if (idled || Date.now() - lastActivity < IDLE_MS || io.engine.clientsCount === 0) return;
  console.log(`idle ${IDLE_MS / 3600e3}h: disconnecting ${io.engine.clientsCount} connection(s)`);
  idled = true; io.emit('idle');
  setTimeout(() => io.disconnectSockets(true), 2000);
}, Math.min(60e3, IDLE_MS / 4)).unref();

io.on('connection', (socket) => {
  if (idled) { idled = false; lastActivity = Date.now(); }   // someone reloaded after a shutoff
  socket.onAny((ev) => { if (ACTIVITY.has(ev)) lastActivity = Date.now(); });

  // HOST
  socket.on('host:create', ({ key, eventId } = {}, cb = () => {}) => {
    if (!isHost(key)) return cb({ error: 'Wrong host key' });
    let event; try { event = loadEvent(eventId); } catch (e) { return cb({ error: e.message }); }
    const pin = newPin();
    const g = { pin, eventId, event, players: new Map(), phase: 'lobby', qIndex: -1, answers: new Map(), banned: new Set() };
    games.set(pin, g);
    socket.join(pin + ':host'); socket.data.hostPin = pin;
    cb({ pin, title: event.title, logo: event.logo || '', total: event.questions.length, phase: 'lobby', qIndex: -1 });
  });
  socket.on('host:rejoin', ({ key, pin } = {}, cb = () => {}) => {
    const g = games.get(pin);
    if (!isHost(key) || !g) return cb({ error: 'Game not found' });
    socket.join(pin + ':host'); socket.data.hostPin = pin;
    cb({ pin, title: g.event.title, logo: g.event.logo || '', total: g.event.questions.length, phase: g.phase, qIndex: g.qIndex });
    lobbyUpdate(g);
    // Host screen was refreshed mid-game: put it back exactly where the game is.
    if (g.phase === 'question') {
      socket.emit('question', questionPayload(g));
      socket.emit('answered', { answered: g.answers.size, players: g.players.size });
    } else if (g.phase === 'reveal') {
      socket.emit('question', { ...questionPayload(g), time: 0 });
      socket.emit('reveal', g.lastReveal);
    } else if (g.phase === 'final') socket.emit('final', g.finalData);
  });
  const hostGame = () => games.get(socket.data.hostPin);
  // act 'reveal' = end the current question early; act 'advance' = start / next question / final results.
  // q is the question the host screen is showing, so a double-click or stale screen can't skip a question.
  socket.on('host:next', ({ act, q } = {}) => {
    const g = hostGame(); if (!g || q !== g.qIndex) return;
    if (act === 'reveal') { if (g.phase === 'question') reveal(g); return; }
    if (act !== 'advance' || !(g.phase === 'lobby' || g.phase === 'reveal')) return;
    if (g.qIndex + 1 >= g.event.questions.length) return finish(g);
    g.qIndex++; sendQuestion(g);
  });
  // Remove a player (rude name etc). Their email can't rejoin this game.
  socket.on('host:kick', ({ name } = {}) => {
    const g = hostGame(); if (!g) return;
    for (const p of g.players.values()) if (p.name === name) {
      g.players.delete(p.id); g.answers.delete(p.id); g.banned.add(p.email);
      io.to(p.id).emit('kicked');
      io.in(p.id).socketsLeave([g.pin + ':players', p.id]);
    }
    lobbyUpdate(g);
    if (g.phase === 'question') {
      io.to(g.pin + ':host').emit('answered', { answered: g.answers.size, players: g.players.size });
      if (g.players.size && g.answers.size >= g.players.size) reveal(g);
    }
  });

  // PLAYER
  const attach = (g, p) => {
    socket.join(p.id); socket.join(g.pin + ':players');
    socket.data.pin = g.pin; socket.data.pid = p.id;
  };
  // Phone joined or came back mid-question: send it with the time that's left
  const catchUp = (g, p) => { if (g.phase === 'question' && !g.answers.has(p.id)) socket.emit('question', questionPayload(g)); };
  socket.on('player:join', (d = {}, cb = () => {}) => {
    const g = games.get(clean(d.pin, 6));
    if (!g) return cb({ error: 'No game with that PIN' });
    if (g.phase === 'final') return cb({ error: 'This game has ended' });
    const p = { id: crypto.randomUUID(), name: clean(d.name, 24), email: clean(d.email, 120).toLowerCase(),
      phone: clean(d.phone, 30), linkedin: clean(d.linkedin, 200), consent: !!d.consent, score: 0, streak: 0, bestStreak: 0 };
    if (!p.name) return cb({ error: 'Name is required' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return cb({ error: 'Valid email is required' });
    if (g.banned.has(p.email)) return cb({ error: 'The host removed you from this game' });
    // Same email already playing (lost the session, new browser): put them back on their own score
    // instead of creating a second player and a duplicate lead row.
    const mine = [...g.players.values()].find(x => x.email === p.email);
    if (mine) {
      attach(g, mine);
      cb({ playerId: mine.id, name: mine.name, score: mine.score, resumed: true, title: g.event.title, logo: g.event.logo || '' });
      return catchUp(g, mine);
    }
    if (isRudeName(p.name)) return cb({ error: 'Please pick a different screen name' });
    if ([...g.players.values()].some(x => x.name.toLowerCase() === p.name.toLowerCase()))
      return cb({ error: 'That name is taken' });
    g.players.set(p.id, p); saveRegistration(g, p);
    attach(g, p);
    cb({ playerId: p.id, name: p.name, score: 0, title: g.event.title, logo: g.event.logo || '' });
    lobbyUpdate(g);
    catchUp(g, p);
  });
  socket.on('player:rejoin', ({ pin, playerId } = {}, cb = () => {}) => {
    const g = games.get(pin); const p = g?.players.get(playerId);
    if (!p) return cb({ error: 'Session expired' });
    attach(g, p);
    cb({ name: p.name, score: p.score, title: g.event.title, logo: g.event.logo || '', phase: g.phase,
      answered: g.phase === 'question' && g.answers.has(p.id) });
    catchUp(g, p);
  });
  socket.on('player:answer', ({ choice } = {}, cb = () => {}) => {
    const g = games.get(socket.data.pin); const p = g?.players.get(socket.data.pid);
    if (!p || g.phase !== 'question' || g.answers.has(p.id)) return cb({ error: 'Not accepting' });
    const q = g.event.questions[g.qIndex];
    if (!(Number.isInteger(choice) && choice >= 0 && choice < q.answers.length)) return cb({ error: 'Bad choice' });
    const time = qTime(g, q) * 1000;
    const elapsed = Math.min(Date.now() - g.qStart, time);
    const correct = choice === q.correct;
    p.streak = correct ? p.streak + 1 : 0;
    if (correct) { p.bestStreak = Math.max(p.bestStreak || 0, p.streak); p.fastest = Math.min(p.fastest ?? Infinity, elapsed); }
    // Kahoot-style: up to 1000 pts, decaying to 500 at the buzzer, + small streak bonus; x2 on double-points questions
    const points = correct ? (Math.round(1000 * (1 - elapsed / time / 2)) + Math.min(p.streak - 1, 5) * 100) * (isDouble(g, g.qIndex) ? 2 : 1) : 0;
    p.score += points;
    g.answers.set(p.id, { choice, correct, points });
    cb({ ok: true });
    io.to(g.pin + ':host').emit('answered', { answered: g.answers.size, players: g.players.size });
    if (g.answers.size >= g.players.size) reveal(g);
  });
});

// ---------- HTTP API ----------
app.get('/api/events', (req, res) => isHost(req.get('x-host-key')) ? res.json(listEvents()) : res.sendStatus(401));
const hostOnly = (req, res, next) => isHost(req.get('x-host-key')) ? next() : res.sendStatus(401);
app.get('/api/events/:id', hostOnly, (req, res) => {
  try { res.json(JSON.parse(fs.readFileSync(eventPath(req.params.id), 'utf8'))); }
  catch (e) { res.status(e.code === 'ENOENT' ? 404 : 400).json({ error: e.code === 'ENOENT' ? 'event not found' : e.message }); }
});
// Save an event. ?create=1 refuses to overwrite an existing file.
app.put('/api/events/:id', hostOnly, (req, res) => {
  try {
    const file = eventPath(req.params.id);
    if (req.query.create && fs.existsSync(file)) return res.status(409).json({ error: 'an event with that id already exists' });
    const e = validateEvent(req.body);
    saveEvent(req.params.id, e);
    res.json({ ok: true, id: req.params.id, questions: e.questions.length });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Public: lets the check-in page show the event's title and logo before the player joins.
app.get('/api/game/:pin', (req, res) => {
  const g = games.get(req.params.pin);
  g ? res.json({ title: g.event.title, logo: g.event.logo || '' }) : res.sendStatus(404);
});
app.get('/api/qr/:pin.png', async (req, res) => {
  const url = `${baseUrl(req)}/play.html?pin=${encodeURIComponent(req.params.pin)}`;
  res.type('png').send(await QRCode.toBuffer(url, { width: 600, margin: 1 }));
});
app.get('/api/registrations.csv', async (req, res) => {
  if (!isHost(req.query.key)) return res.sendStatus(401);
  await regWrites;   // include check-ins still being written
  const f = path.join(DATA_DIR, 'registrations.jsonl');
  const rows = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const cols = ['time', 'event', 'pin', 'name', 'email', 'phone', 'linkedin', 'consent'];
  // quote every cell; prefix ' so Excel won't run a formula a player typed into the form
  const esc = (v) => { const t = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replace(/"/g, '""')}"`; };
  res.type('text/csv').attachment('registrations.csv')
    .send([cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
});
app.get('/api/leads/status', hostOnly, (_, res) => res.json({ enabled: leads.enabled, ...leads.stats }));
app.get('/healthz', (_, res) => res.send('ok'));

server.listen(PORT, () => console.log(`Event Quiz on :${PORT} (HubSpot ${leads.enabled.hubspot ? 'on' : 'off'}, Sheet ${leads.enabled.sheet ? 'on' : 'off'})`));
