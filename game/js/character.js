'use strict';

// ── BASE CHARACTER ──────────────────────────────────────────────────
class Character {
  constructor(name, baseHP, baseAtk, baseDef, baseSpd, color, accent) {
    this.name      = name;
    this.baseHP    = baseHP;
    this.baseAtk   = baseAtk;
    this.baseDef   = baseDef;
    this.baseSpd   = baseSpd;
    this.color     = color;
    this.accent    = accent;
    this.currentHP = baseHP;
    this.equipped  = {
      helmet: null, shoulders: null, chainmail: null, body: null, belt: null,
      legs: null, boots: null, mainHand: null, offHand: null,
    };
  }

  get maxHP() {
    return this.baseHP
      + (this.equipped.chainmail?.hpBonus ?? 0)
      + (this.equipped.body?.hpBonus      ?? 0)
      + (this.equipped.belt?.hpBonus      ?? 0);
  }
  get totalAtk() {
    return this.baseAtk
      + (this.equipped.mainHand?.atkBonus ?? 0)
      + (this.equipped.offHand?.atkBonus  ?? 0);
  }
  get totalDef() {
    return this.baseDef
      + (this.equipped.helmet?.defBonus    ?? 0)
      + (this.equipped.shoulders?.defBonus ?? 0)
      + (this.equipped.chainmail?.defBonus ?? 0)
      + (this.equipped.body?.defBonus      ?? 0)
      + (this.equipped.belt?.defBonus      ?? 0)
      + (this.equipped.legs?.defBonus      ?? 0)
      + (this.equipped.boots?.defBonus     ?? 0)
      + (this.equipped.offHand?.defBonus   ?? 0);
  }
  get totalSpd() { return this.baseSpd; }

  isAlive()     { return this.currentHP > 0; }
  takeDamage(n) { this.currentHP = Math.max(0, this.currentHP - Math.round(n)); }
  restoreHP()   { this.currentHP = this.maxHP; }
}

// ── PLAYER CHARACTER ────────────────────────────────────────────────
class PlayerCharacter extends Character {
  constructor(race, charClass) {
    const r = RACE_DATA[race];
    const c = CLASS_DATA[charClass];
    super(
      `${race} ${charClass}`,
      c.baseHP    + r.hpMod,
      c.baseAtk   + r.atkMod,
      c.baseDef   + r.defMod,
      c.baseSpd   + r.spdMod,
      r.color, r.accent
    );
    this.race            = race;
    this.charClass       = charClass;
    this.level           = 1;
    this.xp              = 0;
    this.gold            = 0;
    this.championPoints  = 0;
    this.inventory       = new Array(100).fill(null);
    this.elixirSlots     = [null, null, null, null]; // 2 default; 2 extra with belt
    this._baseRegen      = CLASS_DATA[charClass].baseRegen;
    this._hotHps         = 0;
    this._hotRemaining   = 0;
    // World position (tile units)
    this.worldTileX = 30;
    this.worldTileY = 30;
    // Profession (index into PROFESSION_NAMES; 1+2 TBD)
    this.profession = 0;
    // Hit combinations — randomly assigned per session; one unlocked per level
    this.combos = [];
    this._initCombos();
    this.activeCombinationIdx = 0; // which combo is active in battle
    // Per-battle consecutive hit buffer (cleared by BattleScene/DuelBattleScene.init)
    this._hitBuffer = [];
  }

