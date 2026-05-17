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
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

// ── Game state ────────────────────────────────────────────────────────────────
let nextId = 1;
const wsToPlayer = new Map();   // ws → playerState
const enemyLocks = new Map();   // enemyIdx → playerId  (currently in battle)
const defeated   = new Set();   // enemyIdx (permanently defeated this session)

// ── City state ────────────────────────────────────────────────────────────────
const cityPlayers = new Set();  // player IDs currently inside the city

// ── Trade state ───────────────────────────────────────────────────────────────
const tradeSessions  = new Map();  // sessionId → { p1ws, p2ws, p1offer, p2offer, p1confirmed, p2confirmed }
const tradePending   = new Map();  // fromId → toId  (unaccepted requests)
let   nextTradeId    = 1;

// ── Duel state ────────────────────────────────────────────────────────────────
const duelQueue    = [];         // [{ ws, id, stats }]
const duelSessions = new Map();  // sessionId → { p1, p2, activeId, turnTimer }
let   nextDuelId   = 1;
const DUEL_TURN_MS = 90_000;

function calcDuelDmg(atk, def, attackerDefending, defenderDefending) {
  let base = Math.max(1, atk - def * 0.5) * (0.85 + Math.random() * 0.3);
  if (attackerDefending) base *= 0.5;   // defensive stance reduces outgoing damage
  if (defenderDefending) base *= 0.5;   // defender's stance reduces incoming damage
  return Math.max(1, Math.round(base));
}

function startTurnTimer(sid) {
  const sess = duelSessions.get(sid);
  if (!sess) return;
  clearTimeout(sess.turnTimer);
  sess.turnTimer = setTimeout(() => resolveDuelTurn(sid, 0, true), DUEL_TURN_MS);
}

