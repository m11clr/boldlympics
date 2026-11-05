// BOLDLYMPICS game server: one shared game, three kinds of clients
//   /        player phone (the QR code points here)
//   /screen  big-screen projection (read only)
//   /admin   Adminland (needs ?key=ADMIN_KEY)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'boldlympics';
const PUB = path.join(__dirname, 'public');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 25000, maxHttpBufferSize: 1e5 });

app.use(express.static(PUB, { index: false, maxAge: '1h' }));
['/', '/play', '/screen', '/admin'].forEach(r => app.get(r, (req, res) => res.sendFile(path.join(PUB, 'app.html'))));
app.get('/healthz', (req, res) => res.send('ok'));

/* ---------- game rules (kept in sync with the client) ---------- */
const T = { lobby: 120, story: 35, client: 10, finalround: 3, rules: 10, results: 20, clientfinal: 10, podium: 30, final: 15, total: 485 };
const GAMES = [{ dur: 20, max: 5000 }, { dur: 20, max: 5000 }, { dur: 40, max: 4900 }, { dur: 80, max: 5200 }, { dur: 42, max: 7000 }];
const MAX_PLAYERS = 300;
// legacy quips (no longer shown; the client messages live in the page)
const QUOTES = ['One more thing…', 'Could you make a few tiny changes?', 'Can we make the logo bigger first?', 'Our CEO showed it to the team. A few notes.', "Let's do just one more round.", 'The board would love to see it in green.', 'Accounting needs a new PO number.', "We'll pay once it goes viral.", 'Love it! Can we see three more options?', "Quick call? Won't take long."];
const NA = ['Pixel', 'Kern', 'Vector', 'Bezier', 'Grid', 'Swatch', 'Serif', 'Glyph', 'Mood', 'Layer', 'Artboard', 'Pantone', 'Hex', 'Gutter', 'Baseline', 'Tracking', 'Mockup', 'Brief', 'Raster', 'Spline', 'Anchor', 'Halftone', 'Gradient', 'Token', 'Lorem', 'Ipsum', 'Bleed', 'Crop', 'Orphan', 'Widow', 'Margin', 'Stroke', 'Opacity', 'Blend', 'Mask', 'Kerning'];
const NB = ['Runner', 'Dash', 'Pusher', 'Ninja', 'Sprinter', 'Bolt', 'Fox', 'Crush', 'Rider', 'Wizard', 'Goblin', 'Otter', 'Moth', 'Panda', 'Pro', 'Max', 'Lord', 'Kid', 'Boss', 'Bandit', 'Pilot', 'Comet', 'Hero', 'Duck'];
function hsl2hex(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase(); }
const COLORS = []; for (let i = 0; i < MAX_PLAYERS; i++) { const h = (i * 137.508 + 18) % 360; COLORS.push(hsl2hex(h, [80, 66, 90, 74][i % 4], [54, 45, 62, 50][(i >> 2) % 4])); }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const pick = a => a[Math.floor(Math.random() * a.length)];
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.577;

function buildSched() {
  const s = []; let t = 0;
  const add = (type, dur, g = -1) => { s.push({ type, g, start: t, dur, end: t + dur }); t += dur; };
  add('story', T.story);                                   // three black story slides
  GAMES.forEach((g, i) => {
    if (i > 0) add('client', T.client, i - 1);             // message from the client, then the finish line moves
    if (i === 4) add('finalround', T.finalround, i);
    add('rules', T.rules, i); add('play', g.dur, i); add('results', T.results, i);
  });
  add('clientfinal', T.clientfinal);                       // accounting is out of office
  add('podium', T.podium);
  add('final', T.final);                                   // 15 s countdown only, heartbeat
  return s;
}
const SCHED = buildSched();

/* ---------- state ---------- */
let S;
function fresh(mode) {
  S = { mode, lobbyLeft: T.lobby, t: 0, speed: 1, pi: -1, players: [], tokens: new Map(), goal: 10000,
        due: Date.now() + 30 * 864e5, seed: (Math.random() * 1e9) | 0, cdOnly: false, results: null, events: [], lastResG: -1 };
}
fresh('idle');

