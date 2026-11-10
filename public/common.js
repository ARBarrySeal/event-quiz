// Shared by host and player pages.
const COLORS = ['var(--red)', 'var(--blue)', 'var(--yellow)', 'var(--green)'];
const SHAPES = [
  '<svg class="shape" viewBox="0 0 10 10"><path d="M5 .8 9.6 9.2H.4z"/></svg>',          // triangle
  '<svg class="shape" viewBox="0 0 10 10"><path d="M5 .3 9.7 5 5 9.7.3 5z"/></svg>',     // diamond
  '<svg class="shape" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.6"/></svg>',        // circle
  '<svg class="shape" viewBox="0 0 10 10"><rect x=".8" y=".8" width="8.4" height="8.4"/></svg>' // square
];
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Server disconnects every page after hours with no game activity so hosting can shut off. Stay disconnected.
function handleIdle(socket) {
  socket.on('idle', () => {
    socket.io.reconnection(false); socket.disconnect();
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
      'padding:16px;background:rgba(0,0,0,.85);color:#fff;font:600 1.2rem/1.5 system-ui,sans-serif;text-align:center';
    d.textContent = 'Paused after 3 hours with no activity. Reload this page to continue.';
    document.body.appendChild(d);
  });
}
