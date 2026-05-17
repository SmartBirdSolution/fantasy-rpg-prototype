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
      helmet: null, shoulders: null, body: null, belt: null,
      legs: null, boots: null, mainHand: null, offHand: null,
    };
  }

  get maxHP() {
    return this.baseHP
      + (this.equipped.body?.hpBonus ?? 0)
      + (this.equipped.belt?.hpBonus ?? 0);
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
    this._baseRegen      = CLASS_DATA[charClass].baseRegen;
    this._hotHps         = 0;
    this._hotRemaining   = 0;
    // World position (tile units)
    this.worldTileX = 30;
    this.worldTileY = 30;
  }

  // HP regen per second (used in world loop)
  get regenRate() { return this._baseRegen * 0.5; }

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

  draw(ctx, cx, cy, facingRight = true, lungeOffset = 0) {
    CharacterDrawer.drawHumanoid(ctx, cx, cy, this.color, this.accent, facingRight, lungeOffset, this.race);
  }
}

// ── ENEMY CHARACTER ─────────────────────────────────────────────────
class EnemyCharacter extends Character {
  constructor(type, spawnTX, spawnTY) {
    const t = ENEMY_TYPES[type];
    super(type, t.baseHP, t.baseAtk, t.baseDef, t.spd, t.color, t.accent);
    this.type       = type;
    this.level      = t.level;
    this.xpReward   = t.xp;
    this.goldReward = t.gold;
    this.spawnTX    = spawnTX;
    this.spawnTY    = spawnTY;
    this.defeated   = false;
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

  static drawHumanoid(ctx, cx, cy, color, accent, facingRight, lunge = 0, race = null) {
    ctx.save();
    const dir = facingRight ? 1 : -1;
    const x = cx + dir * lunge;

    if (!facingRight) {
      ctx.translate(cx * 2, 0);
      ctx.scale(-1, 1);
    }

    if (race === 'Human') {
      CharacterDrawer._human(ctx, x, cy);
      ctx.restore();
      return;
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

  static _human(ctx, x, y) {
    const skin     = '#d4a878';
    const skinDk   = '#a8784a';
    const tunic    = '#e8dfc0';
    const tunicSh  = '#c8bfa0';
    const leather  = '#7a5030';
    const leatherDk= '#4a2e18';
    const leatherLt= '#a07848';
    const pants    = '#3a2818';
    const hair     = '#b89048';
    const hairDk   = '#7a5820';
    const metal    = '#8898a8';
    const metalLt  = '#c8d8e8';
    const gold     = '#c8a028';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 14, 5, 0, 0, Math.PI * 2); ctx.fill();

    // ── BOOTS ──
    ctx.fillStyle = leatherDk;
    ctx.beginPath(); ctx.roundRect(x - 8, y - 14, 7, 16, [0,0,2,2]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + 1, y - 14, 7, 16, [0,0,2,2]); ctx.fill();
    // boot highlight strip
    ctx.fillStyle = leather;
    ctx.fillRect(x - 7, y - 13, 2, 10);
    ctx.fillRect(x + 2, y - 13, 2, 10);

    // ── SHIN ARMOR PLATES ──
    ctx.fillStyle = metal;
    ctx.beginPath(); ctx.roundRect(x - 8, y - 24, 7, 12, 1); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + 1, y - 24, 7, 12, 1); ctx.fill();
    ctx.fillStyle = metalLt;
    ctx.fillRect(x - 7, y - 23, 2, 8);
    ctx.fillRect(x + 2, y - 23, 2, 8);
    ctx.strokeStyle = '#607080'; ctx.lineWidth = 0.6;
    ctx.strokeRect(x - 8, y - 24, 7, 12);
    ctx.strokeRect(x + 1, y - 24, 7, 12);
    // plate rivets
    ctx.fillStyle = metalLt;
    ctx.beginPath(); ctx.arc(x - 5, y - 23, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y - 23, 1, 0, Math.PI * 2); ctx.fill();

    // ── UPPER LEGS / PANTS ──
    ctx.fillStyle = pants;
    ctx.fillRect(x - 7, y - 32, 6, 10);
    ctx.fillRect(x + 1, y - 32, 6, 10);
    // inner leg shadow
    ctx.fillStyle = '#281808';
    ctx.fillRect(x - 2, y - 32, 4, 10);

    // ── KILT PANELS ──
    ctx.fillStyle = leather;
    // center panel
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 36); ctx.lineTo(x + 5, y - 36);
    ctx.lineTo(x + 4, y - 26); ctx.lineTo(x - 4, y - 26);
    ctx.closePath(); ctx.fill();
    // left panel
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 36); ctx.lineTo(x - 4, y - 36);
    ctx.lineTo(x - 5, y - 26); ctx.lineTo(x - 10, y - 27);
    ctx.closePath(); ctx.fill();
    // right panel
    ctx.beginPath();
    ctx.moveTo(x + 4, y - 36); ctx.lineTo(x + 9, y - 36);
    ctx.lineTo(x + 10, y - 27); ctx.lineTo(x + 5, y - 26);
    ctx.closePath(); ctx.fill();
    // panel separators
    ctx.strokeStyle = leatherDk; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(x - 4, y - 36); ctx.lineTo(x - 5, y - 26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 4, y - 36); ctx.lineTo(x + 5, y - 26); ctx.stroke();
    // kilt highlights
    ctx.fillStyle = leatherLt;
    ctx.fillRect(x - 4, y - 36, 2, 8);
    ctx.fillRect(x + 3, y - 36, 2, 8);

