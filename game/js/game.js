'use strict';

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this.scene  = 'charselect';

    this.player       = null;
    this.worldScene   = null;
    this.battleScene  = null;
    this.currentEnemy    = null;
    this.currentEnemyIdx = null;
    this.duelScene       = null;
    this.duelSessionId   = null;

    this.lastTime    = 0;
    this._netTimer   = 0;
    this._regenAccum = 0;
    this._hotAccum   = 0;

    // Trade state
    this._tradeSession    = null; // { sessionId, peerId, peerName, isSender }
    this._tradePendingId  = null; // peerId we sent a request to, before session exists
    this._tradePendingName = null;
  }

  start() {
    this._resize();
    window.addEventListener('resize', () => this._resize());

    Network.connect();
    Network.onDuelStart = data => this._onDuelStart(data);
    this._initTradeNetwork();

    UI.init();
    UI.showScene('charselect');
    UI.buildCharSelect((race, cls) => this._onCharSelected(race, cls));

    requestAnimationFrame(ts => this._loop(ts));
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ── CHAR SELECT → WORLD ──────────────────────────────────────────────
  _onCharSelected(race, cls) {
    this.player = new PlayerCharacter(race, cls);

    this.worldScene = new WorldScene(this.canvas, this.player);
    this.worldScene.init();
    this.worldScene.onBattleStart = (e, idx) => this._startBattle(e, idx);
    this.worldScene.onPeerClick   = (peerId, peerName, cx, cy) => {
      if (this.scene !== 'world') return;
      UI.showPlayerContextMenu(
        peerId, peerName, cx, cy,
        () => { /* Private Chat placeholder – just close */ },
        () => this._sendTradeRequest(peerId, peerName)
      );
    };

    Network.sendJoin(race, cls, this.player.name);

    // Hide DUEL button in single-player (file://) mode
    const btnDuel = document.getElementById('btn-duel');
    if (window.location.protocol === 'file:') {
      btnDuel.style.display = 'none';
    } else {
      btnDuel.addEventListener('click', () => this._enterDuelQueue());
    }

    document.getElementById('btn-inventory').addEventListener('click', () => {
      if (this.scene === 'world') UI.openInventory(this.player);
    });

    UI.fadeOut(() => {
      UI.showScene('world');
      UI.updateWorldStats(this.player);
      this.scene = 'world';
      UI.fadeIn(null);
    });
  }

  // ── WORLD → BATTLE ───────────────────────────────────────────────────
  _startBattle(enemy, idx) {
    if (this.scene !== 'world') return;

    // Double-check lock (race condition guard before fade starts)
    if (Network.isEnemyLocked(idx)) return;

    this.scene = 'transitioning';
    this.currentEnemy    = enemy;
    this.currentEnemyIdx = idx;

    Network.sendBattleStart(idx);

    UI.fadeOut(() => {
      this.battleScene = new BattleScene(this.canvas, this.player, enemy);
      this.battleScene.onBattleEnd = result => this._endBattle(result);

      UI.showScene('battle');
      UI.initBattleHUD(this.player, enemy);
      UI.setDefenseEnabled(false);
      UI.setDefenseActive(false);

      document.getElementById('btn-defense').onclick = () => {
        if (this.scene === 'battle' && this.battleScene) this.battleScene.toggleDefense();
        else if (this.scene === 'duel'  && this.duelScene)  this.duelScene.toggleDefense();
      };

      this.scene = 'battle';
      this.battleScene.init();

      UI.fadeIn(null);
    });
  }

  // ── DUEL QUEUE ───────────────────────────────────────────────────────
  _enterDuelQueue() {
    if (this.scene !== 'world' || !Network.connected) return;
    Network.sendDuelQueue({
      name:  this.player.name,
      race:  this.player.race,
      cls:   this.player.charClass,
      level: this.player.level,
      maxHP: this.player.maxHP,
      atk:   this.player.totalAtk,
      def:   this.player.totalDef,
    });
    UI.showDuelPopup(() => Network.sendDuelCancel());
  }

  _onDuelStart(data) {
    UI.hideDuelPopup();
    if (this.scene !== 'world') return;

    this.scene         = 'transitioning';
    this.duelSessionId = data.sessionId;
    const opp          = data.opponent;

    // Restore full HP before duel
    this.player.currentHP = this.player.maxHP;
    this._regenAccum = 0;

    UI.fadeOut(() => {
      this.duelScene = new DuelBattleScene(this.canvas, this.player, opp, data.sessionId, data.yourTurn);
      this.duelScene.onDuelEnd = result => this._endDuel(result);

      UI.showScene('battle');
      UI.initBattleHUD(this.player,
        { type: opp.name, level: opp.level, currentHP: opp.maxHP, maxHP: opp.maxHP });
      UI.setDefenseEnabled(false);
      UI.setDefenseActive(false);
      document.getElementById('btn-defense').onclick = () => {
        if (this.scene === 'duel' && this.duelScene) this.duelScene.toggleDefense();
      };

      this.scene = 'duel';
      this.duelScene.init();
      UI.fadeIn(null);
    });
  }

  _endDuel(result) {

    UI.fadeOut(() => {
      if (result === 'win') {
        this.worldScene.startBattleCooldown();
        UI.showScene('world');
        UI.updateWorldStats(this.player);
        this.scene = 'world';
        UI.fadeIn(null);
      } else {
        if (!this.player.isAlive()) {
          this.player.currentHP = Math.floor(this.player.maxHP * 0.5);
        }
        this.worldScene.px = 30 * TILE_SIZE + TILE_SIZE / 2;
        this.worldScene.py = 30 * TILE_SIZE + TILE_SIZE / 2;
        this.worldScene._snapCamera();
        this.worldScene.startBattleCooldown();
        UI.showScene('world');
        this.scene = 'world';
        UI.fadeIn(() => {
          UI.showGameOver(() => UI.updateWorldStats(this.player));
        });
      }
      this.duelScene     = null;
      this.duelSessionId = null;
    });
  }

  // ── BATTLE → WORLD ───────────────────────────────────────────────────
  _endBattle(result) {
    const won = result === 'win';
    Network.sendBattleEnd(this.currentEnemyIdx, won);

    UI.fadeOut(() => {
      if (won) {
        this.currentEnemy.defeated = true;

        UI.showScene('world');
        UI.updateWorldStats(this.player);
        this.worldScene.startBattleCooldown();
        this.scene = 'world';
        UI.fadeIn(null);

      } else {
        this.player.currentHP = Math.floor(this.player.maxHP * 0.5);
        this.worldScene.px = 30 * TILE_SIZE + TILE_SIZE / 2;
        this.worldScene.py = 30 * TILE_SIZE + TILE_SIZE / 2;
        this.worldScene._snapCamera();
        this.worldScene.startBattleCooldown();

        UI.showScene('world');
        this.scene = 'world';

        UI.fadeIn(() => {
          UI.showGameOver(() => {
            UI.updateWorldStats(this.player);
          });
        });
      }
    });
  }

  // ── TRADE ────────────────────────────────────────────────────────────
  _initTradeNetwork() {
    Network.onTradeRequest = ({ fromId, fromName }) => {
      if (this.scene !== 'world') {
        Network.sendTradeDecline('');
        return;
      }
      UI.showTradeRequest(fromName,
        () => {
          // Accept
          this._tradePendingId   = fromId;
          this._tradePendingName = fromName;
          Network.sendTradeAccept(fromId);
        },
        () => Network.sendTradeDecline(fromId)
      );
    };

    Network.onTradeDeclined = () => {
      UI.hideTradeWaiting();
      this._tradePendingId   = null;
      this._tradePendingName = null;
    };

    Network.onTradeAccepted = ({ sessionId }) => {
      const peerName = this._tradePendingName || 'Player';
      this._tradeSession = { sessionId, peerName };
      this._tradePendingId   = null;
      this._tradePendingName = null;
      UI.hideTradeWaiting();
      UI.openTradeWindow(
        this.player,
        peerName,
        items  => {
          this._tradeSession.myOffer = items; // keep invIdx locally
          Network.sendTradeOffer(sessionId, items.map(({ invIdx, ...rest }) => rest));
        },
        ()     => Network.sendTradeConfirm(sessionId),
        ()     => { Network.sendTradeCancel(sessionId); this._tradeSession = null; }
      );
    };

    Network.onTradePeerOffer = ({ items }) => {
      UI.updatePeerOffer(items || []);
    };

    Network.onTradePeerConfirmed = () => {
      UI.setPeerConfirmed(true);
    };

    Network.onTradeComplete = ({ receivedItems }) => {
      // Remove offered items from inventory
      const myOffer = this._tradeSession?.myOffer || [];
      for (const offered of myOffer) {
        if (offered.slot === 'gold') {
          this.player.addGold(-(offered.amount || 0));
        } else if (offered.invIdx != null) {
          this.player.inventory[offered.invIdx] = null;
        }
      }
      // Add received items
      for (const item of (receivedItems || [])) {
        if (item.slot === 'gold') {
          this.player.addGold(item.amount || 0);
        } else {
          this.player.addToInventory({ ...item });
        }
      }
      UI.closeTradeWindow();
      this._tradeSession = null;
      UI.updateWorldStats(this.player);
    };

    Network.onTradeCancelled = () => {
      UI.closeTradeWindow();
      UI.hideTradeWaiting();
      this._tradeSession     = null;
      this._tradePendingId   = null;
      this._tradePendingName = null;
    };
  }

  _sendTradeRequest(peerId, peerName) {
    if (this.scene !== 'world' || !Network.connected) return;
    this._tradePendingId   = peerId;
    this._tradePendingName = peerName;
    Network.sendTradeRequest(peerId);
    UI.showTradeWaiting(peerName, () => {
      Network.sendTradeCancel('');
      this._tradePendingId   = null;
      this._tradePendingName = null;
    });
  }

  // ── MAIN LOOP ────────────────────────────────────────────────────────
  _loop(ts) {
    const dt = Math.min((ts - this.lastTime) / 1000, 0.05);
    this.lastTime = ts;

    if (this.scene === 'world' && this.worldScene) {
      this.worldScene.update(dt);
      this.worldScene.draw();

      // HP regeneration (only when not at full HP)
      if (this.player.currentHP < this.player.maxHP) {
        this._regenAccum += dt * this.player.regenRate;
        if (this._regenAccum >= 1) {
          const pts = Math.floor(this._regenAccum);
          this._regenAccum -= pts;
          this.player.currentHP = Math.min(this.player.maxHP, this.player.currentHP + pts);
        }
      } else {
        this._regenAccum = 0;
      }

      // Heal-over-time tick (accumulate to avoid decimal HP display)
      if (this.player._hotRemaining > 0) {
        const tick = Math.min(this.player._hotRemaining, dt);
        this._hotAccum += tick * this.player._hotHps;
        this.player._hotRemaining = Math.max(0, this.player._hotRemaining - dt);
        if (this._hotAccum >= 1) {
          const pts = Math.floor(this._hotAccum);
          this._hotAccum -= pts;
          this.player.currentHP = Math.min(this.player.maxHP, this.player.currentHP + pts);
        }
      } else {
        this._hotAccum = 0;
      }

      UI.updateWorldStats(this.player);

      // Send position to server at ~20 Hz
      this._netTimer += dt;
      if (this._netTimer >= 0.05 && Network.connected) {
        this._netTimer = 0;
        Network.sendMove(this.worldScene.px, this.worldScene.py, 'world');
      }

    } else if (this.scene === 'battle' && this.battleScene) {
      this.battleScene.update(dt);
      this.battleScene.draw();
      UI.updateBattleHUD(this.player, this.battleScene.enemy);

    } else if (this.scene === 'duel' && this.duelScene) {
      this.duelScene.update(dt);
      this.duelScene.draw();
      UI.updateBattleHUD(this.player,
        { currentHP: this.duelScene.opponentCurrentHP, maxHP: this.duelScene.opponent.maxHP });

    } else if (this.scene === 'charselect') {
      this.ctx.fillStyle = '#05081a';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    if (this.player) UI.updateEffectsPanel(this.player);

    requestAnimationFrame(nts => this._loop(nts));
  }
}

window.addEventListener('load', () => { new Game().start(); });
