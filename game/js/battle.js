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

    this.zonesActive    = false;
    this.defenseEnabled = false;
    this.hoveredSegment = null;
    this._wheelCenter   = null;
    this.hoveredElixir  = null;

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
      this.zonesActive    = true;
      this.defenseEnabled = true;
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

  _hitWheel(mx, my) {
    if (!this._wheelCenter) return null;
    const { cx, cy } = this._wheelCenter;
    const dx = mx - cx, dy = my - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 38 * 38 || d2 > 92 * 92) return null;
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a < 0) a += 360;
    if (a >= 150 && a < 210) return 'defend';  // shield: 150°–210°
    if (a >= 270 && a < 330) return 'top';     // HEAD:   270°–330°
    if (a >= 330 || a < 30)  return 'mid';     // BODY:   330°–30° (wraps 0°)
    if (a >= 30  && a < 90)  return 'bot';     // LEGS:   30°–90°
    return null;                               // gaps:   90°–150° and 210°–270°
  }

  _handleClick(e) {
    if (this._ended || this.animState !== 'idle') return;
    const { mx, my } = this._mouseCoords(e);
    const ei = this._hitElixir(mx, my);
    if (ei >= 0) {
      if (this.defenseEnabled) this._useElixir(ei);
      return;
    }
    const seg = this._hitWheel(mx, my);
    if (!seg) return;
    if (seg === 'defend') {
      if (!this.defenseEnabled) return;
      this.playerDefending = !this.playerDefending;
      return;
    }
    if (!this.zonesActive) return;
    this.zonesActive    = false;
    this.defenseEnabled = false;
    this.hoveredSegment = null;
    this.hoveredElixir  = null;
    this.canvas.style.cursor = 'default';
    UI.setDefenseEnabled(false);
    UI.setTurnIndicator(false);
    this._executePlayerAction(seg);
  }

  _handleMove(e) {
    const { mx, my } = this._mouseCoords(e);
    const ei = this._hitElixir(mx, my);
    if (ei >= 0) {
      this.hoveredElixir  = ei;
      this.hoveredSegment = null;
      const item = this.player.elixirSlots[ei];
      const avail = ei < this.player.elixirSlotsAvailable;
      this.canvas.style.cursor = (this.defenseEnabled && item && avail) ? 'pointer' : 'default';
      return;
    }
    this.hoveredElixir = null;
    const seg = this._hitWheel(mx, my);
    this.hoveredSegment = seg;
    const interactive = seg === 'defend' ? this.defenseEnabled
                      : seg !== null     ? this.zonesActive : false;
    this.canvas.style.cursor = interactive ? 'pointer' : 'default';
  }

  toggleDefense() {
    if (!this.defenseEnabled || this._ended) return;
    this.playerDefending = !this.playerDefending;
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

        this.animState      = 'idle';
        this.playerTurn     = true;
        this.zonesActive    = true;
        this.defenseEnabled = true;
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
    this.animState       = 'done';
    this.zonesActive     = false;
    this.defenseEnabled  = false;
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
    const drops = [];
    if (Math.random() < 0.25) drops.push({ ...EQUIPMENT_TEMPLATES.HealthBottle });

    const zone = ENEMY_TYPES[this.enemy.type]?.zone;
    // easy zone — basic gear
    if (zone === 'easy') {
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronSword });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.WoodenShield });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.LeatherHelm });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.LeatherShoulders });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.LeatherLegs });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.LeatherBoots });
      if (Math.random() < 0.06) drops.push({ ...EQUIPMENT_TEMPLATES.LeatherBelt });
    }
    // mid zone — better gear
    if (zone === 'mid') {
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronSword });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.WoodenShield });
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronHelm });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.IronShoulders });
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.Chainmail });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.IronLegs });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.IronBoots });
      if (Math.random() < 0.06) drops.push({ ...EQUIPMENT_TEMPLATES.LeatherBelt });
    }
    // hard zone — best gear
    if (zone === 'hard') {
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.SteelSword });
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronShield });
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronHelm });
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronShoulders });
      if (Math.random() < 0.12) drops.push({ ...EQUIPMENT_TEMPLATES.PlateArmor });
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronLegs });
      if (Math.random() < 0.10) drops.push({ ...EQUIPMENT_TEMPLATES.IronBoots });
      if (Math.random() < 0.08) drops.push({ ...EQUIPMENT_TEMPLATES.IronBelt });
    }
    return drops;
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

    if (this.zonesActive || this.defenseEnabled) this._drawWheel(ctx, W, H);

    this._drawElixirBelt(ctx, W, H);

    // Floating damage / heal numbers
    for (const f of this.floats) {
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle   = f.color || '#ff4444';
      ctx.font        = f.font  || 'bold 26px monospace';
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

  _drawWheel(ctx, W, H) {
    const DEG = Math.PI / 180;
    const OR = 92, IR = 38;
    const cx = W * 0.50, cy = H * 0.68 - 68;
    this._wheelCenter = { cx, cy };
    const pulse = 0.5 + 0.5 * Math.sin(this._animTime * 4);
    const hov = this.hoveredSegment;
    const def = this.playerDefending;

    // Outer ambient glow
    const aglow = ctx.createRadialGradient(cx, cy, OR * 0.55, cx, cy, OR + 38);
    aglow.addColorStop(0, `rgba(160,110,28,${0.16 + pulse * 0.10})`);
    aglow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aglow;
    ctx.beginPath(); ctx.arc(cx, cy, OR + 38, 0, Math.PI * 2); ctx.fill();

    // Blue defend aura
    if (def) {
      const dglow = ctx.createRadialGradient(cx, cy, IR, cx, cy, OR + 30);
      dglow.addColorStop(0, `rgba(68,170,255,${0.30 + pulse * 0.22})`);
      dglow.addColorStop(1, 'rgba(68,170,255,0)');
      ctx.fillStyle = dglow;
      ctx.beginPath(); ctx.arc(cx, cy, OR + 30, 0, Math.PI * 2); ctx.fill();
    }

    // ── Shield face (full donut OR → IR, dark aged iron) ─────────────
    ctx.beginPath();
    ctx.arc(cx, cy, OR, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, IR, 0, Math.PI * 2, true);
    ctx.closePath();
    const bgGrad = ctx.createRadialGradient(cx - 14, cy - 14, 4, cx, cy, OR);
    bgGrad.addColorStop(0,    '#2e1a08');
    bgGrad.addColorStop(0.42, '#1e1005');
    bgGrad.addColorStop(0.78, '#120a03');
    bgGrad.addColorStop(1,    '#0a0601');
    ctx.fillStyle = bgGrad; ctx.fill();

    // ── Inner boss ring (IR → IR+7, raised steel) ────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, IR + 7, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, IR, 0, Math.PI * 2, true);
    ctx.closePath();
    const bossRG = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, IR + 9);
    bossRG.addColorStop(0, '#9aa8b8'); bossRG.addColorStop(0.5, '#5e6c7e'); bossRG.addColorStop(1, '#2e3848');
    ctx.fillStyle = bossRG; ctx.fill();
    ctx.strokeStyle = 'rgba(200,218,240,0.50)'; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, IR + 6.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.52)'; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, IR + 0.5, 0, Math.PI * 2); ctx.stroke();

    // Segment highlight overlays
    const segs = [
      { id: 'defend', s: 150, e: 210, midA: 180,   color: def ? '#9a0020' : '#5a0010', enabled: this.defenseEnabled },
      { id: 'top',    s: 270, e: 330, midA: 300,   color: '#501888', enabled: this.zonesActive },
      { id: 'mid',    s: 330, e:  30, midA:   0,   color: '#0e5828', enabled: this.zonesActive },
      { id: 'bot',    s:  30, e:  90, midA:  60,   color: '#7a3a08', enabled: this.zonesActive },
    ];

    for (const seg of segs) {
      const isHov = hov === seg.id && seg.enabled;
      const isAct = seg.id === 'defend' && def;
      const alpha = isHov ? 0.80 : isAct ? 0.48 : (seg.enabled ? 0.22 : 0.08);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, OR - 3, seg.s * DEG, seg.e * DEG, false);
      ctx.arc(cx, cy, IR + 3, seg.e * DEG, seg.s * DEG, true);
      ctx.closePath();
      const gx = cx + Math.cos(seg.midA * DEG) * OR * 0.70;
      const gy = cy + Math.sin(seg.midA * DEG) * OR * 0.70;
      const sg = ctx.createRadialGradient(gx, gy, 2, cx, cy, OR);
      sg.addColorStop(0, seg.color + 'ff'); sg.addColorStop(1, seg.color + '00');
      ctx.fillStyle = sg; ctx.fill();
      if (isHov) {
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20;
        ctx.globalAlpha = 0.60;
        ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.8;
        ctx.stroke(); ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    // ── Outer shield rim (OR-9 → OR, riveted steel band) ────────────
    ctx.beginPath();
    ctx.arc(cx, cy, OR, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, OR - 9, 0, Math.PI * 2, true);
    ctx.closePath();
    const rimFG = ctx.createRadialGradient(cx - 10, cy - 10, OR - 18, cx, cy, OR + 3);
    rimFG.addColorStop(0,    '#b8c2d2');
    rimFG.addColorStop(0.28, '#dce4f4');
    rimFG.addColorStop(0.55, '#9aa4b8');
    rimFG.addColorStop(0.82, '#686e7e');
    rimFG.addColorStop(1,    '#363c4a');
    ctx.fillStyle = rimFG; ctx.fill();
    // Rim highlight outer edge + inner shadow
    ctx.shadowColor = 'rgba(220,232,255,0.38)'; ctx.shadowBlur = 4;
    ctx.strokeStyle = 'rgba(225,232,252,0.62)'; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, OR - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, OR - 8.5, 0, Math.PI * 2); ctx.stroke();
    // 18 steel rivets
    for (let i = 0; i < 18; i++) {
      const ra = (i / 18) * Math.PI * 2;
      const rx = cx + Math.cos(ra) * (OR - 4.5);
      const ry = cy + Math.sin(ra) * (OR - 4.5);
      const rg = ctx.createRadialGradient(rx - 0.7, ry - 0.7, 0.2, rx, ry, 2.6);
      rg.addColorStop(0, '#eef2ff'); rg.addColorStop(0.32, '#a8b2c6'); rg.addColorStop(1, '#404858');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.40)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, Math.PI * 2); ctx.stroke();
    }

    // Concentric ring engravings on shield face
    ctx.save();
    for (const [r, a, w] of [[OR - 15, 0.20, 0.9], [OR - 22, 0.14, 0.6], [IR + 14, 0.14, 0.6], [IR + 9, 0.11, 0.45]]) {
      ctx.strokeStyle = `rgba(200,160,50,${a})`; ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // Gold accent rings (outer edge + inner boss)
    ctx.shadowColor = `rgba(200,150,28,${0.42 + pulse * 0.18})`; ctx.shadowBlur = 7;
    ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(cx, cy, OR, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(180,140,40,${0.40 + pulse * 0.15})`; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, IR, 0, Math.PI * 2); ctx.stroke();

    // 4 ornate divider swords at gap midpoints
    for (const a of [270, 330, 30, 90, 150, 210]) this._drawDividerSword(ctx, cx, cy, a, OR, pulse);

    // Smooth sword offset — lerp toward target each frame
    if (!this._swordOffsets) this._swordOffsets = { top: 0, mid: 0, bot: 0 };

    // Shield one-shot shake — triggers on hover entry, decays to zero
    if (this._shieldShakeStart === undefined) this._shieldShakeStart = null;
    const isHovDef = hov === 'defend' && this.defenseEnabled;
    if (isHovDef && this._shieldShakeStart === null) this._shieldShakeStart = this._animTime;
    if (!isHovDef) this._shieldShakeStart = null;
    const _sst = this._shieldShakeStart;
    const shieldShake = (_sst !== null)
      ? Math.sin((this._animTime - _sst) * 22) * 0.11 * Math.max(0, 1 - (this._animTime - _sst) * 2.2)
      : 0;

    // Segment icons (drawn on top of base, under medallion)
    const iconR = (OR + IR) / 2;
    for (const seg of segs) {
      const isHov = hov === seg.id && seg.enabled;
      const isAct = seg.id === 'defend' && def;
      let hoverPush = 0;
      if (seg.id !== 'defend') {
        const target = isHov ? 14 : 0;
        this._swordOffsets[seg.id] += (target - this._swordOffsets[seg.id]) * 0.12;
        hoverPush = this._swordOffsets[seg.id];
      }
      const ix = cx + Math.cos(seg.midA * DEG) * (iconR + hoverPush);
      const iy = cy + Math.sin(seg.midA * DEG) * (iconR + hoverPush);
      if (seg.id === 'defend') {
        this._drawShieldIcon(ctx, ix, iy, isHov, isAct, seg.enabled, shieldShake);
      } else {
        const lbl = { top: 'HEAD', mid: 'BODY', bot: 'LEGS' }[seg.id];
        this._drawSwordIcon(ctx, ix, iy, lbl, isHov, seg.enabled, seg.midA, pulse);
      }
    }

    this._drawCenterMedallion(ctx, cx, cy, def, pulse, this._animTime);
  }

  _drawDividerSword(ctx, cx, cy, angleDeg, OR, pulse) {
    const DEG = Math.PI / 180;
    const IR  = 38; // matches _drawWheel inner radius constant
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleDeg * DEG);
    // blade runs from inner ring (IR) all the way through and past outer ring

    const tipX  = OR + 8;   // tip just barely past outer rim
    const baseX = IR;        // base starts at inner ring
    const bW    = 2.2;       // half-width at base (tapers to tip)

    // Blade glow
    ctx.shadowColor = `rgba(220,225,255,${0.22 + pulse * 0.15})`; ctx.shadowBlur = 6;

    // Blade — long triangle base at IR, tip past OR
    const blGrad = ctx.createLinearGradient(baseX, 0, tipX, 0);
    blGrad.addColorStop(0,    '#7a8090');
    blGrad.addColorStop(0.40, '#d8dcee');
    blGrad.addColorStop(0.80, '#eaeeff');
    blGrad.addColorStop(1,    '#b0b4c8');
    ctx.fillStyle = blGrad;
    ctx.beginPath(); ctx.moveTo(tipX, 0); ctx.lineTo(baseX, -bW); ctx.lineTo(baseX, bW); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;

    // Ridge
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(tipX - 4, 0); ctx.lineTo(baseX + 8, 0); ctx.stroke();

    ctx.restore();
  }

  _drawCenterMedallion(ctx, cx, cy, defending, pulse, animTime = 0) {
    const R = 36;

    // Base
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    const bGrad = ctx.createRadialGradient(cx - 5, cy - 5, 1, cx, cy, R);
    bGrad.addColorStop(0, defending ? '#1e3acc' : '#0e1a72');
    bGrad.addColorStop(1, defending ? '#0a1a88' : '#060d42');
    ctx.fillStyle = bGrad; ctx.fill();

    // Organic inner light — four incommensurate frequencies, blooms irregularly
    const t  = animTime;
    const lp = 0.50 + 0.22 * Math.sin(t * 1.7)
                    + 0.16 * Math.sin(t * 2.9 + 1.8)
                    + 0.09 * Math.sin(t * 5.1 + 0.6)
                    + 0.05 * Math.sin(t * 8.3 + 2.1);
    const lR = Math.max(1, 6 + lp * 10);
    const lA = defending ? 0.36 + lp * 0.40 : 0.05 + lp * 0.22;
    const lG = ctx.createRadialGradient(cx - 1, cy - 1, 0.5, cx, cy, lR);
    lG.addColorStop(0,    `rgba(180,228,255,${Math.min(1, lA + 0.22)})`);
    lG.addColorStop(0.42, `rgba(90,170,255,${Math.max(0, lA)})`);
    lG.addColorStop(1,    'rgba(40,80,220,0)');
    ctx.fillStyle = lG;
    ctx.beginPath(); ctx.arc(cx, cy, lR, 0, Math.PI * 2); ctx.fill();
    // Spark — brightens when light blooms, dims when it fades
    const sA = Math.max(0, lp * 0.82);
    ctx.fillStyle = `rgba(215,242,255,${Math.min(1, sA)})`;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.5, 1.2 + lp * 2.2), 0, Math.PI * 2); ctx.fill();

    // Defend inner pulse
    if (defending) {
      const dg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      dg.addColorStop(0, `rgba(100,200,255,${0.32 + pulse * 0.26})`);
      dg.addColorStop(0.65, `rgba(68,140,255,${0.10 + pulse * 0.08})`);
      dg.addColorStop(1, 'rgba(68,140,255,0)');
      ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }

    // Gold ring
    ctx.shadowColor = `rgba(200,160,40,${0.42 + pulse * 0.22})`; ctx.shadowBlur = 8;
    ctx.strokeStyle = '#d4a030'; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#8a6010'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, 0, Math.PI * 2); ctx.stroke();

    // Two crossed swords — same premium style, guards meeting at center, tips up-right & up-left
    const ms_tipX    = 33;  const ms_sharp  = 9;   const ms_bW    = 2.8;
    const ms_gX      = 0;   const ms_gH     = 5.0; const ms_cgH   = 2.0;
    const ms_cgW     = 2.0; const ms_gripX  = -ms_cgW;
    const ms_hLen    = 9;   const ms_gripEnd = ms_gripX - ms_hLen;
    const ms_pomCX   = ms_gripEnd - 2.5;
    const ms_pomR    = 2.5; const ms_pomRy  = 1.9; const ms_gripW = 1.2;

    // Draw both swords; second pass (upper-left) renders on top
    for (const angle of [-Math.PI / 4, -3 * Math.PI / 4]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-11, 0); // cross ~33% up the blade — closer to handle, not midpoint

      // Blade
      const ms_bl = ctx.createLinearGradient(ms_gX, -ms_bW, ms_gX, ms_bW);
      ms_bl.addColorStop(0, '#50546a'); ms_bl.addColorStop(0.18, '#9ea2bc');
      ms_bl.addColorStop(0.5, '#f0f4ff'); ms_bl.addColorStop(0.82, '#9ea2bc'); ms_bl.addColorStop(1, '#50546a');
      ctx.fillStyle = ms_bl;
      ctx.beginPath();
      ctx.moveTo(ms_gX + 3.5, -ms_bW); ctx.lineTo(ms_tipX - ms_sharp, -ms_bW);
      ctx.lineTo(ms_tipX, 0);
      ctx.lineTo(ms_tipX - ms_sharp, ms_bW); ctx.lineTo(ms_gX + 3.5, ms_bW);
      ctx.closePath(); ctx.fill();

      // Ricasso
      const ms_ric = ctx.createLinearGradient(ms_gX, -(ms_bW+0.7), ms_gX, ms_bW+0.7);
      ms_ric.addColorStop(0, '#404460'); ms_ric.addColorStop(0.5, '#ccd0e8'); ms_ric.addColorStop(1, '#404460');
      ctx.fillStyle = ms_ric;
      ctx.fillRect(ms_gX, -(ms_bW + 0.7), 3.5, (ms_bW + 0.7) * 2);

      // Fuller
      ctx.strokeStyle = 'rgba(28,30,48,0.62)'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ms_tipX - ms_sharp - 1, 0); ctx.lineTo(ms_gX + 5, 0); ctx.stroke();
      ctx.lineCap = 'butt';

      // 3 highlight bands
      for (let i = 0; i < 3; i++) {
        const bx = ms_gX + 5 + i * ((ms_tipX - ms_sharp - ms_gX - 7) / 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.15 + (i % 2 === 0 ? 0.13 : 0.04)})`;
        ctx.lineWidth = 0.45;
        ctx.beginPath(); ctx.moveTo(bx, -ms_bW * 0.62); ctx.lineTo(bx, ms_bW * 0.62); ctx.stroke();
      }

      // Edge glints
      ctx.strokeStyle = 'rgba(215,222,255,0.35)'; ctx.lineWidth = 0.45; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ms_gX,-ms_bW); ctx.lineTo(ms_gX+3.5,-ms_bW); ctx.lineTo(ms_tipX-ms_sharp,-ms_bW); ctx.lineTo(ms_tipX,0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ms_gX, ms_bW); ctx.lineTo(ms_gX+3.5, ms_bW); ctx.lineTo(ms_tipX-ms_sharp, ms_bW); ctx.lineTo(ms_tipX,0); ctx.stroke();
      ctx.lineCap = 'butt';

      // Crossguard block
      const ms_cg = ctx.createLinearGradient(ms_gX - ms_cgW, -ms_cgH, ms_gX - ms_cgW, ms_cgH);
      ms_cg.addColorStop(0, '#622e06'); ms_cg.addColorStop(0.5, '#ffd700'); ms_cg.addColorStop(1, '#622e06');
      ctx.fillStyle = ms_cg;
      ctx.shadowColor = `rgba(190,140,28,${0.5 + pulse * 0.2})`; ctx.shadowBlur = 5;
      _roundRect(ctx, ms_gX - ms_cgW, -ms_cgH, ms_cgW * 2, ms_cgH * 2, 1.4); ctx.fill(); ctx.shadowBlur = 0;

      // Quillon arms
      ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.strokeStyle = '#c8960c';
      ctx.beginPath(); ctx.moveTo(ms_gX, -ms_cgH); ctx.quadraticCurveTo(ms_gX+1.5, -(ms_gH*0.55), ms_gX+1, -ms_gH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ms_gX,  ms_cgH); ctx.quadraticCurveTo(ms_gX+1.5,  ms_gH*0.55,   ms_gX+1,  ms_gH); ctx.stroke();
      ctx.lineCap = 'butt';
      for (const oy of [-ms_gH, ms_gH]) {
        const og = ctx.createRadialGradient(ms_gX+0.3, oy-0.5, 0.1, ms_gX+1, oy, 2.0);
        og.addColorStop(0,'#fff8c0'); og.addColorStop(0.5,'#ffd700'); og.addColorStop(1,'#6a4508');
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.arc(ms_gX+1, oy, 2.0, 0, Math.PI*2); ctx.fill();
      }

      // Sapphire cabochon
      const ms_sap = ctx.createRadialGradient(ms_gX-0.4,-0.4,0.1, ms_gX,0,1.8);
      ms_sap.addColorStop(0,'#c8ecff'); ms_sap.addColorStop(0.35,'#2277ee'); ms_sap.addColorStop(1,'#060e50');
      ctx.fillStyle = ms_sap;
      ctx.shadowColor = 'rgba(35,95,255,0.65)'; ctx.shadowBlur = 5;
      ctx.beginPath(); ctx.ellipse(ms_gX, 0, 1.8, 1.8, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;

      // Grip
      const ms_gr = ctx.createLinearGradient(ms_gripX, -ms_gripW, ms_gripX, ms_gripW);
      ms_gr.addColorStop(0, '#280e04'); ms_gr.addColorStop(0.5, '#70320e'); ms_gr.addColorStop(1, '#280e04');
      ctx.fillStyle = ms_gr;
      ctx.fillRect(ms_gripEnd, -ms_gripW, ms_hLen, ms_gripW * 2);
      ctx.lineWidth = 0.35;
      for (let wx = ms_gripEnd; wx <= ms_gripX; wx += 2.5) {
        ctx.strokeStyle = 'rgba(195,158,42,0.52)';
        ctx.beginPath(); ctx.moveTo(wx, -ms_gripW); ctx.lineTo(wx+2.5,  ms_gripW); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(wx,  ms_gripW); ctx.lineTo(wx+2.5, -ms_gripW); ctx.stroke();
      }
      for (let ri = 0; ri < 2; ri++) {
        const rx2 = ms_gripX - ms_hLen * (0.22 + ri * 0.56);
        const rg2 = ctx.createLinearGradient(rx2, -(ms_gripW+0.8), rx2, ms_gripW+0.8);
        rg2.addColorStop(0,'#6a4408'); rg2.addColorStop(0.5,'#ffd700'); rg2.addColorStop(1,'#6a4408');
        ctx.fillStyle = rg2;
        ctx.fillRect(rx2-0.8, -(ms_gripW+0.8), 1.6, (ms_gripW+0.8)*2);
      }

      // Pommel
      const ms_pom = ctx.createRadialGradient(ms_pomCX-0.8,-0.8,0.1, ms_pomCX,0,ms_pomR);
      ms_pom.addColorStop(0,'#fff8c0'); ms_pom.addColorStop(0.28,'#ffd700'); ms_pom.addColorStop(1,'#622e08');
      ctx.fillStyle = ms_pom;
      ctx.shadowColor = `rgba(195,155,38,${0.4 + pulse * 0.18})`; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.ellipse(ms_pomCX, 0, ms_pomR, ms_pomRy, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      const ms_gem = ctx.createRadialGradient(ms_pomCX-0.4,-0.4,0.1, ms_pomCX,0,1.4);
      ms_gem.addColorStop(0,'#c8ecff'); ms_gem.addColorStop(0.38,'#1a62cc'); ms_gem.addColorStop(1,'#060e40');
      ctx.fillStyle = ms_gem;
      ctx.shadowColor = 'rgba(35,95,255,0.5)'; ctx.shadowBlur = 3;
      ctx.beginPath(); ctx.arc(ms_pomCX, 0, 1.4, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(195,158,42,0.55)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.ellipse(ms_pomCX, 0, ms_pomR, ms_pomRy, 0, 0, Math.PI*2); ctx.stroke();

      ctx.restore();
    }
  }

  _drawShieldIcon(ctx, x, y, hover, active, enabled, shakeAngle = 0) {
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    ctx.translate(x, y);
    if (shakeAngle) ctx.rotate(shakeAngle);

    const HW = 11;   // half-width at top
    const TY = -11;  // top y
    const BY =  12;  // bottom tip y

    // Classic heater shield — gently arched top, sides flare, wide rounded bottom
    const BHW = 7.5;  // bottom half-width
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-HW, TY);
      ctx.quadraticCurveTo(0, TY - 1.5, HW, TY);                               // gentle top arch
      ctx.bezierCurveTo(HW + 2, TY + 5, BHW + 3, BY - 5, BHW, BY);            // right side
      ctx.quadraticCurveTo(0, BY + 6, -BHW, BY);                               // rounded bottom
      ctx.bezierCurveTo(-BHW - 3, BY - 5, -HW - 2, TY + 5, -HW, TY);         // left side
      ctx.closePath();
    };

    // ── Outer glow ──────────────────────────────────────────────────
    if (active)     { ctx.shadowColor = '#3399ff'; ctx.shadowBlur = 20; }
    else if (hover) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14; }

    // ── Main face ───────────────────────────────────────────────────
    path();
    const faceG = ctx.createLinearGradient(-HW, TY, HW * 0.55, BY);
    if (active) {
      faceG.addColorStop(0,    '#1c4ab8');
      faceG.addColorStop(0.30, '#2a66e0');
      faceG.addColorStop(0.65, '#1844a8');
      faceG.addColorStop(1,    '#0c2468');
    } else {
      faceG.addColorStop(0,    '#3e4460');
      faceG.addColorStop(0.30, '#5c6484');
      faceG.addColorStop(0.65, '#3a4058');
      faceG.addColorStop(1,    '#1c2038');
    }
    ctx.fillStyle = faceG; ctx.fill(); ctx.shadowBlur = 0;

    // ── Top-left directional sheen ──────────────────────────────────
    ctx.save(); path(); ctx.clip();
    const sheenG = ctx.createLinearGradient(-HW, TY, HW * 0.28, TY + 17);
    sheenG.addColorStop(0,    active ? 'rgba(140,205,255,0.50)' : 'rgba(255,255,255,0.42)');
    sheenG.addColorStop(0.45, active ? 'rgba(80,160,255,0.12)'  : 'rgba(255,255,255,0.10)');
    sheenG.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = sheenG; ctx.fill(); ctx.restore();

    // ── Bottom depth shadow ─────────────────────────────────────────
    ctx.save(); path(); ctx.clip();
    const depthG = ctx.createLinearGradient(0, 0, 0, BY);
    depthG.addColorStop(0,   'rgba(0,0,0,0)');
    depthG.addColorStop(0.6, 'rgba(0,0,0,0.10)');
    depthG.addColorStop(1,   'rgba(0,0,0,0.28)');
    ctx.fillStyle = depthG; ctx.fill(); ctx.restore();

    // ── Heraldic cross ──────────────────────────────────────────────
    ctx.save(); path(); ctx.clip();
    ctx.strokeStyle = active ? 'rgba(100,170,255,0.28)' : 'rgba(255,255,255,0.11)';
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.moveTo(0, TY - 2); ctx.lineTo(0, BY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-HW - 3, -1.5); ctx.lineTo(HW + 3, -1.5); ctx.stroke();
    ctx.restore();

    // ── Metallic rim ────────────────────────────────────────────────
    path();
    const rimG = ctx.createLinearGradient(-HW, TY, HW * 0.4, BY * 0.75);
    if (active) {
      rimG.addColorStop(0, '#88ccff'); rimG.addColorStop(0.45, '#55aaff'); rimG.addColorStop(1, '#1a55cc');
    } else if (hover) {
      rimG.addColorStop(0, '#ffe060'); rimG.addColorStop(0.45, '#ffd700'); rimG.addColorStop(1, '#a07800');
    } else {
      rimG.addColorStop(0, '#b0b8d0'); rimG.addColorStop(0.45, '#d0d8e8'); rimG.addColorStop(1, '#606878');
    }
    ctx.strokeStyle = rimG; ctx.lineWidth = 1.9; ctx.stroke();

    // Inner shadow bevel
    ctx.save(); ctx.scale(0.84, 0.84); path(); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 0.8; ctx.stroke();

    // Inner highlight bevel
    ctx.save(); ctx.scale(0.78, 0.78); path(); ctx.restore();
    ctx.strokeStyle = active ? 'rgba(90,170,255,0.22)' : 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 0.6; ctx.stroke();


    // ── 5 accent rivets ─────────────────────────────────────────────
    const rc = active ? 'rgba(110,215,255,0.92)' : (hover ? 'rgba(255,215,50,0.92)' : 'rgba(200,215,242,0.84)');
    const rivet = (rx2, ry2) => {
      ctx.fillStyle = rc; ctx.shadowColor = rc; ctx.shadowBlur = 2.5;
      ctx.beginPath(); ctx.arc(rx2, ry2, 1.15, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    };
    rivet(0,         TY + 2.8);   // top centre
    rivet(-HW*0.60,  TY + 3.5);   // top-left
    rivet( HW*0.60,  TY + 3.5);   // top-right
    rivet(-BHW*0.45, BY - 3.5);   // lower-left
    rivet( BHW*0.45, BY - 3.5);   // lower-right

    ctx.restore();

    // DEFEND label
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    ctx.fillStyle = active ? '#66ccff' : (hover ? '#ffffff' : 'rgba(150,190,255,0.70)');
    ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('DEFEND', x, y + BY + 9);
    ctx.textBaseline = 'alphabetic'; ctx.restore();
  }

  _drawSwordIcon(ctx, x, y, label, hover, enabled, midAngleDeg, pulse = 0.5) {
    const DEG = Math.PI / 180;
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    ctx.translate(x, y);
    ctx.rotate(midAngleDeg * DEG); // +x = outward (blade tip direction)

    // Geometry — straight sword (parallel sides, sharp tip only at end)
    const tipX     = 58;
    const sharpLen = 13;
    const gX       = 0;
    const bW       = 4.2;
    const gH       = 7;
    const cgH      = 3.0;
    const cgW      = 3.0;
    const gripX    = gX - cgW;
    const hLen     = 11;
    const gripEnd  = gripX - hLen;
    const pomCX    = gripEnd - 3.5;
    const pomR     = 3.2;
    const pomRy    = 2.5;
    const gripW    = 1.7;

    // ── BLADE ──────────────────────────────────────────────────────
    const blGrad = ctx.createLinearGradient(gX, -bW, gX, bW);
    blGrad.addColorStop(0,    '#50546a');
    blGrad.addColorStop(0.18, '#9ea2bc');
    blGrad.addColorStop(0.40, '#d8dcf0');
    blGrad.addColorStop(0.50, '#f0f4ff');
    blGrad.addColorStop(0.60, '#d8dcf0');
    blGrad.addColorStop(0.82, '#9ea2bc');
    blGrad.addColorStop(1,    '#50546a');
    ctx.fillStyle = blGrad;
    // Straight blade — parallel sides along full length, taper only at the very tip
    ctx.beginPath();
    ctx.moveTo(gX + 5.5, -bW);
    ctx.lineTo(tipX - sharpLen, -bW);
    ctx.lineTo(tipX, 0);
    ctx.lineTo(tipX - sharpLen,  bW);
    ctx.lineTo(gX + 5.5,  bW);
    ctx.closePath(); ctx.fill();

    // Ricasso (unsharpened base block, slightly wider)
    const ricGrad = ctx.createLinearGradient(gX, -(bW + 0.9), gX, bW + 0.9);
    ricGrad.addColorStop(0,   '#404460'); ricGrad.addColorStop(0.25, '#aaaecc');
    ricGrad.addColorStop(0.5, '#ccd0e8'); ricGrad.addColorStop(0.75, '#aaaecc');
    ricGrad.addColorStop(1,   '#404460');
    ctx.fillStyle = ricGrad;
    ctx.fillRect(gX, -(bW + 0.9), 5.5, (bW + 0.9) * 2);

    // Central fuller groove — stops before the sharp taper
    ctx.strokeStyle = 'rgba(28,30,48,0.62)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tipX - sharpLen - 2, 0); ctx.lineTo(gX + 6, 0); ctx.stroke();
    ctx.lineCap = 'butt';

    // 7 polished-steel highlight bands (uniform height across straight section)
    for (let i = 0; i < 7; i++) {
      const bx = gX + 7 + i * ((tipX - sharpLen - gX - 9) / 6);
      ctx.strokeStyle = `rgba(255,255,255,${0.14 + (i % 2 === 0 ? 0.13 : 0.04)})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(bx, -bW * 0.62); ctx.lineTo(bx, bW * 0.62); ctx.stroke();
    }

    // Nordic rune etchings (Tiwaz, Hagalaz, Algiz) — spread across straight section
    ctx.strokeStyle = 'rgba(100,110,175,0.30)'; ctx.lineWidth = 0.42;
    let rx = gX + 12;
    ctx.beginPath(); ctx.moveTo(rx, 1.6);  ctx.lineTo(rx, -1.6);      ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx + 1.4, 1.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx - 1.4, 1.1); ctx.stroke();
    rx = gX + 26;
    ctx.beginPath(); ctx.moveTo(rx-1.2,-1.5); ctx.lineTo(rx-1.2,1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx+1.2,-1.5); ctx.lineTo(rx+1.2,1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx-1.2, 0);   ctx.lineTo(rx+1.2, 0);  ctx.stroke();
    rx = gX + 38;
    ctx.beginPath(); ctx.moveTo(rx, 1.6);  ctx.lineTo(rx, -0.3);       ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx - 1.4, -1.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx + 1.4, -1.8); ctx.stroke();

    // Edge glints trace the actual blade outline
    if (hover) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10; }
    ctx.strokeStyle = hover ? 'rgba(255,215,60,0.55)' : 'rgba(215,222,255,0.35)';
    ctx.lineWidth = 0.55; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(gX,-bW); ctx.lineTo(gX+5.5,-bW); ctx.lineTo(tipX-sharpLen,-bW); ctx.lineTo(tipX,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gX, bW); ctx.lineTo(gX+5.5, bW); ctx.lineTo(tipX-sharpLen, bW); ctx.lineTo(tipX,0); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.shadowBlur = 0;

    // ── CROSSGUARD ─────────────────────────────────────────────────
    const cgGrad = ctx.createLinearGradient(gX - cgW, -cgH, gX - cgW, cgH);
    cgGrad.addColorStop(0,   '#622e06'); cgGrad.addColorStop(0.28, '#c88010');
    cgGrad.addColorStop(0.5,  hover ? '#ffe060' : '#ffd700');
    cgGrad.addColorStop(0.72,'#c88010'); cgGrad.addColorStop(1,   '#622e06');
    ctx.fillStyle = cgGrad;
    ctx.shadowColor = hover ? '#ffd700' : 'rgba(190,140,28,0.55)'; ctx.shadowBlur = hover ? 9 : 5;
    _roundRect(ctx, gX - cgW, -cgH, cgW * 2, cgH * 2, 2); ctx.fill(); ctx.shadowBlur = 0;

    // Alternating grooves + gold engraving
    for (let gy = -cgH + 1.5; gy < cgH; gy += 2.0) {
      ctx.strokeStyle = 'rgba(55,30,4,0.55)'; ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.moveTo(gX-cgW+0.8,gy); ctx.lineTo(gX+cgW-0.8,gy); ctx.stroke();
    }
    for (let gy = -cgH + 2.5; gy < cgH; gy += 2.0) {
      ctx.strokeStyle = 'rgba(255,215,70,0.28)'; ctx.lineWidth = 0.38;
      ctx.beginPath(); ctx.moveTo(gX-cgW+1,gy); ctx.lineTo(gX+cgW-1,gy); ctx.stroke();
    }

    // Swept quillon arms (curved toward blade side)
    ctx.lineWidth = 2.8; ctx.lineCap = 'round';
    ctx.strokeStyle = hover ? '#ffe060' : '#c8960c';
    ctx.beginPath(); ctx.moveTo(gX,-cgH); ctx.quadraticCurveTo(gX+2.5,-(gH*0.55),gX+1.5,-gH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gX, cgH); ctx.quadraticCurveTo(gX+2.5, gH*0.55, gX+1.5, gH); ctx.stroke();
    ctx.lineCap = 'butt';

    // Quillon tip orbs with specular
    for (const oy of [-gH, gH]) {
      const orbG = ctx.createRadialGradient(gX+0.5, oy-0.9, 0.3, gX+1.5, oy, 3.5);
      orbG.addColorStop(0,'#fff8c0'); orbG.addColorStop(0.45,'#ffd700'); orbG.addColorStop(1,'#6a4508');
      ctx.fillStyle = orbG;
      ctx.shadowColor = 'rgba(255,200,35,0.5)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(gX+1.5, oy, 3.5, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,210,0.52)';
      ctx.beginPath(); ctx.ellipse(gX+0.5, oy-1.1, 1.1, 0.75, -0.4, 0, Math.PI*2); ctx.fill();
    }

    // Sapphire cabochon in guard centre (matches wheel gem language)
    const sapGrad = ctx.createRadialGradient(gX-0.5,-0.6,0.2, gX,0,2.8);
    sapGrad.addColorStop(0,'#c8ecff'); sapGrad.addColorStop(0.35,'#2277ee'); sapGrad.addColorStop(1,'#060e50');
    ctx.fillStyle = sapGrad;
    ctx.shadowColor = 'rgba(35,95,255,0.65)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.ellipse(gX, 0, 2.8, 2.8, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(210,240,255,0.70)';
    ctx.beginPath(); ctx.ellipse(gX-0.8,-0.8, 1.1,0.7, -0.45, 0, Math.PI*2); ctx.fill();

    // ── GRIP ───────────────────────────────────────────────────────
    const leatherGrad = ctx.createLinearGradient(gripX, -gripW, gripX, gripW);
    leatherGrad.addColorStop(0,   '#280e04'); leatherGrad.addColorStop(0.28,'#522206');
    leatherGrad.addColorStop(0.5, '#70320e'); leatherGrad.addColorStop(0.72,'#522206');
    leatherGrad.addColorStop(1,   '#280e04');
    ctx.fillStyle = leatherGrad;
    ctx.fillRect(gripEnd, -gripW, hLen, gripW * 2);

    // Diamond cross-wrap gold wire
    ctx.lineWidth = 0.55;
    for (let wx = gripEnd; wx <= gripX; wx += 4) {
      ctx.strokeStyle = hover ? 'rgba(255,220,65,0.60)' : 'rgba(195,158,42,0.52)';
      ctx.beginPath(); ctx.moveTo(wx, -gripW); ctx.lineTo(wx+4,  gripW); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx,  gripW); ctx.lineTo(wx+4, -gripW); ctx.stroke();
    }

    // 3 decorative spacer rings
    for (let ri = 0; ri < 3; ri++) {
      const ringX = gripX - hLen * (0.18 + ri * 0.32);
      const ringG = ctx.createLinearGradient(ringX, -(gripW+1.2), ringX, gripW+1.2);
      ringG.addColorStop(0,'#6a4408'); ringG.addColorStop(0.45,'#ffd700');
      ringG.addColorStop(0.55,'#fff8a0'); ringG.addColorStop(1,'#6a4408');
      ctx.fillStyle = ringG;
      ctx.fillRect(ringX-1.2, -(gripW+1.2), 2.4, (gripW+1.2)*2);
      ctx.strokeStyle = 'rgba(70,40,4,0.38)'; ctx.lineWidth = 0.32;
      ctx.beginPath(); ctx.moveTo(ringX-1.2,-(gripW+0.35)); ctx.lineTo(ringX+1.2,-(gripW+0.35)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ringX-1.2, gripW+0.35);   ctx.lineTo(ringX+1.2, gripW+0.35);   ctx.stroke();
    }

    // ── POMMEL ─────────────────────────────────────────────────────
    const pomBodyGrad = ctx.createRadialGradient(pomCX-1.2,-1.2,0.3, pomCX,0,pomR);
    pomBodyGrad.addColorStop(0,   '#fff8c0'); pomBodyGrad.addColorStop(0.28,'#ffd700');
    pomBodyGrad.addColorStop(0.62,'#c09010'); pomBodyGrad.addColorStop(1,   '#622e08');
    ctx.fillStyle = pomBodyGrad;
    ctx.shadowColor = hover ? '#ffd700' : 'rgba(195,155,38,0.50)'; ctx.shadowBlur = hover ? 8 : 5;
    ctx.beginPath(); ctx.ellipse(pomCX, 0, pomR, pomRy, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;

    // Facet grid (horizontal + vertical)
    ctx.strokeStyle = 'rgba(80,48,5,0.42)'; ctx.lineWidth = 0.38;
    for (let fi = -2; fi <= 2; fi++) {
      const fy  = fi * (pomRy / 2.6);
      const fx  = Math.sqrt(Math.max(0, 1 - (fy/pomRy)**2)) * pomR * 0.88;
      ctx.beginPath(); ctx.moveTo(pomCX-fx, fy); ctx.lineTo(pomCX+fx, fy); ctx.stroke();
      const fxv = fi * (pomR / 2.6);
      const fyv = Math.sqrt(Math.max(0, 1 - (fxv/pomR)**2)) * pomRy * 0.88;
      ctx.beginPath(); ctx.moveTo(pomCX+fxv,-fyv); ctx.lineTo(pomCX+fxv,fyv); ctx.stroke();
    }

    // 4 secondary bosses (N/S/E/W)
    for (const [bx,by] of [[0,-(pomRy-1.8)],[0,pomRy-1.8],[-(pomR-1.8),0],[pomR-1.8,0]]) {
      const bossG = ctx.createRadialGradient(pomCX+bx-0.3,by-0.3,0.1, pomCX+bx,by,1.3);
      bossG.addColorStop(0,'#fff8c0'); bossG.addColorStop(0.5,'#ffd700'); bossG.addColorStop(1,'#6a4808');
      ctx.fillStyle = bossG;
      ctx.beginPath(); ctx.arc(pomCX+bx, by, 1.3, 0, Math.PI*2); ctx.fill();
    }

    // Central pommel gem — same blue gem language as guard sapphire & wheel medallion
    const gemGrad = ctx.createRadialGradient(pomCX-0.5,-0.5,0.15, pomCX,0,2.2);
    gemGrad.addColorStop(0,'#c8ecff'); gemGrad.addColorStop(0.38,'#1a62cc'); gemGrad.addColorStop(1,'#060e40');
    ctx.fillStyle = gemGrad;
    ctx.shadowColor = 'rgba(35,95,255,0.55)'; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(pomCX, 0, 2.2, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(200,235,255,0.68)';
    ctx.beginPath(); ctx.ellipse(pomCX-0.6,-0.6, 0.9,0.6,-0.5, 0, Math.PI*2); ctx.fill();

    // Pommel rim
    ctx.strokeStyle = hover ? '#ffe060' : 'rgba(195,158,42,0.62)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.ellipse(pomCX, 0, pomR, pomRy, 0, 0, Math.PI*2); ctx.stroke();

    ctx.restore();

    // Label (perpendicular to blade)
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    const perpA = (midAngleDeg + 90) * DEG;
    const lx = x + Math.cos(perpA) * 18;
    const ly = y + Math.sin(perpA) * 18;
    ctx.fillStyle = hover ? '#ffd700' : 'rgba(215,195,155,0.85)';
    ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, lx, ly);
    ctx.textBaseline = 'alphabetic'; ctx.restore();
  }

  _drawDefenseShield(ctx, cx, cy) {
    const pulse = 0.5 + 0.5 * Math.sin(this._animTime * 4);
    const charCY = cy - 68;
    const r   = 48 + pulse * 8;
    const grd = ctx.createRadialGradient(cx, charCY, 0, cx, charCY, r);
    grd.addColorStop(0, `rgba(68,170,255,${0.18 + pulse * 0.14})`);
    grd.addColorStop(1, 'rgba(68,170,255,0)');
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

  spawnHealFloat(pts, side = 'player') {
    const W = this.canvas.width, H = this.canvas.height;
    const cx = side === 'player' ? W * 0.25 : W * 0.75;
    this.floats.push({
      text: `+${pts}`, color: '#44ee88', font: 'bold 20px monospace',
      x: cx + (Math.random() - 0.5) * 28,
      y: H * 0.68 - 90, life: 1.5, maxLife: 1.5,
    });
  }

  // ── ELIXIR BELT ────────────────────────────────────────────────────
  _elixirBeltLayout(W, H) {
    const sw = 44, sh = 30, gap = 5;
    const total = 4 * sw + 3 * gap;
    const sx = W * 0.25 - total / 2;
    const sy = H * 0.68 + 14;
    return [0, 1, 2, 3].map(i => ({ x: sx + i * (sw + gap), y: sy, w: sw, h: sh, i }));
  }

  _hitElixir(mx, my) {
    const W = this.canvas.width, H = this.canvas.height;
    for (const r of this._elixirBeltLayout(W, H)) {
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return r.i;
    }
    return -1;
  }

  _useElixir(slotIdx) {
    const item = this.player.elixirSlots[slotIdx];
    if (!item || slotIdx >= this.player.elixirSlotsAvailable) return;
    this.player.useElixirSlot(slotIdx);
    this._log(`You drink ${item.name}! +${item.hotHps} HP/s for ${item.hotDuration}s`, 'log-system');
  }

  _drawElixirBelt(ctx, W, H) {
    const player  = this.player;
    const rects   = this._elixirBeltLayout(W, H);
    const avail   = player.elixirSlotsAvailable;
    const myTurn  = this.defenseEnabled;
    const pulse   = 0.5 + 0.5 * Math.sin(this._animTime * 3);

    // Panel — action-bar style
    const bx = rects[0].x - 8,  by = rects[0].y - 17;
    const bw = rects[3].x + rects[3].w - rects[0].x + 16, bh = rects[0].h + 25;

    ctx.shadowColor = 'rgba(0,0,0,0.70)';
    ctx.shadowBlur  = 16; ctx.shadowOffsetY = 2;
    ctx.fillStyle   = 'rgba(5,8,20,0.90)';
    _roundRect(ctx, bx, by, bw, bh, 8); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    ctx.strokeStyle = myTurn ? 'rgba(90,138,170,0.70)' : 'rgba(42,58,90,0.80)';
    ctx.lineWidth   = 1;
    _roundRect(ctx, bx, by, bw, bh, 8); ctx.stroke();

    ctx.fillStyle = myTurn ? 'rgba(140,188,220,0.80)' : 'rgba(80,110,140,0.55)';
    ctx.font = '7px monospace'; ctx.textAlign = 'center';
    ctx.fillText('E L I X I R', bx + bw / 2, by + 11);

    for (const r of rects) {
      const item   = player.elixirSlots[r.i];
      const locked = r.i >= avail;
      const hov    = this.hoveredElixir === r.i && myTurn && item && !locked;

      ctx.save();
      if (locked) {
        ctx.fillStyle = 'rgba(8,10,20,0.85)';
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(28,32,50,0.80)'; ctx.lineWidth = 1;
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.stroke();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#778'; ctx.font = '10px serif'; ctx.textAlign = 'center';
        ctx.fillText('🔒', r.x + r.w / 2, r.y + r.h / 2 + 4);
      } else if (!item) {
        ctx.fillStyle = 'rgba(10,14,28,0.85)';
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(42,58,90,0.55)'; ctx.lineWidth = 1;
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.stroke();
        ctx.fillStyle = 'rgba(72,92,120,0.50)';
        ctx.font = '9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(r.i + 1, r.x + r.w / 2, r.y + r.h / 2 + 3);
      } else {
        if (hov) { ctx.shadowColor = 'rgba(90,138,170,0.55)'; ctx.shadowBlur = 10; }
        ctx.fillStyle = hov ? '#111e30' : '#0d1424';
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.fill();
        ctx.strokeStyle = hov ? '#5a8aaa' : (myTurn ? 'rgba(90,138,170,0.65)' : 'rgba(42,58,90,0.75)');
        ctx.lineWidth   = hov ? 1.5 : 1;
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.stroke();
        ctx.shadowBlur = 0;

        const icx = r.x + r.w / 2, icy = r.y + 9;
        ctx.strokeStyle = hov ? '#adf' : (myTurn ? '#8bc' : 'rgba(100,155,195,0.55)');
        ctx.fillStyle   = hov ? 'rgba(170,220,255,0.15)' : 'rgba(100,155,195,0.12)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(icx, icy, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(icx - 1.5, icy - 4); ctx.lineTo(icx + 1.5, icy - 4);
        ctx.moveTo(icx, icy - 4);       ctx.lineTo(icx, icy - 7);
        ctx.stroke();

        ctx.fillStyle = hov ? '#adf' : (myTurn ? '#8bc' : 'rgba(100,155,195,0.55)');
        ctx.font = '7px monospace'; ctx.textAlign = 'center';
        const lbl = item.name.replace('Health ', '').slice(0, 6);
        ctx.fillText(lbl, r.x + r.w / 2, r.y + r.h - 3);
      }
      ctx.restore();
    }
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

    this.zonesActive    = false;
    this.defenseEnabled = false;
    this.hoveredSegment = null;
    this._wheelCenter   = null;
    this.hoveredElixir  = null;
    this.floats         = [];

    this._oppHotHps       = 0;
    this._oppHotRemaining = 0;
    this._oppHotAccum     = 0;

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
    Network.onDuelHeal    = d => {
      const info = d.total;
      if (!info || typeof info !== 'object') return;
      this._log(`Opponent used ${info.itemName}! (+${info.hotHps} HP/s for ${info.hotDuration}s)`, 'log-system');
      this._oppHotHps       = info.hotHps;
      this._oppHotRemaining = info.hotDuration;
      this._oppHotAccum     = 0;
    };

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
    Network.onDuelHeal    = null;
  }

  toggleDefense() {
    if (!this.defenseEnabled || this._ended) return;
    this.playerDefending = !this.playerDefending;
  }

  // ── TURN STATE ─────────────────────────────────────────────────────
  _activateMyTurn() {
    this.state          = 'picking';
    this.zonesActive    = true;
    this.defenseEnabled = true;
    UI.setDefenseEnabled(true);
    UI.setDefenseActive(this.playerDefending);
    this._startCountdown();
    this._updateTurnIndicator();
  }

  _setWaiting() {
    this.state          = 'waiting';
    this.zonesActive    = false;
    this.defenseEnabled = false;
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

  _hitWheel(mx, my) {
    if (!this._wheelCenter) return null;
    const { cx, cy } = this._wheelCenter;
    const dx = mx - cx, dy = my - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < 38 * 38 || d2 > 92 * 92) return null;
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a < 0) a += 360;
    if (a >= 150 && a < 210) return 'defend';  // shield: 150°–210°
    if (a >= 270 && a < 330) return 'top';     // HEAD:   270°–330°
    if (a >= 330 || a < 30)  return 'mid';     // BODY:   330°–30° (wraps 0°)
    if (a >= 30  && a < 90)  return 'bot';     // LEGS:   30°–90°
    return null;                               // gaps:   90°–150° and 210°–270°
  }

  _handleClick(e) {
    if (this._ended || this.animState !== 'idle') return;
    const { mx, my } = this._mouseCoords(e);
    const ei = this._hitElixir(mx, my);
    if (ei >= 0) {
      if (this.defenseEnabled && this.state === 'picking') this._useElixir(ei);
      return;
    }
    const seg = this._hitWheel(mx, my);
    if (!seg) return;
    if (seg === 'defend') {
      if (!this.defenseEnabled) return;
      this.playerDefending = !this.playerDefending;
      return;
    }
    if (!this.zonesActive || this.state !== 'picking') return;
    this._stopCountdown();
    this.zonesActive    = false;
    this.defenseEnabled = false;
    this.hoveredSegment = null;
    this.hoveredElixir  = null;
    this.canvas.style.cursor = 'default';
    this.state = 'waiting';
    const el = document.getElementById('turn-indicator');
    if (el) { el.className = 'duel-resolve'; el.textContent = 'ATTACKING...'; }
    Network.sendDuelZone(this.sessionId, seg, this.playerDefending);
  }

  _handleMove(e) {
    const { mx, my } = this._mouseCoords(e);
    const ei = this._hitElixir(mx, my);
    if (ei >= 0) {
      this.hoveredElixir  = ei;
      this.hoveredSegment = null;
      const item  = this.player.elixirSlots[ei];
      const avail = ei < this.player.elixirSlotsAvailable;
      this.canvas.style.cursor = (this.defenseEnabled && this.state === 'picking' && item && avail) ? 'pointer' : 'default';
      return;
    }
    this.hoveredElixir = null;
    const seg = this._hitWheel(mx, my);
    this.hoveredSegment = seg;
    const interactive = seg === 'defend' ? this.defenseEnabled
                      : seg !== null     ? this.zonesActive : false;
    this.canvas.style.cursor = interactive ? 'pointer' : 'default';
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

    if (this._oppHotRemaining > 0) {
      const tick = Math.min(this._oppHotRemaining, dt);
      this._oppHotAccum    += tick * this._oppHotHps;
      this._oppHotRemaining = Math.max(0, this._oppHotRemaining - dt);
      if (this._oppHotAccum >= 1) {
        const pts = Math.floor(this._oppHotAccum);
        this._oppHotAccum -= pts;
        this.opponentCurrentHP = Math.min(this.opponent.maxHP, this.opponentCurrentHP + pts);
        this.spawnHealFloat(pts, 'opponent');
      }
    }

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
    if (this.zonesActive || this.defenseEnabled) this._drawWheel(ctx, W, H);

    this._drawElixirBelt(ctx, W, H);

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

    // Floating damage / heal numbers
    for (const f of this.floats) {
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle   = f.color || '#ff4444';
      ctx.font        = f.font  || 'bold 26px monospace';
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

  _drawWheel(ctx, W, H) {
    const DEG = Math.PI / 180;
    const OR = 92, IR = 38;
    const cx = W * 0.50, cy = H * 0.68 - 68;
    this._wheelCenter = { cx, cy };
    const pulse = 0.5 + 0.5 * Math.sin(this._animTime * 4);
    const hov = this.hoveredSegment;
    const def = this.playerDefending;

    // Outer ambient glow
    const aglow = ctx.createRadialGradient(cx, cy, OR * 0.55, cx, cy, OR + 38);
    aglow.addColorStop(0, `rgba(160,110,28,${0.16 + pulse * 0.10})`);
    aglow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aglow;
    ctx.beginPath(); ctx.arc(cx, cy, OR + 38, 0, Math.PI * 2); ctx.fill();

    // Blue defend aura
    if (def) {
      const dglow = ctx.createRadialGradient(cx, cy, IR, cx, cy, OR + 30);
      dglow.addColorStop(0, `rgba(68,170,255,${0.30 + pulse * 0.22})`);
      dglow.addColorStop(1, 'rgba(68,170,255,0)');
      ctx.fillStyle = dglow;
      ctx.beginPath(); ctx.arc(cx, cy, OR + 30, 0, Math.PI * 2); ctx.fill();
    }

    // ── Shield face (full donut OR → IR, dark aged iron) ─────────────
    ctx.beginPath();
    ctx.arc(cx, cy, OR, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, IR, 0, Math.PI * 2, true);
    ctx.closePath();
    const bgGrad = ctx.createRadialGradient(cx - 14, cy - 14, 4, cx, cy, OR);
    bgGrad.addColorStop(0,    '#2e1a08');
    bgGrad.addColorStop(0.42, '#1e1005');
    bgGrad.addColorStop(0.78, '#120a03');
    bgGrad.addColorStop(1,    '#0a0601');
    ctx.fillStyle = bgGrad; ctx.fill();

    // ── Inner boss ring (IR → IR+7, raised steel) ────────────────────
    ctx.beginPath();
    ctx.arc(cx, cy, IR + 7, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, IR, 0, Math.PI * 2, true);
    ctx.closePath();
    const bossRG = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, IR + 9);
    bossRG.addColorStop(0, '#9aa8b8'); bossRG.addColorStop(0.5, '#5e6c7e'); bossRG.addColorStop(1, '#2e3848');
    ctx.fillStyle = bossRG; ctx.fill();
    ctx.strokeStyle = 'rgba(200,218,240,0.50)'; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, IR + 6.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.52)'; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, IR + 0.5, 0, Math.PI * 2); ctx.stroke();

    // Segment highlight overlays
    const segs = [
      { id: 'defend', s: 150, e: 210, midA: 180,   color: def ? '#9a0020' : '#5a0010', enabled: this.defenseEnabled },
      { id: 'top',    s: 270, e: 330, midA: 300,   color: '#501888', enabled: this.zonesActive },
      { id: 'mid',    s: 330, e:  30, midA:   0,   color: '#0e5828', enabled: this.zonesActive },
      { id: 'bot',    s:  30, e:  90, midA:  60,   color: '#7a3a08', enabled: this.zonesActive },
    ];

    for (const seg of segs) {
      const isHov = hov === seg.id && seg.enabled;
      const isAct = seg.id === 'defend' && def;
      const alpha = isHov ? 0.80 : isAct ? 0.48 : (seg.enabled ? 0.22 : 0.08);
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, OR - 3, seg.s * DEG, seg.e * DEG, false);
      ctx.arc(cx, cy, IR + 3, seg.e * DEG, seg.s * DEG, true);
      ctx.closePath();
      const gx = cx + Math.cos(seg.midA * DEG) * OR * 0.70;
      const gy = cy + Math.sin(seg.midA * DEG) * OR * 0.70;
      const sg = ctx.createRadialGradient(gx, gy, 2, cx, cy, OR);
      sg.addColorStop(0, seg.color + 'ff'); sg.addColorStop(1, seg.color + '00');
      ctx.fillStyle = sg; ctx.fill();
      if (isHov) {
        ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 20;
        ctx.globalAlpha = 0.60;
        ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.8;
        ctx.stroke(); ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    // ── Outer shield rim (OR-9 → OR, riveted steel band) ────────────
    ctx.beginPath();
    ctx.arc(cx, cy, OR, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, OR - 9, 0, Math.PI * 2, true);
    ctx.closePath();
    const rimFG = ctx.createRadialGradient(cx - 10, cy - 10, OR - 18, cx, cy, OR + 3);
    rimFG.addColorStop(0,    '#b8c2d2');
    rimFG.addColorStop(0.28, '#dce4f4');
    rimFG.addColorStop(0.55, '#9aa4b8');
    rimFG.addColorStop(0.82, '#686e7e');
    rimFG.addColorStop(1,    '#363c4a');
    ctx.fillStyle = rimFG; ctx.fill();
    // Rim highlight outer edge + inner shadow
    ctx.shadowColor = 'rgba(220,232,255,0.38)'; ctx.shadowBlur = 4;
    ctx.strokeStyle = 'rgba(225,232,252,0.62)'; ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.arc(cx, cy, OR - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, OR - 8.5, 0, Math.PI * 2); ctx.stroke();
    // 18 steel rivets
    for (let i = 0; i < 18; i++) {
      const ra = (i / 18) * Math.PI * 2;
      const rx = cx + Math.cos(ra) * (OR - 4.5);
      const ry = cy + Math.sin(ra) * (OR - 4.5);
      const rg = ctx.createRadialGradient(rx - 0.7, ry - 0.7, 0.2, rx, ry, 2.6);
      rg.addColorStop(0, '#eef2ff'); rg.addColorStop(0.32, '#a8b2c6'); rg.addColorStop(1, '#404858');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.40)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, Math.PI * 2); ctx.stroke();
    }

    // Concentric ring engravings on shield face
    ctx.save();
    for (const [r, a, w] of [[OR - 15, 0.20, 0.9], [OR - 22, 0.14, 0.6], [IR + 14, 0.14, 0.6], [IR + 9, 0.11, 0.45]]) {
      ctx.strokeStyle = `rgba(200,160,50,${a})`; ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // Gold accent rings (outer edge + inner boss)
    ctx.shadowColor = `rgba(200,150,28,${0.42 + pulse * 0.18})`; ctx.shadowBlur = 7;
    ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(cx, cy, OR, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(180,140,40,${0.40 + pulse * 0.15})`; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, IR, 0, Math.PI * 2); ctx.stroke();

    // 4 ornate divider swords at gap midpoints
    for (const a of [270, 330, 30, 90, 150, 210]) this._drawDividerSword(ctx, cx, cy, a, OR, pulse);

    // Smooth sword offset — lerp toward target each frame
    if (!this._swordOffsets) this._swordOffsets = { top: 0, mid: 0, bot: 0 };

    // Shield one-shot shake — triggers on hover entry, decays to zero
    if (this._shieldShakeStart === undefined) this._shieldShakeStart = null;
    const isHovDef = hov === 'defend' && this.defenseEnabled;
    if (isHovDef && this._shieldShakeStart === null) this._shieldShakeStart = this._animTime;
    if (!isHovDef) this._shieldShakeStart = null;
    const _sst = this._shieldShakeStart;
    const shieldShake = (_sst !== null)
      ? Math.sin((this._animTime - _sst) * 22) * 0.11 * Math.max(0, 1 - (this._animTime - _sst) * 2.2)
      : 0;

    // Segment icons (drawn on top of base, under medallion)
    const iconR = (OR + IR) / 2;
    for (const seg of segs) {
      const isHov = hov === seg.id && seg.enabled;
      const isAct = seg.id === 'defend' && def;
      let hoverPush = 0;
      if (seg.id !== 'defend') {
        const target = isHov ? 14 : 0;
        this._swordOffsets[seg.id] += (target - this._swordOffsets[seg.id]) * 0.12;
        hoverPush = this._swordOffsets[seg.id];
      }
      const ix = cx + Math.cos(seg.midA * DEG) * (iconR + hoverPush);
      const iy = cy + Math.sin(seg.midA * DEG) * (iconR + hoverPush);
      if (seg.id === 'defend') {
        this._drawShieldIcon(ctx, ix, iy, isHov, isAct, seg.enabled, shieldShake);
      } else {
        const lbl = { top: 'HEAD', mid: 'BODY', bot: 'LEGS' }[seg.id];
        this._drawSwordIcon(ctx, ix, iy, lbl, isHov, seg.enabled, seg.midA, pulse);
      }
    }

    this._drawCenterMedallion(ctx, cx, cy, def, pulse, this._animTime);
  }

  _drawDividerSword(ctx, cx, cy, angleDeg, OR, pulse) {
    const DEG = Math.PI / 180;
    const IR  = 38; // matches _drawWheel inner radius constant
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleDeg * DEG);
    // blade runs from inner ring (IR) all the way through and past outer ring

    const tipX  = OR + 8;   // tip just barely past outer rim
    const baseX = IR;        // base starts at inner ring
    const bW    = 2.2;       // half-width at base (tapers to tip)

    // Blade glow
    ctx.shadowColor = `rgba(220,225,255,${0.22 + pulse * 0.15})`; ctx.shadowBlur = 6;

    // Blade — long triangle base at IR, tip past OR
    const blGrad = ctx.createLinearGradient(baseX, 0, tipX, 0);
    blGrad.addColorStop(0,    '#7a8090');
    blGrad.addColorStop(0.40, '#d8dcee');
    blGrad.addColorStop(0.80, '#eaeeff');
    blGrad.addColorStop(1,    '#b0b4c8');
    ctx.fillStyle = blGrad;
    ctx.beginPath(); ctx.moveTo(tipX, 0); ctx.lineTo(baseX, -bW); ctx.lineTo(baseX, bW); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;

    // Ridge
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(tipX - 4, 0); ctx.lineTo(baseX + 8, 0); ctx.stroke();

    ctx.restore();
  }

  _drawCenterMedallion(ctx, cx, cy, defending, pulse, animTime = 0) {
    const R = 36;

    // Base
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    const bGrad = ctx.createRadialGradient(cx - 5, cy - 5, 1, cx, cy, R);
    bGrad.addColorStop(0, defending ? '#1e3acc' : '#0e1a72');
    bGrad.addColorStop(1, defending ? '#0a1a88' : '#060d42');
    ctx.fillStyle = bGrad; ctx.fill();

    // Organic inner light — four incommensurate frequencies, blooms irregularly
    const t  = animTime;
    const lp = 0.50 + 0.22 * Math.sin(t * 1.7)
                    + 0.16 * Math.sin(t * 2.9 + 1.8)
                    + 0.09 * Math.sin(t * 5.1 + 0.6)
                    + 0.05 * Math.sin(t * 8.3 + 2.1);
    const lR = Math.max(1, 6 + lp * 10);
    const lA = defending ? 0.36 + lp * 0.40 : 0.05 + lp * 0.22;
    const lG = ctx.createRadialGradient(cx - 1, cy - 1, 0.5, cx, cy, lR);
    lG.addColorStop(0,    `rgba(180,228,255,${Math.min(1, lA + 0.22)})`);
    lG.addColorStop(0.42, `rgba(90,170,255,${Math.max(0, lA)})`);
    lG.addColorStop(1,    'rgba(40,80,220,0)');
    ctx.fillStyle = lG;
    ctx.beginPath(); ctx.arc(cx, cy, lR, 0, Math.PI * 2); ctx.fill();
    // Spark — brightens when light blooms, dims when it fades
    const sA = Math.max(0, lp * 0.82);
    ctx.fillStyle = `rgba(215,242,255,${Math.min(1, sA)})`;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.5, 1.2 + lp * 2.2), 0, Math.PI * 2); ctx.fill();

    // Defend inner pulse
    if (defending) {
      const dg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      dg.addColorStop(0, `rgba(100,200,255,${0.32 + pulse * 0.26})`);
      dg.addColorStop(0.65, `rgba(68,140,255,${0.10 + pulse * 0.08})`);
      dg.addColorStop(1, 'rgba(68,140,255,0)');
      ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }

    // Gold ring
    ctx.shadowColor = `rgba(200,160,40,${0.42 + pulse * 0.22})`; ctx.shadowBlur = 8;
    ctx.strokeStyle = '#d4a030'; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#8a6010'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, 0, Math.PI * 2); ctx.stroke();

    // Two crossed swords — same premium style, guards meeting at center, tips up-right & up-left
    const ms_tipX    = 33;  const ms_sharp  = 9;   const ms_bW    = 2.8;
    const ms_gX      = 0;   const ms_gH     = 5.0; const ms_cgH   = 2.0;
    const ms_cgW     = 2.0; const ms_gripX  = -ms_cgW;
    const ms_hLen    = 9;   const ms_gripEnd = ms_gripX - ms_hLen;
    const ms_pomCX   = ms_gripEnd - 2.5;
    const ms_pomR    = 2.5; const ms_pomRy  = 1.9; const ms_gripW = 1.2;

    // Draw both swords; second pass (upper-left) renders on top
    for (const angle of [-Math.PI / 4, -3 * Math.PI / 4]) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-11, 0); // cross ~33% up the blade — closer to handle, not midpoint

      // Blade
      const ms_bl = ctx.createLinearGradient(ms_gX, -ms_bW, ms_gX, ms_bW);
      ms_bl.addColorStop(0, '#50546a'); ms_bl.addColorStop(0.18, '#9ea2bc');
      ms_bl.addColorStop(0.5, '#f0f4ff'); ms_bl.addColorStop(0.82, '#9ea2bc'); ms_bl.addColorStop(1, '#50546a');
      ctx.fillStyle = ms_bl;
      ctx.beginPath();
      ctx.moveTo(ms_gX + 3.5, -ms_bW); ctx.lineTo(ms_tipX - ms_sharp, -ms_bW);
      ctx.lineTo(ms_tipX, 0);
      ctx.lineTo(ms_tipX - ms_sharp, ms_bW); ctx.lineTo(ms_gX + 3.5, ms_bW);
      ctx.closePath(); ctx.fill();

      // Ricasso
      const ms_ric = ctx.createLinearGradient(ms_gX, -(ms_bW+0.7), ms_gX, ms_bW+0.7);
      ms_ric.addColorStop(0, '#404460'); ms_ric.addColorStop(0.5, '#ccd0e8'); ms_ric.addColorStop(1, '#404460');
      ctx.fillStyle = ms_ric;
      ctx.fillRect(ms_gX, -(ms_bW + 0.7), 3.5, (ms_bW + 0.7) * 2);

      // Fuller
      ctx.strokeStyle = 'rgba(28,30,48,0.62)'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ms_tipX - ms_sharp - 1, 0); ctx.lineTo(ms_gX + 5, 0); ctx.stroke();
      ctx.lineCap = 'butt';

      // 3 highlight bands
      for (let i = 0; i < 3; i++) {
        const bx = ms_gX + 5 + i * ((ms_tipX - ms_sharp - ms_gX - 7) / 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.15 + (i % 2 === 0 ? 0.13 : 0.04)})`;
        ctx.lineWidth = 0.45;
        ctx.beginPath(); ctx.moveTo(bx, -ms_bW * 0.62); ctx.lineTo(bx, ms_bW * 0.62); ctx.stroke();
      }

      // Edge glints
      ctx.strokeStyle = 'rgba(215,222,255,0.35)'; ctx.lineWidth = 0.45; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ms_gX,-ms_bW); ctx.lineTo(ms_gX+3.5,-ms_bW); ctx.lineTo(ms_tipX-ms_sharp,-ms_bW); ctx.lineTo(ms_tipX,0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ms_gX, ms_bW); ctx.lineTo(ms_gX+3.5, ms_bW); ctx.lineTo(ms_tipX-ms_sharp, ms_bW); ctx.lineTo(ms_tipX,0); ctx.stroke();
      ctx.lineCap = 'butt';

      // Crossguard block
      const ms_cg = ctx.createLinearGradient(ms_gX - ms_cgW, -ms_cgH, ms_gX - ms_cgW, ms_cgH);
      ms_cg.addColorStop(0, '#622e06'); ms_cg.addColorStop(0.5, '#ffd700'); ms_cg.addColorStop(1, '#622e06');
      ctx.fillStyle = ms_cg;
      ctx.shadowColor = `rgba(190,140,28,${0.5 + pulse * 0.2})`; ctx.shadowBlur = 5;
      _roundRect(ctx, ms_gX - ms_cgW, -ms_cgH, ms_cgW * 2, ms_cgH * 2, 1.4); ctx.fill(); ctx.shadowBlur = 0;

      // Quillon arms
      ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.strokeStyle = '#c8960c';
      ctx.beginPath(); ctx.moveTo(ms_gX, -ms_cgH); ctx.quadraticCurveTo(ms_gX+1.5, -(ms_gH*0.55), ms_gX+1, -ms_gH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ms_gX,  ms_cgH); ctx.quadraticCurveTo(ms_gX+1.5,  ms_gH*0.55,   ms_gX+1,  ms_gH); ctx.stroke();
      ctx.lineCap = 'butt';
      for (const oy of [-ms_gH, ms_gH]) {
        const og = ctx.createRadialGradient(ms_gX+0.3, oy-0.5, 0.1, ms_gX+1, oy, 2.0);
        og.addColorStop(0,'#fff8c0'); og.addColorStop(0.5,'#ffd700'); og.addColorStop(1,'#6a4508');
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.arc(ms_gX+1, oy, 2.0, 0, Math.PI*2); ctx.fill();
      }

      // Sapphire cabochon
      const ms_sap = ctx.createRadialGradient(ms_gX-0.4,-0.4,0.1, ms_gX,0,1.8);
      ms_sap.addColorStop(0,'#c8ecff'); ms_sap.addColorStop(0.35,'#2277ee'); ms_sap.addColorStop(1,'#060e50');
      ctx.fillStyle = ms_sap;
      ctx.shadowColor = 'rgba(35,95,255,0.65)'; ctx.shadowBlur = 5;
      ctx.beginPath(); ctx.ellipse(ms_gX, 0, 1.8, 1.8, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;

      // Grip
      const ms_gr = ctx.createLinearGradient(ms_gripX, -ms_gripW, ms_gripX, ms_gripW);
      ms_gr.addColorStop(0, '#280e04'); ms_gr.addColorStop(0.5, '#70320e'); ms_gr.addColorStop(1, '#280e04');
      ctx.fillStyle = ms_gr;
      ctx.fillRect(ms_gripEnd, -ms_gripW, ms_hLen, ms_gripW * 2);
      ctx.lineWidth = 0.35;
      for (let wx = ms_gripEnd; wx <= ms_gripX; wx += 2.5) {
        ctx.strokeStyle = 'rgba(195,158,42,0.52)';
        ctx.beginPath(); ctx.moveTo(wx, -ms_gripW); ctx.lineTo(wx+2.5,  ms_gripW); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(wx,  ms_gripW); ctx.lineTo(wx+2.5, -ms_gripW); ctx.stroke();
      }
      for (let ri = 0; ri < 2; ri++) {
        const rx2 = ms_gripX - ms_hLen * (0.22 + ri * 0.56);
        const rg2 = ctx.createLinearGradient(rx2, -(ms_gripW+0.8), rx2, ms_gripW+0.8);
        rg2.addColorStop(0,'#6a4408'); rg2.addColorStop(0.5,'#ffd700'); rg2.addColorStop(1,'#6a4408');
        ctx.fillStyle = rg2;
        ctx.fillRect(rx2-0.8, -(ms_gripW+0.8), 1.6, (ms_gripW+0.8)*2);
      }

      // Pommel
      const ms_pom = ctx.createRadialGradient(ms_pomCX-0.8,-0.8,0.1, ms_pomCX,0,ms_pomR);
      ms_pom.addColorStop(0,'#fff8c0'); ms_pom.addColorStop(0.28,'#ffd700'); ms_pom.addColorStop(1,'#622e08');
      ctx.fillStyle = ms_pom;
      ctx.shadowColor = `rgba(195,155,38,${0.4 + pulse * 0.18})`; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.ellipse(ms_pomCX, 0, ms_pomR, ms_pomRy, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      const ms_gem = ctx.createRadialGradient(ms_pomCX-0.4,-0.4,0.1, ms_pomCX,0,1.4);
      ms_gem.addColorStop(0,'#c8ecff'); ms_gem.addColorStop(0.38,'#1a62cc'); ms_gem.addColorStop(1,'#060e40');
      ctx.fillStyle = ms_gem;
      ctx.shadowColor = 'rgba(35,95,255,0.5)'; ctx.shadowBlur = 3;
      ctx.beginPath(); ctx.arc(ms_pomCX, 0, 1.4, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(195,158,42,0.55)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.ellipse(ms_pomCX, 0, ms_pomR, ms_pomRy, 0, 0, Math.PI*2); ctx.stroke();

      ctx.restore();
    }
  }

  _drawShieldIcon(ctx, x, y, hover, active, enabled, shakeAngle = 0) {
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    ctx.translate(x, y);
    if (shakeAngle) ctx.rotate(shakeAngle);

    const HW = 11;   // half-width at top
    const TY = -11;  // top y
    const BY =  12;  // bottom tip y

    // Classic heater shield — gently arched top, sides flare, wide rounded bottom
    const BHW = 7.5;  // bottom half-width
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-HW, TY);
      ctx.quadraticCurveTo(0, TY - 1.5, HW, TY);                               // gentle top arch
      ctx.bezierCurveTo(HW + 2, TY + 5, BHW + 3, BY - 5, BHW, BY);            // right side
      ctx.quadraticCurveTo(0, BY + 6, -BHW, BY);                               // rounded bottom
      ctx.bezierCurveTo(-BHW - 3, BY - 5, -HW - 2, TY + 5, -HW, TY);         // left side
      ctx.closePath();
    };

    // ── Outer glow ──────────────────────────────────────────────────
    if (active)     { ctx.shadowColor = '#3399ff'; ctx.shadowBlur = 20; }
    else if (hover) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14; }

    // ── Main face ───────────────────────────────────────────────────
    path();
    const faceG = ctx.createLinearGradient(-HW, TY, HW * 0.55, BY);
    if (active) {
      faceG.addColorStop(0,    '#1c4ab8');
      faceG.addColorStop(0.30, '#2a66e0');
      faceG.addColorStop(0.65, '#1844a8');
      faceG.addColorStop(1,    '#0c2468');
    } else {
      faceG.addColorStop(0,    '#3e4460');
      faceG.addColorStop(0.30, '#5c6484');
      faceG.addColorStop(0.65, '#3a4058');
      faceG.addColorStop(1,    '#1c2038');
    }
    ctx.fillStyle = faceG; ctx.fill(); ctx.shadowBlur = 0;

    // ── Top-left directional sheen ──────────────────────────────────
    ctx.save(); path(); ctx.clip();
    const sheenG = ctx.createLinearGradient(-HW, TY, HW * 0.28, TY + 17);
    sheenG.addColorStop(0,    active ? 'rgba(140,205,255,0.50)' : 'rgba(255,255,255,0.42)');
    sheenG.addColorStop(0.45, active ? 'rgba(80,160,255,0.12)'  : 'rgba(255,255,255,0.10)');
    sheenG.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = sheenG; ctx.fill(); ctx.restore();

    // ── Bottom depth shadow ─────────────────────────────────────────
    ctx.save(); path(); ctx.clip();
    const depthG = ctx.createLinearGradient(0, 0, 0, BY);
    depthG.addColorStop(0,   'rgba(0,0,0,0)');
    depthG.addColorStop(0.6, 'rgba(0,0,0,0.10)');
    depthG.addColorStop(1,   'rgba(0,0,0,0.28)');
    ctx.fillStyle = depthG; ctx.fill(); ctx.restore();

    // ── Heraldic cross ──────────────────────────────────────────────
    ctx.save(); path(); ctx.clip();
    ctx.strokeStyle = active ? 'rgba(100,170,255,0.28)' : 'rgba(255,255,255,0.11)';
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.moveTo(0, TY - 2); ctx.lineTo(0, BY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-HW - 3, -1.5); ctx.lineTo(HW + 3, -1.5); ctx.stroke();
    ctx.restore();

    // ── Metallic rim ────────────────────────────────────────────────
    path();
    const rimG = ctx.createLinearGradient(-HW, TY, HW * 0.4, BY * 0.75);
    if (active) {
      rimG.addColorStop(0, '#88ccff'); rimG.addColorStop(0.45, '#55aaff'); rimG.addColorStop(1, '#1a55cc');
    } else if (hover) {
      rimG.addColorStop(0, '#ffe060'); rimG.addColorStop(0.45, '#ffd700'); rimG.addColorStop(1, '#a07800');
    } else {
      rimG.addColorStop(0, '#b0b8d0'); rimG.addColorStop(0.45, '#d0d8e8'); rimG.addColorStop(1, '#606878');
    }
    ctx.strokeStyle = rimG; ctx.lineWidth = 1.9; ctx.stroke();

    // Inner shadow bevel
    ctx.save(); ctx.scale(0.84, 0.84); path(); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 0.8; ctx.stroke();

    // Inner highlight bevel
    ctx.save(); ctx.scale(0.78, 0.78); path(); ctx.restore();
    ctx.strokeStyle = active ? 'rgba(90,170,255,0.22)' : 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 0.6; ctx.stroke();


    // ── 5 accent rivets ─────────────────────────────────────────────
    const rc = active ? 'rgba(110,215,255,0.92)' : (hover ? 'rgba(255,215,50,0.92)' : 'rgba(200,215,242,0.84)');
    const rivet = (rx2, ry2) => {
      ctx.fillStyle = rc; ctx.shadowColor = rc; ctx.shadowBlur = 2.5;
      ctx.beginPath(); ctx.arc(rx2, ry2, 1.15, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    };
    rivet(0,         TY + 2.8);   // top centre
    rivet(-HW*0.60,  TY + 3.5);   // top-left
    rivet( HW*0.60,  TY + 3.5);   // top-right
    rivet(-BHW*0.45, BY - 3.5);   // lower-left
    rivet( BHW*0.45, BY - 3.5);   // lower-right

    ctx.restore();

    // DEFEND label
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    ctx.fillStyle = active ? '#66ccff' : (hover ? '#ffffff' : 'rgba(150,190,255,0.70)');
    ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('DEFEND', x, y + BY + 9);
    ctx.textBaseline = 'alphabetic'; ctx.restore();
  }

  _drawSwordIcon(ctx, x, y, label, hover, enabled, midAngleDeg, pulse = 0.5) {
    const DEG = Math.PI / 180;
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    ctx.translate(x, y);
    ctx.rotate(midAngleDeg * DEG); // +x = outward (blade tip direction)

    // Geometry — straight sword (parallel sides, sharp tip only at end)
    const tipX     = 58;
    const sharpLen = 13;
    const gX       = 0;
    const bW       = 4.2;
    const gH       = 7;
    const cgH      = 3.0;
    const cgW      = 3.0;
    const gripX    = gX - cgW;
    const hLen     = 11;
    const gripEnd  = gripX - hLen;
    const pomCX    = gripEnd - 3.5;
    const pomR     = 3.2;
    const pomRy    = 2.5;
    const gripW    = 1.7;

    // ── BLADE ──────────────────────────────────────────────────────
    const blGrad = ctx.createLinearGradient(gX, -bW, gX, bW);
    blGrad.addColorStop(0,    '#50546a');
    blGrad.addColorStop(0.18, '#9ea2bc');
    blGrad.addColorStop(0.40, '#d8dcf0');
    blGrad.addColorStop(0.50, '#f0f4ff');
    blGrad.addColorStop(0.60, '#d8dcf0');
    blGrad.addColorStop(0.82, '#9ea2bc');
    blGrad.addColorStop(1,    '#50546a');
    ctx.fillStyle = blGrad;
    // Straight blade — parallel sides along full length, taper only at the very tip
    ctx.beginPath();
    ctx.moveTo(gX + 5.5, -bW);
    ctx.lineTo(tipX - sharpLen, -bW);
    ctx.lineTo(tipX, 0);
    ctx.lineTo(tipX - sharpLen,  bW);
    ctx.lineTo(gX + 5.5,  bW);
    ctx.closePath(); ctx.fill();

    // Ricasso (unsharpened base block, slightly wider)
    const ricGrad = ctx.createLinearGradient(gX, -(bW + 0.9), gX, bW + 0.9);
    ricGrad.addColorStop(0,   '#404460'); ricGrad.addColorStop(0.25, '#aaaecc');
    ricGrad.addColorStop(0.5, '#ccd0e8'); ricGrad.addColorStop(0.75, '#aaaecc');
    ricGrad.addColorStop(1,   '#404460');
    ctx.fillStyle = ricGrad;
    ctx.fillRect(gX, -(bW + 0.9), 5.5, (bW + 0.9) * 2);

    // Central fuller groove — stops before the sharp taper
    ctx.strokeStyle = 'rgba(28,30,48,0.62)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(tipX - sharpLen - 2, 0); ctx.lineTo(gX + 6, 0); ctx.stroke();
    ctx.lineCap = 'butt';

    // 7 polished-steel highlight bands (uniform height across straight section)
    for (let i = 0; i < 7; i++) {
      const bx = gX + 7 + i * ((tipX - sharpLen - gX - 9) / 6);
      ctx.strokeStyle = `rgba(255,255,255,${0.14 + (i % 2 === 0 ? 0.13 : 0.04)})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(bx, -bW * 0.62); ctx.lineTo(bx, bW * 0.62); ctx.stroke();
    }

    // Nordic rune etchings (Tiwaz, Hagalaz, Algiz) — spread across straight section
    ctx.strokeStyle = 'rgba(100,110,175,0.30)'; ctx.lineWidth = 0.42;
    let rx = gX + 12;
    ctx.beginPath(); ctx.moveTo(rx, 1.6);  ctx.lineTo(rx, -1.6);      ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx + 1.4, 1.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx - 1.4, 1.1); ctx.stroke();
    rx = gX + 26;
    ctx.beginPath(); ctx.moveTo(rx-1.2,-1.5); ctx.lineTo(rx-1.2,1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx+1.2,-1.5); ctx.lineTo(rx+1.2,1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx-1.2, 0);   ctx.lineTo(rx+1.2, 0);  ctx.stroke();
    rx = gX + 38;
    ctx.beginPath(); ctx.moveTo(rx, 1.6);  ctx.lineTo(rx, -0.3);       ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx - 1.4, -1.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, -0.3); ctx.lineTo(rx + 1.4, -1.8); ctx.stroke();

    // Edge glints trace the actual blade outline
    if (hover) { ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10; }
    ctx.strokeStyle = hover ? 'rgba(255,215,60,0.55)' : 'rgba(215,222,255,0.35)';
    ctx.lineWidth = 0.55; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(gX,-bW); ctx.lineTo(gX+5.5,-bW); ctx.lineTo(tipX-sharpLen,-bW); ctx.lineTo(tipX,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gX, bW); ctx.lineTo(gX+5.5, bW); ctx.lineTo(tipX-sharpLen, bW); ctx.lineTo(tipX,0); ctx.stroke();
    ctx.lineCap = 'butt'; ctx.shadowBlur = 0;

    // ── CROSSGUARD ─────────────────────────────────────────────────
    const cgGrad = ctx.createLinearGradient(gX - cgW, -cgH, gX - cgW, cgH);
    cgGrad.addColorStop(0,   '#622e06'); cgGrad.addColorStop(0.28, '#c88010');
    cgGrad.addColorStop(0.5,  hover ? '#ffe060' : '#ffd700');
    cgGrad.addColorStop(0.72,'#c88010'); cgGrad.addColorStop(1,   '#622e06');
    ctx.fillStyle = cgGrad;
    ctx.shadowColor = hover ? '#ffd700' : 'rgba(190,140,28,0.55)'; ctx.shadowBlur = hover ? 9 : 5;
    _roundRect(ctx, gX - cgW, -cgH, cgW * 2, cgH * 2, 2); ctx.fill(); ctx.shadowBlur = 0;

    // Alternating grooves + gold engraving
    for (let gy = -cgH + 1.5; gy < cgH; gy += 2.0) {
      ctx.strokeStyle = 'rgba(55,30,4,0.55)'; ctx.lineWidth = 0.45;
      ctx.beginPath(); ctx.moveTo(gX-cgW+0.8,gy); ctx.lineTo(gX+cgW-0.8,gy); ctx.stroke();
    }
    for (let gy = -cgH + 2.5; gy < cgH; gy += 2.0) {
      ctx.strokeStyle = 'rgba(255,215,70,0.28)'; ctx.lineWidth = 0.38;
      ctx.beginPath(); ctx.moveTo(gX-cgW+1,gy); ctx.lineTo(gX+cgW-1,gy); ctx.stroke();
    }

    // Swept quillon arms (curved toward blade side)
    ctx.lineWidth = 2.8; ctx.lineCap = 'round';
    ctx.strokeStyle = hover ? '#ffe060' : '#c8960c';
    ctx.beginPath(); ctx.moveTo(gX,-cgH); ctx.quadraticCurveTo(gX+2.5,-(gH*0.55),gX+1.5,-gH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gX, cgH); ctx.quadraticCurveTo(gX+2.5, gH*0.55, gX+1.5, gH); ctx.stroke();
    ctx.lineCap = 'butt';

    // Quillon tip orbs with specular
    for (const oy of [-gH, gH]) {
      const orbG = ctx.createRadialGradient(gX+0.5, oy-0.9, 0.3, gX+1.5, oy, 3.5);
      orbG.addColorStop(0,'#fff8c0'); orbG.addColorStop(0.45,'#ffd700'); orbG.addColorStop(1,'#6a4508');
      ctx.fillStyle = orbG;
      ctx.shadowColor = 'rgba(255,200,35,0.5)'; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(gX+1.5, oy, 3.5, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,210,0.52)';
      ctx.beginPath(); ctx.ellipse(gX+0.5, oy-1.1, 1.1, 0.75, -0.4, 0, Math.PI*2); ctx.fill();
    }

    // Sapphire cabochon in guard centre (matches wheel gem language)
    const sapGrad = ctx.createRadialGradient(gX-0.5,-0.6,0.2, gX,0,2.8);
    sapGrad.addColorStop(0,'#c8ecff'); sapGrad.addColorStop(0.35,'#2277ee'); sapGrad.addColorStop(1,'#060e50');
    ctx.fillStyle = sapGrad;
    ctx.shadowColor = 'rgba(35,95,255,0.65)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.ellipse(gX, 0, 2.8, 2.8, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(210,240,255,0.70)';
    ctx.beginPath(); ctx.ellipse(gX-0.8,-0.8, 1.1,0.7, -0.45, 0, Math.PI*2); ctx.fill();

    // ── GRIP ───────────────────────────────────────────────────────
    const leatherGrad = ctx.createLinearGradient(gripX, -gripW, gripX, gripW);
    leatherGrad.addColorStop(0,   '#280e04'); leatherGrad.addColorStop(0.28,'#522206');
    leatherGrad.addColorStop(0.5, '#70320e'); leatherGrad.addColorStop(0.72,'#522206');
    leatherGrad.addColorStop(1,   '#280e04');
    ctx.fillStyle = leatherGrad;
    ctx.fillRect(gripEnd, -gripW, hLen, gripW * 2);

    // Diamond cross-wrap gold wire
    ctx.lineWidth = 0.55;
    for (let wx = gripEnd; wx <= gripX; wx += 4) {
      ctx.strokeStyle = hover ? 'rgba(255,220,65,0.60)' : 'rgba(195,158,42,0.52)';
      ctx.beginPath(); ctx.moveTo(wx, -gripW); ctx.lineTo(wx+4,  gripW); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx,  gripW); ctx.lineTo(wx+4, -gripW); ctx.stroke();
    }

    // 3 decorative spacer rings
    for (let ri = 0; ri < 3; ri++) {
      const ringX = gripX - hLen * (0.18 + ri * 0.32);
      const ringG = ctx.createLinearGradient(ringX, -(gripW+1.2), ringX, gripW+1.2);
      ringG.addColorStop(0,'#6a4408'); ringG.addColorStop(0.45,'#ffd700');
      ringG.addColorStop(0.55,'#fff8a0'); ringG.addColorStop(1,'#6a4408');
      ctx.fillStyle = ringG;
      ctx.fillRect(ringX-1.2, -(gripW+1.2), 2.4, (gripW+1.2)*2);
      ctx.strokeStyle = 'rgba(70,40,4,0.38)'; ctx.lineWidth = 0.32;
      ctx.beginPath(); ctx.moveTo(ringX-1.2,-(gripW+0.35)); ctx.lineTo(ringX+1.2,-(gripW+0.35)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ringX-1.2, gripW+0.35);   ctx.lineTo(ringX+1.2, gripW+0.35);   ctx.stroke();
    }

    // ── POMMEL ─────────────────────────────────────────────────────
    const pomBodyGrad = ctx.createRadialGradient(pomCX-1.2,-1.2,0.3, pomCX,0,pomR);
    pomBodyGrad.addColorStop(0,   '#fff8c0'); pomBodyGrad.addColorStop(0.28,'#ffd700');
    pomBodyGrad.addColorStop(0.62,'#c09010'); pomBodyGrad.addColorStop(1,   '#622e08');
    ctx.fillStyle = pomBodyGrad;
    ctx.shadowColor = hover ? '#ffd700' : 'rgba(195,155,38,0.50)'; ctx.shadowBlur = hover ? 8 : 5;
    ctx.beginPath(); ctx.ellipse(pomCX, 0, pomR, pomRy, 0, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;

    // Facet grid (horizontal + vertical)
    ctx.strokeStyle = 'rgba(80,48,5,0.42)'; ctx.lineWidth = 0.38;
    for (let fi = -2; fi <= 2; fi++) {
      const fy  = fi * (pomRy / 2.6);
      const fx  = Math.sqrt(Math.max(0, 1 - (fy/pomRy)**2)) * pomR * 0.88;
      ctx.beginPath(); ctx.moveTo(pomCX-fx, fy); ctx.lineTo(pomCX+fx, fy); ctx.stroke();
      const fxv = fi * (pomR / 2.6);
      const fyv = Math.sqrt(Math.max(0, 1 - (fxv/pomR)**2)) * pomRy * 0.88;
      ctx.beginPath(); ctx.moveTo(pomCX+fxv,-fyv); ctx.lineTo(pomCX+fxv,fyv); ctx.stroke();
    }

    // 4 secondary bosses (N/S/E/W)
    for (const [bx,by] of [[0,-(pomRy-1.8)],[0,pomRy-1.8],[-(pomR-1.8),0],[pomR-1.8,0]]) {
      const bossG = ctx.createRadialGradient(pomCX+bx-0.3,by-0.3,0.1, pomCX+bx,by,1.3);
      bossG.addColorStop(0,'#fff8c0'); bossG.addColorStop(0.5,'#ffd700'); bossG.addColorStop(1,'#6a4808');
      ctx.fillStyle = bossG;
      ctx.beginPath(); ctx.arc(pomCX+bx, by, 1.3, 0, Math.PI*2); ctx.fill();
    }

    // Central pommel gem — same blue gem language as guard sapphire & wheel medallion
    const gemGrad = ctx.createRadialGradient(pomCX-0.5,-0.5,0.15, pomCX,0,2.2);
    gemGrad.addColorStop(0,'#c8ecff'); gemGrad.addColorStop(0.38,'#1a62cc'); gemGrad.addColorStop(1,'#060e40');
    ctx.fillStyle = gemGrad;
    ctx.shadowColor = 'rgba(35,95,255,0.55)'; ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.arc(pomCX, 0, 2.2, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(200,235,255,0.68)';
    ctx.beginPath(); ctx.ellipse(pomCX-0.6,-0.6, 0.9,0.6,-0.5, 0, Math.PI*2); ctx.fill();

    // Pommel rim
    ctx.strokeStyle = hover ? '#ffe060' : 'rgba(195,158,42,0.62)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.ellipse(pomCX, 0, pomR, pomRy, 0, 0, Math.PI*2); ctx.stroke();

    ctx.restore();

    // Label (perpendicular to blade)
    ctx.save(); ctx.globalAlpha = enabled ? 1 : 0.22;
    const perpA = (midAngleDeg + 90) * DEG;
    const lx = x + Math.cos(perpA) * 18;
    const ly = y + Math.sin(perpA) * 18;
    ctx.fillStyle = hover ? '#ffd700' : 'rgba(215,195,155,0.85)';
    ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, lx, ly);
    ctx.textBaseline = 'alphabetic'; ctx.restore();
  }

  _drawDefenseShield(ctx, cx, cy) {
    const pulse = 0.5 + 0.5 * Math.sin(this._animTime * 4);
    const charCY = cy - 68;
    const r   = 48 + pulse * 8;
    const grd = ctx.createRadialGradient(cx, charCY, 0, cx, charCY, r);
    grd.addColorStop(0, `rgba(68,170,255,${0.18 + pulse * 0.14})`);
    grd.addColorStop(1, 'rgba(68,170,255,0)');
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

  spawnHealFloat(pts, side = 'player') {
    const W = this.canvas.width, H = this.canvas.height;
    const cx = side === 'player' ? W * 0.25 : W * 0.75;
    this.floats.push({
      text: `+${pts}`, color: '#44ee88', font: 'bold 20px monospace',
      x: cx + (Math.random() - 0.5) * 28,
      y: H * 0.68 - 90, life: 1.5, maxLife: 1.5,
    });
  }

  // ── ELIXIR BELT ────────────────────────────────────────────────────
  _elixirBeltLayout(W, H) {
    const sw = 44, sh = 30, gap = 5;
    const total = 4 * sw + 3 * gap;
    const sx = W * 0.25 - total / 2;
    const sy = H * 0.68 + 14;
    return [0, 1, 2, 3].map(i => ({ x: sx + i * (sw + gap), y: sy, w: sw, h: sh, i }));
  }

  _hitElixir(mx, my) {
    const W = this.canvas.width, H = this.canvas.height;
    for (const r of this._elixirBeltLayout(W, H)) {
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return r.i;
    }
    return -1;
  }

  _useElixir(slotIdx) {
    const item = this.player.elixirSlots[slotIdx];
    if (!item || slotIdx >= this.player.elixirSlotsAvailable) return;
    this.player.useElixirSlot(slotIdx);
    this._log(`You drink ${item.name}! +${item.hotHps} HP/s for ${item.hotDuration}s`, 'log-system');
    if (Network.connected) Network.sendDuelHeal(this.sessionId, { hotHps: item.hotHps, hotDuration: item.hotDuration, itemName: item.name });
  }

  _drawElixirBelt(ctx, W, H) {
    const player  = this.player;
    const rects   = this._elixirBeltLayout(W, H);
    const avail   = player.elixirSlotsAvailable;
    const myTurn  = this.defenseEnabled && this.state === 'picking';
    const pulse   = 0.5 + 0.5 * Math.sin(this._animTime * 3);

    const bx = rects[0].x - 8,  by = rects[0].y - 17;
    const bw = rects[3].x + rects[3].w - rects[0].x + 16, bh = rects[0].h + 25;

    ctx.shadowColor = 'rgba(0,0,0,0.70)';
    ctx.shadowBlur  = 16; ctx.shadowOffsetY = 2;
    ctx.fillStyle   = 'rgba(5,8,20,0.90)';
    _roundRect(ctx, bx, by, bw, bh, 8); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    ctx.strokeStyle = myTurn ? 'rgba(90,138,170,0.70)' : 'rgba(42,58,90,0.80)';
    ctx.lineWidth   = 1;
    _roundRect(ctx, bx, by, bw, bh, 8); ctx.stroke();

    ctx.fillStyle = myTurn ? 'rgba(140,188,220,0.80)' : 'rgba(80,110,140,0.55)';
    ctx.font = '7px monospace'; ctx.textAlign = 'center';
    ctx.fillText('E L I X I R', bx + bw / 2, by + 11);

    for (const r of rects) {
      const item   = player.elixirSlots[r.i];
      const locked = r.i >= avail;
      const hov    = this.hoveredElixir === r.i && myTurn && item && !locked;

      ctx.save();
      if (locked) {
        ctx.fillStyle = 'rgba(8,10,20,0.85)';
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(28,32,50,0.80)'; ctx.lineWidth = 1;
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.stroke();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#778'; ctx.font = '10px serif'; ctx.textAlign = 'center';
        ctx.fillText('🔒', r.x + r.w / 2, r.y + r.h / 2 + 4);
      } else if (!item) {
        ctx.fillStyle = 'rgba(10,14,28,0.85)';
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(42,58,90,0.55)'; ctx.lineWidth = 1;
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.stroke();
        ctx.fillStyle = 'rgba(72,92,120,0.50)';
        ctx.font = '9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(r.i + 1, r.x + r.w / 2, r.y + r.h / 2 + 3);
      } else {
        if (hov) { ctx.shadowColor = 'rgba(90,138,170,0.55)'; ctx.shadowBlur = 10; }
        ctx.fillStyle = hov ? '#111e30' : '#0d1424';
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.fill();
        ctx.strokeStyle = hov ? '#5a8aaa' : (myTurn ? 'rgba(90,138,170,0.65)' : 'rgba(42,58,90,0.75)');
        ctx.lineWidth   = hov ? 1.5 : 1;
        _roundRect(ctx, r.x, r.y, r.w, r.h, 5); ctx.stroke();
        ctx.shadowBlur = 0;

        const icx = r.x + r.w / 2, icy = r.y + 9;
        ctx.strokeStyle = hov ? '#adf' : (myTurn ? '#8bc' : 'rgba(100,155,195,0.55)');
        ctx.fillStyle   = hov ? 'rgba(170,220,255,0.15)' : 'rgba(100,155,195,0.12)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(icx, icy, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(icx - 1.5, icy - 4); ctx.lineTo(icx + 1.5, icy - 4);
        ctx.moveTo(icx, icy - 4);       ctx.lineTo(icx, icy - 7);
        ctx.stroke();

        ctx.fillStyle = hov ? '#adf' : (myTurn ? '#8bc' : 'rgba(100,155,195,0.55)');
        ctx.font = '7px monospace'; ctx.textAlign = 'center';
        const lbl = item.name.replace('Health ', '').slice(0, 6);
        ctx.fillText(lbl, r.x + r.w / 2, r.y + r.h - 3);
      }
      ctx.restore();
    }
  }
}
