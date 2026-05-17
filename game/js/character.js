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

  draw(ctx, cx, cy, facingRight = true, lungeOffset = 0) {
    CharacterDrawer.drawHumanoid(ctx, cx, cy, this.color, this.accent, facingRight, lungeOffset);
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

  draw(ctx, cx, cy, facingRight = false, lungeOffset = 0) {
    CharacterDrawer.drawMonster(ctx, this.type, cx, cy, facingRight, lungeOffset);
  }
}

// ── CHARACTER DRAWER ────────────────────────────────────────────────
class CharacterDrawer {

  static drawHumanoid(ctx, cx, cy, color, accent, facingRight, lunge = 0) {
    ctx.save();
    const dir = facingRight ? 1 : -1;
    const x = cx + dir * lunge;

    if (!facingRight) {
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, cy + 2, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = accent;
    ctx.fillRect(x - 6, cy - 10, 5, 13);
    ctx.fillRect(x + 1, cy - 10, 5, 13);

    // Body
    ctx.fillStyle = accent;
    ctx.fillRect(x - 7, cy - 24, 14, 15);

    // Arms
    ctx.fillStyle = color;
    ctx.fillRect(x - 11, cy - 24, 4, 12);
    ctx.fillRect(x + 7,  cy - 24, 4, 12);

    // Head
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, cy - 34, 11, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 5, cy - 37, 3, 3);
    ctx.fillRect(x + 2, cy - 37, 3, 3);

    ctx.restore();
  }

  static drawMonster(ctx, type, cx, cy, facingRight, lunge = 0) {
    ctx.save();
    const dir = facingRight ? 1 : -1;

    if (!facingRight) {
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
    }

    const x = cx + dir * lunge;

    switch (type) {
      case 'Goblin':   CharacterDrawer._goblin(ctx, x, cy);   break;
      case 'Wolf':     CharacterDrawer._wolf(ctx, x, cy);     break;
      case 'Bandit':   CharacterDrawer._bandit(ctx, x, cy);   break;
      case 'Skeleton': CharacterDrawer._skeleton(ctx, x, cy); break;
      case 'Troll':    CharacterDrawer._troll(ctx, x, cy);    break;
      case 'Dragon':   CharacterDrawer._dragon(ctx, x, cy);   break;
      default:         CharacterDrawer.drawHumanoid(ctx, x, cy, '#888', '#555', true, 0);
    }
    ctx.restore();
  }

  static _goblin(ctx, x, y) {
    const c = '#58a040';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#305828';
    ctx.fillRect(x - 5, y - 8,  4, 10);
    ctx.fillRect(x + 1, y - 8,  4, 10);
    ctx.fillStyle = '#305828';
    ctx.fillRect(x - 5, y - 18, 10, 11);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 26, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 7, y - 30); ctx.lineTo(x - 14, y - 40); ctx.lineTo(x - 2, y - 30); ctx.closePath();
    ctx.fillStyle = c; ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 7, y - 30); ctx.lineTo(x + 14, y - 40); ctx.lineTo(x + 2, y - 30); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(x - 5, y - 29, 3, 3);
    ctx.fillRect(x + 2, y - 29, 3, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 4, y - 29, 1, 2);
    ctx.fillRect(x + 3, y - 29, 1, 2);
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
    ctx.fillStyle = '#ff4400';
    ctx.fillRect(x + 21, y - 18, 3, 3);
  }

  static _bandit(ctx, x, y) {
    const c = '#8a5830', accent = '#4a2810';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(x - 6, y - 10, 5, 13);
    ctx.fillRect(x + 1, y - 10, 5, 13);
    ctx.fillRect(x - 7, y - 24, 14, 15);
    ctx.fillStyle = c;
    ctx.fillRect(x - 11, y - 24, 4, 12);
    ctx.fillRect(x + 7,  y - 24, 4, 12);
    ctx.fillStyle = '#aaa';
    ctx.fillRect(x + 11, y - 26, 3, 18);
    ctx.fillStyle = '#8a7';
    ctx.fillRect(x + 9, y - 26, 7, 3);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 34, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a0a00';
    ctx.beginPath(); ctx.arc(x, y - 34, 12, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 12, y - 34, 24, 6);
    ctx.fillStyle = '#ff4';
    ctx.fillRect(x - 4, y - 37, 2, 2);
    ctx.fillRect(x + 2, y - 37, 2, 2);
  }

  static _skeleton(ctx, x, y) {
    const c = '#d0d0b0';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c;
    ctx.fillRect(x - 5, y - 10, 4, 13);
    ctx.fillRect(x + 1, y - 10, 4, 13);
    ctx.fillRect(x - 6, y - 24, 12, 15);
    ctx.strokeStyle = '#0a0a08'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(x - 5, y - 22 + i * 4); ctx.lineTo(x + 5, y - 22 + i * 4); ctx.stroke();
    }
    ctx.fillStyle = c;
    ctx.fillRect(x - 10, y - 24, 4, 14);
    ctx.fillRect(x + 6,  y - 24, 4, 14);
    ctx.beginPath(); ctx.arc(x, y - 34, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x - 4, y - 36, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y - 36, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 1, y - 31, 2, 3);
    ctx.fillStyle = c;
    ctx.fillRect(x - 5, y - 28, 10, 3);
    ctx.fillStyle = '#000';
    for (let i = 0; i < 4; i++) ctx.fillRect(x - 4 + i * 3, y - 28, 1, 3);
  }

  static _troll(ctx, x, y) {
    const c = '#588040', dark = '#304820';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 20, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(x - 14, y - 14, 11, 16);
    ctx.fillRect(x + 3,  y - 14, 11, 16);
    ctx.fillStyle = c;
    ctx.fillRect(x - 16, y - 34, 32, 22);
    ctx.fillStyle = dark;
    ctx.fillRect(x - 26, y - 34, 10, 22);
    ctx.fillRect(x + 16, y - 34, 10, 22);
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y - 46, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff2200';
    ctx.fillRect(x - 7, y - 50, 5, 5);
    ctx.fillRect(x + 2, y - 50, 5, 5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x - 3, y - 41, 2, 5);
    ctx.fillRect(x + 1, y - 41, 2, 5);
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
    ctx.fillRect(x - 18, y - 10, 8, 14);
    ctx.fillRect(x + 10, y - 10, 8, 14);
    ctx.fillStyle = c;
    ctx.fillRect(x + 14, y - 34, 10, 16);
    ctx.beginPath(); ctx.ellipse(x + 26, y - 36, 14, 10, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 38, y - 32, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#400';
    ctx.beginPath(); ctx.moveTo(x + 20, y - 44); ctx.lineTo(x + 18, y - 58); ctx.lineTo(x + 26, y - 44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd700';
    ctx.beginPath(); ctx.arc(x + 32, y - 38, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(x + 32, y - 38, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  static drawWorldSprite(ctx, type, cx, cy) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.55, 0.55);
    ctx.translate(-cx, -cy);
    CharacterDrawer.drawMonster(ctx, type, cx, cy, true, 0);
    ctx.restore();
  }

  static drawWorldPlayer(ctx, cx, cy, color, accent) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.55, 0.55);
    ctx.translate(-cx, -cy);
    CharacterDrawer.drawHumanoid(ctx, cx, cy, color, accent, true, 0);
    ctx.restore();
  }
}
