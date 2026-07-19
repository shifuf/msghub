// TCP wait only — do not load Prisma here (avoids openssl noise before migrate/generate)
const net = require('net');
const url = process.env.DATABASE_URL || '';
// postgresql://user:pass@host:5432/db
let host = 'postgres';
let port = 5432;
try {
  const u = new URL(url.replace(/^postgresql:/, 'http:'));
  host = u.hostname || host;
  port = Number(u.port || 5432);
} catch {}

const socket = net.connect({ host, port });
const timer = setTimeout(() => {
  socket.destroy();
  console.error(`timeout connecting ${host}:${port}`);
  process.exit(1);
}, 3000);

socket.on('connect', () => {
  clearTimeout(timer);
  socket.end();
  process.exit(0);
});
socket.on('error', (e) => {
  clearTimeout(timer);
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});