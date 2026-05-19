'use strict';

const UI = {
  _els: null,

  init() {
    this._els = {
      authUI:        document.getElementById('auth-ui'),
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

      // Duel
      btnDuel:       document.getElementById('btn-duel'),
      duelPopup:     document.getElementById('duel-popup'),
      duelTimerTxt:  document.getElementById('duel-timer-text'),
      duelStatusTxt: document.getElementById('duel-status-text'),

      // Action bar
      actionBar:      document.getElementById('action-bar'),
      btnBag:              document.getElementById('btn-bag'),
      btnAdminToggle:      document.getElementById('btn-admin-toggle'),
      adminPanel:          document.getElementById('admin-panel'),
      btnAdminHp:          document.getElementById('btn-admin-hp'),
      btnAdminBottle:      document.getElementById('btn-admin-bottle'),
      btnAdminGold:        document.getElementById('btn-admin-gold'),
      btnAdminIronSword:   document.getElementById('btn-admin-iron-sword'),
      btnAdminSteelSword:  document.getElementById('btn-admin-steel-sword'),
      btnAdminWoodShield:  document.getElementById('btn-admin-wooden-shield'),
      btnAdminIronShield:  document.getElementById('btn-admin-iron-shield'),
      btnAdminLeathHelm:   document.getElementById('btn-admin-leather-helm'),
      btnAdminIronHelm:    document.getElementById('btn-admin-iron-helm'),
      btnAdminChainmail:   document.getElementById('btn-admin-chainmail'),
      btnAdminPlateArmor:  document.getElementById('btn-admin-plate-armor'),
      btnAdminLeathBoots:  document.getElementById('btn-admin-leather-boots'),
      btnAdminIronBoots:   document.getElementById('btn-admin-iron-boots'),
      btnAdminBelt:            document.getElementById('btn-admin-belt'),
      btnAdminIronBelt:        document.getElementById('btn-admin-iron-belt'),
      btnAdminLeathShoulders:  document.getElementById('btn-admin-leather-shoulders'),
      btnAdminIronShoulders:   document.getElementById('btn-admin-iron-shoulders'),
      btnAdminLeathLegs:       document.getElementById('btn-admin-leather-legs'),
      btnAdminIronLegs:        document.getElementById('btn-admin-iron-legs'),

      // Profile
      profilePopup:     document.getElementById('profile-popup'),
      btnCloseProfile:  document.getElementById('btn-close-profile'),
      profileCharCanvas:document.getElementById('profile-char-canvas'),
      profileName:      document.getElementById('profile-name'),
      profileProfession:document.getElementById('profile-profession'),
      profileStats:     document.getElementById('profile-stats'),
      profileChampion:  document.getElementById('profile-champion'),
      profileComboList: document.getElementById('profile-combo-list'),
      btnProfile:       document.getElementById('btn-profile'),

      // Combo bar (shown in battle)
      comboBar:   document.getElementById('combo-bar'),
      comboSlots: document.getElementById('combo-slots'),

      // City
      cityUI:         document.getElementById('city-ui'),
      cityPopulation: document.getElementById('city-population'),
      btnLeaveCity:   document.getElementById('btn-leave-city'),
      cityPrompt:     document.getElementById('city-prompt'),
      btnCityYes:     document.getElementById('btn-city-yes'),
      btnCityNo:      document.getElementById('btn-city-no'),
    };
    this._duelTimerHandle = null;
    this._duelStartTime   = 0;
    this._invPlayer       = null;
    this._adminPanelOpen  = false;
    this._dragInvIdx      = null; // index of bag slot being dragged

    // Close profile popup
    this._els.btnCloseProfile.addEventListener('click', () => this.closeProfile());

    // Close inventory context menu when clicking anywhere in the popup
    document.getElementById('inventory-popup').addEventListener('click', e => {
      const menu = document.getElementById('inv-context-menu');
      if (!menu.contains(e.target)) menu.style.display = 'none';
    });

    // Close admin panel when clicking outside it and outside the toggle button
    document.addEventListener('click', e => {
      if (!this._adminPanelOpen) return;
      const panel  = this._els.adminPanel;
      const toggle = this._els.btnAdminToggle;
      if (!panel.contains(e.target) && !toggle.contains(e.target)) {
        this._closeAdminPanel();
      }
    });

    this.initEffectsPanel();
  },

  // ── SCENE MANAGEMENT ──────────────────────────────────────────────
  showScene(name) { // 'auth' | 'charselect' | 'world' | 'battle' | 'city'
    if (this._els.authUI) this._els.authUI.style.display = name === 'auth' ? '' : 'none';
    this._els.charSelectUI.style.display  = name === 'charselect' ? '' : 'none';
    this._els.worldUI.style.display       = name === 'world'      ? '' : 'none';
    this._els.battleUI.style.display      = name === 'battle'     ? '' : 'none';
    this._els.cityUI.style.display        = name === 'city'       ? '' : 'none';
    this._els.cityPrompt.style.display    = 'none'; // always close prompt on scene change
    this._els.btnDuel.style.display       = name === 'city'       ? '' : 'none';
    if (this._els.profilePopup) this._els.profilePopup.style.display = 'none';

    // Action bar is only visible in the world scene
    if (name === 'world') {
      this._els.actionBar.style.display = 'flex';
    } else {
      this._els.actionBar.style.display = 'none';
      this._closeAdminPanel();
    }
  },

  // ── ACTION BAR ────────────────────────────────────────────────────
  initActionBar(player, onOpenInventory, isAdmin) {
    this._els.btnBag.onclick     = () => { if (onOpenInventory) onOpenInventory(); };
    this._els.btnProfile.onclick = () => this.openProfile(player);

    if (!isAdmin) {
      this._els.btnAdminToggle.style.display = 'none';
    }

    this._els.btnAdminToggle.onclick = () => {
      this._toggleAdminPanel();
    };

    this._els.btnAdminHp.onclick = () => {
      if (!player) return;
      player.currentHP = Math.min(player.currentHP + 50, player.maxHP);
      this.updateWorldStats(player);
    };

    this._els.btnAdminBottle.onclick = () => {
      if (!player) return;
      player.addToInventory({ ...EQUIPMENT_TEMPLATES.HealthBottle });
    };

    const _adminAdd = key => { if (player) player.addToInventory({ ...EQUIPMENT_TEMPLATES[key] }); };
    this._els.btnAdminIronSword.onclick  = () => _adminAdd('IronSword');
    this._els.btnAdminSteelSword.onclick = () => _adminAdd('SteelSword');
    this._els.btnAdminWoodShield.onclick = () => _adminAdd('WoodenShield');
    this._els.btnAdminIronShield.onclick = () => _adminAdd('IronShield');
    this._els.btnAdminLeathHelm.onclick  = () => _adminAdd('LeatherHelm');
    this._els.btnAdminIronHelm.onclick   = () => _adminAdd('IronHelm');
    this._els.btnAdminChainmail.onclick  = () => _adminAdd('Chainmail');
    this._els.btnAdminPlateArmor.onclick = () => _adminAdd('PlateArmor');
    this._els.btnAdminLeathBoots.onclick = () => _adminAdd('LeatherBoots');
    this._els.btnAdminIronBoots.onclick  = () => _adminAdd('IronBoots');
    this._els.btnAdminBelt.onclick           = () => _adminAdd('LeatherBelt');
    this._els.btnAdminIronBelt.onclick       = () => _adminAdd('IronBelt');
    this._els.btnAdminLeathShoulders.onclick = () => _adminAdd('LeatherShoulders');
    this._els.btnAdminIronShoulders.onclick  = () => _adminAdd('IronShoulders');
    this._els.btnAdminLeathLegs.onclick      = () => _adminAdd('LeatherLegs');
    this._els.btnAdminIronLegs.onclick       = () => _adminAdd('IronLegs');

    this._els.btnAdminGold.onclick = () => {
      if (!player) return;
      player.addGold(100);
      this.updateWorldStats(player);
    };
  },

  _toggleAdminPanel() {
    if (this._adminPanelOpen) {
      this._closeAdminPanel();
    } else {
      this._openAdminPanel();
    }
  },

  _openAdminPanel() {
    this._adminPanelOpen = true;
    this._els.adminPanel.style.display = 'flex';
    this._els.btnAdminToggle.classList.add('active');
  },

  _closeAdminPanel() {
    this._adminPanelOpen = false;
    this._els.adminPanel.style.display = 'none';
    this._els.btnAdminToggle.classList.remove('active');
  },

  // ── PROFILE POPUP ─────────────────────────────────────────────────
  openProfile(player) {
    if (!player) return;
    const canvas = this._els.profileCharCanvas;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height - 10);
      ctx.scale(1.8, 1.8);
      player.draw(ctx, 0, 0, false, 0);
      ctx.restore();
    }
    const profName = PROFESSION_NAMES[player.profession] || 'Adventurer';
    this._els.profileName.textContent      = player.name;
    this._els.profileProfession.textContent = `${profName}  ·  Level ${player.level}`;
    this._els.profileStats.innerHTML =
      `<div class="pstat-row"><span>HP</span><span>${player.currentHP}/${player.maxHP}</span></div>` +
      `<div class="pstat-row"><span>ATK</span><span>${player.totalAtk}</span></div>` +
      `<div class="pstat-row"><span>DEF</span><span>${player.totalDef}</span></div>` +
      `<div class="pstat-row"><span>Gold</span><span>${player.gold}</span></div>`;
    this._els.profileChampion.textContent = `Champion Points: ${player.championPoints}`;

    const list = this._els.profileComboList;
    if (list) {
      if (!player.combos.length) {
        list.innerHTML = '<div class="pcmb-empty">No combinations yet.</div>';
      } else {
        list.innerHTML = player.combos.map((combo, i) => {
          const active = i === player.activeCombinationIdx;
          const slots  = combo.sequence.map(zone => {
            if (combo.discovered) {
              return `<span class="pcmb-slot pcmb-slot--known zone-${zone}" data-zone="${zone}"></span>`;
            }
            return `<span class="pcmb-slot pcmb-slot--unknown">?</span>`;
          }).join('');
          return `<div class="pcmb-row${active ? ' pcmb-row--active' : ''}">
            <span class="pcmb-name">${combo.name}${combo.discovered ? '' : ' 🔒'}</span>
            <span class="pcmb-slots">${slots}</span>
            <button class="pcmb-select${active ? ' pcmb-select--active' : ''}" data-idx="${i}">${active ? 'ACTIVE' : 'SELECT'}</button>
          </div>`;
        }).join('');
        list.querySelectorAll('[data-zone]').forEach(sp => {
          const cv = document.createElement('canvas');
          cv.width = 28; cv.height = 28;
          this._drawMiniZoneSword(cv, sp.dataset.zone);
          sp.appendChild(cv);
        });
        list.querySelectorAll('.pcmb-select').forEach(btn => {
          btn.addEventListener('click', () => {
            player.activeCombinationIdx = Number(btn.dataset.idx);
            this.openProfile(player);
          });
        });
      }
    }
    this._els.profilePopup.style.display = 'flex';
  },

  closeProfile() {
    this._els.profilePopup.style.display = 'none';
  },

  // ── COMBO BAR (battle only) ────────────────────────────────────────
  showCombatBar(player) {
    this._els.comboBar.style.display = 'flex';
    this.updateCombatBar(player);
  },

  hideCombatBar() {
    this._els.comboBar.style.display = 'none';
  },

  _drawMiniZoneSword(canvas, zone) {
    const ctx = canvas.getContext('2d');
    const S = canvas.width;
    ctx.clearRect(0, 0, S, S);
    const ANGLES = { top: 300, mid: 0, bot: 60 };
    const COLORS = { top: '#9060dd', mid: '#30c060', bot: '#e07030' };
    const ang   = ((ANGLES[zone] ?? 0) * Math.PI) / 180;
    const color = COLORS[zone] ?? '#aaaaaa';
    const sc    = S / 84; // 84 ≈ sword span (gripEnd=-14 to tipX=58 + margin)

    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(ang);
    ctx.scale(sc, sc);
    ctx.translate(-22, 0); // center sword length on canvas

    const tipX = 58, bW = 4.2, sharpLen = 13, gX = 0;
    const cgW = 3, cgH = 7, gripW = 1.7, hLen = 11;
    const gripX = gX - cgW, gripEnd = gripX - hLen;

    // Blade
    const blGrad = ctx.createLinearGradient(gX, -bW, gX, bW);
    blGrad.addColorStop(0,   '#50546a');
    blGrad.addColorStop(0.4, '#d8dcf0');
    blGrad.addColorStop(0.5, '#f0f4ff');
    blGrad.addColorStop(0.6, '#d8dcf0');
    blGrad.addColorStop(1,   '#50546a');
    ctx.fillStyle = blGrad;
    ctx.beginPath();
    ctx.moveTo(gX + 5.5, -bW);
    ctx.lineTo(tipX - sharpLen, -bW);
    ctx.lineTo(tipX, 0);
    ctx.lineTo(tipX - sharpLen, bW);
    ctx.lineTo(gX + 5.5, bW);
    ctx.closePath(); ctx.fill();

    // Central fuller groove
    ctx.strokeStyle = 'rgba(28,30,48,0.55)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tipX - sharpLen - 2, 0); ctx.lineTo(gX + 8, 0); ctx.stroke();
    ctx.lineCap = 'butt';

    // Crossguard (zone colour, glowing)
    ctx.shadowColor = color; ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.fillRect(gX - cgW, -cgH, cgW * 2, cgH * 2);
    ctx.shadowBlur = 0;

    // Grip
    ctx.fillStyle = '#522206';
    ctx.fillRect(gripEnd, -gripW, hLen, gripW * 2);

    ctx.restore();
  },

  updateCombatBar(player) {
    const slots = this._els.comboSlots;
    if (!slots) return;
    const combo = player.combos[player.activeCombinationIdx];
    if (!combo) { slots.innerHTML = ''; return; }
    slots.innerHTML = '';
    combo.sequence.forEach(zone => {
      const div = document.createElement('div');
      if (combo.discovered) {
        div.className = `cb-slot cb-slot--known zone-${zone}`;
        const cv = document.createElement('canvas');
        cv.width = 36; cv.height = 36;
        this._drawMiniZoneSword(cv, zone);
        div.appendChild(cv);
      } else {
        div.className = 'cb-slot cb-slot--unknown';
        div.textContent = '?';
      }
      slots.appendChild(div);
    });
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

  setDefenseEnabled(_on) {},
  setDefenseActive(_on) {},

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
    const SLOTS = ['helmet','shoulders','chainmail','body','belt','legs','boots','mainHand','offHand'];
    const LABELS = { helmet:'Helmet', shoulders:'Shoulders', chainmail:'Chainmail', body:'Body',
                     belt:'Belt', legs:'Legs', boots:'Boots', mainHand:'Main Hand', offHand:'Off Hand' };

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
      // Drop target: accept any bag item whose slot matches this equipment slot
      el.addEventListener('dragover', e => {
        const dragged = this._dragInvIdx != null ? player.inventory[this._dragInvIdx] : null;
        if (dragged && dragged.slot === slot) {
          e.preventDefault();
          el.classList.add('drag-over');
        }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (this._dragInvIdx != null) {
          player.equipFromInventory(this._dragInvIdx);
          this._dragInvIdx = null;
          this._renderInventory();
        }
      });
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

    // Elixir belt slots
    const available = player.elixirSlotsAvailable;
    const elixirGrid = document.getElementById('inv-elixir-grid');
    elixirGrid.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const item   = player.elixirSlots[i];
      const locked = i >= available;
      const el = document.createElement('div');
      el.className = 'inv-elixir-slot' + (item ? ' has-item' : '') + (locked ? ' locked' : '');
      el.title = locked ? 'Equip a Belt to unlock this slot' : (item ? item.name : 'Empty elixir slot');
      el.textContent = locked ? '🔒' : (item ? item.name.slice(0, 4) : (i + 1));
      if (item && !locked) {
        el.addEventListener('click', e => {
          e.stopPropagation();
          this._showElixirContext(i, e.clientX, e.clientY);
        });
      }
      if (!locked) {
        el.addEventListener('dragover', e => {
          const dragged = this._dragInvIdx != null ? player.inventory[this._dragInvIdx] : null;
          if (dragged && dragged.slot === 'consumable') { e.preventDefault(); el.classList.add('drag-over'); }
        });
        el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
        el.addEventListener('drop', e => {
          e.preventDefault();
          el.classList.remove('drag-over');
          if (this._dragInvIdx != null) {
            player.equipElixirSlot(this._dragInvIdx, i);
            this._dragInvIdx = null;
            this._renderInventory();
          }
        });
      }
      elixirGrid.appendChild(el);
    }

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
        if (item.slot !== 'gold') {
          el.draggable = true;
          el.addEventListener('dragstart', () => { this._dragInvIdx = i; });
          el.addEventListener('dragend',   () => { this._dragInvIdx = null; });
        }
      }
      // Bag-to-bag drop target
      el.addEventListener('dragover', e => {
        if (this._dragInvIdx != null && this._dragInvIdx !== i) {
          const dragged = player.inventory[this._dragInvIdx];
          if (dragged && dragged.slot !== 'gold') { e.preventDefault(); el.classList.add('drag-over'); }
        }
      });
      el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
      el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('drag-over');
        const from = this._dragInvIdx;
        if (from == null || from === i) return;
        // Swap the two slots
        const tmp = player.inventory[i];
        player.inventory[i]    = player.inventory[from];
        player.inventory[from] = tmp;
        this._dragInvIdx = null;
        this._renderInventory();
      });
      itemGrid.appendChild(el);
    }
  },

  _showItemContext(invIdx, cx, cy) {
    const player = this._invPlayer;
    const item = player.inventory[invIdx];
    if (!item) return;

    const menu = document.getElementById('inv-context-menu');
    document.getElementById('inv-ctx-item-name').textContent = item.name;

    const isConsumable   = item.slot === 'consumable';
    const isEquipment    = item.slot !== 'consumable' && item.slot !== 'gold';
    const freeElixirSlot = isConsumable
      ? player.elixirSlots.slice(0, player.elixirSlotsAvailable).findIndex(s => !s)
      : -1;
    document.getElementById('inv-ctx-use').style.display          = isConsumable ? '' : 'none';
    document.getElementById('inv-ctx-wear').style.display         = isEquipment  ? '' : 'none';
    document.getElementById('inv-ctx-equip-elixir').style.display = (isConsumable && freeElixirSlot !== -1) ? '' : 'none';
    document.getElementById('inv-ctx-unequip').style.display      = 'none';

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
    document.getElementById('inv-ctx-equip-elixir').onclick = () => {
      const slot = player.elixirSlots.slice(0, player.elixirSlotsAvailable).findIndex(s => !s);
      if (slot !== -1) player.equipElixirSlot(invIdx, slot);
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

    document.getElementById('inv-ctx-item-name').textContent         = item.name;
    document.getElementById('inv-ctx-use').style.display             = 'none';
    document.getElementById('inv-ctx-wear').style.display            = 'none';
    document.getElementById('inv-ctx-equip-elixir').style.display    = 'none';
    document.getElementById('inv-ctx-unequip').style.display         = '';

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

  _showElixirContext(slotIdx, cx, cy) {
    const player = this._invPlayer;
    const menu = document.getElementById('inv-context-menu');
    const item = player.elixirSlots[slotIdx];
    if (!item) return;

    document.getElementById('inv-ctx-item-name').textContent         = item.name;
    document.getElementById('inv-ctx-use').style.display             = '';
    document.getElementById('inv-ctx-wear').style.display            = 'none';
    document.getElementById('inv-ctx-equip-elixir').style.display    = 'none';
    document.getElementById('inv-ctx-unequip').style.display         = '';

    document.getElementById('inv-ctx-use').onclick = () => {
      player.useElixirSlot(slotIdx);
      menu.style.display = 'none';
      this._renderInventory();
    };
    document.getElementById('inv-ctx-unequip').onclick = () => {
      player.unequipElixirSlot(slotIdx);
      menu.style.display = 'none';
      this._renderInventory();
    };
    document.getElementById('inv-ctx-delete').onclick = () => {
      player.elixirSlots[slotIdx] = null;
      menu.style.display = 'none';
      this._renderInventory();
    };

    menu.style.left = cx + 4 + 'px';
    menu.style.top  = cy + 4 + 'px';
    menu.style.display = 'flex';
  },

  // ── PLAYER CONTEXT MENU ───────────────────────────────────────────
  showPlayerContextMenu(peerId, peerName, x, y, onChat, onTrade) {
    const menu = document.getElementById('player-context-menu');
    document.getElementById('player-ctx-name').textContent = peerName;
    document.getElementById('player-ctx-chat').onclick = () => {
      this.hidePlayerContextMenu();
      if (onChat) onChat();
    };
    document.getElementById('player-ctx-trade').onclick = () => {
      this.hidePlayerContextMenu();
      if (onTrade) onTrade();
    };
    menu.style.left    = x + 4 + 'px';
    menu.style.top     = y + 4 + 'px';
    menu.style.display = 'flex';
    this._playerCtxOpenId = peerId;
  },

  hidePlayerContextMenu() {
    document.getElementById('player-context-menu').style.display = 'none';
    this._playerCtxOpenId = null;
  },

  // ── TRADE REQUEST (receiver) ───────────────────────────────────────
  showTradeRequest(fromName, onAccept, onDecline) {
    document.getElementById('trade-request-msg').textContent =
      `${fromName} wants to trade with you.`;
    document.getElementById('btn-trade-accept').onclick = () => {
      document.getElementById('trade-request-popup').style.display = 'none';
      if (onAccept) onAccept();
    };
    document.getElementById('btn-trade-decline').onclick = () => {
      document.getElementById('trade-request-popup').style.display = 'none';
      if (onDecline) onDecline();
    };
    document.getElementById('trade-request-popup').style.display = 'flex';
  },

  // ── TRADE WAITING (sender) ─────────────────────────────────────────
  showTradeWaiting(toName, onCancel) {
    document.getElementById('trade-waiting-msg').textContent =
      `Waiting for ${toName}…`;
    document.getElementById('btn-trade-cancel-wait').onclick = () => {
      this.hideTradeWaiting();
      if (onCancel) onCancel();
    };
    document.getElementById('trade-waiting-popup').style.display = 'flex';
  },

  hideTradeWaiting() {
    document.getElementById('trade-waiting-popup').style.display = 'none';
  },

  // ── TRADE WINDOW ──────────────────────────────────────────────────
  openTradeWindow(localPlayer, peerName, onOffer, onConfirm, onCancel) {
    this._tradeLocalPlayer  = localPlayer;
    this._tradeOnOffer      = onOffer;
    this._tradeOnConfirm    = onConfirm;
    this._tradeOnCancel     = onCancel;
    this._tradeReserved     = new Set(); // inventory indices reserved in offer
    this._tradeYourOfferItems = []; // array of { invIdx, item, qty? }

    document.getElementById('trade-peer-label').textContent =
      peerName.toUpperCase() + "'S BAG";
    document.getElementById('trade-peer-confirmed').style.display = 'none';
    document.getElementById('btn-trade-confirm').classList.remove('confirmed');

    this._renderTradeYourOffer();
    this._renderTradePeerOffer([]);
    this._renderTradeLocalGrid();

    // Clear peer grid (unknown until they send their bag)
    document.getElementById('trade-peer-grid').innerHTML = '';

    document.getElementById('btn-trade-confirm').onclick = () => {
      document.getElementById('btn-trade-confirm').classList.add('confirmed');
      if (onConfirm) onConfirm();
    };

    document.getElementById('btn-trade-close').onclick = () => {
      this.closeTradeWindow();
      if (onCancel) onCancel();
    };

    document.getElementById('trade-window').style.display = 'flex';
  },

  _renderTradeLocalGrid() {
    const player = this._tradeLocalPlayer;
    const grid   = document.getElementById('trade-local-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 100; i++) {
      const item = player.inventory[i];
      const el   = document.createElement('div');
      const reserved = this._tradeReserved.has(i);
      el.className = 'trade-inv-slot' +
        (item ? ' has-item' : '') +
        (reserved ? ' reserved' : '');
      if (item) {
        el.title     = item.slot === 'gold' ? `Gold: ${item.amount}` : item.name;
        el.textContent = item.slot === 'gold'
          ? `${item.amount}G`
          : item.name.slice(0, 4);
        if (!reserved) {
          el.draggable = true;
          el.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', String(i));
          });
          el.addEventListener('dblclick', () => {
            const emptySlot = document.querySelector('#trade-your-offer .trade-offer-slot:not(.has-item)');
            if (emptySlot) this._tradeDropItemToOffer(i, emptySlot);
          });
        }
      }
      grid.appendChild(el);
    }
  },

  _tradeDropItemToOffer(invIdx, slot) {
    const player = this._tradeLocalPlayer;
    const item   = player.inventory[invIdx];
    if (!item || this._tradeReserved.has(invIdx)) return;

    // Stackable (gold)?
    if (item.slot === 'gold' && item.amount > 1) {
      this.showQtyModal(item.amount, qty => {
        this._commitTradeOffer(invIdx, item, qty, slot);
      });
    } else {
      this._commitTradeOffer(invIdx, item, null, slot);
    }
  },

  _commitTradeOffer(invIdx, item, qty, slot) {
    this._tradeReserved.add(invIdx);
    this._tradeYourOfferItems.push({ invIdx, item, qty });

    const label = item.slot === 'gold'
      ? `${qty !== null ? qty : item.amount}G`
      : item.name.slice(0, 4);
    slot.classList.add('has-item');
    slot.textContent = label;
    slot.title       = item.slot === 'gold' ? `Gold: ${qty || item.amount}` : item.name;

    // Remove drag ability from that inv slot
    this._renderTradeLocalGrid();

    // dblclick on offer slot removes it back to inventory
    slot.addEventListener('dblclick', () => this._removeFromOffer(slot, invIdx));

    // Notify game layer (include invIdx for local removal on complete)
    const offerPayload = this._tradeYourOfferItems.map(o => ({
      ...o.item,
      invIdx: o.invIdx,
      ...(o.qty !== null ? { amount: o.qty } : {}),
    }));
    if (this._tradeOnOffer) this._tradeOnOffer(offerPayload);
  },

  _removeFromOffer(slot, invIdx) {
    const idx = this._tradeYourOfferItems.findIndex(o => o.invIdx === invIdx);
    if (idx !== -1) this._tradeYourOfferItems.splice(idx, 1);
    this._tradeReserved.delete(invIdx);
    slot.classList.remove('has-item');
    slot.textContent = '';
    slot.title = '';
    this._renderTradeLocalGrid();
    const offerPayload = this._tradeYourOfferItems.map(o => ({
      ...o.item,
      invIdx: o.invIdx,
      ...(o.qty !== null ? { amount: o.qty } : {}),
    }));
    if (this._tradeOnOffer) this._tradeOnOffer(offerPayload);
  },

  _renderTradeYourOffer() {
    const area = document.getElementById('trade-your-offer');
    area.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const slot = document.createElement('div');
      slot.className = 'trade-offer-slot';
      slot.dataset.offerIdx = i;
      slot.addEventListener('dragover', e => {
        if (slot.classList.contains('has-item')) return;
        e.preventDefault();
        slot.classList.add('drop-target');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
      slot.addEventListener('drop', e => {
        e.preventDefault();
        slot.classList.remove('drop-target');
        if (slot.classList.contains('has-item')) return;
        const invIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        this._tradeDropItemToOffer(invIdx, slot);
      });
      area.appendChild(slot);
    }
  },

  _renderTradePeerOffer(items) {
    const area = document.getElementById('trade-peer-offer');
    area.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const slot = document.createElement('div');
      slot.className = 'trade-offer-slot' + (items[i] ? ' has-item' : '');
      if (items[i]) {
        const it = items[i];
        slot.textContent = it.slot === 'gold'
          ? `${it.amount}G`
          : (it.name || '').slice(0, 4);
        slot.title = it.name || '';
      }
      area.appendChild(slot);
    }
  },

  updatePeerOffer(items) {
    this._renderTradePeerOffer(items || []);
  },

  setPeerConfirmed(confirmed) {
    const el = document.getElementById('trade-peer-confirmed');
    el.style.display = confirmed ? '' : 'none';
  },

  closeTradeWindow() {
    document.getElementById('trade-window').style.display = 'none';
    this._tradeLocalPlayer    = null;
    this._tradeOnOffer        = null;
    this._tradeOnConfirm      = null;
    this._tradeOnCancel       = null;
    this._tradeReserved       = null;
    this._tradeYourOfferItems = null;
  },

  // ── QTY MODAL ─────────────────────────────────────────────────────
  showQtyModal(max, onConfirm) {
    const input = document.getElementById('trade-qty-input');
    input.max   = max;
    input.value = max;
    document.getElementById('btn-qty-confirm').onclick = () => {
      const v = Math.max(1, Math.min(max, parseInt(input.value, 10) || 1));
      this.hideQtyModal();
      if (onConfirm) onConfirm(v);
    };
    document.getElementById('btn-qty-cancel').onclick = () => this.hideQtyModal();
    document.getElementById('trade-qty-modal').style.display = 'flex';
    input.focus();
    input.select();
  },

  hideQtyModal() {
    document.getElementById('trade-qty-modal').style.display = 'none';
  },

  // ── CITY UI ───────────────────────────────────────────────────────
  showCityUI() {
    // Population will be updated by server's city_population message
  },

  updateCityPopulation(count) {
    this._els.cityPopulation.textContent = 'Population: ' + count;
  },

  hideCityUI() {
    this._els.cityUI.style.display = 'none';
  },

  showCityPrompt(screenX, screenY, onYes, onNo) {
    this._els.btnCityYes.onclick = onYes;
    this._els.btnCityNo.onclick  = onNo;
    const el = this._els.cityPrompt;
    el.style.display = 'block';
    // Position just above the city visual on screen, clamped to viewport
    el.style.left = Math.max(4, Math.min(screenX - 60, window.innerWidth  - 140)) + 'px';
    el.style.top  = Math.max(4, Math.min(screenY - 40, window.innerHeight - 90)) + 'px';
  },

  hideCityPrompt() {
    this._els.cityPrompt.style.display = 'none';
  },

  // ── GAME OVER ─────────────────────────────────────────────────────
  showGameOver(onRespawn) {
    this._els.gameoverOverlay.style.display = 'flex';
    document.getElementById('btn-respawn').onclick = () => {
      this._els.gameoverOverlay.style.display = 'none';
      onRespawn();
    };
  },

  // ── EFFECTS PANEL ─────────────────────────────────────────────────
  initEffectsPanel() {
    const panel  = document.getElementById('effects-panel');
    const handle = document.getElementById('effects-handle');
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      ox = e.clientX - panel.offsetLeft;
      oy = e.clientY - panel.offsetTop;
      handle.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left   = (e.clientX - ox) + 'px';
      panel.style.top    = (e.clientY - oy) + 'px';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      handle.style.cursor = 'grab';
    });
  },

  updateEffectsPanel(player) {
    const list = document.getElementById('effects-list');
    list.innerHTML = '';
    if (player._hotRemaining > 0) {
      const el = document.createElement('div');
      el.className = 'effect-entry effect-hot';
      el.textContent = `Regen ${Math.ceil(player._hotRemaining)}s`;
      list.appendChild(el);
    }
  },
};
