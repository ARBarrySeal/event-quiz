// Event Quiz - live Kahoot-style quiz server with QR check-in.
// One process holds all game state in memory (run Cloud Run with max-instances=1).
const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 8080;
const HOST_KEY = process.env.HOST_KEY || 'changeme';          // host/admin password
if (process.env.K_SERVICE && (!process.env.HOST_KEY || HOST_KEY.length < 12)) {
  console.error('Set HOST_KEY (12+ chars) before running on Cloud Run'); process.exit(1);
}
const PUBLIC_URL = process.env.PUBLIC_URL || '';                // e.g. https://quiz-xyz.run.app
const EVENTS_DIR = path.join(__dirname, 'events');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const games = new Map(); // pin -> game
const newPin = () => { let p; do { p = String(crypto.randomInt(100000, 1000000)); } while (games.has(p)); return p; };
const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);
const baseUrl = (req) => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const isHost = (key) => typeof key === 'string' && key.length === HOST_KEY.length &&
  crypto.timingSafeEqual(Buffer.from(key), Buffer.from(HOST_KEY));

function listEvents() {
  return fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json')).map(f => {
    const e = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, f), 'utf8'));
    return { id: f.replace(/\.json$/, ''), title: e.title, questions: e.questions.length };
  });
}
function loadEvent(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('bad event id');
  const e = JSON.parse(fs.readFileSync(path.join(EVENTS_DIR, id + '.json'), 'utf8'));
  e.questions.forEach((q, i) => {
    if (!q.q || !Array.isArray(q.answers) || q.answers.length < 2 || q.answers.length > 4 ||
        !(q.correct >= 0 && q.correct < q.answers.length)) throw new Error(`question ${i + 1} is malformed`);
  });
  return e;
}
const leaderboard = (g, n = 5) => [...g.players.values()]
  .sort((a, b) => b.score - a.score).slice(0, n).map(p => ({ name: p.name, score: p.score }));

function saveRegistration(g, p) {
  const row = { pin: g.pin, event: g.eventId, time: new Date().toISOString(),
    name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin, consent: p.consent };
  fs.appendFileSync(path.join(DATA_DIR, 'registrations.jsonl'), JSON.stringify(row) + '\n');
}

// ---------- game flow ----------
function sendQuestion(g) {
  const q = g.event.questions[g.qIndex];
  const time = q.time || g.event.timePerQuestion || 20;
  g.phase = 'question'; g.answers = new Map(); g.qStart = Date.now();
  const pub = { index: g.qIndex, total: g.event.questions.length, q: q.q, answers: q.answers, time };
  io.to(g.pin + ':host').emit('question', pub);
  io.to(g.pin + ':players').emit('question', { index: pub.index, total: pub.total, count: q.answers.length, time, q: q.q, answers: q.answers });
  clearTimeout(g.timer);
  g.timer = setTimeout(() => reveal(g), time * 1000 + 500);
}

function reveal(g) {
  if (g.phase !== 'question') return;
  clearTimeout(g.timer);
  g.phase = 'reveal';
  const q = g.event.questions[g.qIndex];
  const counts = q.answers.map(() => 0);
  for (const a of g.answers.values()) counts[a.choice]++;
  const ranked = [...g.players.values()].sort((a, b) => b.score - a.score);
  ranked.forEach((p, i) => {
    const a = g.answers.get(p.id);
    if (!a) p.streak = 0;
    io.to(p.id).emit('result', { correct: !!a?.correct, answered: !!a, points: a?.points || 0,
      score: p.score, rank: i + 1, of: ranked.length, streak: p.streak });
  });
  io.to(g.pin + ':host').emit('reveal', { correct: q.correct, counts, answered: g.answers.size,
    leaderboard: leaderboard(g), last: g.qIndex === g.event.questions.length - 1 });
}

function finish(g) {
  clearTimeout(g.timer);
  g.phase = 'final';
  const podium = leaderboard(g, 10);
  io.to(g.pin + ':host').emit('final', { podium });
  const ranked = [...g.players.values()].sort((a, b) => b.score - a.score);
  ranked.forEach((p, i) => io.to(p.id).emit('final', { rank: i + 1, of: ranked.length, score: p.score }));
}

const lobbyUpdate = (g) => io.to(g.pin + ':host').emit('lobby', {
  count: g.players.size, names: [...g.players.values()].slice(-60).map(p => p.name) });

