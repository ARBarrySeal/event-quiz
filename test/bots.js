// Joins N bot players to an existing game: PIN=123456 N=40 node test/bots.js
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:8080', PIN = process.env.PIN, N = +process.env.N || 40;
const names = ['ZeroCool','AcidBurn','CrashOverride','Neo','Trinity','PhreakQueen','r00tkit','NullByte','Mudge','DarkTangent','SegFault','StackSmash','0xDEADBEEF','ScriptKiddie','BlueBox','Packet','Sudo','Kernel','Phisherman','BitFlip'];
for (let i = 0; i < N; i++) setTimeout(() => {
  const s = io(URL, { transports: ['websocket'] });
  s.emit('player:join', { pin: PIN, name: (names[i % names.length]) + (i >= names.length ? i : ''), email: `bot${i}@test.io`, consent: true }, r => r.error && console.log(r.error));
  s.on('question', q => setTimeout(() => s.emit('player:answer', { choice: Math.floor(Math.random() * q.count) }), 800 + Math.random() * 6000));
}, i * 60);
