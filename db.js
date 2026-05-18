'use strict';

const path = require('path');

let _db = null;

function getDB() {
  if (_db) return _db;

  const type = process.env.DB_TYPE || 'sqlite';
  if (type !== 'sqlite') {
    throw new Error(`DB_TYPE="${type}" is not yet supported. Use sqlite for local dev.`);
  }

  const Database = require('better-sqlite3');
  const dbPath   = path.resolve(process.env.DB_PATH || './rpg.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _initSchema(_db);
  console.log(`  DB  SQLite → ${dbPath}`);
  return _db;
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      uuid             TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      race             TEXT NOT NULL,
      cls              TEXT NOT NULL,
      level            INTEGER DEFAULT 1,
      xp               INTEGER DEFAULT 0,
      base_hp          INTEGER DEFAULT 100,
      base_atk         INTEGER DEFAULT 10,
      base_def         INTEGER DEFAULT 5,
      current_hp       INTEGER DEFAULT 100,
      gold             INTEGER DEFAULT 0,
      champion_points  INTEGER DEFAULT 0,
      world_tile_x     INTEGER DEFAULT 30,
      world_tile_y     INTEGER DEFAULT 30,
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS player_inventory (
      player_uuid  TEXT    NOT NULL,
      slot_index   INTEGER NOT NULL,
      item_json    TEXT    NOT NULL,
      PRIMARY KEY (player_uuid, slot_index),
      FOREIGN KEY (player_uuid) REFERENCES players(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_equipped (
      player_uuid  TEXT NOT NULL,
      slot_name    TEXT NOT NULL,
      item_json    TEXT NOT NULL,
      PRIMARY KEY (player_uuid, slot_name),
      FOREIGN KEY (player_uuid) REFERENCES players(uuid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS player_combos (
      player_uuid  TEXT    NOT NULL,
      combo_index  INTEGER NOT NULL,
      combo_json   TEXT    NOT NULL,
      PRIMARY KEY (player_uuid, combo_index),
      FOREIGN KEY (player_uuid) REFERENCES players(uuid) ON DELETE CASCADE
    );
  `);
}

// ── Prepared statements (lazy, cached per open DB) ───────────────────────────
let _stmts = null;

function stmts() {
  if (_stmts) return _stmts;
  const db = getDB();
  _stmts = {
    loadPlayer:     db.prepare('SELECT * FROM players WHERE uuid = ?'),
    loadInventory:  db.prepare('SELECT slot_index, item_json FROM player_inventory WHERE player_uuid = ? ORDER BY slot_index'),
    loadEquipped:   db.prepare('SELECT slot_name, item_json FROM player_equipped WHERE player_uuid = ?'),
    loadCombos:     db.prepare('SELECT combo_index, combo_json FROM player_combos WHERE player_uuid = ? ORDER BY combo_index'),
    upsertPlayer:   db.prepare(`
      INSERT INTO players (uuid, name, race, cls, level, xp, base_hp, base_atk, base_def,
        current_hp, gold, champion_points, world_tile_x, world_tile_y, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(uuid) DO UPDATE SET
        name=excluded.name, race=excluded.race, cls=excluded.cls,
        level=excluded.level, xp=excluded.xp,
        base_hp=excluded.base_hp, base_atk=excluded.base_atk, base_def=excluded.base_def,
        current_hp=excluded.current_hp, gold=excluded.gold,
        champion_points=excluded.champion_points,
        world_tile_x=excluded.world_tile_x, world_tile_y=excluded.world_tile_y,
        updated_at=datetime('now')
    `),
    delInventory:   db.prepare('DELETE FROM player_inventory WHERE player_uuid = ?'),
    insInventory:   db.prepare('INSERT INTO player_inventory (player_uuid, slot_index, item_json) VALUES (?,?,?)'),
    delEquipped:    db.prepare('DELETE FROM player_equipped WHERE player_uuid = ?'),
    insEquipped:    db.prepare('INSERT INTO player_equipped (player_uuid, slot_name, item_json) VALUES (?,?,?)'),
    delCombos:      db.prepare('DELETE FROM player_combos WHERE player_uuid = ?'),
    insCombos:      db.prepare('INSERT INTO player_combos (player_uuid, combo_index, combo_json) VALUES (?,?,?)'),
  };
  return _stmts;
}

// ── Public API ────────────────────────────────────────────────────────────────

function loadPlayer(uuid) {
  const s   = stmts();
  const row = s.loadPlayer.get(uuid);
  if (!row) return null;

  const inventoryArr = new Array(100).fill(null);
  const elixirArr    = [null, null, null, null];
  for (const r of s.loadInventory.all(uuid)) {
    const item = JSON.parse(r.item_json);
    if (r.slot_index >= 100) elixirArr[r.slot_index - 100] = item;
    else                     inventoryArr[r.slot_index]     = item;
  }

  const equippedObj = {};
  for (const r of s.loadEquipped.all(uuid)) {
    equippedObj[r.slot_name] = JSON.parse(r.item_json);
  }

  const combosArr = s.loadCombos.all(uuid).map(r => JSON.parse(r.combo_json));

  return {
    uuid:            row.uuid,
    name:            row.name,
    race:            row.race,
    cls:             row.cls,
    level:           row.level,
    xp:              row.xp,
    baseHP:          row.base_hp,
    baseAtk:         row.base_atk,
    baseDef:         row.base_def,
    currentHP:       row.current_hp,
    gold:            row.gold,
    championPoints:  row.champion_points,
    worldTileX:      row.world_tile_x,
    worldTileY:      row.world_tile_y,
    inventory:       inventoryArr,
    elixirSlots:     elixirArr,
    equipped:        equippedObj,
    combos:          combosArr,
  };
}

function savePlayer(uuid, d) {
  const s  = stmts();
  const db = getDB();

  const sanitize = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : 0);

  db.transaction(() => {
    s.upsertPlayer.run(
      uuid,
      String(d.name  || '').slice(0, 64),
      String(d.race  || '').slice(0, 32),
      String(d.cls   || '').slice(0, 32),
      sanitize(d.level),
      sanitize(d.xp),
      sanitize(d.baseHP),
      sanitize(d.baseAtk),
      sanitize(d.baseDef),
      sanitize(d.currentHP),
      sanitize(d.gold),
      sanitize(d.championPoints),
      sanitize(d.worldTileX),
      sanitize(d.worldTileY),
    );

    // Inventory (bag: 0-99, elixir: 100-103)
    s.delInventory.run(uuid);
    if (Array.isArray(d.inventory)) {
      for (let i = 0; i < Math.min(d.inventory.length, 100); i++) {
        if (d.inventory[i] != null) s.insInventory.run(uuid, i, JSON.stringify(d.inventory[i]));
      }
    }
    if (Array.isArray(d.elixirSlots)) {
      for (let i = 0; i < Math.min(d.elixirSlots.length, 4); i++) {
        if (d.elixirSlots[i] != null) s.insInventory.run(uuid, 100 + i, JSON.stringify(d.elixirSlots[i]));
      }
    }

    // Equipped
    s.delEquipped.run(uuid);
    if (d.equipped && typeof d.equipped === 'object') {
      for (const [slot, item] of Object.entries(d.equipped)) {
        if (item != null) s.insEquipped.run(uuid, slot, JSON.stringify(item));
      }
    }

    // Combos
    s.delCombos.run(uuid);
    if (Array.isArray(d.combos)) {
      for (let i = 0; i < d.combos.length; i++) {
        s.insCombos.run(uuid, i, JSON.stringify(d.combos[i]));
      }
    }
  })();
}

module.exports = { loadPlayer, savePlayer, getDB };
