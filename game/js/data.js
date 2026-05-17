'use strict';

// ── TILE CONSTANTS ──────────────────────────────────────────────────
const TILE = { GRASS:0, FOREST:1, WATER:2, ROAD:3, VILLAGE:4, MOUNTAIN:5, SAND:6 };

const TILE_META = {
  [TILE.GRASS]:    { walkable: true,  color: '#3a7d44', border: '#2d6235' },
  [TILE.FOREST]:   { walkable: false, color: '#1a5c2a', border: '#124820' },
  [TILE.WATER]:    { walkable: false, color: '#1a5a8a', border: '#104570' },
  [TILE.ROAD]:     { walkable: true,  color: '#b8a070', border: '#9a8455' },
  [TILE.VILLAGE]:  { walkable: true,  color: '#c4a35a', border: '#a8843a' },
  [TILE.MOUNTAIN]: { walkable: false, color: '#6a6a7a', border: '#505060' },
  [TILE.SAND]:     { walkable: true,  color: '#c8b878', border: '#aca060' },
};

// ── MAP DATA (60×60) ────────────────────────────────────────────────
// Zones:
//  Top-left  (rows 2-26, cols 2-24): FOREST — easy enemies
//  Center    (rows 20-40, cols 20-40): GRASS + ROAD + VILLAGE
//  Bottom    (rows 38-57, cols 8-50): SAND — mid enemies
//  Top-right (rows 2-24, cols 36-57): MOUNTAIN + sparse FOREST — hard enemies
//  Right     (rows 30-57, cols 48-57): WATER lake
//  Road      row 30 (horizontal) + col 30 (vertical)
//  Player start: (30, 30)
function _buildMap() {
  const M = TILE.MOUNTAIN, G = TILE.GRASS, F = TILE.FOREST,
        W = TILE.WATER,    R = TILE.ROAD,  V = TILE.VILLAGE,
        S = TILE.SAND;

  // Build a 60×60 default all-grass map
  const map = [];
  for (let r = 0; r < 60; r++) {
    map.push(new Array(60).fill(G));
  }

  const set = (r, c, t) => { if (r >= 0 && r < 60 && c >= 0 && c < 60) map[r][c] = t; };
  const fill = (r1, c1, r2, c2, t) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) set(r, c, t);
  };

  // Border mountains
  fill(0, 0, 1, 59, M);
  fill(58, 0, 59, 59, M);
  fill(0, 0, 59, 1, M);
  fill(0, 58, 59, 59, M);

  // ── Forest zone (top-left) ──
  fill(2, 2, 26, 24, F);
  // Clearings in forest
  fill(7, 7, 9, 9, G);
  fill(14, 5, 16, 8, G);
  fill(20, 12, 22, 15, G);
  fill(10, 18, 12, 22, G);
  fill(4, 14, 6, 18, G);

  // ── Mountain zone (top-right) ──
  fill(2, 36, 26, 57, M);
  // Grass paths and clearings through the mountains (reachable from south)
  fill(20, 36, 26, 42, G);   // entrance corridor from south
  fill(10, 40, 22, 51, G);   // large mid clearing
  fill(2,  49, 12, 57, G);   // deep north clearing for hard enemies

  // ── Sand zone (bottom) ──
  fill(38, 4, 57, 54, S);
  // Grass patches in sand
  fill(42, 10, 45, 16, G);
  fill(48, 20, 51, 26, G);
  fill(44, 34, 47, 40, G);
  fill(52, 38, 55, 46, G);

  // ── Water lake (right side) ──
  fill(30, 50, 57, 57, W);
  // Shore sand around lake
  fill(28, 49, 29, 57, S);

  // ── Road network ──
  // Horizontal road at row 30
  for (let c = 2; c <= 57; c++) if (map[30][c] !== W && map[30][c] !== M) set(30, c, R);
  // Vertical road at col 30
  for (let r = 2; r <= 57; r++) if (map[r][30] !== W && map[r][30] !== M) set(r, 30, R);
  // Small road spur top-left
  for (let c = 10; c <= 30; c++) if (map[16][c] !== M && map[16][c] !== F) set(16, c, R);

  // ── Village (center) ──
  fill(27, 27, 33, 33, V);
  // Keep road crossing through village
  for (let c = 27; c <= 33; c++) set(30, c, R);
  for (let r = 27; r <= 33; r++) set(r, 30, R);

  // ── Grass buffer zones around roads ──
  // Transition strip between forest and center
  fill(24, 2, 28, 26, G);
  fill(24, 34, 28, 36, G);

  // ── Grass center zone ──
  fill(16, 24, 36, 26, G);
  fill(16, 34, 36, 36, G);
  fill(2, 24, 16, 36, G);
  fill(16, 24, 30, 36, G);

  return map;
}

