'use strict';

const UI = {
  _els: null,

  init() {
    this._els = {
      charSelectUI:  document.getElementById('char-select-ui'),
      worldUI:       document.getElementById('world-ui'),
      battleUI:      document.getElementById('battle-ui'),
      fadeOverlay:   document.getElementById('fade-overlay'),
      levelupOverlay:document.getElementById('levelup-overlay'),
      levelupText:   document.getElementById('levelup-text'),
      gameoverOverlay:document.getElementById('gameover-overlay'),

      // World
      statName:   document.getElementById('stat-charname'),
      statHP:     document.getElementById('stat-hp'),
      statLevel:  document.getElementById('stat-level'),
      xpFill:     document.getElementById('xp-bar-fill'),
      statGold:   document.getElementById('stat-gold'),
      statWeapon: document.getElementById('stat-weapon'),
      statArmor:  document.getElementById('stat-armor'),

      // Battle
      playerHudName: document.getElementById('player-hud-name'),
      playerHPFill:  document.getElementById('player-hp-fill'),
      playerHPText:  document.getElementById('player-hp-text'),
      enemyHudName:  document.getElementById('enemy-hud-name'),
      enemyHPFill:   document.getElementById('enemy-hp-fill'),
      enemyHPText:   document.getElementById('enemy-hp-text'),
      turnIndicator: document.getElementById('turn-indicator'),
      battleLog:     document.getElementById('battle-log'),

      btnDefense:    document.getElementById('btn-defense'),
      defenseStatus: document.getElementById('defense-status'),
    };
  },

  // ── SCENE MANAGEMENT ──────────────────────────────────────────────
  showScene(name) { // 'charselect' | 'world' | 'battle'
    this._els.charSelectUI.style.display  = name === 'charselect' ? '' : 'none';
    this._els.worldUI.style.display       = name === 'world'      ? '' : 'none';
    this._els.battleUI.style.display      = name === 'battle'     ? '' : 'none';
  },

  // ── FADE ──────────────────────────────────────────────────────────
  fadeOut(cb) {
    this._els.fadeOverlay.classList.add('visible');
    setTimeout(cb, 460);
  },

  fadeIn(cb) {
    this._els.fadeOverlay.classList.remove('visible');
    if (cb) setTimeout(cb, 460);
  },

  // ── CHARACTER SELECT ──────────────────────────────────────────────
  buildCharSelect(onConfirm) {
    const raceGrid  = document.getElementById('race-grid');
    const classGrid = document.getElementById('class-grid');
    const preview   = document.getElementById('char-preview');

    let selRace  = 'Human';
    let selClass = 'Knight';

    const makeCard = (label, desc, onClick) => {
      const d = document.createElement('div');
      d.className = 'select-card';
      d.innerHTML = `<span class="card-name">${label}</span><span class="card-desc">${desc}</span>`;
      d.addEventListener('click', () => {
        onClick(d, label);
        updatePreview();
      });
      return d;
    };

    const updatePreview = () => {
      const r = RACE_DATA[selRace], c = CLASS_DATA[selClass];
      const hp  = c.baseHP  + r.hpMod;
      const atk = c.baseAtk + r.atkMod;
      const def = c.baseDef + r.defMod;
      const spd = c.baseSpd + r.spdMod;
      preview.textContent = `HP: ${hp}  ATK: ${atk}  DEF: ${def}  SPD: ${spd}`;
    };

    Object.entries(RACE_DATA).forEach(([race, data]) => {
      const card = makeCard(race, data.desc, (el, lbl) => {
        raceGrid.querySelectorAll('.select-card').forEach(c => c.classList.remove('chosen'));
        el.classList.add('chosen');
        selRace = lbl;
      });
      if (race === selRace) card.classList.add('chosen');
      raceGrid.appendChild(card);
    });

    Object.entries(CLASS_DATA).forEach(([cls, data]) => {
      const card = makeCard(cls, data.desc, (el, lbl) => {
        classGrid.querySelectorAll('.select-card').forEach(c => c.classList.remove('chosen'));
        el.classList.add('chosen');
        selClass = lbl;
      });
      if (cls === selClass) card.classList.add('chosen');
      classGrid.appendChild(card);
    });

    updatePreview();

    document.getElementById('confirm-char').addEventListener('click', () => {
      onConfirm(selRace, selClass);
    });
  },

  // ── WORLD UI ──────────────────────────────────────────────────────
  updateWorldStats(player) {
    this._els.statName.textContent  = player.name;
    this._els.statHP.textContent    = `${player.currentHP}/${player.maxHP}`;
    this._els.statLevel.textContent = player.level;
    this._els.statGold.textContent  = player.gold;

    const xpPct = Math.min(100, (player.xp / xpToNextLevel(player.level)) * 100);
    this._els.xpFill.style.width = xpPct + '%';

    this._els.statWeapon.textContent = player.equipment.weapon?.name    ?? '—';
    this._els.statArmor.textContent  = player.equipment.armor?.name     ?? '—';
  },

  // ── BATTLE UI ─────────────────────────────────────────────────────
  initBattleHUD(player, enemy) {
    this._els.playerHudName.textContent = player.name;
    this._els.enemyHudName.textContent  = `${enemy.type} Lv${enemy.level}`;
    this.updateBattleHUD(player, enemy);
    this.clearBattleLog();
  },

  updateBattleHUD(player, enemy) {
    const pPct = Math.max(0, (player.currentHP / player.maxHP) * 100);
    this._els.playerHPFill.style.width = pPct + '%';
    this._els.playerHPFill.className   = 'hp-bar-fill' + (pPct < 25 ? ' low' : pPct < 50 ? ' mid' : '');
    this._els.playerHPText.textContent = `${Math.max(0,player.currentHP)}/${player.maxHP}`;

    const ePct = Math.max(0, (enemy.currentHP / enemy.maxHP) * 100);
    this._els.enemyHPFill.style.width = ePct + '%';
    this._els.enemyHPFill.className   = 'hp-bar-fill' + (ePct < 25 ? ' low' : ePct < 50 ? ' mid' : '');
    this._els.enemyHPText.textContent = `${Math.max(0,enemy.currentHP)}/${enemy.maxHP}`;
  },

  setTurnIndicator(isPlayer) {
    const el = this._els.turnIndicator;
    el.textContent = isPlayer ? 'YOUR TURN' : 'ENEMY TURN';
    el.style.color = isPlayer ? '#ffd700' : '#ff6060';
  },

  setDefenseEnabled(on) {
    this._els.btnDefense.disabled = !on;
  },

  setDefenseActive(on) {
    this._els.btnDefense.classList.toggle('active', on);
    this._els.defenseStatus.textContent = on ? 'ON' : 'OFF';
  },

  appendBattleLog(msg, cls = '') {
    const p = document.createElement('p');
    if (cls) p.className = cls;
    p.textContent = msg;
    this._els.battleLog.appendChild(p);
    this._els.battleLog.scrollTop = this._els.battleLog.scrollHeight;
    // Keep max 40 lines
    while (this._els.battleLog.children.length > 40) {
      this._els.battleLog.removeChild(this._els.battleLog.firstChild);
    }
  },

  clearBattleLog() {
    this._els.battleLog.innerHTML = '';
  },

  // ── LEVEL UP ──────────────────────────────────────────────────────
  showLevelUp(level) {
    const el = this._els.levelupOverlay;
    this._els.levelupText.textContent = `Now Level ${level}! HP+10  ATK+2  DEF+1`;
    el.style.display = 'flex';
    setTimeout(() => { el.style.display = 'none'; }, 2000);
  },

  // ── GAME OVER ─────────────────────────────────────────────────────
  showGameOver(onRespawn) {
    this._els.gameoverOverlay.style.display = 'flex';
    document.getElementById('btn-respawn').onclick = () => {
      this._els.gameoverOverlay.style.display = 'none';
      onRespawn();
    };
  },
};
