'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

let WebSocketServer;
try {
  ({ WebSocketServer } = require('ws'));
} catch {
  console.error('\n  Missing dependency — run:  npm install\n');
  process.exit(1);
}

const PORT     = Number(process.env.PORT) || 3000;
const GAME_DIR = path.join(__dirname, 'game');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ── HTTP: serve game/ directory ───────────────────────────────────────────────
const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.resolve(GAME_DIR, '.' + urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(GAME_DIR + path.sep) && filePath !== GAME_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── Game state ────────────────────────────────────────────────────────────────
let nextId = 1;
const wsToPlayer = new Map();   // ws → playerState
const enemyLocks = new Map();   // enemyIdx → playerId  (currently in battle)
const defeated   = new Set();   // enemyIdx (permanently defeated this session)

function makeState(id) {
  return { id, name: `Player${id}`, race: null, cls: null,
           x: 0, y: 0, scene: 'charselect', fightingEnemy: null };
}

function allOtherStates(excludeId) {
  return [...wsToPlayer.values()]
    .filter(p => p.id !== excludeId)
    .map(({ id, name, race, cls, x, y, scene, fightingEnemy }) =>
      ({ id, name, race, cls, x, y, scene, fightingEnemy }));
}

function broadcast(msg, exceptWs = null) {
  const raw = JSON.stringify(msg);
  for (const ws of wsToPlayer.keys()) {
    if (ws !== exceptWs && ws.readyState === 1) ws.send(raw);
  }
}

function sendTo(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', ws => {
  const id    = String(nextId++);
  const state = makeState(id);
  wsToPlayer.set(ws, state);

  // Send new player their ID + current world snapshot
  sendTo(ws, {
    type:     'welcome',
    id,
    players:  allOtherStates(id),
    locks:    Object.fromEntries([...enemyLocks].map(([k, v]) => [k, v])),
    defeated: [...defeated],
  });

  // Tell everyone else a new player appeared
  broadcast({ type: 'player_join', player: { id, name: state.name, race: null, cls: null,
    x: 0, y: 0, scene: 'charselect', fightingEnemy: null } }, ws);

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'join': {
        state.race  = msg.race  || null;
        state.cls   = msg.cls   || null;
        state.name  = msg.name  || state.name;
        state.scene = 'world';
        broadcast({ type: 'player_update', player: { id, name: state.name, race: state.race,
          cls: state.cls, x: state.x, y: state.y, scene: state.scene, fightingEnemy: null } }, ws);
        break;
      }

      case 'move': {
        state.x     = msg.x     ?? state.x;
        state.y     = msg.y     ?? state.y;
        state.scene = msg.scene ?? state.scene;
        broadcast({ type: 'player_update', player: { id, name: state.name, race: state.race,
          cls: state.cls, x: state.x, y: state.y, scene: state.scene,
          fightingEnemy: state.fightingEnemy } }, ws);
        break;
      }

      case 'battle_start': {
        const idx = Number(msg.enemyIdx);
        if (enemyLocks.has(idx)) {
          sendTo(ws, { type: 'battle_denied', enemyIdx: idx, reason: 'Another player is already fighting this enemy.' });
          return;
        }
        enemyLocks.set(idx, id);
        state.fightingEnemy = idx;
        state.scene = 'battle';
        broadcast({ type: 'enemy_locked',  enemyIdx: idx, byId: id });
        broadcast({ type: 'player_update', player: { id, name: state.name, race: state.race,
          cls: state.cls, x: state.x, y: state.y, scene: 'battle', fightingEnemy: idx } }, ws);
        break;
      }

      case 'battle_end': {
        const idx = Number(msg.enemyIdx);
        enemyLocks.delete(idx);
        state.fightingEnemy = null;
        state.scene = 'world';
        if (msg.won) defeated.add(idx);
        broadcast({ type: 'enemy_unlocked', enemyIdx: idx, defeated: !!msg.won });
        broadcast({ type: 'player_update', player: { id, name: state.name, race: state.race,
          cls: state.cls, x: state.x, y: state.y, scene: 'world', fightingEnemy: null } }, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    // Release any locks this player held
    for (const [idx, pid] of enemyLocks) {
      if (pid === id) {
        enemyLocks.delete(idx);
        broadcast({ type: 'enemy_unlocked', enemyIdx: idx, defeated: false });
      }
    }
    wsToPlayer.delete(ws);
    broadcast({ type: 'player_left', id });
    console.log(`  Player ${id} disconnected  (${wsToPlayer.size} online)`);
  });

  console.log(`  Player ${id} connected  (${wsToPlayer.size} online)`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const lines = [`\n  Fantasy RPG server\n`];
  lines.push(`  Local:    http://localhost:${PORT}`);

  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        lines.push(`  Network:  http://${iface.address}:${PORT}`);
      }
    }
  }

  lines.push(`\n  Share the Network address with other machines on the same WiFi/LAN.\n`);
  console.log(lines.join('\n'));
});
