# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Projects

**Tic Tac Toe:** double-click `tictactoe.html` — standalone, no server needed.

**Fantasy RPG — single player:** double-click `game/index.html` (file://, no network sync).

**Fantasy RPG — multiplayer server:**
```
npm install       # first time only — installs the 'ws' package
node server.js    # or: npm start
```
The console prints both `http://localhost:3000` and the LAN IP (e.g. `http://192.168.x.x:3000`).  
Share the LAN IP with other machines on the same WiFi/network. All browsers connect to the same server, see each other's characters, and share enemy state. The game still works as single-player when opened as `file://` — `network.js` skips the connection automatically.

There are no tests or linters. Verify changes by running the server (or opening `index.html`) and playing through the affected flow.

## Fantasy RPG Architecture (`game/`)

### Script load order (defined in `index.html`)
```
data.js → character.js → world.js → battle.js → ui.js → network.js → game.js
```
All files use `'use strict'` and expose globals (no modules). Each file depends on globals from earlier files. Always maintain this order.

### Scene state machine (`game.js`)
`Game.scene` is the single source of truth: `'charselect' | 'world' | 'battle' | 'transitioning'`. The main `requestAnimationFrame` loop branches on this string to call the active scene's `update(dt)` and `draw()`. Scene transitions always go through `UI.fadeOut()` → swap scene → `UI.fadeIn()`.

### Data layer (`data.js`)
All game constants live here — tile types, race/class stats, enemy templates, equipment, enemy spawn positions, and the 60×60 `MAP_DATA` array (built by `_buildMap()`). Nothing else should hardcode game numbers. Key globals: `TILE`, `TILE_META`, `RACE_DATA`, `CLASS_DATA`, `ENEMY_TYPES`, `ENEMY_SPAWNS`, `EQUIPMENT_TEMPLATES`, `MAP_DATA`, `MAP_W`, `MAP_H`, `TILE_SIZE`.

### Character drawing (`character.js`)
All rendering is done with primitive canvas shapes — no image assets. `CharacterDrawer` is a static class with one method per enemy type (`_goblin`, `_wolf`, `_bandit`, `_skeleton`, `_troll`, `_dragon`) and `drawHumanoid` for player races.

**Critical canvas transform rule:** Drawing functions take `(ctx, cx, cy, ...)` where `cx/cy` are the anchor coordinates in the *current* transform space. In battle mode, the caller sets up `ctx.translate(screenX, screenY); ctx.scale(±2, 2)` *before* calling `draw(ctx, 0, 0, ...)` — so draw functions receive `cx=0, cy=0`. Do **not** add flipping logic inside draw functions when called from battle; the enemy flip is handled externally via `ctx.scale(-2, 2)`.

For world-map sprites (`drawWorldSprite`, `drawWorldPlayer`), a `scale(0.55)` centered on the sprite position is applied, and `facingRight=true` must always be passed to avoid the internal flip conflicting with the outer scale.

### Combat flow (`battle.js`)
`BattleScene._resolveRound(playerDmg, enemyDmg, enemyOnly)` drives the animation state machine. Animation states are `'playerAtk' → 'enemyAtk' → 'idle'`, advanced by `animT` (0→1) in `update(dt)`. When `enemyOnly=true` (enemy goes first at battle start), the player attack phase is skipped. Damage, HP changes, and floating numbers are applied in the `_onAnimDone` callback, not during animation. `UI.setButtonsEnabled` / `UI.setTurnIndicator` are called by `battle.js` directly — do not re-enable buttons from `game.js`.

### UI layer (`ui.js`)
`UI` is a plain object (not a class) with an `init()` that caches all DOM element references into `UI._els`. It manages scene visibility (`showScene`), fade transitions, HP bar updates, the battle log, and the character select builder. The battle log auto-scrolls and caps at 40 lines.

### Network layer (`network.js` + `server.js`)
`Network` is a global plain object. `Network.connect()` is called once on game start; it no-ops when opened as `file://`. The server (Node.js HTTP + `ws` WebSocket) tracks player positions, enemy locks (one player per enemy at a time), and defeated enemies for the session. The `WorldScene` checks `Network.isEnemyLocked(idx)` and `Network.isEnemyDefeated(idx)` before allowing collision. Enemy indices are their position in `ENEMY_SPAWNS` — stable and used as the network ID. The `onBattleStart(enemy, idx)` callback now takes two arguments; `game.js` passes `idx` to `Network.sendBattleStart` and `Network.sendBattleEnd`.

### Map layout
The 60×60 map has impassable mountain borders. Player starts at tile (30, 30) (road intersection / village center). Enemy difficulty zones: top-left forest = easy (Goblin/Wolf), bottom sand = mid (Bandit/Skeleton), top-right mountains = hard (Troll/Dragon). Enemy `spawnTX/spawnTY` are tile coordinates; pixel position = `tx * TILE_SIZE + TILE_SIZE/2`.

### Adding content
- **New enemy type:** add to `ENEMY_TYPES` in `data.js`, add a `_drawXxx` method in `CharacterDrawer`, add a `case` in `drawMonster`, add spawns to `ENEMY_SPAWNS`.
- **New race/class:** add to `RACE_DATA` / `CLASS_DATA` in `data.js` — the character select UI builds itself from those objects automatically.
- **New equipment:** add to `EQUIPMENT_TEMPLATES` in `data.js` — loot rolling in `BattleScene._rollLoot()` iterates over it automatically.