const MAP_DATA = _buildMap();
const MAP_W = 60, MAP_H = 60, TILE_SIZE = 32;

// ── RACE DATA ───────────────────────────────────────────────────────
const RACE_DATA = {
  Human:   { hpMod:  0, atkMod:  0, defMod:  0, spdMod:  0, color: '#e8c99a', accent: '#b89060', desc: 'Balanced' },
  Elf:     { hpMod:-10, atkMod:  2, defMod: -1, spdMod:  3, color: '#c8e8a0', accent: '#88b850', desc: 'Fast & fragile' },
  DarkElf: { hpMod: -5, atkMod:  4, defMod: -2, spdMod:  2, color: '#9080b8', accent: '#5040a0', desc: 'High attack' },
  Orc:     { hpMod: 20, atkMod:  3, defMod:  2, spdMod: -2, color: '#70a058', accent: '#3a7030', desc: 'Tough brawler' },
  Dwarf:   { hpMod: 15, atkMod:  1, defMod:  4, spdMod: -1, color: '#c87040', accent: '#903820', desc: 'Iron defense' },
};

// ── CLASS DATA ──────────────────────────────────────────────────────
const CLASS_DATA = {
  Knight:       { baseHP: 120, baseAtk: 12, baseDef: 10, baseSpd:  7, baseRegen: 1.0, desc: 'Balanced tank' },
  BladeWarrior: { baseHP: 100, baseAtk: 16, baseDef:  7, baseSpd:  9, baseRegen: 1.5, desc: 'High damage dealer' },
  Ranger:       { baseHP:  90, baseAtk: 14, baseDef:  6, baseSpd: 12, baseRegen: 2.0, desc: 'Swift striker' },
  Mystic:       { baseHP:  80, baseAtk: 18, baseDef:  5, baseSpd:  8, baseRegen: 1.0, desc: 'Glass cannon' },
  Assassin:     { baseHP:  85, baseAtk: 15, baseDef:  5, baseSpd: 14, baseRegen: 2.5, desc: 'Fastest attacker' },
  Cleric:       { baseHP: 110, baseAtk: 10, baseDef:  8, baseSpd:  6, baseRegen: 3.0, desc: 'Resilient fighter' },
};

// ── ENEMY TYPES ─────────────────────────────────────────────────────
const ENEMY_TYPES = {
  Goblin:   { level:  1, baseHP:  35, baseAtk:  7, baseDef:  2, spd:  6, xp:  25, gold:  6, zone: 'easy', color: '#58a040', accent: '#305828', respawnTime: 30 },
  Wolf:     { level:  3, baseHP:  55, baseAtk: 10, baseDef:  4, spd:  9, xp:  45, gold: 10, zone: 'easy', color: '#7a6a58', accent: '#504030', respawnTime: 40 },
  Bandit:   { level:  5, baseHP:  70, baseAtk: 14, baseDef:  6, spd:  8, xp:  70, gold: 18, zone: 'mid',  color: '#8a5830', accent: '#402810', respawnTime: 45 },
  Skeleton: { level:  7, baseHP:  85, baseAtk: 17, baseDef:  8, spd:  7, xp: 100, gold: 24, zone: 'mid',  color: '#d0d0b0', accent: '#a0a080', respawnTime: 50 },
  Troll:    { level: 10, baseHP: 130, baseAtk: 22, baseDef: 13, spd:  5, xp: 160, gold: 40, zone: 'hard', color: '#588040', accent: '#304820', respawnTime: 60 },
  Dragon:   { level: 15, baseHP: 210, baseAtk: 32, baseDef: 20, spd:  7, xp: 320, gold: 90, zone: 'hard', color: '#c03020', accent: '#800800', respawnTime: 90 },
};

