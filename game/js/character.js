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
    return { Human:'#e0b878', Elf:'#b8d878', DarkElf:'#7060a0', Orc:'#708848', Dwarf:'#c06840' }[race] ?? '#e0b878';
  }
  static _hair(race) {
    return { Human:'#5a2808', Elf:'#c8b830', DarkElf:'#d8d8f0', Orc:'#283018', Dwarf:'#b02818' }[race] ?? '#5a2808';
  }
  static _cloth(cls) {
    return { Knight:'#3a5888', BladeWarrior:'#682818', Ranger:'#405830', Mystic:'#482870', Assassin:'#181820', Cleric:'#a88820' }[cls] ?? '#404858';
  }
  static _eye(race) {
    return { Human:'#3870b0', Elf:'#28a060', DarkElf:'#c020c0', Orc:'#903010', Dwarf:'#5030a0' }[race] ?? '#3870b0';
  }
  static _dk(hex, f = 0.60) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${Math.round(((n>>16)&255)*f)},${Math.round(((n>>8)&255)*f)},${Math.round((n&255)*f)})`;
  }
  static _lt(hex, f = 1.30) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${Math.min(255,Math.round(((n>>16)&255)*f))},${Math.min(255,Math.round(((n>>8)&255)*f))},${Math.min(255,Math.round((n&255)*f))})`;
  }

  // ── Player humanoid ──────────────────────────────────────────────
  static draw(ctx, cx, cy, race, cls, facingRight = true, animState = 'idle', animT = 0, idleT = 0) {
    const skin  = CharacterDrawer._skin(race);
    const hair  = CharacterDrawer._hair(race);
    const cloth = CharacterDrawer._cloth(cls);
    const eyeC  = CharacterDrawer._eye(race);
    const skD   = CharacterDrawer._dk(skin, 0.74);
    const skDD  = CharacterDrawer._dk(skin, 0.56);
    const clD   = CharacterDrawer._dk(cloth, 0.62);
    const clL   = CharacterDrawer._lt(cloth, 1.22);
    const isElf   = race === 'Elf' || race === 'DarkElf';
    const isOrc   = race === 'Orc';
    const isDwarf = race === 'Dwarf';
    const H = isDwarf ? 0.80 : (isOrc ? 1.07 : 1.0);

    const breathY   = animState === 'idle'   ? Math.sin(idleT * 2.2) * 1.8 : 0;
    const leanAngle = animState === 'attack' ? Math.sin(animT * Math.PI) * 0.26 : 0;
    const hitAngle  = animState === 'hit'    ? Math.sin(animT * Math.PI) * -0.22 : 0;

    ctx.save();
    ctx.translate(cx, cy);
    if (!facingRight) ctx.scale(-1, 1);
    ctx.translate(0, breathY);

    // Ground shadow (ellipse under feet)
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, -1, 17 * H, 6, 0, 0, Math.PI * 2); ctx.fill();

    ctx.rotate(leanAngle + hitAngle);

    // Proportions (all Y negative = upward from feet)
    const s       = H;
    const kneeY   = -25 * s;
    const hipY    = -43 * s;
    const waistY  = -50 * s;
    const shldrY  = -67 * s;  // shoulder
    const neckBY  = -71 * s;
    const headY   = -83 * s;
    const headRx  =  11 * s;  // head x-radius (slight oval)
    const headRy  =  12 * s;  // head y-radius
    const bW      = (isOrc ? 13 : 11) * s;  // half chest width
    const armW    = (isOrc ?  5 :  4) * s;

    // Attack step — front foot moves forward
    const stepX = animState === 'attack' ? Math.sin(animT * Math.PI) * 5 * s : 0;

    // ── BACK LEG (left leg, darker) ──
    const blx = -6 * s - stepX * 0.4;
    {
      const lg = ctx.createLinearGradient(blx - 5*s, 0, blx + 5*s, 0);
      lg.addColorStop(0, clD); lg.addColorStop(0.45, cloth); lg.addColorStop(1, clD);
      ctx.fillStyle = lg;
      // thigh
      ctx.beginPath();
      ctx.moveTo(blx - 5*s, hipY);
      ctx.quadraticCurveTo(blx - 6*s, (hipY+kneeY)*0.5, blx - 4.5*s, kneeY);
      ctx.lineTo(blx + 4.5*s, kneeY);
      ctx.quadraticCurveTo(blx + 6*s, (hipY+kneeY)*0.5, blx + 5*s, hipY);
      ctx.closePath(); ctx.fill();
      // shin
      ctx.beginPath();
      ctx.moveTo(blx - 4.5*s, kneeY);
      ctx.quadraticCurveTo(blx - 4*s, (kneeY - 6*s)*0.5, blx - 3.5*s, -6*s);
      ctx.lineTo(blx + 3.5*s, -6*s);
      ctx.quadraticCurveTo(blx + 4*s, (kneeY - 6*s)*0.5, blx + 4.5*s, kneeY);
      ctx.closePath(); ctx.fill();
      // Boot
      ctx.fillStyle = '#221408';
      ctx.beginPath();
      ctx.moveTo(blx - 4*s, -6*s); ctx.lineTo(blx - 4*s, 0);
      ctx.quadraticCurveTo(blx, 2.5*s, blx + 6.5*s, 1.5*s);
      ctx.lineTo(blx + 6*s, -6*s); ctx.closePath(); ctx.fill();
    }

    // ── BODY / TORSO ──
    {
      const bg = ctx.createLinearGradient(-bW, 0, bW, 0);
      bg.addColorStop(0, clD); bg.addColorStop(0.22, clL); bg.addColorStop(0.55, cloth); bg.addColorStop(1, clD);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(-9*s, hipY);
      ctx.bezierCurveTo(-bW, waistY, -bW - 2*s, shldrY + 10*s, -bW, shldrY);
      ctx.lineTo(bW, shldrY);
      ctx.bezierCurveTo(bW + 2*s, shldrY + 10*s, bW, waistY, 9*s, hipY);
      ctx.closePath(); ctx.fill();

      // Chest crease
      ctx.strokeStyle = clD; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, waistY); ctx.lineTo(0, shldrY); ctx.stroke();

      // Belt
      const belt = ctx.createLinearGradient(-11*s, 0, 11*s, 0);
      belt.addColorStop(0, '#1a0e06'); belt.addColorStop(0.5, '#3a2210'); belt.addColorStop(1, '#1a0e06');
      ctx.fillStyle = belt;
      ctx.fillRect(-10*s, hipY - 4*s, 20*s, 5.5*s);
      // Buckle
      ctx.fillStyle = '#c09020';
      ctx.beginPath(); ctx.roundRect(-2.8*s, hipY-4*s, 5.6*s, 5*s, 1.5); ctx.fill();
      ctx.fillStyle = '#604808'; ctx.fillRect(-1.2*s, hipY-3*s, 2.4*s, 2.5*s);

      // Shoulder pads (convex highlight)
      [[-bW, -0.15], [bW, 0.15]].forEach(([sx, tilt]) => {
        const sg = ctx.createRadialGradient(sx - 1.5*s, shldrY - 1.5*s, 1, sx, shldrY, 7*s);
        sg.addColorStop(0, clL); sg.addColorStop(0.5, cloth); sg.addColorStop(1, clD);
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.ellipse(sx, shldrY, 6.5*s, 5*s, tilt, 0, Math.PI*2); ctx.fill();
      });
    }

    // ── BACK ARM (left / off-hand) ──
    {
      const ax = -bW;
      const ag = ctx.createLinearGradient(ax - armW, 0, ax + armW, 0);
      ag.addColorStop(0, skDD); ag.addColorStop(0.42, skin); ag.addColorStop(1, skD);
      ctx.fillStyle = ag;
      // upper arm
      ctx.beginPath();
      ctx.moveTo(ax - armW, shldrY);
      ctx.quadraticCurveTo(ax - armW - s, shldrY + 14*s, ax - armW + s, shldrY + 26*s);
      ctx.lineTo(ax + armW - s, shldrY + 26*s);
      ctx.quadraticCurveTo(ax + armW, shldrY + 14*s, ax + armW, shldrY);
      ctx.closePath(); ctx.fill();
      // forearm
      ctx.beginPath();
      ctx.moveTo(ax - armW + s, shldrY + 26*s);
      ctx.quadraticCurveTo(ax - armW, shldrY + 40*s, ax - armW + 2*s, shldrY + 50*s);
      ctx.lineTo(ax + armW - 2*s, shldrY + 50*s);
      ctx.quadraticCurveTo(ax + armW, shldrY + 40*s, ax + armW - s, shldrY + 26*s);
      ctx.closePath(); ctx.fill();
      // hand
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.ellipse(ax, shldrY + 52*s, 3.5*s, 4*s, 0, 0, Math.PI*2); ctx.fill();
    }

    // ── FRONT LEG (right leg, brighter) ──
    const flx = 6 * s + stepX;
    {
      const flg = ctx.createLinearGradient(flx - 5*s, 0, flx + 5*s, 0);
      flg.addColorStop(0, clD); flg.addColorStop(0.3, clL); flg.addColorStop(0.65, cloth); flg.addColorStop(1, clD);
      ctx.fillStyle = flg;
      // thigh
      ctx.beginPath();
      ctx.moveTo(flx - 5*s, hipY);
      ctx.quadraticCurveTo(flx - 5.5*s, (hipY+kneeY)*0.5, flx - 4*s, kneeY);
      ctx.lineTo(flx + 4*s, kneeY);
      ctx.quadraticCurveTo(flx + 5.5*s, (hipY+kneeY)*0.5, flx + 5*s, hipY);
      ctx.closePath(); ctx.fill();
      // knee highlight
      const kg = ctx.createRadialGradient(flx - s, kneeY - s, 1, flx, kneeY, 4.5*s);
      kg.addColorStop(0, clL); kg.addColorStop(1, cloth);
      ctx.fillStyle = kg;
      ctx.beginPath(); ctx.ellipse(flx, kneeY, 4*s, 4.5*s, 0, 0, Math.PI*2); ctx.fill();
      // shin
      ctx.fillStyle = cloth;
      ctx.beginPath();
      ctx.moveTo(flx - 4*s, kneeY);
      ctx.quadraticCurveTo(flx - 4*s, (kneeY - 6*s)*0.5, flx - 3.5*s, -6*s);
      ctx.lineTo(flx + 3.5*s, -6*s);
      ctx.quadraticCurveTo(flx + 4*s, (kneeY - 6*s)*0.5, flx + 4*s, kneeY);
      ctx.closePath(); ctx.fill();
      // Boot
      const bootG = ctx.createLinearGradient(flx - 4*s, 0, flx + 7*s, 0);
      bootG.addColorStop(0, '#150a04'); bootG.addColorStop(0.4, '#2a1608'); bootG.addColorStop(1, '#150a04');
      ctx.fillStyle = bootG;
      ctx.beginPath();
      ctx.moveTo(flx - 4*s, -6*s); ctx.lineTo(flx - 4*s, 0);
      ctx.quadraticCurveTo(flx, 2.5*s, flx + 7*s, 1.5*s);
      ctx.lineTo(flx + 6.5*s, -6*s); ctx.closePath(); ctx.fill();
      // boot shine
      ctx.fillStyle = 'rgba(255,200,120,0.18)';
      ctx.beginPath(); ctx.ellipse(flx + s, -3*s, 2.2*s, 1.3*s, -0.2, 0, Math.PI*2); ctx.fill();
    }

    // ── WEAPON ARM (front / right — rotates on attack) ──
    const atkRot = animState === 'attack' ? Math.sin(animT * Math.PI) * 1.1 : 0;
    ctx.save();
    ctx.translate(bW, shldrY);
    ctx.rotate(atkRot);
    {
      const wag = ctx.createLinearGradient(-armW, 0, armW, 0);
      wag.addColorStop(0, skDD); wag.addColorStop(0.4, skin); wag.addColorStop(1, skD);
      ctx.fillStyle = wag;
      // upper arm
      ctx.beginPath();
      ctx.moveTo(-armW, 0);
      ctx.quadraticCurveTo(-armW - s, 14*s, -armW + s, 26*s);
      ctx.lineTo(armW - s, 26*s);
      ctx.quadraticCurveTo(armW + s, 14*s, armW, 0);
      ctx.closePath(); ctx.fill();
      // forearm
      ctx.beginPath();
      ctx.moveTo(-armW + s, 26*s);
      ctx.quadraticCurveTo(-armW, 40*s, -armW + 2*s, 50*s);
      ctx.lineTo(armW - 2*s, 50*s);
      ctx.quadraticCurveTo(armW, 40*s, armW - s, 26*s);
      ctx.closePath(); ctx.fill();
      // fist
      ctx.fillStyle = skD;
      ctx.beginPath(); ctx.ellipse(0, 52*s, 4*s, 4.5*s, 0, 0, Math.PI*2); ctx.fill();
    }
    CharacterDrawer._weapon(ctx, cls, 0, 57 * s);
    ctx.restore();

    // ── NECK ──
    {
      const ng = ctx.createLinearGradient(-3.5*s, 0, 3.5*s, 0);
      ng.addColorStop(0, skD); ng.addColorStop(0.5, skin); ng.addColorStop(1, skD);
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.moveTo(-3.5*s, neckBY);
      ctx.quadraticCurveTo(-4*s, (neckBY+headY)*0.5, -2.5*s, headY + headRy*0.7);
      ctx.lineTo(2.5*s, headY + headRy*0.7);
      ctx.quadraticCurveTo(4*s, (neckBY+headY)*0.5, 3.5*s, neckBY);
      ctx.closePath(); ctx.fill();
    }

    // ── EARS ──
    ctx.fillStyle = skin;
    if (isElf) {
      // Pointed elf ear
      ctx.beginPath(); ctx.moveTo(-headRx, headY-2); ctx.lineTo(-headRx-9, headY-11); ctx.lineTo(-headRx+1, headY+5); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo( headRx, headY-2); ctx.lineTo( headRx+9, headY-11); ctx.lineTo( headRx-1, headY+5); ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(-headRx + 1.5*s, headY, 3.8*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( headRx - 1.5*s, headY, 3.8*s, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = skD;
      ctx.beginPath(); ctx.arc(-headRx + 1.5*s, headY, 2.2*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( headRx - 1.5*s, headY, 2.2*s, 0, Math.PI*2); ctx.fill();
    }

    // ── HEAD ──
    {
      const hg = ctx.createRadialGradient(-2*s, headY - 4*s, 1.5, 0, headY, headRx * 1.3);
      hg.addColorStop(0, CharacterDrawer._lt(skin, 1.18));
      hg.addColorStop(0.55, skin);
      hg.addColorStop(1, skD);
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.ellipse(0, headY, headRx, headRy, 0, 0, Math.PI*2); ctx.fill();
    }

    // Orc tusks
    if (isOrc) {
      ctx.fillStyle = '#ddd0a0';
      ctx.beginPath(); ctx.moveTo(-3.5*s, headY+headRy-2); ctx.lineTo(-5*s, headY+headRy+9); ctx.lineTo(-1*s, headY+headRy-1); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(1*s, headY+headRy-1); ctx.lineTo(3*s, headY+headRy+9); ctx.lineTo(5*s, headY+headRy-2); ctx.closePath(); ctx.fill();
    }
    // Dwarf beard
    if (isDwarf) {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.moveTo(-7*s, headY + 5*s);
      ctx.bezierCurveTo(-10*s, headY + 12*s, -8*s, headY + 22*s, -3*s, headY + 24*s);
      ctx.quadraticCurveTo(0, headY + 26*s, 3*s, headY + 24*s);
      ctx.bezierCurveTo(8*s, headY + 22*s, 10*s, headY + 12*s, 7*s, headY + 5*s);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = CharacterDrawer._lt(hair, 1.18);
      ctx.beginPath(); ctx.ellipse(0, headY + 15*s, 2.5*s, 4*s, 0, 0, Math.PI*2); ctx.fill();
    }

    // ── FACE ──
    const eyeY = headY - 1.5*s;
    const eSpX = 3.5*s;

    if (animState === 'hit') {
      // Squinted pain eyes
      ctx.fillStyle = skD;
      ctx.beginPath(); ctx.moveTo(-eSpX-3*s, eyeY+0.5); ctx.quadraticCurveTo(-eSpX, eyeY-2.5*s, -eSpX+3*s, eyeY+0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo( eSpX-3*s, eyeY+0.5); ctx.quadraticCurveTo( eSpX, eyeY-2.5*s,  eSpX+3*s, eyeY+0.5); ctx.stroke();
      ctx.strokeStyle = '#303030'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-eSpX-2.5*s, eyeY); ctx.quadraticCurveTo(-eSpX, eyeY-2*s, -eSpX+2.5*s, eyeY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo( eSpX-2.5*s, eyeY); ctx.quadraticCurveTo( eSpX, eyeY-2*s,  eSpX+2.5*s, eyeY); ctx.stroke();
      // Pain mouth (open O)
      ctx.fillStyle = '#600';
      ctx.beginPath(); ctx.ellipse(0, headY+5*s, 3*s, 4*s, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ff8060';
      ctx.beginPath(); ctx.ellipse(0, headY+5*s, 1.8*s, 2.5*s, 0, 0, Math.PI*2); ctx.fill();
    } else {
      // ── Eyebrows ──
      ctx.strokeStyle = CharacterDrawer._dk(hair, 0.82);
      ctx.lineWidth = 2.2 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-eSpX - 3*s, eyeY - 5.5*s);
      ctx.quadraticCurveTo(-eSpX + 0.5*s, eyeY - 7.5*s, -eSpX + 3*s, eyeY - 5.5*s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(eSpX - 3*s, eyeY - 5.5*s);
      ctx.quadraticCurveTo(eSpX - 0.5*s, eyeY - 7.5*s, eSpX + 3*s, eyeY - 5.5*s);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // ── Eyes ── white sclera
      ctx.fillStyle = '#f4f0e8';
      ctx.beginPath(); ctx.ellipse(-eSpX, eyeY, 3*s, 2.4*s, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( eSpX, eyeY, 3*s, 2.4*s, 0, 0, Math.PI*2); ctx.fill();
      // iris (colored ring)
      ctx.fillStyle = eyeC;
      ctx.beginPath(); ctx.arc(-eSpX + 0.6*s, eyeY, 1.9*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( eSpX + 0.6*s, eyeY, 1.9*s, 0, Math.PI*2); ctx.fill();
      // pupil
      ctx.fillStyle = '#080606';
      ctx.beginPath(); ctx.arc(-eSpX + 0.6*s, eyeY, 1.1*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( eSpX + 0.6*s, eyeY, 1.1*s, 0, Math.PI*2); ctx.fill();
      // highlight dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(-eSpX + 1.4*s, eyeY - 0.7*s, 0.75*s, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( eSpX + 1.4*s, eyeY - 0.7*s, 0.75*s, 0, Math.PI*2); ctx.fill();

      // ── Nose ──
      ctx.fillStyle = skD;
      ctx.beginPath(); ctx.ellipse(0.5*s, headY + 2.5*s, 1.4*s, 0.9*s, 0, 0, Math.PI*2); ctx.fill();

      // ── Mouth ──
      ctx.strokeStyle = skDD; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      if (animState === 'attack') {
        // gritted teeth: straight determined line
        ctx.beginPath(); ctx.moveTo(-3*s, headY+6*s); ctx.lineTo(3*s, headY+6*s); ctx.stroke();
        // top of teeth peek
        ctx.strokeStyle = '#e8e0c0'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-2*s, headY+6*s); ctx.lineTo(2*s, headY+6*s); ctx.stroke();
      } else {
        // Relaxed confident expression
        ctx.beginPath();
        ctx.moveTo(-2.5*s, headY + 6*s);
        ctx.quadraticCurveTo(0, headY + 7.5*s, 2.5*s, headY + 6*s);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }

    // ── HAIR ──
    CharacterDrawer._drawHair(ctx, hair, headY, headRx, headRy, s, isDwarf, isElf, cls);

    // ── HEAD GEAR ──
    CharacterDrawer._headGear(ctx, cls, headY, headRx, headRy, s);

    // ── HIT FLASH ──
    if (animState === 'hit') {
      ctx.globalAlpha = Math.sin(animT * Math.PI) * 0.36;
      ctx.fillStyle = '#ff2020';
      ctx.beginPath(); ctx.ellipse(0, headY + 45*s, 20*s, 55*s, 0, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  static _drawHair(ctx, hair, headY, headRx, headRy, s, isDwarf, isElf, cls) {
    if (cls === 'Knight') return; // helm covers all hair
    const hairD = CharacterDrawer._dk(hair, 0.72);

    ctx.fillStyle = hair;
    if (isDwarf) {
      // short thick cap
      ctx.beginPath(); ctx.arc(0, headY, headRx, Math.PI * 0.68, Math.PI * 2.32); ctx.fill();
    } else if (isElf) {
      // long flowing cap + back strand
      ctx.beginPath(); ctx.arc(0, headY, headRx, Math.PI * 0.64, Math.PI * 2.36); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(headRx - 3*s, headY + 2*s);
      ctx.bezierCurveTo(headRx + 6*s, headY + 12*s, headRx + 5*s, headY + 26*s, headRx + s, headY + 28*s);
      ctx.bezierCurveTo(headRx - 5*s, headY + 24*s, headRx - 5*s, headY + 16*s, headRx - 3*s, headY + 8*s);
      ctx.closePath(); ctx.fill();
    } else {
      // Standard hair cap
      ctx.beginPath(); ctx.arc(0, headY, headRx, Math.PI * 0.70, Math.PI * 2.30); ctx.fill();
      // Hair texture strands
      ctx.strokeStyle = hairD; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-4*s, headY - headRx + 1); ctx.quadraticCurveTo(-1.5*s, headY - headRx - 1.5*s, 2*s, headY - headRx + 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8*s, headY - headRx + 4*s); ctx.quadraticCurveTo(-4*s, headY - headRx + 1.5*s, -1*s, headY - headRx + 3.5*s); ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  static _weapon(ctx, cls, hx, hy) {
    switch (cls) {
      case 'Knight': {
        // grip
        ctx.fillStyle = '#6a3810';
        ctx.fillRect(hx - 1.8, hy, 3.6, 12);
        ctx.strokeStyle = '#4a2808'; ctx.lineWidth = 0.8;
        for (let i = 2; i < 12; i += 3) { ctx.beginPath(); ctx.moveTo(hx-1.8, hy+i); ctx.lineTo(hx+1.8, hy+i); ctx.stroke(); }
        // crossguard
        const cg = ctx.createLinearGradient(hx-7, 0, hx+7, 0);
        cg.addColorStop(0,'#706050'); cg.addColorStop(0.5,'#b0a080'); cg.addColorStop(1,'#706050');
        ctx.fillStyle = cg; ctx.fillRect(hx-7, hy-2.5, 14, 4);
        // blade with metallic gradient
        const bg = ctx.createLinearGradient(hx-3, 0, hx+3, 0);
        bg.addColorStop(0,'#808898'); bg.addColorStop(0.35,'#d8dce8'); bg.addColorStop(0.65,'#c0c8d8'); bg.addColorStop(1,'#808898');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.moveTo(hx-2.5, hy-2); ctx.lineTo(hx+2.5, hy-2); ctx.lineTo(hx+1, hy-24); ctx.lineTo(hx-1, hy-24); ctx.closePath(); ctx.fill();
        // blade shine
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.moveTo(hx-0.5, hy-3); ctx.lineTo(hx+1, hy-3); ctx.lineTo(hx+0.4, hy-22); ctx.closePath(); ctx.fill();
        break;
      }
      case 'BladeWarrior': {
        ctx.fillStyle = '#5a2808'; ctx.fillRect(hx-2, hy, 4, 14);
        const cg = ctx.createLinearGradient(hx-9, 0, hx+9, 0);
        cg.addColorStop(0,'#605040'); cg.addColorStop(0.5,'#a09070'); cg.addColorStop(1,'#605040');
        ctx.fillStyle = cg; ctx.fillRect(hx-9, hy-3, 18, 5);
        const bg = ctx.createLinearGradient(hx-4, 0, hx+4, 0);
        bg.addColorStop(0,'#707880'); bg.addColorStop(0.4,'#d0d4d8'); bg.addColorStop(0.7,'#b8bcc8'); bg.addColorStop(1,'#707880');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.moveTo(hx-3.5, hy-3); ctx.lineTo(hx+3.5, hy-3); ctx.lineTo(hx+1.2, hy-32); ctx.lineTo(hx-1.2, hy-32); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.moveTo(hx-0.5, hy-4); ctx.lineTo(hx+1.5, hy-4); ctx.lineTo(hx+0.4, hy-30); ctx.closePath(); ctx.fill();
        break;
      }
      case 'Ranger': {
        // Bow
        ctx.strokeStyle = '#7a5020'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(hx + 9, hy - 6, 15, -0.65, 0.65); ctx.stroke();
        // Bowstring
        const a1x = hx + 9 + 15*Math.cos(-0.65), a1y = hy - 6 + 15*Math.sin(-0.65);
        const a2x = hx + 9 + 15*Math.cos(0.65),  a2y = hy - 6 + 15*Math.sin(0.65);
        ctx.strokeStyle = '#e8d090'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a1x, a1y); ctx.lineTo(a2x, a2y); ctx.stroke();
        // Arrow
        ctx.strokeStyle = '#8a6030'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a1x, a1y); ctx.lineTo(a2x, a2y); ctx.stroke();
        ctx.lineCap = 'butt';
        break;
      }
      case 'Mystic': {
        // Staff rod
        const rg = ctx.createLinearGradient(hx, 0, hx+4, 0);
        rg.addColorStop(0,'#3a2010'); rg.addColorStop(0.5,'#7a5030'); rg.addColorStop(1,'#3a2010');
        ctx.fillStyle = rg; ctx.fillRect(hx, hy, 4, 32);
        // Orb glow
        const og = ctx.createRadialGradient(hx+2, hy-3, 1, hx+2, hy-3, 9);
        og.addColorStop(0,'#ffffff'); og.addColorStop(0.3,'#d080ff'); og.addColorStop(0.7,'#6020c0'); og.addColorStop(1,'rgba(60,0,160,0)');
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.arc(hx+2, hy-3, 9, 0, Math.PI*2); ctx.fill();
        // Orb core
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(hx+1, hy-5, 2.5, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'Assassin': {
        // Dagger
        ctx.fillStyle = '#4a3820'; ctx.fillRect(hx-1.5, hy, 3, 9);
        const dg = ctx.createLinearGradient(hx-2, 0, hx+2, 0);
        dg.addColorStop(0,'#606068'); dg.addColorStop(0.4,'#c8ccd4'); dg.addColorStop(1,'#606068');
        ctx.fillStyle = dg;
        ctx.beginPath(); ctx.moveTo(hx-2, hy-1); ctx.lineTo(hx+2, hy-1); ctx.lineTo(hx+0.6, hy-17); ctx.lineTo(hx-0.6, hy-17); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#707888'; ctx.fillRect(hx-4, hy-2, 8, 2.5);
        break;
      }
      case 'Cleric': {
        // Mace handle
        const mg = ctx.createLinearGradient(hx-2, 0, hx+2, 0);
        mg.addColorStop(0,'#4a3010'); mg.addColorStop(0.5,'#8a6030'); mg.addColorStop(1,'#4a3010');
        ctx.fillStyle = mg; ctx.fillRect(hx-2, hy, 4, 28);
        // Mace head (flanged)
        const hg2 = ctx.createRadialGradient(hx, hy-2, 1.5, hx, hy-2, 9);
        hg2.addColorStop(0,'#c0b890'); hg2.addColorStop(0.6,'#909080'); hg2.addColorStop(1,'#505048');
        ctx.fillStyle = hg2;
        ctx.beginPath(); ctx.arc(hx, hy-2, 9, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#404038'; ctx.lineWidth = 1.2;
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          ctx.beginPath(); ctx.moveTo(hx+Math.cos(a)*9, hy-2+Math.sin(a)*9);
          ctx.lineTo(hx+Math.cos(a)*13, hy-2+Math.sin(a)*13); ctx.stroke();
        }
        break;
      }
    }
  }

  static _headGear(ctx, cls, headY, headRx, headRy, s) {
    if (cls === 'Knight') {
      // Full iron helmet with gradient
      const hg = ctx.createLinearGradient(-headRx-3, 0, headRx+3, 0);
      hg.addColorStop(0, '#484e56'); hg.addColorStop(0.3, '#8890a0'); hg.addColorStop(0.65, '#707888'); hg.addColorStop(1, '#484e56');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(0, headY, headRx + 2.5*s, Math.PI*0.72, Math.PI*2.28); ctx.fill();
      ctx.fillRect(-headRx - 2.5*s, headY - 6*s, (headRx + 2.5*s)*2, 7.5*s);
      // Nose guard ridge
      ctx.fillStyle = '#606870';
      ctx.fillRect(-1.5*s, headY - 12*s, 3*s, 8*s);
      // Visor slit
      ctx.fillStyle = '#202830';
      ctx.fillRect(-headRx, headY - 1.5*s, headRx*2, 2.5*s);
      // Rivets
      ctx.fillStyle = '#909898';
      [-headRx + 2*s, headRx - 2*s].forEach(rx => {
        ctx.beginPath(); ctx.arc(rx, headY - 9*s, 1.2*s, 0, Math.PI*2); ctx.fill();
      });
    } else if (cls === 'Mystic') {
      // Tall pointed wizard hat with gradient
      const hg = ctx.createLinearGradient(-headRx-3, 0, headRx+3, 0);
      hg.addColorStop(0,'#200840'); hg.addColorStop(0.5,'#401880'); hg.addColorStop(1,'#200840');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.moveTo(-headRx - 3*s, headY - headRy + 4*s);
      ctx.lineTo(-3*s, headY - headRy - 28*s);
      ctx.lineTo(3*s, headY - headRy - 28*s);
      ctx.lineTo(headRx + 3*s, headY - headRy + 4*s);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(-headRx - 5*s, headY - headRy + 2*s, (headRx+5*s)*2, 6*s);
      // Star on hat
      ctx.fillStyle = '#d0a020';
      ctx.beginPath(); ctx.arc(0, headY - headRy - 14*s, 2.5*s, 0, Math.PI*2); ctx.fill();
    } else if (cls === 'Ranger') {
      // Green hood
      ctx.fillStyle = CharacterDrawer._dk(CharacterDrawer._cloth('Ranger'), 0.75);
      ctx.beginPath(); ctx.arc(0, headY, headRx + 1.5*s, Math.PI*0.78, Math.PI*2.22); ctx.fill();
      ctx.fillStyle = CharacterDrawer._cloth('Ranger');
      ctx.beginPath(); ctx.arc(0, headY, headRx + 0.5*s, Math.PI*0.82, Math.PI*2.18); ctx.fill();
    } else if (cls === 'Cleric') {
      // Gold circlet
      const cg = ctx.createLinearGradient(-headRx, 0, headRx, 0);
      cg.addColorStop(0,'#806010'); cg.addColorStop(0.5,'#d0a820'); cg.addColorStop(1,'#806010');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(0, headY, headRx + 1.5*s, Math.PI*0.85, Math.PI*2.15); ctx.fill();
      ctx.fillRect(-headRx, headY - headRy, headRx*2, 6*s);
      // Gem
      ctx.fillStyle = '#d04040';
      ctx.beginPath(); ctx.arc(0, headY - headRy + 2*s, 2.5*s, 0, Math.PI*2); ctx.fill();
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