const sockets = () => io.of('/').sockets;
function snapshot(sock) {
  const role = sock.data.role, p = sock.data.pid != null ? S.players[sock.data.pid] : null;
  const d = { mode: S.mode, l: S.lobbyLeft, t: S.t, s: S.speed, pi: S.pi, goal: S.goal, due: S.due, seed: S.seed, cd: S.cdOnly, n: S.players.length };
  if (role !== 'play') { d.roster = S.players.map(rosterRow); d.results = S.results; }
  if (p) d.me = meRow(p);
  return d;
}
const rosterRow = p => [p.id, p.nick, p.color, p.isBot ? 1 : 0];
const meRow = p => ({ id: p.id, nick: p.nick, color: p.color, total: p.total, last: p.last, rank: p.rank, gRank: p.gRank, resG: p.resG });
function broadcastState() { for (const [, s] of sockets()) s.emit('state', snapshot(s)); }

function addPlayer(nick, isBot) {
  if (S.players.length >= MAX_PLAYERS) return null;
  const id = S.players.length;
  const p = { id, nick, isBot, color: COLORS[id], skill: clamp(0.55 + gauss() * 0.2, 0.05, 0.98), scores: [0, 0, 0, 0, 0], got: [false, false, false, false, false], total: 0, last: 0, rank: id + 1, gRank: id + 1, resG: -1 };
  S.players.push(p);
  return p;
}
const nickUsed = n => S.players.some(p => p.nick.toLowerCase() === n.toLowerCase());
function botNick() { for (let k = 0; k < 60; k++) { let n = pick(NA) + pick(NB); if (Math.random() < 0.2) n += Math.floor(Math.random() * 99); if (n.length <= 15 && !nickUsed(n)) return n; } return 'Bot' + S.players.length; }
function botScore(p, g) {
  const n = gauss() * 0.1, s = p.skill; let f;
  switch (g) { case 0: f = clamp(0.06 + 0.44 * s + n, 0.02, 0.7); break; case 1: f = clamp(0.18 + 0.56 * s + n, 0.04, 0.9); break; case 2: f = clamp(0.18 + 0.74 * s + n, 0, 0.94); break; case 3: f = clamp(0.3 + 0.6 * s + n, 0.05, 0.97); break; default: f = clamp(0.22 + 0.68 * s + n, 0, 0.92); }
  return Math.round(GAMES[g].max * f / 10) * 10;
}
const at = (dt, fn) => S.events.push({ at: S.t + dt, fn });

/* ---------- flow ---------- */
function openStadium() { fresh('lobby'); broadcastState(); }
function startGame() { if (S.mode !== 'lobby') return; S.mode = 'game'; S.t = 0; S.pi = -1; broadcastState(); }
function enterPhase(k) {
  const ph = SCHED[k]; S.pi = k;
  if (ph.type === 'play') S.players.forEach(p => { if (p.isBot) { p.scores[ph.g] = botScore(p, ph.g); p.got[ph.g] = true; } });
  if (ph.type === 'results') at(1.5, () => computeResults(ph.g));   // give phones a moment to send their score
  if (ph.type === 'final') { S.cdOnly = true; broadcastState(); }
  if (ph.type === 'client') at(7.3, () => moveGoal(ph.g));
}
function computeResults(g) {
  if (S.lastResG >= g) return; S.lastResG = g;
  S.players.forEach(p => { p.total = p.scores.slice(0, g + 1).reduce((a, b) => a + b, 0); p.last = p.scores[g]; p.resG = g; });
  const byGame = [...S.players].sort((a, b) => b.last - a.last || b.total - a.total); byGame.forEach((p, i) => p.gRank = i + 1);
  const byTot = [...S.players].sort((a, b) => b.total - a.total || b.last - a.last); byTot.forEach((p, i) => p.rank = i + 1);
  S.results = { g, tot: byTot.map(p => [p.id, p.total, p.last, p.rank, p.gRank]), game: byGame.slice(0, 12).map(p => p.id) };
  for (const [, s] of sockets()) {
    if (s.data.role !== 'play') s.emit('results', S.results);
    else if (s.data.pid != null) s.emit('you', meRow(S.players[s.data.pid]));
  }
}

// after every round the client pushes the finish line further away
function moveGoal(g) {
  const lead = S.players.reduce((m, p) => Math.max(m, p.total), 0);
  const oldDue = S.due;
  const next = Math.ceil(Math.max(S.goal + 5000, lead + 4000) / 1000) * 1000;
  S.goal = next; S.due = S.due + 30 * 864e5;
  io.emit('goal', { next, oldDue, due: S.due, vo: g === 1 ? 'c_goal' : 'c_pushed' });
}

