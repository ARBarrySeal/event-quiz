// Shared by host and player pages.
const COLORS = ['var(--red)', 'var(--blue)', 'var(--yellow)', 'var(--green)'];
const SHAPES = [
  '<svg class="shape" viewBox="0 0 10 10"><path d="M5 .8 9.6 9.2H.4z"/></svg>',          // triangle
  '<svg class="shape" viewBox="0 0 10 10"><path d="M5 .3 9.7 5 5 9.7.3 5z"/></svg>',     // diamond
  '<svg class="shape" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.6"/></svg>',        // circle
  '<svg class="shape" viewBox="0 0 10 10"><rect x=".8" y=".8" width="8.4" height="8.4"/></svg>' // square
];
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
