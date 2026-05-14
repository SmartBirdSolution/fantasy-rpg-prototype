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
      statName:      document.getElementById('stat-charname'),
      statHP:        document.getElementById('stat-hp'),
      statLevel:     document.getElementById('stat-level'),
      xpFill:        document.getElementById('xp-bar-fill'),
      statGold:      document.getElementById('stat-gold'),
      statChampion:  document.getElementById('stat-champion'),
      statWeapon:    document.getElementById('stat-weapon'),
      statArmor:     document.getElementById('stat-armor'),

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

      // Duel
      btnDuel:       document.getElementById('btn-duel'),
      duelPopup:     document.getElementById('duel-popup'),
      duelTimerTxt:  document.getElementById('duel-timer-text'),
      duelStatusTxt: document.getElementById('duel-status-text'),
    };
    this._duelTimerHandle = null;
    this._duelStartTime   = 0;
    this._invPlayer       = null;

    // Close inventory context menu when clicking anywhere in the popup
    document.getElementById('inventory-popup').addEventListener('click', e => {
      const menu = document.getElementById('inv-context-menu');
      if (!menu.contains(e.target)) menu.style.display = 'none';
    });
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
    this._els.statName.textContent     = player.name;
    this._els.statHP.textContent       = `${player.currentHP}/${player.maxHP}`;
    this._els.statLevel.textContent    = player.level;
    this._els.statGold.textContent     = player.gold;
    this._els.statChampion.textContent = player.championPoints || 0;

    const xpPct = Math.min(100, (player.xp / xpToNextLevel(player.level)) * 100);
    this._els.xpFill.style.width = xpPct + '%';

    this._els.statWeapon.textContent = player.equipped.mainHand?.name ?? '—';
    this._els.statArmor.textContent  = player.equipped.body?.name     ?? '—';
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

  // ── DUEL POPUP ────────────────────────────────────────────────────
  showDuelPopup(onCancel) {
    this._els.duelPopup.style.display = 'flex';
    this._els.duelTimerTxt.textContent = '0:00';
    this._els.btnDuel.classList.add('searching');
    this._duelStartTime = Date.now();
    this._duelTimerHandle = setInterval(() => {
      const secs = Math.floor((Date.now() - this._duelStartTime) / 1000);
      const m = Math.floor(secs / 60), s = secs % 60;
      this._els.duelTimerTxt.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }, 500);
    document.getElementById('btn-duel-cancel').onclick = () => {
      this.hideDuelPopup();
      if (onCancel) onCancel();
    };
  },

  hideDuelPopup() {
    this._els.duelPopup.style.display = 'none';
    this._els.btnDuel.classList.remove('searching');
    clearInterval(this._duelTimerHandle);
    this._duelTimerHandle = null;
    this._els.duelTimerTxt.textContent = '0:00';
  },

  // ── INVENTORY ─────────────────────────────────────────────────────
  openInventory(player) {
    this._invPlayer = player;
    document.getElementById('inventory-popup').style.display = 'flex';
    this._renderInventory();
    document.getElementById('btn-close-inventory').onclick = () => this.closeInventory();
  },

  closeInventory() {
    document.getElementById('inventory-popup').style.display = 'none';
    document.getElementById('inv-context-menu').style.display = 'none';
  },

  _renderInventory() {
    const player = this._invPlayer;

    // Equipment slots
    const SLOTS = ['helmet','shoulders','body','belt','legs','boots','mainHand','offHand'];
    const LABELS = { helmet:'Helmet', shoulders:'Shoulders', body:'Body', belt:'Belt',
                     legs:'Legs', boots:'Boots', mainHand:'Main Hand', offHand:'Off Hand' };

    const equipGrid = document.getElementById('inv-equip-grid');
    equipGrid.innerHTML = '';
    for (const slot of SLOTS) {
      const item = player.equipped[slot];
      const el = document.createElement('div');
      el.className = 'inv-equip-slot' + (item ? ' has-item' : '');
      el.innerHTML = `<span class="inv-slot-label">${LABELS[slot]}</span>
                      <span class="inv-slot-item">${item ? item.name : '—'}</span>`;
      if (item) {
        el.addEventListener('click', e => {
          e.stopPropagation();
          this._showEquipContext(slot, e.clientX, e.clientY);
        });
      }
      equipGrid.appendChild(el);
    }

    // Character canvas preview
    const canvas = document.getElementById('inv-char-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(60, 145);
    ctx.scale(1.8, 1.8);
    CharacterDrawer.drawHumanoid(ctx, 0, 0, player.color, player.accent, true, 0);
    ctx.restore();

    // Stats text
    document.getElementById('inv-stats-text').innerHTML =
      `ATK: ${player.totalAtk}<br>DEF: ${player.totalDef}` +
      `<br>HP: ${player.currentHP}/${player.maxHP}` +
      `<br>CP: ${player.championPoints || 0}`;

    // Inventory grid
    const itemGrid = document.getElementById('inv-item-grid');
    itemGrid.innerHTML = '';
    for (let i = 0; i < 100; i++) {
      const item = player.inventory[i];
      const el = document.createElement('div');
      el.className = 'inv-item-slot' + (item ? ' has-item' : '');
      if (item) {
        el.title = item.slot === 'gold' ? `Gold: ${item.amount}` : item.name;
        el.textContent = item.slot === 'gold' ? `${item.amount}G` : item.name.slice(0, 4);
        el.addEventListener('click', e => {
          e.stopPropagation();
          this._showItemContext(i, e.clientX, e.clientY);
        });
      }
      itemGrid.appendChild(el);
    }
  },

  _showItemContext(invIdx, cx, cy) {
    const player = this._invPlayer;
    const item = player.inventory[invIdx];
    if (!item) return;

    const menu = document.getElementById('inv-context-menu');
    document.getElementById('inv-ctx-item-name').textContent = item.name;

    const isConsumable = item.slot === 'consumable';
    const isEquipment  = item.slot !== 'consumable' && item.slot !== 'gold';
    document.getElementById('inv-ctx-use').style.display     = isConsumable ? '' : 'none';
    document.getElementById('inv-ctx-wear').style.display    = isEquipment  ? '' : 'none';
    document.getElementById('inv-ctx-unequip').style.display = 'none';

    document.getElementById('inv-ctx-use').onclick = () => {
      player.useFromInventory(invIdx);
      menu.style.display = 'none';
      this._renderInventory();
    };
    document.getElementById('inv-ctx-wear').onclick = () => {
      player.equipFromInventory(invIdx);
      menu.style.display = 'none';
      this._renderInventory();
    };
    document.getElementById('inv-ctx-delete').onclick = () => {
      player.removeFromInventory(invIdx);
      menu.style.display = 'none';
      this._renderInventory();
    };

    menu.style.left = cx + 4 + 'px';
    menu.style.top  = cy + 4 + 'px';
    menu.style.display = 'flex';
  },

  _showEquipContext(slot, cx, cy) {
    const player = this._invPlayer;
    const menu = document.getElementById('inv-context-menu');
    const item = player.equipped[slot];
    if (!item) return;

    document.getElementById('inv-ctx-item-name').textContent = item.name;
    document.getElementById('inv-ctx-use').style.display    = 'none';
    document.getElementById('inv-ctx-wear').style.display   = 'none';
    document.getElementById('inv-ctx-unequip').style.display = '';

    document.getElementById('inv-ctx-unequip').onclick = () => {
      player.unequipSlot(slot);
      menu.style.display = 'none';
      this._renderInventory();
    };
    document.getElementById('inv-ctx-delete').onclick = () => {
      player.equipped[slot] = null;
      player.currentHP = Math.min(player.currentHP, player.maxHP);
      menu.style.display = 'none';
      this._renderInventory();
    };

    menu.style.left = cx + 4 + 'px';
    menu.style.top  = cy + 4 + 'px';
    menu.style.display = 'flex';
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
