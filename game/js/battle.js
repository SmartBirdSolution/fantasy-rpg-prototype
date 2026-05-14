'use strict';

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

class BattleScene {
  constructor(canvas, player, enemy) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.player = player;
    this.enemy  = enemy;

    this.enemy.currentHP = this.enemy.maxHP;

    this.playerTurn      = true;
    this.playerDefending = false;
    this.animState       = 'idle';
    this.animT           = 0;
    this._onAnimDone     = null;
    this._animTime       = 0;

    this.zonesActive  = false;
    this.hoveredZone  = null;

    this.floats  = [];
    this.log     = [];

    this.onBattleEnd = null;
    this._ended      = false;

    this._clickHandler = e => this._handleClick(e);
    this._moveHandler  = e => this._handleMove(e);
  }

  init() {
    const pSpd = this.player.totalSpd;
    const eSpd = this.enemy.level + 5;
    if (pSpd > eSpd)      this.playerTurn = true;
    else if (eSpd > pSpd) this.playerTurn = false;
    else                  this.playerTurn = Math.random() < 0.5;

    this._log(`⚔ Battle start vs ${this.enemy.type} (Lv${this.enemy.level})!`, 'log-system');
    this._log(this.playerTurn ? 'You move first!' : `${this.enemy.type} moves first!`, 'log-system');

    this.canvas.addEventListener('click',     this._clickHandler);
    this.canvas.addEventListener('mousemove', this._moveHandler);

    if (this.playerTurn) {
      this.zonesActive = true;
      UI.setDefenseEnabled(true);
      UI.setTurnIndicator(true);
    } else {
      UI.setTurnIndicator(false);
      setTimeout(() => this._doEnemyTurn(), 1000);
    }
  }

  destroy() {
    this.canvas.removeEventListener('click',     this._clickHandler);
    this.canvas.removeEventListener('mousemove', this._moveHandler);
    this.canvas.style.cursor = 'default';
  }

  // ── INPUT ──────────────────────────────────────────────────────────
  _mouseCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      mx: (e.clientX - rect.left) * (this.canvas.width  / rect.width),
      my: (e.clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  _zoneRects() {
    const W = this.canvas.width, H = this.canvas.height;
    const charH   = 68 * 2;
    const groundY = H * 0.68;
    const topY    = groundY - charH;
    const h3      = charH / 3;
    const panelW  = 88;
    const panelX  = W * 0.75 - 44 - panelW - 8;

    return {
      top: { x: panelX, y: topY,          w: panelW, h: h3,   label: '▲ HEAD', color: '#501888', zone: 'top' },
      mid: { x: panelX, y: topY + h3,     w: panelW, h: h3,   label: '● BODY', color: '#0e5828', zone: 'mid' },
      bot: { x: panelX, y: topY + h3 * 2, w: panelW, h: h3,   label: '▼ LEGS', color: '#7a3a08', zone: 'bot' },
    };
  }

  _hitZone(mx, my) {
    if (!this.zonesActive) return null;
    for (const r of Object.values(this._zoneRects())) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.zone;
    }
    return null;
  }

  _handleClick(e) {
    if (!this.zonesActive || this._ended || this.animState !== 'idle') return;
    const { mx, my } = this._mouseCoords(e);
    const zone = this._hitZone(mx, my);
    if (!zone) return;
    this.zonesActive = false;
    this.hoveredZone = null;
    this.canvas.style.cursor = 'default';
    UI.setDefenseEnabled(false);
    UI.setTurnIndicator(false);
    this._executePlayerAction(zone);
  }

  _handleMove(e) {
    const { mx, my } = this._mouseCoords(e);
    this.hoveredZone = this._hitZone(mx, my);
    this.canvas.style.cursor = (this.zonesActive && this.hoveredZone) ? 'pointer' : 'default';
  }

  toggleDefense() {
    if (!this.zonesActive || this._ended) return;
    this.playerDefending = !this.playerDefending;
    UI.setDefenseActive(this.playerDefending);
  }

  // ── COMBAT ─────────────────────────────────────────────────────────
  _executePlayerAction(zone) {
    if (this._ended || this.animState !== 'idle') return;

    const enemyDecision = this.enemy.chooseAction();
    let playerDmg = this._calcDmg(this.player, this.enemy, zone, enemyDecision.blockZone);
    let enemyDmg  = this._calcDmg(this.enemy,  this.player, enemyDecision.action, null);

    const defending = this.playerDefending;
    if (defending) {
      playerDmg = Math.round(playerDmg * 0.5);
      enemyDmg  = Math.round(enemyDmg  * 0.5);
    }

    const blocked = (enemyDecision.blockZone === zone);
    const defTag  = defending ? ' [SHIELD ×0.5]' : '';
    this._log(`You attack ${zone.toUpperCase()}${blocked ? ' — BLOCKED! (×0.2)' : ''} → ${playerDmg} dmg.${defTag}`);
    this._log(`${this.enemy.type} attacks ${enemyDecision.action.toUpperCase()} → ${enemyDmg} dmg.${defTag}`);

    this._resolveRound(playerDmg, enemyDmg);
  }

  _doEnemyTurn() {
    if (this._ended || this.animState !== 'idle') return;

    const enemyDecision = this.enemy.chooseAction();
    let enemyDmg = this._calcDmg(this.enemy, this.player, enemyDecision.action, null);

    if (this.playerDefending) {
      enemyDmg = Math.round(enemyDmg * 0.5);
      this._log(`${this.enemy.type} attacks ${enemyDecision.action.toUpperCase()} → ${enemyDmg} dmg. [SHIELD ×0.5]`);
    } else {
      this._log(`${this.enemy.type} attacks ${enemyDecision.action.toUpperCase()} → ${enemyDmg} dmg.`);
    }

    this._resolveRound(0, enemyDmg, true);
  }

  _calcDmg(attacker, defender, attackZone, defenderBlock) {
    const atk  = attacker.totalAtk ?? attacker.baseAtk;
    const def  = defender.totalDef ?? defender.baseDef;
    let base   = Math.max(1, atk - def * 0.5);
    base      *= 0.85 + Math.random() * 0.3;
    if (defenderBlock && defenderBlock === attackZone) base *= 0.2;
    return Math.max(1, Math.round(base));
  }

  _resolveRound(playerDmg, enemyDmg, enemyOnly = false) {
    const doEnemyPhase = () => {
      this.animState = 'enemyAtk';
      this.animT     = 0;

      this._onAnimDone = () => {
        if (enemyDmg > 0) {
          this.player.takeDamage(enemyDmg);
          this._spawnFloat(enemyDmg, 'player');
        }
        if (!this.player.isAlive()) { this._endBattle('lose'); return; }

        this.animState   = 'idle';
        this.playerTurn  = true;
        this.zonesActive = true;
        UI.setDefenseEnabled(true);
        UI.setTurnIndicator(true);
      };
    };

    if (enemyOnly) { doEnemyPhase(); return; }

    this.animState = 'playerAtk';
    this.animT     = 0;

    this._onAnimDone = () => {
      if (playerDmg > 0) {
        this.enemy.takeDamage(playerDmg);
        this._spawnFloat(playerDmg, 'enemy');
      }
      if (!this.enemy.isAlive()) { this._endBattle('win'); return; }
      UI.setTurnIndicator(false);
      doEnemyPhase();
    };
  }

  _endBattle(result) {
    if (this._ended) return;
    this._ended      = true;
    this.animState   = 'done';
    this.zonesActive = false;
    this.playerDefending = false;
    UI.setDefenseEnabled(false);
    UI.setDefenseActive(false);

    if (result === 'win') {
      const xp   = this.enemy.xpReward;
      const gold = this.enemy.goldReward;
      const leveled = this.player.gainXP(xp);

      this.player.addGold(gold);
      this._log(`Victory! +${xp} XP, +${gold} gold.`, 'log-win');
      if (leveled) this._log(`LEVEL UP! Now Lv${this.player.level}!`, 'log-win');

      const drops = this._rollLoot();
      for (const drop of drops) {
        if (this.player.addToInventory(drop)) {
          this._log(`Found: ${drop.name}! (check inventory)`, 'log-loot');
        } else {
          this._log(`Found ${drop.name} but your inventory is full!`, 'log-lose');
        }
      }
      if (leveled) UI.showLevelUp(this.player.level);
    } else {
      this._log('You were defeated...', 'log-lose');
    }

    setTimeout(() => { this.destroy(); if (this.onBattleEnd) this.onBattleEnd(result); }, 2200);
  }

  _rollLoot() {
    if (Math.random() < 0.25) {
      return [{ ...EQUIPMENT_TEMPLATES.HealthBottle, id: 'HealthBottle' }];
    }
    return [];
  }

  _spawnFloat(dmg, target) {
    const W = this.canvas.width, H = this.canvas.height;
    const x = target === 'enemy'
      ? W * 0.72 + (Math.random() - 0.5) * 30
      : W * 0.28 + (Math.random() - 0.5) * 30;
    this.floats.push({ text: `-${dmg}`, x, y: H * 0.45, life: 1.4, maxLife: 1.4 });
  }

  _log(msg, cls = '') {
    this.log.push(msg);
    UI.appendBattleLog(msg, cls);
  }

  // ── UPDATE ─────────────────────────────────────────────────────────
  update(dt) {
    this._animTime += dt;

    if (this.animState === 'playerAtk' || this.animState === 'enemyAtk') {
      this.animT += dt * 2.8;
      if (this.animT >= 1) {
        this.animT = 1;
        const cb = this._onAnimDone;
        this._onAnimDone = null;
        if (cb) cb();
      }
    }

    this.floats = this.floats.filter(f => {
      f.life -= dt;
      f.y    -= dt * 50;
      return f.life > 0;
    });
  }

  // ── DRAW ───────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#12060a');
    grad.addColorStop(1, '#0a0618');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const groundGrad = ctx.createLinearGradient(0, H * 0.68, 0, H);
    groundGrad.addColorStop(0, '#1e120a');
    groundGrad.addColorStop(1, '#0e0808');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, H * 0.68, W, H * 0.32);

    ctx.strokeStyle = '#3a2010';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.68);
    ctx.lineTo(W, H * 0.68);
    ctx.stroke();

    ctx.fillStyle = 'rgba(180,160,255,0.15)';
    for (let i = 0; i < 30; i++) {
      ctx.fillRect((i * 137 + 50) % W, (i * 191 + 80) % (H * 0.65), 1, 1);
    }

    // Player
    const pLunge = this.animState === 'playerAtk' ? Math.sin(this.animT * Math.PI) * 50 : 0;
    ctx.save();
    ctx.translate(W * 0.25 + pLunge, H * 0.68);
    ctx.scale(2, 2);
    this.player.draw(ctx, 0, 0, true, 0);
    ctx.restore();

    // Defense shield aura on player
    if (this.playerDefending) {
      this._drawDefenseShield(ctx, W * 0.25, H * 0.68);
    }

    // Enemy
    const eLunge = this.animState === 'enemyAtk' ? -Math.sin(this.animT * Math.PI) * 50 : 0;
    ctx.save();
    ctx.translate(W * 0.75 + eLunge, H * 0.68);
    ctx.scale(-2, 2);
    this.enemy.draw(ctx, 0, 0, true, 0);
    ctx.restore();

    this._drawZoneLines(ctx, W, H);

    if (this.zonesActive) this._drawZoneArrows(ctx, W, H);

    // Floating damage numbers
    for (const f of this.floats) {
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle   = '#ff4444';
      ctx.font        = 'bold 26px monospace';
      ctx.textAlign   = 'center';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  _drawZoneLines(ctx, W, H) {
    const charH = 68 * 2;
    const top   = H * 0.68 - charH;
    const bot   = H * 0.68;
    const h3    = (bot - top) / 3;

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 6]);

    for (const cx of [W * 0.25, W * 0.75]) {
      ctx.beginPath(); ctx.moveTo(cx - 44, top + h3);   ctx.lineTo(cx + 44, top + h3);   ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 44, top + h3*2); ctx.lineTo(cx + 44, top + h3*2); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(200,200,255,0.18)';
    ctx.font      = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HEAD', W * 0.25, top + h3 * 0.5 + 3);
    ctx.fillText('BODY', W * 0.25, top + h3 * 1.5 + 3);
    ctx.fillText('LEGS', W * 0.25, top + h3 * 2.5 + 3);
    ctx.fillText('HEAD', W * 0.75, top + h3 * 0.5 + 3);
    ctx.fillText('BODY', W * 0.75, top + h3 * 1.5 + 3);
    ctx.fillText('LEGS', W * 0.75, top + h3 * 2.5 + 3);
  }

  _drawZoneArrows(ctx, W, H) {
    const rects = Object.values(this._zoneRects());

    for (const r of rects) {
      const hover = this.hoveredZone === r.zone;
      const alpha = hover ? 0.88 : 0.58;

      // Panel background
      const hexAlpha = Math.round(alpha * 255).toString(16).padStart(2, '0');
      ctx.fillStyle = r.color + hexAlpha;
      _roundRect(ctx, r.x, r.y + 2, r.w, r.h - 4, 6);
      ctx.fill();

      // Border
      ctx.strokeStyle = hover ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = hover ? 2 : 1;
      _roundRect(ctx, r.x, r.y + 2, r.w, r.h - 4, 6);
      ctx.stroke();

      const midY = r.y + r.h / 2;

      // Label
      ctx.fillStyle  = hover ? '#ffffff' : 'rgba(255,255,255,0.9)';
      ctx.font       = `bold ${hover ? 12 : 11}px monospace`;
      ctx.textAlign  = 'left';
      ctx.fillText(r.label, r.x + 10, midY + 4);

      // Right-pointing arrow
      const ax   = r.x + r.w - 10;
      const asz  = hover ? 8 : 6;
      ctx.fillStyle = hover ? '#fff' : 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(ax,       midY - asz * 0.6);
      ctx.lineTo(ax,       midY + asz * 0.6);
      ctx.lineTo(ax + asz, midY);
      ctx.closePath();
      ctx.fill();
    }

    // Hint below panels
    ctx.fillStyle = 'rgba(255,255,200,0.45)';
    ctx.font      = '10px monospace';
    ctx.textAlign = 'center';
    const lastR   = rects[rects.length - 1];
    ctx.fillText('CLICK TO ATTACK', lastR.x + lastR.w / 2, lastR.y + lastR.h + 14);
  }

  _drawDefenseShield(ctx, cx, cy) {
    const pulse = 0.5 + 0.5 * Math.sin(this._animTime * 4);
    const charCY = cy - 68;

    // Soft aura
    const r   = 48 + pulse * 8;
    const grd = ctx.createRadialGradient(cx, charCY, 0, cx, charCY, r);
    grd.addColorStop(0, `rgba(68,170,255,${0.18 + pulse * 0.14})`);
    grd.addColorStop(1,  'rgba(68,170,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, charCY, r, 0, Math.PI * 2);
    ctx.fill();

    // Heater shield shape
    const sx = cx - 11, sy = cy - 106, sw = 22, sh = 28;
    ctx.fillStyle   = `rgba(68,170,255,${0.50 + pulse * 0.28})`;
    ctx.strokeStyle = `rgba(180,225,255,${0.75 + pulse * 0.25})`;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + sw / 2, sy);
    ctx.lineTo(sx + sw,     sy + sh * 0.42);
    ctx.lineTo(sx + sw / 2, sy + sh);
    ctx.lineTo(sx,          sy + sh * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

// ── DUEL BATTLE SCENE (PvP, alternating turns) ──────────────────────────────
class DuelBattleScene {
  constructor(canvas, player, opponent, sessionId, yourTurn) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.player    = player;
    this.opponent  = opponent;   // { name, race, cls, level, maxHP, atk, def }
    this.sessionId = sessionId;
    this._firstTurn = yourTurn;

    this.opponentCurrentHP = opponent.maxHP;

    this.state     = 'idle';   // 'picking' | 'waiting' | 'animating' | 'done'
    this.animState = 'idle';   // 'playerAtk' | 'enemyAtk' | 'idle' | 'done'
    this.animT     = 0;
    this._onAnimDone = null;
    this._animTime   = 0;

    this.zonesActive = false;
    this.hoveredZone = null;
    this.floats      = [];

    this._countdown       = 90;
    this._countdownHandle = null;
    this.playerDefending  = false;

    this.onDuelEnd = null;
    this._ended    = false;

    const rd = RACE_DATA[opponent.race] || { color: '#888888', accent: '#555555' };
    this._oppColor  = rd.color;
    this._oppAccent = rd.accent;

    this._clickHandler = e => this._handleClick(e);
    this._moveHandler  = e => this._handleMove(e);
  }

  init() {
    this._log(`⚔ Duel vs ${this.opponent.name} (Lv${this.opponent.level})!`, 'log-system');

    this.canvas.addEventListener('click',     this._clickHandler);
    this.canvas.addEventListener('mousemove', this._moveHandler);

    Network.onDuelAttack  = d => this._onAttackResult(d);
    Network.onDuelForfeit = d => this._onForfeit(d);

    if (this._firstTurn) {
      this._log('You go first — pick a zone!', 'log-system');
      this._activateMyTurn();
    } else {
      this._log('Opponent goes first — wait for your turn.', 'log-system');
      this._setWaiting();
    }
  }

  destroy() {
    this._stopCountdown();
    this.canvas.removeEventListener('click',     this._clickHandler);
    this.canvas.removeEventListener('mousemove', this._moveHandler);
    this.canvas.style.cursor = 'default';
    Network.onDuelAttack  = null;
    Network.onDuelForfeit = null;
  }

  toggleDefense() {
    this.playerDefending = !this.playerDefending;
    UI.setDefenseActive(this.playerDefending);
  }

  // ── TURN STATE ─────────────────────────────────────────────────────
  _activateMyTurn() {
    this.state       = 'picking';
    this.zonesActive = true;
    UI.setDefenseEnabled(true);
    UI.setDefenseActive(this.playerDefending);
    this._startCountdown();
    this._updateTurnIndicator();
  }

  _setWaiting() {
    this.state       = 'waiting';
    this.zonesActive = false;
    this.canvas.style.cursor = 'default';
    UI.setDefenseEnabled(false);
    // Show opponent countdown (display-only — server enforces the real timer)
    this._countdown = 90;
    clearInterval(this._countdownHandle);
    this._countdownHandle = setInterval(() => {
      this._countdown = Math.max(0, this._countdown - 1);
      this._updateWaitingIndicator();
    }, 1000);
    this._updateWaitingIndicator();
  }

  _startCountdown() {
    this._countdown = 90;
    clearInterval(this._countdownHandle);
    this._countdownHandle = setInterval(() => {
      this._countdown = Math.max(0, this._countdown - 1);
      this._updateTurnIndicator();
    }, 1000);
  }

  _stopCountdown() {
    clearInterval(this._countdownHandle);
    this._countdownHandle = null;
  }

  _updateTurnIndicator() {
    const el = document.getElementById('turn-indicator');
    if (!el || this.state !== 'picking') return;
    const urgency = this._countdown <= 10 ? ' ⚠' : '';
    el.className   = 'duel-pick';
    el.textContent = `YOUR TURN  ${this._countdown}s${urgency}`;
  }

  _updateWaitingIndicator() {
    const el = document.getElementById('turn-indicator');
    if (!el) return;
    el.className   = 'duel-waiting';
    el.textContent = `OPP TURN  ${this._countdown}s`;
  }

  // ── INPUT ──────────────────────────────────────────────────────────
  _mouseCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      mx: (e.clientX - rect.left) * (this.canvas.width  / rect.width),
      my: (e.clientY - rect.top)  * (this.canvas.height / rect.height),
    };
  }

  _zoneRects() {
    const W = this.canvas.width, H = this.canvas.height;
    const charH  = 68 * 2;
    const groundY = H * 0.68;
    const topY   = groundY - charH;
    const h3     = charH / 3;
    const panelW = 88;
    const panelX = W * 0.75 - 44 - panelW - 8;
    return {
      top: { x: panelX, y: topY,          w: panelW, h: h3, label: '▲ HEAD', color: '#501888', zone: 'top' },
      mid: { x: panelX, y: topY + h3,     w: panelW, h: h3, label: '● BODY', color: '#0e5828', zone: 'mid' },
      bot: { x: panelX, y: topY + h3 * 2, w: panelW, h: h3, label: '▼ LEGS', color: '#7a3a08', zone: 'bot' },
    };
  }

  _hitZone(mx, my) {
    if (!this.zonesActive) return null;
    for (const r of Object.values(this._zoneRects())) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.zone;
    }
    return null;
  }

  _handleClick(e) {
    if (!this.zonesActive || this._ended || this.state !== 'picking') return;
    const { mx, my } = this._mouseCoords(e);
    const zone = this._hitZone(mx, my);
    if (!zone) return;
    this._stopCountdown();
    this.zonesActive = false;
    this.hoveredZone = null;
    this.canvas.style.cursor = 'default';
    this.state = 'waiting';
    const el = document.getElementById('turn-indicator');
    if (el) { el.className = 'duel-resolve'; el.textContent = 'ATTACKING...'; }
    Network.sendDuelZone(this.sessionId, zone, this.playerDefending);
  }

  _handleMove(e) {
    const { mx, my } = this._mouseCoords(e);
    this.hoveredZone = this._hitZone(mx, my);
    this.canvas.style.cursor = (this.zonesActive && this.hoveredZone) ? 'pointer' : 'default';
  }

  // ── NETWORK EVENTS ─────────────────────────────────────────────────
  _onAttackResult(data) {
    if (this._ended) return;
    this._stopCountdown();

    if (data.timedOut) {
      const who = data.attackerIsMe ? 'You' : 'Opponent';
      this._log(`${who} ran out of time — no action this turn.`, 'log-system');
      this._afterAttack(data);
      return;
    }

    if (data.attackerIsMe) {
      this._log(`You strike for ${data.dmg} damage!`);
    } else {
      this._log(`${this.opponent.name} strikes you for ${data.dmg} damage!`);
    }

    this.state     = 'animating';
    this.animState = data.attackerIsMe ? 'playerAtk' : 'enemyAtk';
    this.animT     = 0;

    this._onAnimDone = () => {
      if (data.attackerIsMe) {
        this.opponentCurrentHP = Math.max(0, this.opponentCurrentHP - data.dmg);
        this._spawnFloat(data.dmg, 'opponent');
      } else {
        this.player.takeDamage(data.dmg);
        this._spawnFloat(data.dmg, 'player');
      }
      this.animState = 'idle';
      this._afterAttack(data);
    };
  }

  _afterAttack(data) {
    if (data.over) {
      this._endDuel(data.won, data.xpGained);
    } else if (data.yourTurn) {
      this._activateMyTurn();
    } else {
      this._setWaiting();
    }
  }

  _onForfeit(data) {
    if (this._ended) return;
    this._stopCountdown();
    this._ended = true; this.state = 'done'; this.zonesActive = false;
    const xp = data.xpGained || 30;
    const leveled = this.player.gainXP(xp);
    this._log('Opponent disconnected — you win by forfeit!', 'log-win');
    this._log(`+${xp} XP`, 'log-win');
    if (leveled) UI.showLevelUp(this.player.level);
    setTimeout(() => { this.destroy(); if (this.onDuelEnd) this.onDuelEnd('win'); }, 2200);
  }

  // ── COMBAT END ─────────────────────────────────────────────────────
  _endDuel(won, xpGained) {
    if (this._ended) return;
    this._stopCountdown();
    this._ended    = true;
    this.state     = 'done';
    this.animState = 'done';
    this.zonesActive = false;

    if (won) {
      this.player.championPoints++;
      const leveled = this.player.gainXP(xpGained || 0);
      this._log(`Victory! +${xpGained} XP! Champion Points: ${this.player.championPoints}`, 'log-win');
      if (leveled) { this._log(`LEVEL UP! Now Lv${this.player.level}!`, 'log-win'); UI.showLevelUp(this.player.level); }
    } else {
      this._log('Defeated in the duel!', 'log-lose');
    }
    setTimeout(() => { this.destroy(); if (this.onDuelEnd) this.onDuelEnd(won ? 'win' : 'lose'); }, 2200);
  }

  _spawnFloat(dmg, target) {
    const W = this.canvas.width, H = this.canvas.height;
    const x = target === 'opponent'
      ? W * 0.72 + (Math.random() - 0.5) * 30
      : W * 0.28 + (Math.random() - 0.5) * 30;
    this.floats.push({ text: `-${dmg}`, x, y: H * 0.45, life: 1.4, maxLife: 1.4 });
  }

  _log(msg, cls = '') { UI.appendBattleLog(msg, cls); }

  // ── UPDATE ─────────────────────────────────────────────────────────
  update(dt) {
    this._animTime += dt;

    if (this.animState === 'playerAtk' || this.animState === 'enemyAtk') {
      this.animT += dt * 2.8;
      if (this.animT >= 1) {
        this.animT = 1;
        const cb = this._onAnimDone;
        this._onAnimDone = null;
        if (cb) cb();
      }
    }

    this.floats = this.floats.filter(f => {
      f.life -= dt;
      f.y    -= dt * 50;
      return f.life > 0;
    });
  }

  // ── DRAW ───────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#12060a'); grad.addColorStop(1, '#0a0618');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

    const gg = ctx.createLinearGradient(0, H * 0.68, 0, H);
    gg.addColorStop(0, '#1e120a'); gg.addColorStop(1, '#0e0808');
    ctx.fillStyle = gg; ctx.fillRect(0, H * 0.68, W, H * 0.32);

    ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H * 0.68); ctx.lineTo(W, H * 0.68); ctx.stroke();

    ctx.fillStyle = 'rgba(180,160,255,0.15)';
    for (let i = 0; i < 30; i++) ctx.fillRect((i * 137 + 50) % W, (i * 191 + 80) % (H * 0.65), 1, 1);

    // DUEL label
    ctx.fillStyle = 'rgba(233,69,96,0.55)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚔  D U E L  ⚔', W / 2, H * 0.15);

    // Player (left)
    const pLunge = this.animState === 'playerAtk' ? Math.sin(this.animT * Math.PI) * 50 : 0;
    ctx.save();
    ctx.translate(W * 0.25 + pLunge, H * 0.68);
    ctx.scale(2, 2);
    this.player.draw(ctx, 0, 0, true, 0);
    ctx.restore();
    if (this.playerDefending) this._drawDefenseShield(ctx, W * 0.25, H * 0.68);

    // Opponent (right, humanoid, facing left)
    const eLunge = this.animState === 'enemyAtk' ? -Math.sin(this.animT * Math.PI) * 50 : 0;
    ctx.save();
    ctx.translate(W * 0.75 + eLunge, H * 0.68);
    ctx.scale(-2, 2);
    CharacterDrawer.drawHumanoid(ctx, 0, 0, this._oppColor, this._oppAccent, true, 0);
    ctx.restore();

    this._drawZoneLines(ctx, W, H);
    if (this.zonesActive) this._drawZoneArrows(ctx, W, H);

    // Opponent-turn waiting pulse
    if (this.state === 'waiting') {
      const pulse = 0.5 + 0.5 * Math.sin(this._animTime * 3);
      ctx.fillStyle = `rgba(180,180,255,${0.3 + pulse * 0.3})`;
      ctx.font = '10px monospace'; ctx.textAlign = 'center';
      ctx.fillText('Waiting for opponent to strike...', W / 2, H * 0.2 + 4);
    }

    // Red border warning when < 10s left on your turn
    if (this.state === 'picking' && this._countdown <= 10 && this._countdown > 0) {
      const pulse = 0.4 + 0.6 * Math.sin(this._animTime * 8);
      ctx.strokeStyle = `rgba(255,80,80,${pulse * 0.6})`;
      ctx.lineWidth   = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }

    // Floating damage numbers
    for (const f of this.floats) {
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle   = '#ff4444';
      ctx.font        = 'bold 26px monospace';
      ctx.textAlign   = 'center';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  _drawDefenseShield(ctx, cx, cy) {
    const pulse = 0.5 + 0.5 * Math.sin(this._animTime * 4);
    const charCY = cy - 68;
    const r   = 48 + pulse * 8;
    const grd = ctx.createRadialGradient(cx, charCY, 0, cx, charCY, r);
    grd.addColorStop(0, `rgba(68,170,255,${0.18 + pulse * 0.14})`);
    grd.addColorStop(1,  'rgba(68,170,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, charCY, r, 0, Math.PI * 2); ctx.fill();
    const sx = cx - 11, sy = cy - 106, sw = 22, sh = 28;
    ctx.fillStyle   = `rgba(68,170,255,${0.50 + pulse * 0.28})`;
    ctx.strokeStyle = `rgba(180,225,255,${0.75 + pulse * 0.25})`;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx + sw / 2, sy);
    ctx.lineTo(sx + sw,     sy + sh * 0.42);
    ctx.lineTo(sx + sw / 2, sy + sh);
    ctx.lineTo(sx,          sy + sh * 0.42);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  _drawZoneLines(ctx, W, H) {
    const charH = 68 * 2, top = H * 0.68 - charH, h3 = charH / 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    for (const cx of [W * 0.25, W * 0.75]) {
      ctx.beginPath(); ctx.moveTo(cx - 44, top + h3);   ctx.lineTo(cx + 44, top + h3);   ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 44, top + h3*2); ctx.lineTo(cx + 44, top + h3*2); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(200,200,255,0.18)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    ctx.fillText('HEAD', W * 0.25, top + h3 * 0.5 + 3); ctx.fillText('BODY', W * 0.25, top + h3 * 1.5 + 3); ctx.fillText('LEGS', W * 0.25, top + h3 * 2.5 + 3);
    ctx.fillText('HEAD', W * 0.75, top + h3 * 0.5 + 3); ctx.fillText('BODY', W * 0.75, top + h3 * 1.5 + 3); ctx.fillText('LEGS', W * 0.75, top + h3 * 2.5 + 3);
  }

  _drawZoneArrows(ctx, W, H) {
    const rects = Object.values(this._zoneRects());
    for (const r of rects) {
      const hover = this.hoveredZone === r.zone;
      const alpha = hover ? 0.88 : 0.58;
      ctx.fillStyle = r.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
      _roundRect(ctx, r.x, r.y + 2, r.w, r.h - 4, 6); ctx.fill();
      ctx.strokeStyle = hover ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = hover ? 2 : 1;
      _roundRect(ctx, r.x, r.y + 2, r.w, r.h - 4, 6); ctx.stroke();
      const midY = r.y + r.h / 2;
      ctx.fillStyle = hover ? '#ffffff' : 'rgba(255,255,255,0.9)';
      ctx.font      = `bold ${hover ? 12 : 11}px monospace`; ctx.textAlign = 'left';
      ctx.fillText(r.label, r.x + 10, midY + 4);
      const ax = r.x + r.w - 10, asz = hover ? 8 : 6;
      ctx.fillStyle = hover ? '#fff' : 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.moveTo(ax, midY - asz * 0.6); ctx.lineTo(ax, midY + asz * 0.6); ctx.lineTo(ax + asz, midY); ctx.closePath(); ctx.fill();
    }
    const lastR = rects[rects.length - 1];
    ctx.fillStyle = 'rgba(255,255,200,0.45)'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('CLICK TO ATTACK', lastR.x + lastR.w / 2, lastR.y + lastR.h + 14);
  }
}
