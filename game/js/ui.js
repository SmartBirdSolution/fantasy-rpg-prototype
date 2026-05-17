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

      // Duel
      btnDuel:       document.getElementById('btn-duel'),
      duelPopup:     document.getElementById('duel-popup'),
      duelTimerTxt:  document.getElementById('duel-timer-text'),
      duelStatusTxt: document.getElementById('duel-status-text'),

      // Action bar
      actionBar:      document.getElementById('action-bar'),
      btnBag:         document.getElementById('btn-bag'),
      btnAdminToggle: document.getElementById('btn-admin-toggle'),
      adminPanel:     document.getElementById('admin-panel'),
      btnAdminHp:     document.getElementById('btn-admin-hp'),
      btnAdminBottle: document.getElementById('btn-admin-bottle'),
      btnAdminGold:   document.getElementById('btn-admin-gold'),

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
  showScene(name) { // 'charselect' | 'world' | 'battle' | 'city'
    this._els.charSelectUI.style.display  = name === 'charselect' ? '' : 'none';
    this._els.worldUI.style.display       = name === 'world'      ? '' : 'none';
    this._els.battleUI.style.display      = name === 'battle'     ? '' : 'none';
    this._els.cityUI.style.display        = name === 'city'       ? '' : 'none';
    this._els.cityPrompt.style.display    = 'none'; // always close prompt on scene change

    // Action bar is only visible in the world scene
    if (name === 'world') {
      this._els.actionBar.style.display = 'flex';
    } else {
      this._els.actionBar.style.display = 'none';
      this._closeAdminPanel();
    }
  },

  // ── ACTION BAR ────────────────────────────────────────────────────
  initActionBar(player, onOpenInventory) {
    this._els.btnBag.onclick = () => {
      if (onOpenInventory) onOpenInventory();
    };

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
      const template = EQUIPMENT_TEMPLATES.HealthBottle;
      player.addToInventory({ ...template });
    };

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
