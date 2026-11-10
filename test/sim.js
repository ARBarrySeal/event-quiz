// Simulates 1 host + N players through a full game.
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:8080', KEY = process.env.HOST_KEY || 'changeme', N = +process.env.N || 120;
const host = io(URL);
host.emit('host:create', { key: KEY, eventId: process.env.EVENT || 'sample-hacker' }, async ({ pin, error }) => {
  if (error) { console.error(error); process.exit(1); }
  console.log('PIN', pin);
  host.on('lobby', l => l.count === N && (console.log('lobby full', l.count), host.emit('host:next', { act: 'advance', q: -1 })));
  const players = await Promise.all([...Array(N)].map((_, i) => new Promise(res => {
    const s = io(URL, { transports: ['websocket'] });
    s.emit('player:join', { pin, name: 'p' + i, email: `p${i}@test.io`, phone: '555', linkedin: '', consent: true }, r => res(s));
    s.on('question', q => setTimeout(() => s.emit('player:answer', { choice: Math.floor(Math.random() * q.count) }), Math.random() * 3000));
  })));
  host.on('reveal', r => { console.log('Q reveal: answered', r.answered, 'counts', r.counts.join('/'), 'leader', r.leaderboard[0]); setTimeout(() => host.emit('host:next', { act: 'advance', q: r.q }), 200); });
  host.on('final', f => { console.log('FINAL top3', f.podium.slice(0, 3)); players.forEach(p => p.close()); host.close(); process.exit(0); });
});