  _pickComboDef(level) {
    const pool = COMBO_DEFS[level];
    if (!pool || !pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _initCombos() {
    for (let lv = 1; lv <= this.level; lv++) {
      const def = this._pickComboDef(lv);
      if (def) this._addCombo(def);
    }
  }

  _addCombo(def) {
    const seq = Array.from({ length: def.length }, () =>
      COMBO_ZONE_KEYS[Math.floor(Math.random() * COMBO_ZONE_KEYS.length)]);
    this.combos.push({ name: def.name, sequence: seq, discovered: false, def });
  }

  // HP regen per second (used in world loop)
  get regenRate() { return this._baseRegen * 0.5; }

  // Slots 0-1 always available; slots 2-3 require a belt
  get elixirSlotsAvailable() { return this.equipped.belt ? 4 : 2; }

  // Returns true if leveled up
  gainXP(amount) {
    this.xp += amount;
    if (this.xp >= xpToNextLevel(this.level)) {
      this.xp -= xpToNextLevel(this.level);
      this._levelUp();
      return true;
    }
    return false;
  }

  _levelUp() {
    this.level++;
    this.baseHP  += 10;
    this.baseAtk +=  2;
    this.baseDef +=  1;
    this.currentHP = this.maxHP;
    const newDef = this._pickComboDef(this.level);
    if (newDef) this._addCombo(newDef);
  }

  // Add gold: updates player.gold and keeps a synced gold item in inventory
  addGold(amount) {
    this.gold += amount;
    const goldItem = this.inventory.find(item => item?.slot === 'gold');
    if (goldItem) {
      goldItem.amount = this.gold;
      goldItem.name   = `Gold (${this.gold})`;
    } else {
      const idx = this.inventory.indexOf(null);
      if (idx !== -1) {
        this.inventory[idx] = { slot: 'gold', name: `Gold (${this.gold})`, amount: this.gold };
      }
    }
  }

  // Returns false if inventory full
  addToInventory(item) {
    const idx = this.inventory.indexOf(null);
    if (idx === -1) return false;
    this.inventory[idx] = item;
    return true;
  }

  // Move item from inventory slot to equipment slot; swaps old equipped item back
  equipFromInventory(invIdx) {
    const item = this.inventory[invIdx];
    if (!item || !this.equipped.hasOwnProperty(item.slot)) return false;
    const old = this.equipped[item.slot];
    if (old) {
      const freeIdx = this.inventory.findIndex(s => s === null);
      if (freeIdx === -1) return false;  // no room to swap
      this.inventory[freeIdx] = old;
    }
    this.equipped[item.slot] = item;
    this.inventory[invIdx]   = null;
    this.currentHP = Math.min(this.currentHP, this.maxHP);
    return true;
  }

  // Unequip a slot back to inventory
  unequipSlot(slot) {
    const item = this.equipped[slot];
    if (!item) return false;
    if (!this.addToInventory(item)) return false;
    this.equipped[slot] = null;
    this.currentHP = Math.min(this.currentHP, this.maxHP);
    return true;
  }

  // Use a consumable item from inventory
  useFromInventory(invIdx) {
    const item = this.inventory[invIdx];
    if (!item) return false;
    if (item.slot !== 'consumable') return false;
    if (item.hotHps) {
      // Heal over time: stack on top of any existing HoT
      this._hotHps       = item.hotHps;
      this._hotRemaining = item.hotDuration;
    } else if (item.healFraction) {
      this.currentHP = Math.min(this.maxHP, this.currentHP + Math.round(this.maxHP * item.healFraction));
    } else if (item.healAmount) {
      this.currentHP = Math.min(this.maxHP, this.currentHP + item.healAmount);
    }
    this.inventory[invIdx] = null;
    return true;
  }

  removeFromInventory(invIdx) {
    if (this.inventory[invIdx]?.slot === 'gold') this.gold = 0;
    this.inventory[invIdx] = null;
  }

  // Move consumable from inventory to an elixir slot
  equipElixirSlot(invIdx, slotIdx) {
    const item = this.inventory[invIdx];
    if (!item || item.slot !== 'consumable') return false;
    if (slotIdx >= this.elixirSlotsAvailable) return false;
    const old = this.elixirSlots[slotIdx];
    if (old) {
      const freeIdx = this.inventory.findIndex(s => s === null);
      if (freeIdx === -1) return false;
      this.inventory[freeIdx] = old;
    }
    this.elixirSlots[slotIdx] = item;
    this.inventory[invIdx]    = null;
    return true;
  }

  // Return elixir slot item back to inventory
  unequipElixirSlot(slotIdx) {
    const item = this.elixirSlots[slotIdx];
    if (!item) return false;
    if (!this.addToInventory(item)) return false;
    this.elixirSlots[slotIdx] = null;
    return true;
  }

  // Consume and apply the elixir in a slot
  useElixirSlot(slotIdx) {
    const item = this.elixirSlots[slotIdx];
    if (!item) return false;
    if (item.hotHps) {
      this._hotHps       = item.hotHps;
      this._hotRemaining = item.hotDuration;
    } else if (item.healFraction) {
      this.currentHP = Math.min(this.maxHP, this.currentHP + Math.round(this.maxHP * item.healFraction));
    } else if (item.healAmount) {
      this.currentHP = Math.min(this.maxHP, this.currentHP + item.healAmount);
    }
    this.elixirSlots[slotIdx] = null;
    return true;
  }

  // animState: 'idle'|'attack'|'hit'  animT: 0-1  idleT: accumulated seconds
  draw(ctx, cx, cy, facingRight = true, animState = 'idle', animT = 0, idleT = 0) {
    CharacterDrawer.draw(ctx, cx, cy, this.race, this.charClass, facingRight, animState, animT, idleT);
  }
}

// ── MOB BASE CLASS ───────────────────────────────────────────────────
class Mob extends Character {
  constructor(name, hp, atk, def, spd, color, accent, respawnTime = 30) {
    super(name, hp, atk, def, spd, color, accent);
    this.respawnTime   = respawnTime;
    this._respawnTimer = -1;         // -1 = alive; ≥0 = counting down to respawn
    this._roamX        = 0;
    this._roamY        = 0;
    this._roamTargetX  = 0;
    this._roamTargetY  = 0;
    this._roamTimer    = Math.random() * 3; // stagger initial wander
  }
}

// ── ENEMY CHARACTER ─────────────────────────────────────────────────
class EnemyCharacter extends Mob {
  constructor(type, spawnTX, spawnTY) {
    const t = ENEMY_TYPES[type];
    super(type, t.baseHP, t.baseAtk, t.baseDef, t.spd, t.color, t.accent, t.respawnTime ?? 30);
    this.type       = type;
    this.level      = t.level;
    this.xpReward   = t.xp;
    this.goldReward = t.gold;
    this.spawnTX    = spawnTX;
    this.spawnTY    = spawnTY;
    this.defeated   = false;
    // Initialise roam position at spawn
    this._roamX       = spawnTX * TILE_SIZE + TILE_SIZE / 2;
    this._roamY       = spawnTY * TILE_SIZE + TILE_SIZE / 2;
    this._roamTargetX = this._roamX;
    this._roamTargetY = this._roamY;
  }

  chooseAction() {
    const zones   = ['top', 'mid', 'bot'];
    const actions = ['top', 'mid', 'bot', 'stance'];
    return {
      action:    actions[Math.floor(Math.random() * actions.length)],
      blockZone: zones[Math.floor(Math.random() * zones.length)],
    };
  }

  draw(ctx, cx, cy, facingRight = false, animState = 'idle', animT = 0, idleT = 0) {
    CharacterDrawer.drawMonster(ctx, this.type, cx, cy, facingRight, animState, animT, idleT);
  }
}

// ── CHARACTER DRAWER ────────────────────────────────────────────────
class CharacterDrawer {

  static _skin(race) {
    return { Human:'#e8c080', Elf:'#c8e090', DarkElf:'#7060a0', Orc:'#789050', Dwarf:'#c07848' }[race] ?? '#e8c080';
  }
  static _hair(race) {
    return { Human:'#6a3810', Elf:'#d4c840', DarkElf:'#e0e0f0', Orc:'#304020', Dwarf:'#b03020' }[race] ?? '#6a3810';
  }
  static _cloth(cls) {
    return { Knight:'#5070a8', BladeWarrior:'#783028', Ranger:'#506040', Mystic:'#604088', Assassin:'#282830', Cleric:'#c0a840' }[cls] ?? '#505878';
  }
  static _dk(hex, f = 0.62) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${Math.round(((n>>16)&255)*f)},${Math.round(((n>>8)&255)*f)},${Math.round((n&255)*f)})`;
  }

  // ── Player humanoid ──────────────────────────────────────────────
  static draw(ctx, cx, cy, race, cls, facingRight = true, animState = 'idle', animT = 0, idleT = 0) {
    const skin  = CharacterDrawer._skin(race);
    const hair  = CharacterDrawer._hair(race);
    const cloth = CharacterDrawer._cloth(cls);
    const skD   = CharacterDrawer._dk(skin);
    const clD   = CharacterDrawer._dk(cloth);
    const isElf   = race === 'Elf' || race === 'DarkElf';
    const isOrc   = race === 'Orc';
    const isDwarf = race === 'Dwarf';
    const H = isDwarf ? 0.82 : (isOrc ? 1.06 : 1.0); // height scale

    const breathY   = animState === 'idle'   ? Math.sin(idleT * 2.5) * 1.5 : 0;
    const leanAngle = animState === 'attack' ? Math.sin(animT * Math.PI) * 0.17 : 0;
    const hitAngle  = animState === 'hit'    ? Math.sin(animT * Math.PI) * -0.13 : 0;

    ctx.save();
    ctx.translate(cx, cy);
    if (!facingRight) ctx.scale(-1, 1);
    ctx.translate(0, breathY);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(0, -1, 16 * H, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(leanAngle + hitAngle);

    // proportions (Y negative = up from feet)
    const kneeY     = -22 * H,  hipY    = -38 * H;
    const shoulderY = -64 * H,  neckBY  = -68 * H;
    const headY     = -79 * H,  headR   =  10 * H;
    const bW        = isOrc ? 13 : 11;  // half body width at shoulder
    const armW      = isOrc ? 6 : 4;

    // ── Legs ──
    const stepFwd = animState === 'attack' ? Math.sin(animT * Math.PI) * 4 : 0;
    // back leg
    ctx.fillStyle = clD;
    ctx.beginPath();
    ctx.moveTo(-8, hipY); ctx.lineTo(-8 - stepFwd*0.3, kneeY); ctx.lineTo(-3 - stepFwd*0.3, kneeY); ctx.lineTo(-3, hipY);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-8 - stepFwd*0.3, kneeY); ctx.lineTo(-9 - stepFwd*0.3, 0); ctx.lineTo(-4 - stepFwd*0.3, 0); ctx.lineTo(-3 - stepFwd*0.3, kneeY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#302010';
    ctx.fillRect(-11 - stepFwd*0.3, -5, 9, 5);
    // front leg
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(3, hipY); ctx.lineTo(3 + stepFwd*0.5, kneeY); ctx.lineTo(8 + stepFwd*0.5, kneeY); ctx.lineTo(8, hipY);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(3 + stepFwd*0.5, kneeY); ctx.lineTo(2 + stepFwd, 0); ctx.lineTo(8 + stepFwd, 0); ctx.lineTo(8 + stepFwd*0.5, kneeY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#302010';
    ctx.fillRect(1 + stepFwd, -5, 9, 5);

    // belt
    ctx.fillStyle = '#4a3020'; ctx.fillRect(-10, hipY - 4, 20, 5);
    ctx.fillStyle = '#c0a030'; ctx.fillRect(-2, hipY - 4, 4, 4);

    // ── Body ──
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(-9, hipY); ctx.lineTo(-bW - 1, shoulderY); ctx.lineTo(bW + 1, shoulderY); ctx.lineTo(9, hipY);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = clD; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, hipY); ctx.lineTo(0, shoulderY); ctx.stroke();
    ctx.fillStyle = clD;
    ctx.beginPath(); ctx.ellipse(-bW, shoulderY, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse( bW, shoulderY, 5, 4, 0, 0, Math.PI * 2); ctx.fill();

    // ── Off-hand arm (left, back) ──
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(-bW - 1, shoulderY); ctx.lineTo(-bW - armW - 1, shoulderY + 18 * H);
    ctx.lineTo(-bW + armW - 1, shoulderY + 18 * H); ctx.lineTo(-bW + armW - 1, shoulderY);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-bW - armW - 1, shoulderY + 18 * H); ctx.lineTo(-bW - armW + 1, shoulderY + 34 * H);
    ctx.lineTo(-bW + armW - 2, shoulderY + 34 * H); ctx.lineTo(-bW + armW - 1, shoulderY + 18 * H);
    ctx.closePath(); ctx.fill();

    // ── Weapon arm (right, front) — rotates on attack ──
    const atkRot = animState === 'attack' ? Math.sin(animT * Math.PI) * 0.7 : 0;
    ctx.save();
    ctx.translate(bW + 1, shoulderY);
    ctx.rotate(atkRot);
    ctx.fillStyle = skin;
    ctx.fillRect(-armW / 2, 0, armW, 18 * H);
    ctx.fillRect(-armW / 2 + 1, 18 * H, armW - 1, 16 * H);
    CharacterDrawer._weapon(ctx, cls, 0, (18 + 16) * H);
    ctx.restore();

    // ── Neck ──
    ctx.fillStyle = skin; ctx.fillRect(-3, neckBY, 6, headY - neckBY + headR);

    // ── Ears ──
    ctx.fillStyle = skin;
    if (isElf) {
      ctx.beginPath(); ctx.moveTo(-headR, headY - 2); ctx.lineTo(-headR - 7, headY - 9); ctx.lineTo(-headR, headY + 3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo( headR, headY - 2); ctx.lineTo( headR + 7, headY - 9); ctx.lineTo( headR, headY + 3); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(-headR + 1, headY, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( headR - 1, headY, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // ── Head ──
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(0, headY, headR, 0, Math.PI * 2); ctx.fill();

    // orc tusks
    if (isOrc) {
      ctx.fillStyle = '#e8e0c0';
      ctx.beginPath(); ctx.moveTo(-4, headY + headR - 2); ctx.lineTo(-5, headY + headR + 7); ctx.lineTo(-1, headY + headR - 1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo( 1, headY + headR - 1); ctx.lineTo( 3, headY + headR + 7); ctx.lineTo( 5, headY + headR - 2); ctx.closePath(); ctx.fill();
    }

    // dwarf beard
    if (isDwarf) {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.moveTo(-7, headY + 4);
      ctx.quadraticCurveTo(-9, headY + 16, -3, headY + 20);
      ctx.quadraticCurveTo( 0, headY + 22,  3, headY + 20);
      ctx.quadraticCurveTo( 9, headY + 16,  7, headY + 4);
      ctx.closePath(); ctx.fill();
    }

    // eyes
    const eY = headY - 1;
    if (animState === 'hit') {
      ctx.fillStyle = '#000';
      ctx.fillRect(-5, eY - 0.5, 4, 1.5);
      ctx.fillRect( 1, eY - 0.5, 4, 1.5);
      ctx.fillStyle = '#800000';
      ctx.beginPath(); ctx.ellipse(0, headY + 4, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(-3, eY, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 3, eY, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#202020';
      ctx.beginPath(); ctx.arc(-2.5, eY, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc( 3.5, eY, 1.3, 0, Math.PI * 2); ctx.fill();
    }

    // hair
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(0, headY, headR, Math.PI * 0.72, Math.PI * 2.28); ctx.fill();
    if (isElf) {
      ctx.beginPath();
      ctx.moveTo(headR - 3, headY + 2);
      ctx.quadraticCurveTo(headR + 5, headY + 16, headR + 1, headY + 24);
      ctx.quadraticCurveTo(headR - 5, headY + 28, headR - 9, headY + 20);
      ctx.quadraticCurveTo(headR - 5, headY + 16, headR - 3, headY + 8);
      ctx.closePath(); ctx.fill();
    }

    CharacterDrawer._headGear(ctx, cls, headY, headR);

    // hit flash overlay
    if (animState === 'hit') {
      ctx.globalAlpha = Math.sin(animT * Math.PI) * 0.38;
      ctx.fillStyle = '#ff3030';
      ctx.beginPath(); ctx.ellipse(0, headY + 44 * H, 18 * H, 52 * H, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  static _weapon(ctx, cls, hx, hy) {
    switch (cls) {
      case 'Knight':
        ctx.fillStyle = '#9a8060'; ctx.fillRect(hx - 6, hy - 2, 12, 3);
        ctx.fillStyle = '#c8c8d8';
        ctx.beginPath(); ctx.moveTo(hx - 2, hy); ctx.lineTo(hx + 2, hy); ctx.lineTo(hx + 1, hy + 22); ctx.lineTo(hx - 1, hy + 22); ctx.closePath(); ctx.fill();
        break;
      case 'BladeWarrior':
        ctx.fillStyle = '#8a7050'; ctx.fillRect(hx - 7, hy - 2, 14, 3);
        ctx.fillStyle = '#d0c8b8';
        ctx.beginPath(); ctx.moveTo(hx - 3, hy); ctx.lineTo(hx + 3, hy); ctx.lineTo(hx + 1, hy + 30); ctx.lineTo(hx - 1, hy + 30); ctx.closePath(); ctx.fill();
        break;
      case 'Ranger': {
        ctx.strokeStyle = '#7a5828'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(hx + 8, hy + 12, 13, -0.7, 0.7); ctx.stroke();
        const bx1 = hx + 8 + 13 * Math.cos(-0.7), by1 = hy + 12 + 13 * Math.sin(-0.7);
        const bx2 = hx + 8 + 13 * Math.cos(0.7),  by2 = hy + 12 + 13 * Math.sin(0.7);
        ctx.strokeStyle = '#c0a060'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx1, by1); ctx.lineTo(bx2, by2); ctx.stroke();
        break;
      }
      case 'Mystic': {
        ctx.strokeStyle = '#5a3818'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(hx + 1, hy); ctx.lineTo(hx + 1, hy + 28); ctx.stroke();
        const g = ctx.createRadialGradient(hx + 1, hy - 2, 1, hx + 1, hy - 2, 7);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#c060ff'); g.addColorStop(1, 'rgba(100,0,200,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx + 1, hy - 2, 7, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'Assassin':
        ctx.strokeStyle = '#b0b0c8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 2, hy + 14); ctx.stroke();
        ctx.strokeStyle = '#707080'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(hx - 4, hy + 3); ctx.lineTo(hx + 4, hy + 3); ctx.stroke();
        break;
      case 'Cleric':
        ctx.strokeStyle = '#706860'; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(hx + 1, hy + 6); ctx.lineTo(hx + 1, hy + 28); ctx.stroke();
        ctx.fillStyle = '#9a9080';
        ctx.beginPath(); ctx.arc(hx + 1, hy + 3, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#504840'; ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          ctx.beginPath();
          ctx.moveTo(hx + 1 + Math.cos(a) * 7, hy + 3 + Math.sin(a) * 7);
          ctx.lineTo(hx + 1 + Math.cos(a) * 11, hy + 3 + Math.sin(a) * 11);
          ctx.stroke();
        }
        break;
    }
  }

  static _headGear(ctx, cls, headY, headR) {
    if (cls === 'Knight') {
      ctx.fillStyle = '#707880';
      ctx.beginPath(); ctx.arc(0, headY, headR + 2, Math.PI * 0.76, Math.PI * 2.24); ctx.fill();
      ctx.fillRect(-headR - 2, headY - 5, (headR + 2) * 2, 6);
      ctx.fillStyle = '#303840'; ctx.fillRect(-headR + 1, headY - 1, (headR - 1) * 2, 2);
    } else if (cls === 'Mystic') {
      ctx.fillStyle = '#301060';
      ctx.beginPath();
      ctx.moveTo(-headR - 2, headY - headR + 3); ctx.lineTo(-2, headY - headR - 24);
      ctx.lineTo(2, headY - headR - 24); ctx.lineTo(headR + 2, headY - headR + 3);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(-headR - 4, headY - headR + 1, (headR + 4) * 2, 5);
    } else if (cls === 'Ranger') {
      ctx.fillStyle = '#304020';
      ctx.beginPath(); ctx.arc(0, headY, headR + 1, Math.PI * 0.82, Math.PI * 2.18); ctx.fill();
    } else if (cls === 'Cleric') {
      ctx.fillStyle = '#c0a840';
      ctx.beginPath(); ctx.arc(0, headY, headR + 1, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
      ctx.fillRect(-headR, headY - headR - 1, headR * 2, 5);
    }
  }

  // ── Monsters ────────────────────────────────────────────────────
  static drawMonster(ctx, type, cx, cy, facingRight = false, animState = 'idle', animT = 0, idleT = 0) {
    ctx.save();
    ctx.translate(cx, cy);
    if (!facingRight) ctx.scale(-1, 1);

    const breathY = animState === 'idle' ? Math.sin(idleT * 2.5) * 1.5 : 0;
    const atkLean = animState === 'attack' ? Math.sin(animT * Math.PI) * 0.15 : 0;
    const hitLean = animState === 'hit'    ? Math.sin(animT * Math.PI) * -0.12 : 0;

    ctx.translate(0, breathY);
    ctx.rotate(atkLean + hitLean);

    switch (type) {
      case 'Goblin':   CharacterDrawer._goblin(ctx, 0, 0);   break;
      case 'Wolf':     CharacterDrawer._wolf(ctx, 0, 0);     break;
      case 'Bandit':   CharacterDrawer._bandit(ctx, 0, 0);   break;
      case 'Skeleton': CharacterDrawer._skeleton(ctx, 0, 0); break;
      case 'Troll':    CharacterDrawer._troll(ctx, 0, 0);    break;
      case 'Dragon':   CharacterDrawer._dragon(ctx, 0, 0);   break;
    }

    if (animState === 'hit') {
      ctx.globalAlpha = Math.sin(animT * Math.PI) * 0.38;
      ctx.fillStyle = '#ff3030';
      ctx.beginPath(); ctx.ellipse(0, -25, 16, 34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  static _goblin(ctx, x, y) {
    const c = '#58a040';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#305828';
    ctx.fillRect(x - 5, y - 8, 4, 10); ctx.fillRect(x + 1, y - 8, 4, 10);
    ctx.fillRect(x - 5, y - 18, 10, 11);
    // club
    ctx.fillStyle = '#7a5020'; ctx.fillRect(x + 7, y - 22, 3, 16);
    ctx.beginPath(); ctx.arc(x + 8.5, y - 23, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 26, 9, 0, Math.PI * 2); ctx.fill();
    // ears
    ctx.beginPath(); ctx.moveTo(x - 7, y - 30); ctx.lineTo(x - 14, y - 40); ctx.lineTo(x - 2, y - 30); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 7, y - 30); ctx.lineTo(x + 14, y - 40); ctx.lineTo(x + 2, y - 30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(x - 5, y - 29, 3, 3); ctx.fillRect(x + 2, y - 29, 3, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 4, y - 29, 1, 2); ctx.fillRect(x + 3, y - 29, 1, 2);
  }

  static _wolf(ctx, x, y) {
    const c = '#7a6a58', dark = '#504030';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(x - 4, y - 14, 18, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 16, y - 16, 11, 8, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 26, y - 13, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(x + 12, y - 22); ctx.lineTo(x + 10, y - 32); ctx.lineTo(x + 20, y - 23); ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(x - 18, y - 5, 5, 10); ctx.fillRect(x - 10, y - 5, 5, 10);
    ctx.fillRect(x - 2,  y - 5, 5, 10); ctx.fillRect(x + 6,  y - 5, 5, 10);
    ctx.strokeStyle = c; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(x - 20, y - 20, 10, 0.2, 2.2); ctx.stroke();
    ctx.fillStyle = '#ff4400'; ctx.fillRect(x + 21, y - 18, 3, 3);
  }

  static _bandit(ctx, x, y) {
    const c = '#8a5830', accent = '#4a2810';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(x - 6, y - 10, 5, 13); ctx.fillRect(x + 1, y - 10, 5, 13);
    ctx.fillRect(x - 7, y - 24, 14, 15);
    ctx.fillStyle = c;
    ctx.fillRect(x - 11, y - 24, 4, 12); ctx.fillRect(x + 7, y - 24, 4, 12);
    // sword
    ctx.fillStyle = '#aaa'; ctx.fillRect(x + 11, y - 26, 3, 18);
    ctx.fillStyle = '#8a7'; ctx.fillRect(x + 9, y - 26, 7, 3);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 34, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a0a00';
    ctx.beginPath(); ctx.arc(x, y - 34, 12, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 12, y - 34, 24, 6);
    ctx.fillStyle = '#ff4';
    ctx.fillRect(x - 4, y - 37, 2, 2); ctx.fillRect(x + 2, y - 37, 2, 2);
  }

  static _skeleton(ctx, x, y) {
    const c = '#d0d0b0';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.fillRect(x - 5, y - 10, 4, 13); ctx.fillRect(x + 1, y - 10, 4, 13);
    ctx.fillRect(x - 6, y - 24, 12, 15);
    ctx.strokeStyle = '#0a0a08'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(x - 5, y - 22 + i * 4); ctx.lineTo(x + 5, y - 22 + i * 4); ctx.stroke();
    }
    ctx.fillStyle = c;
    ctx.fillRect(x - 10, y - 24, 4, 14); ctx.fillRect(x + 6, y - 24, 4, 14);
    ctx.beginPath(); ctx.arc(x, y - 34, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x - 4, y - 36, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y - 36, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 1, y - 31, 2, 3);
    ctx.fillStyle = c; ctx.fillRect(x - 5, y - 28, 10, 3);
    ctx.fillStyle = '#000';
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 4 + i * 3, y - 28, 1, 3);
  }

  static _troll(ctx, x, y) {
    const c = '#588040', dark = '#304820';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(x - 14, y - 14, 11, 16); ctx.fillRect(x + 3, y - 14, 11, 16);
    ctx.fillStyle = c; ctx.fillRect(x - 16, y - 34, 32, 22);
    ctx.fillStyle = dark;
    ctx.fillRect(x - 26, y - 34, 10, 22); ctx.fillRect(x + 16, y - 34, 10, 22);
    // club
    ctx.fillStyle = '#5a3810'; ctx.fillRect(x + 20, y - 50, 5, 22);
    ctx.fillStyle = '#7a5020';
    ctx.beginPath(); ctx.ellipse(x + 22, y - 52, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 46, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff2200';
    ctx.fillRect(x - 7, y - 50, 5, 5); ctx.fillRect(x + 2, y - 50, 5, 5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 3, y - 41, 2, 5); ctx.fillRect(x + 1, y - 41, 2, 5);
  }

  static _dragon(ctx, x, y) {
    const c = '#c03020', dark = '#800808';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(x, y + 3, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(x - 18, y - 18); ctx.quadraticCurveTo(x - 38, y - 8, x - 34, y + 4); ctx.stroke();
    ctx.fillStyle = '#8a0808';
    ctx.beginPath(); ctx.moveTo(x - 6, y - 30); ctx.lineTo(x - 34, y - 62); ctx.lineTo(x + 8, y - 32); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 8, y - 30); ctx.lineTo(x + 12, y - 62); ctx.lineTo(x + 20, y - 32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.ellipse(x, y - 22, 24, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(x - 18, y - 10, 8, 14); ctx.fillRect(x + 10, y - 10, 8, 14);
    ctx.fillStyle = c; ctx.fillRect(x + 14, y - 34, 10, 16);
    ctx.beginPath(); ctx.ellipse(x + 26, y - 36, 14, 10, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 38, y - 32, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#400';
    ctx.beginPath(); ctx.moveTo(x + 20, y - 44); ctx.lineTo(x + 18, y - 58); ctx.lineTo(x + 26, y - 44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(x + 32, y - 38, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x + 32, y - 38, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  // ── World-map scale ──────────────────────────────────────────────
  static drawWorldPlayer(ctx, cx, cy, race, cls) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.42, 0.42);
    CharacterDrawer.draw(ctx, 0, 0, race, cls, true, 'idle', 0, 0);
    ctx.restore();
  }

  static drawWorldSprite(ctx, type, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.42, 0.42);
    CharacterDrawer.drawMonster(ctx, type, 0, 0, true, 'idle', 0, 0);
    ctx.restore();
  }
}