function resolveDuelTurn(sid, dmg, timedOut) {
  const sess = duelSessions.get(sid);
  if (!sess) return;

  const atkKey = sess.activeId;
  const defKey = atkKey === 'p1' ? 'p2' : 'p1';
  const atk = sess[atkKey];
  const def = sess[defKey];

  def.currentHP = Math.max(0, def.currentHP - dmg);
  const over = def.currentHP <= 0;
  const xp   = Math.round(Math.max(atk.stats.level, def.stats.level) * 20 + 10);

  // Switch whose turn it is for the next round
  sess.activeId = defKey;

  sendTo(atk.ws, { type: 'duel_attack', attackerIsMe: true,  dmg, timedOut,
    yourTurn: false, over, won: over,  xpGained: over ? xp : 0 });
  sendTo(def.ws, { type: 'duel_attack', attackerIsMe: false, dmg, timedOut,
    yourTurn: !over, over, won: false, xpGained: 0 });

  if (over) {
    clearTimeout(sess.turnTimer);
    duelSessions.delete(sid);
    console.log(`  Duel ${sid} ended`);
  } else {
    startTurnTimer(sid);
  }
}

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
    type:           'welcome',
    id,
    players:        allOtherStates(id),
    locks:          Object.fromEntries([...enemyLocks].map(([k, v]) => [k, v])),
    defeated:       [...defeated],
    cityPopulation: cityPlayers.size,
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

      case 'duel_queue': {
        const qi = duelQueue.findIndex(e => e.id === id);
        if (qi !== -1) duelQueue.splice(qi, 1);

        const stats = msg.stats ?? {};
        duelQueue.push({ ws, id, stats });

        if (duelQueue.length >= 2) {
          const a = duelQueue.shift();
          const b = duelQueue.shift();
          const sid      = String(nextDuelId++);
          const firstKey = Math.random() < 0.5 ? 'p1' : 'p2';
          const sess = {
            p1: { ws: a.ws, id: a.id, stats: a.stats, currentHP: a.stats.maxHP, defending: false },
            p2: { ws: b.ws, id: b.id, stats: b.stats, currentHP: b.stats.maxHP, defending: false },
            activeId: firstKey,
            turnTimer: null,
          };
          duelSessions.set(sid, sess);

          const oppA = { name: b.stats.name, race: b.stats.race, cls: b.stats.cls,
                         level: b.stats.level, maxHP: b.stats.maxHP, atk: b.stats.atk, def: b.stats.def };
          const oppB = { name: a.stats.name, race: a.stats.race, cls: a.stats.cls,
                         level: a.stats.level, maxHP: a.stats.maxHP, atk: a.stats.atk, def: a.stats.def };
          sendTo(a.ws, { type: 'duel_start', sessionId: sid, opponent: oppA, yourTurn: firstKey === 'p1' });
          sendTo(b.ws, { type: 'duel_start', sessionId: sid, opponent: oppB, yourTurn: firstKey === 'p2' });
          startTurnTimer(sid);
          console.log(`  Duel ${sid}: Player ${a.id} vs Player ${b.id} — ${firstKey} goes first`);
        }
        break;
      }

      case 'duel_cancel': {
        const qi = duelQueue.findIndex(e => e.id === id);
        if (qi !== -1) duelQueue.splice(qi, 1);
        break;
      }

      case 'duel_zone': {
        const { sessionId, zone, defending } = msg;
        const sess = duelSessions.get(sessionId);
        if (!sess) return;

        const myKey  = sess.p1.id === id ? 'p1' : sess.p2.id === id ? 'p2' : null;
        if (!myKey || sess.activeId !== myKey) return;  // ignore if not your turn

        // Store attacker's defending state (used for outgoing damage penalty and persists for next turn)
        sess[myKey].defending = !!defending;

        clearTimeout(sess.turnTimer);
        const defKey = myKey === 'p1' ? 'p2' : 'p1';
        const dmg = calcDuelDmg(
          sess[myKey].stats.atk, sess[defKey].stats.def,
          sess[myKey].defending, sess[defKey].defending
        );
        resolveDuelTurn(sessionId, dmg, false);
        break;
      }

      case 'duel_heal_tick': {
        const { sessionId, pts, currentHP } = msg;
        const sess = duelSessions.get(sessionId);
        if (!sess) break;
        const myKey = sess.p1.id === id ? 'p1' : sess.p2.id === id ? 'p2' : null;
        if (!myKey) break;
        // Sync server-side HP so damage calc on next attack uses the healed value
        sess[myKey].currentHP = Math.min(sess[myKey].stats.maxHP, Math.max(0, currentHP));
        const defKey = myKey === 'p1' ? 'p2' : 'p1';
        sendTo(sess[defKey].ws, { type: 'duel_heal_tick', sessionId, pts, currentHP: sess[myKey].currentHP });
        break;
      }

      case 'city_enter': {
        cityPlayers.add(id);
        state.scene = 'city';
        broadcast({ type: 'player_update', player: { id, name: state.name, race: state.race,
          cls: state.cls, x: state.x, y: state.y, scene: 'city', fightingEnemy: null } }, ws);
        // Broadcast to ALL players so world map label stays in sync
        broadcast({ type: 'city_population', count: cityPlayers.size });
        sendTo(ws, { type: 'city_population', count: cityPlayers.size });
        console.log(`  Player ${id} entered city  (city pop: ${cityPlayers.size})`);
        break;
      }

      case 'city_leave': {
        cityPlayers.delete(id);
        state.scene = 'world';
        broadcast({ type: 'player_update', player: { id, name: state.name, race: state.race,
          cls: state.cls, x: state.x, y: state.y, scene: 'world', fightingEnemy: null } }, ws);
        // Broadcast to ALL players so world map label stays in sync
        broadcast({ type: 'city_population', count: cityPlayers.size });
        console.log(`  Player ${id} left city  (city pop: ${cityPlayers.size})`);
        break;
      }

      case 'trade_request': {
        const toId = String(msg.toId);
        const toWs = [...wsToPlayer.entries()].find(([, s]) => s.id === toId)?.[0];
        if (!toWs) break;
        tradePending.set(id, toId);
        sendTo(toWs, { type: 'trade_request', fromId: id, fromName: state.name });
        break;
      }

      case 'trade_decline': {
        // msg.sessionId = the original sender's player id (fromId)
        const fromId = String(msg.sessionId || '');
        if (fromId && tradePending.has(fromId)) {
          const fromWs = [...wsToPlayer.entries()].find(([, s]) => s.id === fromId)?.[0];
          if (fromWs) sendTo(fromWs, { type: 'trade_declined' });
          tradePending.delete(fromId);
        }
        // Also cancel by sessionId if already in an active session
        if (fromId && tradeSessions.has(fromId)) {
          const ts = tradeSessions.get(fromId);
          sendTo(ts.p1ws, { type: 'trade_cancelled' });
          sendTo(ts.p2ws, { type: 'trade_cancelled' });
          tradeSessions.delete(fromId);
        }
        break;
      }

      case 'trade_accept': {
        // msg.sessionId here is actually the fromId (sender's player id)
        const fromId = String(msg.sessionId);
        const fromWs = [...wsToPlayer.entries()].find(([, s]) => s.id === fromId)?.[0];
        if (!fromWs) break;
        tradePending.delete(fromId);
        const sid = String(nextTradeId++);
        const sess = { p1ws: fromWs, p2ws: ws, p1offer: [], p2offer: [],
                       p1confirmed: false, p2confirmed: false };
        tradeSessions.set(sid, sess);
        sendTo(fromWs, { type: 'trade_accepted', sessionId: sid });
        sendTo(ws,     { type: 'trade_accepted', sessionId: sid });
        console.log(`  Trade ${sid}: Player ${fromId} ↔ Player ${id}`);
        break;
      }

      case 'trade_offer': {
        const sid  = msg.sessionId;
        const sess = tradeSessions.get(sid);
        if (!sess) break;
        const isP1 = sess.p1ws === ws;
        if (isP1) sess.p1offer = msg.items || [];
        else      sess.p2offer = msg.items || [];
        const otherWs = isP1 ? sess.p2ws : sess.p1ws;
        sendTo(otherWs, { type: 'trade_peer_offer', items: isP1 ? sess.p1offer : sess.p2offer });
        break;
      }

      case 'trade_confirm': {
        const sid  = msg.sessionId;
        const sess = tradeSessions.get(sid);
        if (!sess) break;
        const isP1 = sess.p1ws === ws;
        if (isP1) sess.p1confirmed = true;
        else      sess.p2confirmed = true;
        // Notify the other player that their peer confirmed
        const otherWs = isP1 ? sess.p2ws : sess.p1ws;
        sendTo(otherWs, { type: 'trade_peer_confirmed' });
        // If both confirmed, execute the swap
        if (sess.p1confirmed && sess.p2confirmed) {
          sendTo(sess.p1ws, { type: 'trade_complete', receivedItems: sess.p2offer });
          sendTo(sess.p2ws, { type: 'trade_complete', receivedItems: sess.p1offer });
          tradeSessions.delete(sid);
          console.log(`  Trade ${sid} completed`);
        }
        break;
      }

      case 'trade_cancel': {
        const sid = msg.sessionId;
        if (sid && tradeSessions.has(sid)) {
          const ts = tradeSessions.get(sid);
          sendTo(ts.p1ws, { type: 'trade_cancelled' });
          sendTo(ts.p2ws, { type: 'trade_cancelled' });
          tradeSessions.delete(sid);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    // Release any enemy locks this player held
    for (const [idx, pid] of enemyLocks) {
      if (pid === id) {
        enemyLocks.delete(idx);
        broadcast({ type: 'enemy_unlocked', enemyIdx: idx, defeated: false });
      }
    }
    // Remove from duel queue
    const dqi = duelQueue.findIndex(e => e.id === id);
    if (dqi !== -1) duelQueue.splice(dqi, 1);
    // End any active duel session — opponent wins by forfeit
    for (const [sid, sess] of duelSessions) {
      if (sess.p1.id === id || sess.p2.id === id) {
        clearTimeout(sess.turnTimer);
        const other = sess.p1.id === id ? sess.p2 : sess.p1;
        const xp = Math.round(other.stats.level * 20 + 10);
        sendTo(other.ws, { type: 'duel_forfeit', xpGained: xp });
        duelSessions.delete(sid);
        break;
      }
    }
    // Remove from city if they were inside — broadcast updated count to ALL remaining players
    if (cityPlayers.has(id)) {
      cityPlayers.delete(id);
      for (const [w] of wsToPlayer) {
        if (w !== ws) sendTo(w, { type: 'city_population', count: cityPlayers.size });
      }
    }
    // Cancel any pending trade requests from this player
    tradePending.delete(id);
    // Cancel any active trade sessions involving this player
    for (const [sid, ts] of tradeSessions) {
      if (ts.p1ws === ws || ts.p2ws === ws) {
        const otherWs = ts.p1ws === ws ? ts.p2ws : ts.p1ws;
        sendTo(otherWs, { type: 'trade_cancelled' });
        tradeSessions.delete(sid);
        break;
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
