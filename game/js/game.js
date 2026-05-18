'use strict';

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this.scene  = 'charselect';

    this.player       = null;
    this.worldScene   = null;
    this.cityScene    = null;
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

    this._isAdmin = false;
  }

  start() {
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('beforeunload', () => this._savePlayer());

    Network.connect();
    Network.onDuelStart = data => this._onDuelStart(data);
    this._initTradeNetwork();

    UI.init();

    // Wire LOGOUT button (hidden in file:// mode via CSS; only appears in world)
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.onclick = () => {
        this._savePlayer();
        localStorage.removeItem('rpg_account_uuid');
        localStorage.removeItem('rpg_username');
        localStorage.removeItem('rpg_is_admin');
        localStorage.removeItem('rpg_char_race');
        localStorage.removeItem('rpg_char_cls');
        window.location.reload();
      };
    }

    if (window.location.protocol === 'file:') {
      // Single-player / offline: skip auth, use local UUID
      this._uuid    = this._getOrCreateUUID();
      this._isAdmin = false;
      this._showCharSelect();
    } else {
      const savedUUID = localStorage.getItem('rpg_account_uuid');
      if (savedUUID) {
        this._uuid    = savedUUID;
        this._isAdmin = localStorage.getItem('rpg_is_admin') === '1';
        this._checkSavedChar(savedUUID);
      } else {
        UI.showScene('auth');
        this._initAuthHandlers();
      }
    }

    requestAnimationFrame(ts => this._loop(ts));
  }

  async _checkSavedChar(uuid) {
    // Fast path: localStorage cache (same device, no network needed)
    const cachedRace = localStorage.getItem('rpg_char_race');
    const cachedCls  = localStorage.getItem('rpg_char_cls');
    if (cachedRace && cachedCls) {
      this._onCharSelected(cachedRace, cachedCls);
      return;
    }
    // DB path: covers new devices and cleared storage
    try {
      const res  = await fetch(`/api/player-char?uuid=${encodeURIComponent(uuid)}`);
      const json = await res.json();
      if (json.race && json.cls) {
        localStorage.setItem('rpg_char_race', json.race);
        localStorage.setItem('rpg_char_cls', json.cls);
        this._onCharSelected(json.race, json.cls);
        return;
      }
    } catch { /* server unreachable — fall through to char select */ }
    this._showCharSelect();
  }

  _showCharSelect() {
    UI.showScene('charselect');
    UI.buildCharSelect((race, cls) => this._onCharSelected(race, cls));

    // Show logout button on char select only for authenticated HTTP sessions
    const btnCSLogout = document.getElementById('btn-charselect-logout');
    if (btnCSLogout && window.location.protocol !== 'file:' && this._uuid) {
      btnCSLogout.style.display = '';
      btnCSLogout.onclick = () => {
        localStorage.removeItem('rpg_account_uuid');
        localStorage.removeItem('rpg_username');
        localStorage.removeItem('rpg_is_admin');
        localStorage.removeItem('rpg_char_race');
        localStorage.removeItem('rpg_char_cls');
        window.location.reload();
      };
    }
  }

  _initAuthHandlers() {
    const tabLogin    = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const authSubmit  = document.getElementById('auth-submit');
    const errorEl     = document.getElementById('auth-error');
    let   mode        = 'login';

    tabLogin.onclick = () => {
      mode = 'login';
      tabLogin.classList.add('active-tab');
      tabRegister.classList.remove('active-tab');
      authSubmit.textContent = 'LOGIN';
      errorEl.style.display = 'none';
    };

    tabRegister.onclick = () => {
      mode = 'register';
      tabRegister.classList.add('active-tab');
      tabLogin.classList.remove('active-tab');
      authSubmit.textContent = 'REGISTER';
      errorEl.style.display = 'none';
    };

    authSubmit.onclick = () => this._doAuth(mode);

    document.getElementById('auth-username').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('auth-password').focus();
    });
    document.getElementById('auth-password').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._doAuth(mode);
    });

    // Guest / no-login path — _uuid stays undefined, saves are skipped
    document.getElementById('btn-guest').onclick = () => this._showCharSelect();
  }

  async _doAuth(mode) {
    const username  = document.getElementById('auth-username').value.trim();
    const password  = document.getElementById('auth-password').value;
    const errorEl   = document.getElementById('auth-error');
    const submitEl  = document.getElementById('auth-submit');

    errorEl.style.display = 'none';
    submitEl.disabled     = true;
    submitEl.textContent  = mode === 'login' ? 'LOGGING IN...' : 'REGISTERING...';

    try {
      const res  = await fetch(`/auth/${mode}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, password }),
      });
      const json = await res.json();

      if (!res.ok || json.error) {
        errorEl.textContent   = json.error || 'Server error';
        errorEl.style.display = 'block';
        submitEl.disabled     = false;
        submitEl.textContent  = mode === 'login' ? 'LOGIN' : 'REGISTER';
        return;
      }

      localStorage.setItem('rpg_account_uuid', json.uuid);
      localStorage.setItem('rpg_username', username);
      localStorage.setItem('rpg_is_admin', json.isAdmin ? '1' : '0');
      this._uuid    = json.uuid;
      this._isAdmin = json.isAdmin === true;
      await this._checkSavedChar(json.uuid);

    } catch {
      errorEl.textContent   = 'Connection error — is the server running?';
      errorEl.style.display = 'block';
      submitEl.disabled     = false;
      submitEl.textContent  = mode === 'login' ? 'LOGIN' : 'REGISTER';
    }
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ── CHAR SELECT → WORLD ──────────────────────────────────────────────
  _getOrCreateUUID() {
    let id = localStorage.getItem('rpg_uuid');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
          });
      localStorage.setItem('rpg_uuid', id);
    }
    return id;
  }

  _buildSaveData() {
    const p = this.player;
    if (!p) return null;
    return {
      name:           p.name,
      race:           p.race,
      cls:            p.charClass,
      level:          p.level,
      xp:             p.xp,
      baseHP:         p.baseHP,
      baseAtk:        p.baseAtk,
      baseDef:        p.baseDef,
      currentHP:      p.currentHP,
      gold:           p.gold,
      championPoints: p.championPoints,
      worldTileX:     p.worldTileX,
      worldTileY:     p.worldTileY,
      inventory:      p.inventory,
      elixirSlots:    p.elixirSlots,
      equipped:       p.equipped,
      combos:         p.combos,
    };
  }

  _savePlayer() {
    if (!this.player || !this._uuid) return;
    const data = this._buildSaveData();
    if (!data) return;
    // Reliable unload save via beacon; regular saves use WebSocket
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/save', JSON.stringify({ uuid: this._uuid, data }));
    }
    if (Network.connected) {
      Network.sendPlayerSave(this._uuid, data);
    }
  }

  _applyPlayerLoad(saved) {
    const p = this.player;
    if (!p) return;

    p.level          = saved.level          ?? p.level;
    p.xp             = saved.xp             ?? p.xp;
    p.baseHP         = saved.baseHP         ?? p.baseHP;
    p.baseAtk        = saved.baseAtk        ?? p.baseAtk;
    p.baseDef        = saved.baseDef        ?? p.baseDef;
    p.gold           = saved.gold           ?? p.gold;
    p.championPoints = saved.championPoints ?? p.championPoints;

    // Equipped items affect maxHP, so apply before currentHP
    if (saved.equipped && typeof saved.equipped === 'object') {
      for (const slot of Object.keys(p.equipped)) {
        p.equipped[slot] = saved.equipped[slot] ?? null;
      }
    }
    p.currentHP = Math.min(saved.currentHP ?? p.currentHP, p.maxHP);

    if (Array.isArray(saved.inventory)) {
      p.inventory = new Array(100).fill(null);
      for (let i = 0; i < Math.min(saved.inventory.length, 100); i++) {
        p.inventory[i] = saved.inventory[i];
      }
    }
    if (Array.isArray(saved.elixirSlots)) {
      p.elixirSlots = [null, null, null, null];
      for (let i = 0; i < Math.min(saved.elixirSlots.length, 4); i++) {
        p.elixirSlots[i] = saved.elixirSlots[i];
      }
    }
    if (Array.isArray(saved.combos) && saved.combos.length > 0) {
      p.combos = saved.combos;
    }

    // Restore world position
    if (saved.worldTileX != null && this.worldScene) {
      p.worldTileX = saved.worldTileX;
      p.worldTileY = saved.worldTileY;
      this.worldScene.px = saved.worldTileX * TILE_SIZE + TILE_SIZE / 2;
      this.worldScene.py = saved.worldTileY * TILE_SIZE + TILE_SIZE / 2;
      this.worldScene._snapCamera();
    }

    if (saved.name) p.name = saved.name;

    if (this.scene === 'world') UI.updateWorldStats(p);
  }

  _onCharSelected(race, cls) {
    // Persist the choice so refresh skips char select
    if (this._uuid) {
      localStorage.setItem('rpg_char_race', race);
      localStorage.setItem('rpg_char_cls', cls);
    }

    this.player = new PlayerCharacter(race, cls);

    Network.onPlayerLoad = (saved) => this._applyPlayerLoad(saved);

    this.worldScene = new WorldScene(this.canvas, this.player);
    this.cityScene  = new CityScene(this.canvas);
    this.worldScene.init();
    this.worldScene.startCityCooldown(); // grace period so prompt doesn't fire on spawn
    this.worldScene.onBattleStart = (e, idx) => this._startBattle(e, idx);
    this.worldScene.onCityPrompt  = (screenX, screenY) => {
      UI.showCityPrompt(
        screenX, screenY,
        () => { UI.hideCityPrompt(); this._enterCity(); },
        () => { UI.hideCityPrompt(); this.worldScene.dismissCityPrompt(true); }
      );
    };
    this.worldScene.onCityPromptDismiss = () => UI.hideCityPrompt();
    this.worldScene.onPeerClick   = (peerId, peerName, cx, cy) => {
      if (this.scene !== 'world') return;
      UI.showPlayerContextMenu(
        peerId, peerName, cx, cy,
        () => { /* Private Chat placeholder – just close */ },
        () => this._sendTradeRequest(peerId, peerName)
      );
    };

    Network.sendJoin(race, cls, this.player.name, this._uuid);
    Network.onCityPopulation = count => UI.updateCityPopulation(count);

    document.getElementById('btn-leave-city').addEventListener('click', () => {
      if (this.scene === 'city') this._leaveCity();
    });

    // Hide DUEL and LOGOUT buttons in single-player (file://) mode
    const btnDuel   = document.getElementById('btn-duel');
    const btnLogout2 = document.getElementById('btn-logout');
    if (window.location.protocol === 'file:') {
      btnDuel.style.display = 'none';
      if (btnLogout2) btnLogout2.style.display = 'none';
    } else {
      btnDuel.addEventListener('click', () => this._enterDuelQueue());
    }

    UI.initActionBar(this.player, () => {
      if (this.scene === 'world') UI.openInventory(this.player);
    }, this._isAdmin);

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
      this.scene = 'battle';
      this.battleScene.init();

      UI.fadeIn(null);
    });
  }

  // ── WORLD → CITY ─────────────────────────────────────────────────────
  _enterCity() {
    if (this.scene !== 'world') return;
    this.scene = 'transitioning';
    UI.fadeOut(() => {
      Network.sendCityEnter(); // send after fade so city_population arrives when UI is visible
      UI.showScene('city');
      this.scene = 'city';
      UI.fadeIn(null);
    });
  }

  // ── CITY → WORLD ─────────────────────────────────────────────────────
  _leaveCity() {
    Network.sendCityLeave();
    UI.fadeOut(() => {
      // Place player at tile (34, 30) — just outside the east gate on the road
      this.worldScene.px = 34 * TILE_SIZE + TILE_SIZE / 2;
      this.worldScene.py = 30 * TILE_SIZE + TILE_SIZE / 2;
      this.player.worldTileX = 34;
      this.player.worldTileY = 30;
      this.worldScene._snapCamera();
      this.worldScene.startCityCooldown();
      UI.showScene('world');
      UI.updateWorldStats(this.player);
      this.scene = 'world';
      UI.fadeIn(null);
    });
  }

  // ── DUEL QUEUE ───────────────────────────────────────────────────────
  _enterDuelQueue() {
    if (this.scene !== 'city' || !Network.connected) return;
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
    if (this.scene !== 'world' && this.scene !== 'city') return;

    this._preDuelScene    = this.scene;
    this._preDuelHP       = this.player.currentHP;

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
      this.scene = 'duel';
      this.duelScene.init();
      UI.fadeIn(null);
    });
  }

  _endDuel(result) {
    const fromCity = this._preDuelScene === 'city';
    const savedHP  = this._preDuelHP;

    Network.sendPlayerSave(this._uuid, this._buildSaveData());

    UI.fadeOut(() => {
      if (fromCity) {
        this.player.currentHP = savedHP ?? this.player.maxHP;
        UI.showScene('city');
        UI.updateWorldStats(this.player);
        this.scene = 'city';
        UI.fadeIn(null);
      } else if (result === 'win') {
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
      this._preDuelScene = null;
      this._preDuelHP    = null;
    });
  }

  // ── BATTLE → WORLD ───────────────────────────────────────────────────
  _endBattle(result) {
    const won = result === 'win';
    Network.sendBattleEnd(
      this.currentEnemyIdx, won,
      won ? this.currentEnemy.respawnTime : 0,
      won ? this.currentEnemy.spawnTX : 0,
      won ? this.currentEnemy.spawnTY : 0
    );
    Network.sendPlayerSave(this._uuid, this._buildSaveData());

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
      Network.sendPlayerSave(this._uuid, this._buildSaveData());
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

    } else if (this.scene === 'city' && this.cityScene) {
      this.cityScene.update(dt);
      this.cityScene.draw();

    } else if (this.scene === 'charselect') {
      this.ctx.fillStyle = '#05081a';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Heal-over-time tick — runs in all scenes (world, battle, duel)
    if (this.player && this.player._hotRemaining > 0) {
      const tick = Math.min(this.player._hotRemaining, dt);
      this._hotAccum += tick * this.player._hotHps;
      this.player._hotRemaining = Math.max(0, this.player._hotRemaining - dt);
      if (this._hotAccum >= 1) {
        const pts = Math.floor(this._hotAccum);
        this._hotAccum -= pts;
        this.player.currentHP = Math.min(this.player.maxHP, this.player.currentHP + pts);
        if (this.scene === 'battle' && this.battleScene) this.battleScene.spawnHealFloat(pts);
        else if (this.scene === 'duel' && this.duelScene) this.duelScene.spawnHealFloat(pts, 'player');
      }
    } else if (this.player) {
      this._hotAccum = 0;
    }

    if (this.player) UI.updateEffectsPanel(this.player);

    requestAnimationFrame(nts => this._loop(nts));
  }
}

window.addEventListener('load', () => { new Game().start(); });
