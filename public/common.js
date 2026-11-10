// Shared by host and player pages.
// Each answer has a color and a letter badge, so the host can say "A, B, C or D" and players can match by either.
const COLORS = ['var(--a)', 'var(--b)', 'var(--c)', 'var(--d)'];
const KEYS = ['A', 'B', 'C', 'D'].map(l => `<span class="key">${l}</span>`);
// Sponsor badge shown on the host and player screens. Edit here to rebrand.
const SPONSOR = { name: 'DoD Cyber Consulting', url: 'https://dodcyberconsulting.com' };
function renderSponsor() {
  const shield = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="8" fill="#0a0a0a"/>' +
    '<path d="M16 18 L32 12 L48 18 L48 34 C48 42 41 49 32 52 C23 49 16 42 16 34 Z" fill="none" stroke="#00d4ff" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M25 32 L30 37 L40 26" fill="none" stroke="#00d4ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.querySelectorAll('[data-sponsor]').forEach(a => {
    a.className = 'sponsor'; a.href = SPONSOR.url; a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = 'Presented by ' + shield + '<b>' + SPONSOR.name + '</b>';
  });
}
renderSponsor();

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
