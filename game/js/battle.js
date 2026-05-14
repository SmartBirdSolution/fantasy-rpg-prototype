'use strict';

class BattleScene {
  constructor(canvas, player, enemy) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.player = player;
    this.enemy  = enemy;

    // Fresh HP for enemy each battle
    this.enemy.currentHP = this.enemy.maxHP;

    this.playerTurn  = true;
    this.animState   = 'idle'; // 'idle' | 'playerAtk' | 'enemyAtk' | 'done'
    this.animT       = 0;      // 0→1
    this._onAnimDone = null;

    this.floats  = []; // floating damage numbers
    this.log     = [];

    this.onBattleEnd = null; // callback('win'|'lose')
    this._ended      = false;
  }

  init() {
    // Determine who goes first (higher speed goes first; tie → random)
    const pSpd = this.player.totalSpd;
    const eSpd = this.enemy.level + 5;
    if (pSpd > eSpd)       this.playerTurn = true;
    else if (eSpd > pSpd)  this.playerTurn = false;
    else                   this.playerTurn = Math.random() < 0.5;

    this._log(`⚔ Battle start vs ${this.enemy.type} (Lv${this.enemy.level})!`, 'log-system');
    this._log(this.playerTurn ? 'You move first!' : `${this.enemy.type} moves first!`, 'log-system');

    if (!this.playerTurn) {
      setTimeout(() => this._doEnemyTurn(), 1000);
    }
  }

  // Called by UI buttons
  playerAction(zone) { // zone: 'top' | 'mid' | 'bot' | 'stance'
    if (!this.playerTurn || this.animState !== 'idle' || this._ended) return;

    const enemyDecision = this.enemy.chooseAction();
    let playerDmg = 0, enemyDmg = 0;

    if (zone === 'stance') {
      // Defensive stance: player deals 50%, takes 50%
      const rawPlayer = this._calcDmg(this.player, this.enemy, 'mid', null);
      const rawEnemy  = this._calcDmg(this.enemy, this.player, enemyDecision.action, null);
      playerDmg = Math.round(rawPlayer * 0.5);
      enemyDmg  = Math.round(rawEnemy  * 0.5);
      this._log(`You take a defensive stance (dmg ×0.5 both ways).`);
    } else {
      playerDmg = this._calcDmg(this.player, this.enemy, zone, enemyDecision.blockZone);
      enemyDmg  = this._calcDmg(this.enemy, this.player, enemyDecision.action, null);

      const blocked = (enemyDecision.blockZone === zone);
      this._log(`You attack ${zone}${blocked ? ' — BLOCKED! (×0.2 dmg)' : ''} → ${playerDmg} dmg.`);
      this._log(`${this.enemy.type} attacks ${enemyDecision.action} → ${enemyDmg} dmg.`);
    }

    this._resolveRound(playerDmg, enemyDmg);
  }

  _doEnemyTurn() {
    if (this._ended || this.animState !== 'idle') return;

    const enemyDecision = this.enemy.chooseAction();
    const enemyDmg = this._calcDmg(this.enemy, this.player, enemyDecision.action, null);

    this._log(`${this.enemy.type} attacks ${enemyDecision.action} → ${enemyDmg} dmg.`);
    this._resolveRound(0, enemyDmg, true /* enemyOnly */);
  }

  _calcDmg(attacker, defender, attackZone, defenderBlock) {
    const atk = attacker.totalAtk ?? attacker.baseAtk;
    const def = defender.totalDef ?? defender.baseDef;
    let base = Math.max(1, atk - def * 0.5);
    base *= 0.85 + Math.random() * 0.3; // ±15% variance
    if (defenderBlock && defenderBlock === attackZone) base *= 0.2; // 80% block
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
        if (!this.player.isAlive()) {
          this._endBattle('lose');
          return;
        }
        this.animState  = 'idle';
        this.playerTurn = true;
        UI.setButtonsEnabled(true);
        UI.setTurnIndicator(true);
      };
    };

    if (enemyOnly) {
      // Skip player animation phase entirely
      doEnemyPhase();
      return;
    }

    this.animState = 'playerAtk';
    this.animT     = 0;

    this._onAnimDone = () => {
      if (playerDmg > 0) {
        this.enemy.takeDamage(playerDmg);
        this._spawnFloat(playerDmg, 'enemy');
      }
      if (!this.enemy.isAlive()) {
        this._endBattle('win');
        return;
      }
      doEnemyPhase();
    };
  }

  _endBattle(result) {
    if (this._ended) return;
    this._ended = true;
    this.animState = 'done';
    UI.setButtonsEnabled(false);

    if (result === 'win') {
      const xp   = this.enemy.xpReward;
      const gold = this.enemy.goldReward;
      this.player.gold += gold;
      const leveled = this.player.gainXP(xp);

      this._log(`Victory! +${xp} XP, +${gold} gold.`, 'log-win');
      if (leveled) this._log(`LEVEL UP! Now Lv${this.player.level}!`, 'log-win');

      const drop = this._rollLoot();
      if (drop) {
        this.player.equip(drop);
        this._log(`Found: ${drop.name}!`, 'log-loot');
      }

      if (leveled) UI.showLevelUp(this.player.level);
    } else {
      this._log(`You were defeated...`, 'log-lose');
    }

    setTimeout(() => { if (this.onBattleEnd) this.onBattleEnd(result); }, 2200);
  }

  _rollLoot() {
    for (const [key, tmpl] of Object.entries(EQUIPMENT_TEMPLATES)) {
      if (Math.random() < tmpl.dropChance * 0.4) {
        return { ...tmpl, id: key };
      }
    }
    return null;
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
    // Advance animation
    if (this.animState === 'playerAtk' || this.animState === 'enemyAtk') {
      this.animT += dt * 2.8; // 0→1 in ~360ms
      if (this.animT >= 1) {
        this.animT = 1;
        const cb = this._onAnimDone;
        this._onAnimDone = null;
        if (cb) cb();
      }
    }

    // Float decay
    this.floats = this.floats.filter(f => {
      f.life -= dt;
      f.y    -= dt * 50;
      return f.life > 0;
    });
  }

  // ── DRAW ──────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#12060a');
    grad.addColorStop(1, '#0a0618');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Ground gradient
    const groundGrad = ctx.createLinearGradient(0, H * 0.68, 0, H);
    groundGrad.addColorStop(0, '#1e120a');
    groundGrad.addColorStop(1, '#0e0808');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, H * 0.68, W, H * 0.32);

    // Ground line
    ctx.strokeStyle = '#3a2010';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.68);
    ctx.lineTo(W, H * 0.68);
    ctx.stroke();

    // Ambient particles / stars
    ctx.fillStyle = 'rgba(180,160,255,0.15)';
    for (let i = 0; i < 30; i++) {
      const sx = ((i * 137 + 50) % W);
      const sy = ((i * 191 + 80) % (H * 0.65));
      ctx.fillRect(sx, sy, 1, 1);
    }

    // ── Player (left, facing right) ──
    const pLunge = this.animState === 'playerAtk'
      ? Math.sin(this.animT * Math.PI) * 50 : 0;
    ctx.save();
    ctx.translate(W * 0.25 + pLunge, H * 0.68);
    ctx.scale(2, 2);
    this.player.draw(ctx, 0, 0, true, 0);
    ctx.restore();

    // ── Enemy (right, facing left via horizontal flip) ──
    const eLunge = this.animState === 'enemyAtk'
      ? -Math.sin(this.animT * Math.PI) * 50 : 0;
    ctx.save();
    ctx.translate(W * 0.75 + eLunge, H * 0.68);
    ctx.scale(-2, 2); // negative x = face left
    this.enemy.draw(ctx, 0, 0, true, 0); // draw "facing right" in flipped space
    ctx.restore();

    // Zone indicator lines on characters
    this._drawZoneLines(ctx, W, H);

    // ── Floating damage numbers ──
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
    const charH = 68 * 2; // character height in screen px at scale 2
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

    // Zone labels (subtle)
    ctx.fillStyle = 'rgba(200,200,255,0.18)';
    ctx.font      = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HEAD',  W * 0.25, top + h3 * 0.5 + 3);
    ctx.fillText('BODY',  W * 0.25, top + h3 * 1.5 + 3);
    ctx.fillText('LEGS',  W * 0.25, top + h3 * 2.5 + 3);
    ctx.fillText('HEAD',  W * 0.75, top + h3 * 0.5 + 3);
    ctx.fillText('BODY',  W * 0.75, top + h3 * 1.5 + 3);
    ctx.fillText('LEGS',  W * 0.75, top + h3 * 2.5 + 3);
  }
}
