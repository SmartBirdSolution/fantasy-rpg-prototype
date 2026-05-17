'use strict';

const Network = {
  socket:         null,
  myId:           null,
  connected:      false,

  remotePlayers:  new Map(),  // id → { id, name, race, cls, x, y, scene, fightingEnemy }
  lockedEnemies:  new Map(),  // enemyIdx → playerId
  defeatedEnemies: new Set(), // enemy indices permanently defeated this session

  cityPopulation: 0,          // live count of players inside any city (updated for all players)

  // Set by game layer to react to server events
  onReady:          null, // ()
  onPlayersChanged: null, // ()
  onEnemyLocked:    null, // (idx)
  onEnemyUnlocked:  null, // (idx, wasDefeated)
  onEnemyRespawned: null, // (idx)
  onBattleDenied:   null, // (reason)
  onDuelStart:      null, // ({ sessionId, opponent, yourTurn })
  onDuelAttack:     null, // ({ attackerIsMe, dmg, timedOut, yourTurn, over, won, xpGained })
  onDuelForfeit:    null, // ({ xpGained })
  onDuelHeal:       null, // ({ sessionId, total })

  // Combination heal callback (set by DuelBattleScene)
  onComboHeal: null, // ({ sessionId, total })

  // Extra crit callback (set by DuelBattleScene)
  onExtraCrit: null, // ({ sessionId, dmg })

  // City callbacks (set by game layer)
  onCityPopulation: null, // (count)

  // Trade callbacks (set by game layer)
  onTradeRequest:   null, // ({ fromId, fromName })
  onTradeDeclined:  null, // ()
  onTradeAccepted:  null, // ({ sessionId })
  onTradePeerOffer:      null, // ({ items })
  onTradePeerConfirmed:  null, // ()
  onTradeComplete:       null, // ({ receivedItems })
  onTradeCancelled:      null, // ()

  // Connect using the page's own host (works for localhost and LAN IPs alike)
  connect() {
    if (window.location.protocol === 'file:') return; // single-player / offline
    const url = `ws://${window.location.host}`;
    try {
      this.socket = new WebSocket(url);
    } catch {
      return;
    }

    this.socket.onopen  = () => { this.connected = true; };
    this.socket.onclose = () => { this.connected = false; };
    this.socket.onerror = () => {};
    this.socket.onmessage = ev => {
      try { this._handle(JSON.parse(ev.data)); } catch {}
    };
  },

  _handle(msg) {
    switch (msg.type) {

      case 'welcome':
        this.myId = msg.id;
        for (const p of msg.players) this.remotePlayers.set(p.id, p);
        for (const [k, v] of Object.entries(msg.locks)) this.lockedEnemies.set(Number(k), v);
        for (const idx of msg.defeated) this.defeatedEnemies.add(idx);
        if (msg.cityPopulation != null) this.cityPopulation = msg.cityPopulation;
        if (this.onReady) this.onReady();
        if (this.onPlayersChanged) this.onPlayersChanged();
        break;

      case 'player_join':
        this.remotePlayers.set(msg.player.id, msg.player);
        if (this.onPlayersChanged) this.onPlayersChanged();
        break;

      case 'player_update':
        if (msg.player.id === this.myId) break;
        this.remotePlayers.set(msg.player.id, msg.player);
        if (this.onPlayersChanged) this.onPlayersChanged();
        break;

      case 'player_left':
        this.remotePlayers.delete(msg.id);
        if (this.onPlayersChanged) this.onPlayersChanged();
        break;

      case 'enemy_locked':
        this.lockedEnemies.set(msg.enemyIdx, msg.byId);
        if (this.onEnemyLocked) this.onEnemyLocked(msg.enemyIdx);
        break;

      case 'enemy_unlocked':
        this.lockedEnemies.delete(msg.enemyIdx);
        if (msg.defeated) this.defeatedEnemies.add(msg.enemyIdx);
        if (this.onEnemyUnlocked) this.onEnemyUnlocked(msg.enemyIdx, msg.defeated);
        break;

      case 'enemy_respawned':
        this.defeatedEnemies.delete(msg.enemyIdx);
        if (this.onEnemyRespawned) this.onEnemyRespawned(msg.enemyIdx);
        break;

      case 'defeated_sync':
        // Reconcile: any enemy we think is defeated but server says is alive → respawn it
        for (const idx of [...this.defeatedEnemies]) {
          if (!msg.defeated.includes(idx)) {
            this.defeatedEnemies.delete(idx);
            if (this.onEnemyRespawned) this.onEnemyRespawned(idx);
          }
        }
        break;

      case 'battle_denied':
        if (this.onBattleDenied) this.onBattleDenied(msg.reason);
        break;

      case 'duel_start':
        if (this.onDuelStart) this.onDuelStart(msg);
        break;

      case 'duel_attack':
        if (this.onDuelAttack) this.onDuelAttack(msg);
        break;

      case 'duel_forfeit':
        if (this.onDuelForfeit) this.onDuelForfeit(msg);
        break;

      case 'duel_heal':
        if (this.onDuelHeal) this.onDuelHeal(msg);
        break;

      case 'combo_heal':
        if (this.onComboHeal) this.onComboHeal(msg);
        break;

      case 'extra_crit':
        if (this.onExtraCrit) this.onExtraCrit(msg);
        break;

      case 'trade_request':
        if (this.onTradeRequest) this.onTradeRequest(msg);
        break;

      case 'trade_declined':
        if (this.onTradeDeclined) this.onTradeDeclined(msg);
        break;

      case 'trade_accepted':
        if (this.onTradeAccepted) this.onTradeAccepted(msg);
        break;

      case 'trade_peer_offer':
        if (this.onTradePeerOffer) this.onTradePeerOffer(msg);
        break;

      case 'trade_peer_confirmed':
        if (this.onTradePeerConfirmed) this.onTradePeerConfirmed(msg);
        break;

      case 'trade_complete':
        if (this.onTradeComplete) this.onTradeComplete(msg);
        break;

      case 'trade_cancelled':
        if (this.onTradeCancelled) this.onTradeCancelled(msg);
        break;

      case 'city_population':
        this.cityPopulation = msg.count;
        if (this.onCityPopulation) this.onCityPopulation(msg.count);
        break;
    }
  },

  // ── Senders ──────────────────────────────────────────────────────────
  sendJoin(race, cls, name) {
    this._send({ type: 'join', race, cls, name });
  },

  sendMove(x, y, scene) {
    this._send({ type: 'move', x, y, scene });
  },

  sendBattleStart(enemyIdx) {
    this._send({ type: 'battle_start', enemyIdx });
  },

  sendBattleEnd(enemyIdx, won, respawnTime, spawnTX, spawnTY) {
    this._send({ type: 'battle_end', enemyIdx, won, respawnTime, spawnTX, spawnTY });
  },

  sendDuelQueue(stats) {
    this._send({ type: 'duel_queue', stats });
  },

  sendDuelCancel() {
    this._send({ type: 'duel_cancel' });
  },

  sendDuelZone(sessionId, zone, defending) {
    this._send({ type: 'duel_zone', sessionId, zone, defending: !!defending });
  },

  sendDuelHeal(sessionId, total) {
    this._send({ type: 'duel_heal', sessionId, total });
  },

  sendComboHeal(sessionId, total) {
    this._send({ type: 'combo_heal', sessionId, total });
  },

  sendExtraCrit(sessionId, dmg) {
    this._send({ type: 'extra_crit', sessionId, dmg });
  },

  // ── City senders ─────────────────────────────────────────────────────
  sendCityEnter() {
    this._send({ type: 'city_enter' });
  },

  sendCityLeave() {
    this._send({ type: 'city_leave' });
  },

  // ── Trade senders ────────────────────────────────────────────────────
  sendTradeRequest(toId) {
    this._send({ type: 'trade_request', toId });
  },

  sendTradeDecline(sessionId) {
    this._send({ type: 'trade_decline', sessionId });
  },

  sendTradeAccept(sessionId) {
    this._send({ type: 'trade_accept', sessionId });
  },

  sendTradeOffer(sessionId, items) {
    this._send({ type: 'trade_offer', sessionId, items });
  },

  sendTradeConfirm(sessionId) {
    this._send({ type: 'trade_confirm', sessionId });
  },

  sendTradeCancel(sessionId) {
    this._send({ type: 'trade_cancel', sessionId });
  },

  // ── Queries ──────────────────────────────────────────────────────────
  isEnemyLocked(idx)   { return this.lockedEnemies.has(idx); },
  isEnemyDefeated(idx)    { return this.defeatedEnemies.has(idx); },
  clearEnemyDefeated(idx) { this.defeatedEnemies.delete(idx); },

  _send(msg) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  },
};