    // ── BELT ──
    ctx.fillStyle = leatherDk;
    ctx.fillRect(x - 10, y - 38, 20, 4);
    ctx.fillStyle = gold;
    ctx.fillRect(x - 3, y - 38, 6, 4);
    ctx.strokeStyle = '#a08018'; ctx.lineWidth = 0.5;
    ctx.strokeRect(x - 3, y - 38, 6, 4);
    ctx.fillStyle = leatherLt;
    ctx.fillRect(x - 10, y - 38, 20, 1);

    // ── TORSO — sleeveless tunic ──
    ctx.fillStyle = tunic;
    ctx.beginPath(); ctx.roundRect(x - 8, y - 54, 16, 18, 2); ctx.fill();
    // side shadow seams
    ctx.fillStyle = tunicSh;
    ctx.fillRect(x - 8, y - 54, 2, 18);
    ctx.fillRect(x + 6, y - 54, 2, 18);
    // center crease
    ctx.strokeStyle = tunicSh; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x, y - 54); ctx.lineTo(x, y - 39); ctx.stroke();
    // V neckline
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 54); ctx.lineTo(x, y - 49); ctx.lineTo(x + 3, y - 54);
    ctx.closePath(); ctx.fill();

    // ── CHEST HARNESS ──
    ctx.strokeStyle = leather; ctx.lineWidth = 2; ctx.lineCap = 'round';
    // diagonal strap
    ctx.beginPath(); ctx.moveTo(x + 6, y - 54); ctx.lineTo(x - 5, y - 39); ctx.stroke();
    // horizontal band
    ctx.beginPath(); ctx.moveTo(x - 8, y - 47); ctx.lineTo(x + 8, y - 47); ctx.stroke();
    // buckle
    ctx.fillStyle = gold;
    ctx.beginPath(); ctx.arc(x + 1, y - 47, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6010'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(x + 1, y - 47, 2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineCap = 'butt';

    // ── RIGHT ARM (screen-left, character's right) ──
    // upper arm bare skin
    ctx.fillStyle = skin;
    ctx.fillRect(x - 13, y - 54, 5, 12);
    // muscle highlight
    ctx.fillStyle = skinDk;
    ctx.fillRect(x - 13, y - 46, 5, 4);
    // forearm
    ctx.fillStyle = skin;
    ctx.fillRect(x - 13, y - 42, 5, 9);
    // gauntlet
    ctx.fillStyle = leatherDk;
    ctx.beginPath(); ctx.roundRect(x - 14, y - 35, 7, 9, 1); ctx.fill();
    ctx.fillStyle = leatherLt;
    ctx.fillRect(x - 13, y - 34, 2, 6);
    // knuckle lines
    ctx.strokeStyle = leatherDk; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x - 14, y - 31); ctx.lineTo(x - 7, y - 31); ctx.stroke();

    // ── LEFT ARM (screen-right, character's left) ──
    ctx.fillStyle = skin;
    ctx.fillRect(x + 8, y - 54, 5, 12);
    ctx.fillStyle = skinDk;
    ctx.fillRect(x + 8, y - 46, 5, 4);
    ctx.fillStyle = skin;
    ctx.fillRect(x + 8, y - 42, 5, 9);
    // armband on left arm
    ctx.fillStyle = leather;
    ctx.beginPath(); ctx.roundRect(x + 7, y - 47, 7, 5, 1); ctx.fill();
    ctx.strokeStyle = leatherDk; ctx.lineWidth = 0.5;
    ctx.strokeRect(x + 7, y - 47, 7, 5);
    ctx.fillStyle = leatherLt;
    ctx.fillRect(x + 8, y - 47, 2, 3);
    // gauntlet
    ctx.fillStyle = leatherDk;
    ctx.beginPath(); ctx.roundRect(x + 7, y - 35, 7, 9, 1); ctx.fill();
    ctx.fillStyle = leatherLt;
    ctx.fillRect(x + 8, y - 34, 2, 6);
    ctx.strokeStyle = leatherDk; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x + 7, y - 31); ctx.lineTo(x + 14, y - 31); ctx.stroke();

    // ── SHOULDER LEATHER PAD (left shoulder) ──
    ctx.fillStyle = leather;
    ctx.beginPath(); ctx.ellipse(x + 11, y - 53, 5, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = leatherLt;
    ctx.beginPath(); ctx.ellipse(x + 10, y - 54, 3, 1.5, -0.3, 0, Math.PI); ctx.fill();

    // ── NECK ──
    ctx.fillStyle = skin;
    ctx.fillRect(x - 3, y - 58, 6, 6);
    // neck shadow
    ctx.fillStyle = skinDk;
    ctx.fillRect(x - 3, y - 56, 1, 4);
    ctx.fillRect(x + 2, y - 56, 1, 4);

    // ── HEAD ──
    // main head oval
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse(x, y - 65, 9, 10, 0, 0, Math.PI * 2); ctx.fill();
    // jaw squaring
    ctx.fillRect(x - 7, y - 64, 14, 7);
    // chin
    ctx.beginPath(); ctx.ellipse(x, y - 58, 6, 4, 0, 0, Math.PI * 2); ctx.fill();

    // ── HAIR ──
    ctx.fillStyle = hair;
    // crown
    ctx.beginPath(); ctx.ellipse(x, y - 73, 9, 6, 0, Math.PI, 0); ctx.fill();
    // sides
    ctx.beginPath(); ctx.ellipse(x + 7, y - 68, 4, 5, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x - 7, y - 68, 4, 5, -0.3, 0, Math.PI * 2); ctx.fill();
    // hair depth
    ctx.fillStyle = hairDk;
    ctx.beginPath(); ctx.ellipse(x, y - 73, 6, 3.5, 0, Math.PI, 0); ctx.fill();
    // front tuft
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.ellipse(x - 1, y - 74, 6, 3, -0.15, Math.PI, 0); ctx.fill();

    // ── BROW / FACE ──
    // brow ridge shadow
    ctx.fillStyle = skinDk;
    ctx.fillRect(x - 6, y - 70, 5, 1.5);
    ctx.fillRect(x + 1, y - 70, 5, 1.5);

    // eyes
    ctx.fillStyle = '#1a1008';
    ctx.beginPath(); ctx.ellipse(x - 4, y - 68, 2.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 4, y - 68, 2.5, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff8f0';
    ctx.beginPath(); ctx.ellipse(x - 4, y - 68, 1.4, 1.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 4, y - 68, 1.4, 1.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3858a0';
    ctx.beginPath(); ctx.arc(x - 4, y - 68, 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 4, y - 68, 0.7, 0, Math.PI * 2); ctx.fill();

    // nose
    ctx.fillStyle = skinDk;
    ctx.beginPath();
    ctx.moveTo(x, y - 65); ctx.lineTo(x - 1.5, y - 62); ctx.lineTo(x + 1.5, y - 62);
    ctx.closePath(); ctx.fill();

    // mouth — firm line with slight upward corners
    ctx.strokeStyle = skinDk; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 60);
    ctx.quadraticCurveTo(x, y - 59, x + 3, y - 60);
    ctx.stroke();

    // jaw highlight
    ctx.fillStyle = skinDk;
    ctx.fillRect(x - 8, y - 62, 2, 6);
    ctx.fillRect(x + 6, y - 62, 2, 6);
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

  static drawWorldPlayer(ctx, cx, cy, color, accent, race = null) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.55, 0.55);
    ctx.translate(-cx, -cy);
    CharacterDrawer.drawHumanoid(ctx, cx, cy, color, accent, true, 0, race);
    ctx.restore();
  }
}