// ---------- sockets ----------
io.on('connection', (socket) => {
  // HOST
  socket.on('host:create', ({ key, eventId } = {}, cb = () => {}) => {
    if (!isHost(key)) return cb({ error: 'Wrong host key' });
    let event; try { event = loadEvent(eventId); } catch (e) { return cb({ error: e.message }); }
    const pin = newPin();
    const g = { pin, eventId, event, players: new Map(), phase: 'lobby', qIndex: -1, answers: new Map() };
    games.set(pin, g);
    socket.join(pin + ':host'); socket.data.hostPin = pin;
    cb({ pin, title: event.title, total: event.questions.length });
  });
  socket.on('host:rejoin', ({ key, pin } = {}, cb = () => {}) => {
    const g = games.get(pin);
    if (!isHost(key) || !g) return cb({ error: 'Game not found' });
    socket.join(pin + ':host'); socket.data.hostPin = pin;
    cb({ pin, title: g.event.title, total: g.event.questions.length, phase: g.phase, qIndex: g.qIndex });
    lobbyUpdate(g);
  });
  const hostGame = () => games.get(socket.data.hostPin);
  socket.on('host:next', () => {
    const g = hostGame(); if (!g) return;
    if (g.phase === 'question') return reveal(g);           // skip timer
    if (g.qIndex + 1 >= g.event.questions.length) return finish(g);
    g.qIndex++; sendQuestion(g);
  });
  socket.on('host:kick', ({ name } = {}) => {
    const g = hostGame(); if (!g) return;
    for (const p of g.players.values()) if (p.name === name) { g.players.delete(p.id); io.to(p.id).emit('kicked'); }
    lobbyUpdate(g);
  });

  // PLAYER
  socket.on('player:join', (d = {}, cb = () => {}) => {
    const g = games.get(clean(d.pin, 6));
    if (!g) return cb({ error: 'No game with that PIN' });
    if (g.phase === 'final') return cb({ error: 'This game has ended' });
    const p = { id: crypto.randomUUID(), name: clean(d.name, 24), email: clean(d.email, 120).toLowerCase(),
      phone: clean(d.phone, 30), linkedin: clean(d.linkedin, 200), consent: !!d.consent, score: 0, streak: 0 };
    if (!p.name) return cb({ error: 'Name is required' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return cb({ error: 'Valid email is required' });
    if ([...g.players.values()].some(x => x.name.toLowerCase() === p.name.toLowerCase()))
      return cb({ error: 'That name is taken' });
    g.players.set(p.id, p); saveRegistration(g, p);
    socket.join(p.id); socket.join(g.pin + ':players');
    socket.data.pin = g.pin; socket.data.pid = p.id;
    cb({ playerId: p.id, name: p.name, title: g.event.title });
    lobbyUpdate(g);
  });
  socket.on('player:rejoin', ({ pin, playerId } = {}, cb = () => {}) => {
    const g = games.get(pin); const p = g?.players.get(playerId);
    if (!p) return cb({ error: 'Session expired' });
    socket.join(p.id); socket.join(g.pin + ':players');
    socket.data.pin = g.pin; socket.data.pid = p.id;
    cb({ name: p.name, score: p.score, title: g.event.title, phase: g.phase });
  });
  socket.on('player:answer', ({ choice } = {}, cb = () => {}) => {
    const g = games.get(socket.data.pin); const p = g?.players.get(socket.data.pid);
    if (!p || g.phase !== 'question' || g.answers.has(p.id)) return cb({ error: 'Not accepting' });
    const q = g.event.questions[g.qIndex];
    if (!(choice >= 0 && choice < q.answers.length)) return cb({ error: 'Bad choice' });
    const time = (q.time || g.event.timePerQuestion || 20) * 1000;
    const elapsed = Math.min(Date.now() - g.qStart, time);
    const correct = choice === q.correct;
    p.streak = correct ? p.streak + 1 : 0;
    // Kahoot-style: up to 1000 pts, decaying to 500 at the buzzer, + small streak bonus
    const points = correct ? Math.round(1000 * (1 - elapsed / time / 2)) + Math.min(p.streak - 1, 5) * 100 : 0;
    p.score += points;
    g.answers.set(p.id, { choice, correct, points });
    cb({ ok: true });
    io.to(g.pin + ':host').emit('answered', { answered: g.answers.size, players: g.players.size });
    if (g.answers.size >= g.players.size) reveal(g);
  });
});

// ---------- HTTP API ----------
app.get('/api/events', (req, res) => isHost(req.get('x-host-key')) ? res.json(listEvents()) : res.sendStatus(401));
app.get('/api/qr/:pin.png', async (req, res) => {
  const url = `${baseUrl(req)}/play.html?pin=${encodeURIComponent(req.params.pin)}`;
  res.type('png').send(await QRCode.toBuffer(url, { width: 600, margin: 1 }));
});
app.get('/api/registrations.csv', (req, res) => {
  if (!isHost(req.query.key)) return res.sendStatus(401);
  const f = path.join(DATA_DIR, 'registrations.jsonl');
  const rows = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const cols = ['time', 'event', 'pin', 'name', 'email', 'phone', 'linkedin', 'consent'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.type('text/csv').attachment('registrations.csv')
    .send([cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
});
app.get('/healthz', (_, res) => res.send('ok'));

server.listen(PORT, () => console.log(`Event Quiz on :${PORT}`));