let lastTick = Date.now(), lastSent = 0;
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.5, (now - lastTick) / 1000); lastTick = now;
  const sdt = dt * S.speed;
  if (S.mode === 'lobby') { S.lobbyLeft -= sdt; if (S.lobbyLeft <= 0) { S.lobbyLeft = 0; startGame(); } }
  else if (S.mode === 'game') {
    S.t += sdt;
    let i = SCHED.findIndex(p => S.t < p.end); if (i < 0) i = SCHED.length - 1;
    if (i !== S.pi) { for (let k = S.pi + 1; k <= i; k++) enterPhase(k); io.emit('phase', { pi: S.pi, t: S.t }); }
    if (S.events.length) { const due = S.events.filter(e => S.t >= e.at); S.events = S.events.filter(e => S.t < e.at); due.forEach(e => e.fn()); }
  }
  if (now - lastSent > 250) { lastSent = now; io.volatile.emit('tick', { t: S.t, l: S.lobbyLeft, s: S.speed, pi: S.pi }); }
}, 100);

/* ---------- sockets ---------- */
io.on('connection', sock => {
  sock.data.role = 'play';
  sock.on('hello', ({ role, key, token } = {}) => {
    if (role === 'admin' && key !== ADMIN_KEY) { sock.emit('denied'); role = 'screen'; }
    sock.data.role = role === 'admin' || role === 'screen' ? role : 'play';
    sock.data.token = typeof token === 'string' ? token.slice(0, 64) : null;
    if (sock.data.token && S.tokens.has(sock.data.token)) sock.data.pid = S.tokens.get(sock.data.token);
    sock.emit('state', snapshot(sock));
  });
  sock.on('join', ({ nick } = {}) => {
    if (sock.data.pid != null) return sock.emit('state', snapshot(sock));
    let n = String(nick || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (n.length < 2) return sock.emit('joinError', 'Pick a nickname with at least 2 characters.');
    if (S.mode !== 'lobby') return sock.emit('joinError', 'Joining is closed.');
    if (S.players.length >= MAX_PLAYERS) return sock.emit('joinError', 'The stadium is full (300 players).');
    const base = n; let k = 2; while (nickUsed(n)) { n = base.slice(0, 12) + k; k++; }
    const p = addPlayer(n, false);
    sock.data.pid = p.id; if (sock.data.token) S.tokens.set(sock.data.token, p.id);
    sock.emit('state', snapshot(sock));
    for (const [, s] of sockets()) if (s.data.role !== 'play') s.emit('joins', [rosterRow(p)]);
  });
  sock.on('score', ({ g, pts, final } = {}) => {
    const p = sock.data.pid != null ? S.players[sock.data.pid] : null;
    if (!p || S.mode !== 'game' || !(g >= 0 && g < 5) || p.got[g] || S.lastResG >= g) return;
    const ph = SCHED[S.pi]; if (!ph || ph.g !== g || (ph.type !== 'play' && ph.type !== 'results')) return;
    // provisional scores arrive every 1.5 s during play, the final one when the clock runs out
    p.scores[g] = clamp(Math.round(Number(pts) || 0), 0, GAMES[g].max); if (final !== false) p.got[g] = true;
  });
  sock.on('admin', ({ cmd, v } = {}) => {
    if (sock.data.role !== 'admin') return;
    if (cmd === 'open' && S.mode === 'idle') openStadium();
    if (cmd === 'start') startGame();
    if (cmd === 'bots' && S.mode === 'lobby') {
      const rows = []; for (let i = 0; i < Math.min(Number(v) || 0, 300); i++) { const p = addPlayer(botNick(), true); if (!p) break; rows.push(rosterRow(p)); }
      for (const [, s] of sockets()) if (s.data.role !== 'play') s.emit('joins', rows);
    }
    if (cmd === 'cdonly') { S.cdOnly = !S.cdOnly; broadcastState(); }
    if (cmd === 'reset') { fresh('idle'); broadcastState(); }
    if (cmd === 'skip' && S.mode === 'game') { const ph = SCHED[S.pi]; if (ph && ph.type !== 'final') S.t = ph.end + 0.001; }
    if (cmd === 'speed') { S.speed = [1, 2, 4].includes(v) ? v : 1; }
  });
});

server.listen(PORT, () => console.log(`BOLDLYMPICS on :${PORT}  (admin key: ${ADMIN_KEY === 'boldlympics' ? 'default "boldlympics"' : 'from ADMIN_KEY'})`));