// ── ENEMY SPAWN LIST ────────────────────────────────────────────────
const ENEMY_SPAWNS = [
  // Easy zone — forest clearings (top-left)
  { type: 'Goblin',   tx:  8, ty:  8  },  // clearing (7-9, 7-9)
  { type: 'Goblin',   tx: 15, ty:  5  },  // clearing (4-6, 14-18)
  { type: 'Goblin',   tx:  5, ty: 15  },  // clearing (14-16, 5-8)
  { type: 'Goblin',   tx: 18, ty: 10  },  // clearing (10-12, 18-22)
  { type: 'Goblin',   tx: 13, ty: 21  },  // clearing (20-22, 12-15)
  { type: 'Wolf',     tx: 17, ty:  5  },  // clearing (4-6, 14-18)
  { type: 'Wolf',     tx: 12, ty: 22  },  // clearing (20-22, 12-15)
  { type: 'Wolf',     tx: 19, ty: 11  },  // clearing (10-12, 18-22)
  { type: 'Wolf',     tx: 21, ty: 10  },  // clearing (10-12, 18-22)
  // Mid zone — sand (bottom)
  { type: 'Bandit',   tx: 15, ty: 42  },
  { type: 'Bandit',   tx: 25, ty: 46  },
  { type: 'Bandit',   tx: 35, ty: 43  },
  { type: 'Bandit',   tx: 20, ty: 52  },
  { type: 'Skeleton', tx: 30, ty: 48  },
  { type: 'Skeleton', tx: 38, ty: 50  },
  { type: 'Skeleton', tx: 12, ty: 50  },
  { type: 'Skeleton', tx: 43, ty: 44  },
  // Hard zone — mountain clearings (top-right)
  { type: 'Troll',    tx: 38, ty: 23  },  // entrance clearing
  { type: 'Troll',    tx: 44, ty: 16  },  // mid clearing
  { type: 'Troll',    tx: 47, ty: 18  },  // mid clearing
  { type: 'Dragon',   tx: 52, ty:  7  },  // deep clearing
  { type: 'Dragon',   tx: 51, ty: 10  },  // deep clearing
];

// ── ITEMS ────────────────────────────────────────────────────────────
const EQUIPMENT_TEMPLATES = {
  // Consumables
  HealthBottle:  { slot: 'consumable', name: 'Health Bottle',   hotHps: 5,   hotDuration: 5 },

  // Weapons
  IronSword:     { slot: 'mainHand',   name: 'Iron Sword',      atkBonus: 5  },
  SteelSword:    { slot: 'mainHand',   name: 'Steel Sword',     atkBonus: 11 },

  // Off-hand
  WoodenShield:  { slot: 'offHand',    name: 'Wooden Shield',   defBonus: 3  },
  IronShield:    { slot: 'offHand',    name: 'Iron Shield',     defBonus: 6  },

  // Armor
  LeatherHelm:   { slot: 'helmet',     name: 'Leather Helm',    defBonus: 2  },
  IronHelm:      { slot: 'helmet',     name: 'Iron Helm',       defBonus: 5  },
  Chainmail:     { slot: 'chainmail',   name: 'Chainmail',       defBonus: 5, hpBonus: 15 },
  PlateArmor:    { slot: 'body',       name: 'Plate Armor',     defBonus: 9, hpBonus: 25 },
  LeatherLegs:   { slot: 'legs',       name: 'Leather Legs',    defBonus: 2  },
  IronLegs:      { slot: 'legs',       name: 'Iron Legs',       defBonus: 4  },
  LeatherBoots:  { slot: 'boots',      name: 'Leather Boots',   defBonus: 1  },
  IronBoots:     { slot: 'boots',      name: 'Iron Boots',      defBonus: 3  },
  LeatherBelt:   { slot: 'belt',       name: 'Leather Belt',    defBonus: 1  },
  IronBelt:      { slot: 'belt',       name: 'Iron Belt',       defBonus: 2  },
  LeatherShoulders: { slot: 'shoulders', name: 'Leather Shoulders', defBonus: 2 },
  IronShoulders:    { slot: 'shoulders', name: 'Iron Shoulders',    defBonus: 4 },
};

// ── LEVEL HELPERS ───────────────────────────────────────────────────
function xpToNextLevel(level) { return level * 100; }
