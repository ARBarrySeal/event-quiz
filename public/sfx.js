// Host-screen sound: lobby music, "thinking" music, countdown ticks, reveal sting, join blip, drumroll + fanfare.
// Everything is synthesized with Web Audio (no audio files, nothing to license). Mute with the 🔊 button or the M key.
const Sfx = (() => {
  let ctx = null, master = null, loopTimer = null, playing = null, wanted = null;
  let muted = false;
  try { muted = localStorage.getItem('eq-mute') === '1'; } catch {}
  const N = (n) => 440 * Math.pow(2, (n - 69) / 12);   // MIDI note -> Hz

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55;
    master.connect(lp).connect(ctx.destination);
    return true;
  }
  // Browsers only allow sound after a click/keypress, so the page calls this on every user gesture.
  function unlock() {
    if (!init()) return;
    const go = () => { if (wanted && playing !== wanted) startLoop(wanted); };
    if (ctx.state === 'suspended') ctx.resume().then(go); else go();
  }
  const ready = () => ctx && ctx.state === 'running';

  function tone(freq, t, dur, { type = 'square', vol = 0.12, slide } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  let noiseBuf = null;
  function noise(t, dur, vol = 0.08, freq = 8000) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.05);
  }

  // ---- loops (scheduled a little ahead so timing stays tight) ----
  const LOOPS = {
    lobby: { bpm: 112, step(i, t, sp) {               // Am - F - C - G, bouncy arpeggio
      const ch = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]][Math.floor(i / 8) % 4];
      if (i % 8 === 0) tone(N(ch[0] - 12), t, sp * 7, { type: 'triangle', vol: 0.22 });
      if (i % 2 === 0) tone(N(ch[(i / 2) % 3] + 12), t, sp * 1.6, { type: 'square', vol: 0.045 });
      if (i % 4 === 0) tone(60, t, 0.12, { type: 'sine', vol: 0.35, slide: 40 });   // kick
      if (i % 4 === 2) noise(t, 0.05, 0.05);                                         // hat
    } },
    think: { bpm: 128, step(i, t, sp) {                // tense, minor, steady pulse
      const root = [45, 45, 46, 44][Math.floor(i / 16) % 4];
      if (i % 2 === 0) tone(N(root - 12), t, sp * 1.5, { type: 'sawtooth', vol: 0.07 });
      if (i % 4 === 0) tone(N(root + 12), t, 0.09, { type: 'square', vol: 0.035 });
      if (i % 8 === 6) tone(N(root + 15), t, 0.09, { type: 'square', vol: 0.03 });
      if (i % 2 === 1) noise(t, 0.03, 0.03);
    } },
  };
  function startLoop(kind) {
    stopLoop(); wanted = kind;
    if (!ready() || !LOOPS[kind]) return;
    const L = LOOPS[kind], sp = 60 / L.bpm / 2;      // eighth notes
    let i = 0, next = ctx.currentTime + 0.05;
    playing = kind;
    loopTimer = setInterval(() => {
      while (next < ctx.currentTime + 0.25) { L.step(i++, next, sp); next += sp; }
    }, 60);
  }
  function stopLoop() { clearInterval(loopTimer); loopTimer = null; playing = null; }
  const loop = (kind) => { if (kind) startLoop(kind); else { wanted = null; stopLoop(); } };

  // ---- one-shots ----
  const at = (fn) => { if (ready()) fn(ctx.currentTime + 0.02); };
  const tick = (last) => at(t => tone(last ? 1320 : 880, t, 0.08, { type: 'square', vol: 0.12 }));
  const join = () => at(t => { tone(N(76), t, 0.08, { vol: 0.07 }); tone(N(83), t + 0.07, 0.12, { vol: 0.07 }); });
  const reveal = () => at(t => {
    [60, 64, 67, 72].forEach((n, k) => tone(N(n + 12), t + k * 0.06, 0.5, { type: 'triangle', vol: 0.16 }));
    noise(t, 0.4, 0.07, 3000);
  });
  const timeUp = () => at(t => tone(N(52), t, 0.6, { type: 'sawtooth', vol: 0.12, slide: N(40) }));
  const drumroll = (secs) => at(t => {
    for (let k = 0; k < secs * 22; k++) noise(t + k / 22, 0.06, 0.03 + 0.06 * k / (secs * 22), 1800);
  });
  const fanfare = (delay = 0) => at(t => {
    t += delay;
    [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [76, 0.7], [79, 0.85]].forEach(([n, d]) =>
      tone(N(n), t + d, d === 0.85 ? 1.2 : 0.2, { type: 'square', vol: 0.09 }));
    [48, 55, 60].forEach(n => tone(N(n), t + 0.85, 1.4, { type: 'triangle', vol: 0.15 }));
    noise(t + 0.85, 1.2, 0.08, 5000);
  });

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('eq-mute', m ? '1' : '0'); } catch {}
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.05);
  }
  return { unlock, loop, tick, join, reveal, timeUp, drumroll, fanfare, setMuted, get muted() { return muted; } };
})();
