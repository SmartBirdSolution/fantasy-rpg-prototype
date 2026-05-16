# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment Workflow

Always use these two skills in order when shipping changes:

1. **`/git-commit`** — stages all changes and creates a properly formatted commit
2. **`/git-push`** — pushes to remote; reminds you to restart `server.js` if server code changed

Never skip `/git-commit` before `/git-push`. Never force-push to `main`.

## Running the Projects

**Tic Tac Toe:** double-click `tictactoe.html` — standalone, no server needed.

**Fantasy RPG — single player:** double-click `game/index.html` (file://, no network sync).

**Fantasy RPG — multiplayer server:**
```
npm install       # first time only — installs the 'ws' package
node server.js    # or: npm start
PORT=3001 node server.js   # use a different port if 3000 is taken
```
The console prints both `http://localhost:3000` and the LAN IP. Share the LAN IP with other machines on the same WiFi/network. The game works as single-player when opened as `file://` — `network.js` skips the connection automatically. The DUEL button is hidden in `file://` mode.

**Port conflict:** If port 3000 is already in use, kill lingering node processes:
```bash
for pid in $(ls /proc | grep -E '^[0-9]+$'); do exe=$(readlink /proc/$pid/exe 2>/dev/null); if [[ "$exe" == *"node"* ]]; then kill -9 $pid; fi; done
```

**Windows PATH note:** After installing Node.js, existing terminals won't see `node`/`npm`. Refresh with:
```powershell
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
```

There are no tests or linters. Verify changes by running the server and playing through the affected flow.

**Browser caching:** The server sends `Cache-Control: no-store` on all files. Script tags in `index.html` also carry a `?v=N` query string — bump N whenever JS/CSS changes need to force a cache bypass on already-open browsers.

## Fantasy RPG Architecture (`game/`)

### Script load order (defined in `index.html`)
```
data.js → character.js → world.js → battle.js → ui.js → network.js → game.js
```
All files use `'use strict'` and expose globals (no modules). Each file depends on globals from earlier files. Always maintain this order.

### Scene state machine (`game.js`)
`Game.scene` is the single source of truth: `'charselect' | 'world' | 'battle' | 'duel' | 'city' | 'transitioning'`. The main `requestAnimationFrame` loop branches on this string. Scene transitions always go through `UI.fadeOut()` → swap scene → `UI.fadeIn()`.

- `worldScene.startBattleCooldown()` must be called whenever returning to world from combat (PvE or duel).
- `worldScene.startCityCooldown()` must be called when leaving the city and on initial world spawn — prevents the city prompt from firing immediately.

### Data layer (`data.js`)
All game constants live here. Key globals: `TILE`, `TILE_META`, `RACE_DATA`, `CLASS_DATA`, `ENEMY_TYPES`, `ENEMY_SPAWNS`, `EQUIPMENT_TEMPLATES`, `MAP_DATA`, `MAP_W`, `MAP_H`, `TILE_SIZE`.

- **`CLASS_DATA`** includes `baseRegen` (HP regen points per class, used by `PlayerCharacter.regenRate`).
- **`EQUIPMENT_TEMPLATES`** currently only contains `HealthBottle` (`slot: 'consumable'`, `hotHps: 5`, `hotDuration: 5`). There are no equipment items — the 8-slot equip UI exists but is unused.
- **Map layout:** 60×60 tiles, impassable mountain borders. Player starts at tile (30,30). Easy zone: top-left forest (Goblin/Wolf). Mid zone: bottom sand (Bandit/Skeleton). Hard zone: top-right mountains (Troll/Dragon) — reachable via carved grass clearings: entrance (rows 20-26, cols 36-42) → mid (rows 10-22, cols 40-51) → deep (rows 2-12, cols 49-57).
- **Village:** tiles rows 27–33, cols 27–33. Roads cross at row 30 / col 30. City center pixel: `(30 * TILE_SIZE + TILE_SIZE/2, 30 * TILE_SIZE + TILE_SIZE/2)`.

### Character system (`character.js`)
`Character` is the base class. `PlayerCharacter` extends it with:
- **Inventory:** `inventory[100]` array (null = empty slot). Methods: `addToInventory(item)`, `equipFromInventory(invIdx)`, `unequipSlot(slot)`, `useFromInventory(invIdx)`, `removeFromInventory(invIdx)`.
- **Gold:** `player.gold` is the source of truth. Always update via `player.addGold(amount)` — this increments `player.gold` AND keeps a single stacked `{ slot:'gold' }` item in inventory synced to the total. Deleting the inventory gold item also zeroes `player.gold`.
- **Regen:** `regenRate` getter returns `_baseRegen * 0.5` HP/s. Accumulated in `Game._regenAccum` (float buffer, whole-point increments only).
- **HoT:** `_hotHps` and `_hotRemaining` fields. Set by `useFromInventory` when an item has `hotHps`. Ticked in `Game._loop` via `Game._hotAccum` (same float-buffer pattern as regen).
- **Champion points:** `player.championPoints` — incremented by `DuelBattleScene._endDuel` on win.

`EnemyCharacter` and `CharacterDrawer` live in the same file. All rendering uses primitive canvas shapes — no image assets.

**Critical canvas transform rule:** Drawing functions take `(ctx, cx, cy, ...)` in the *current* transform space. In battle mode, the caller sets `ctx.translate(screenX, screenY); ctx.scale(±2, 2)` before calling `draw(ctx, 0, 0, ...)`. Do not add flip logic inside draw functions called from battle; enemy flip is done externally via `ctx.scale(-2, 2)`.

### Combat flow (`battle.js`)
Two classes live here: `BattleScene` (PvE) and `DuelBattleScene` (PvP).

**BattleScene:** `_resolveRound(playerDmg, enemyDmg, enemyOnly)` drives the animation state machine (`'playerAtk' → 'enemyAtk' → 'idle'`). Damage/HP changes happen in `_onAnimDone`, not during animation. Attack UI is canvas-based — `_zoneRects()` returns HEAD/BODY/LEGS hit areas; `zonesActive` gates clicks. `BattleScene.destroy()` removes canvas listeners — always call it when tearing down early. On win: `player.addGold(gold)` and `_rollLoot()` (25% Health Bottle). On loss: player respawns with 50% HP, regen kicks in.

**DuelBattleScene:** Alternating turn-based PvP. Server-authoritative damage via `duel_zone` → `duel_attack` messages. `_activateMyTurn()` / `_setWaiting()` control the 90-second per-turn countdown (display only; server enforces it). Defense is a persistent toggle — `playerDefending` reduces both outgoing and incoming damage by 50%. Player HP is restored to `maxHP` in `game.js` before duel starts.

**Defense toggle ownership:** `battle.js` owns all `UI.setDefenseEnabled` / `UI.setDefenseActive` calls during battle/duel. Do not call them from `game.js`.

**Loot:** `_rollLoot()` returns an array (0 or 1 Health Bottle at 25% chance).

### City system (`world.js` + `game.js` + `server.js`)
DION is the single city. Entering hides the player from the global map; leaving spawns them at tile (34, 30) — just east of the village gate on the road.

**Proximity trigger:** `WorldScene._checkCollisions` computes pixel distance from the player to city center. When `distToCity < TILE_SIZE * 2` (64 px), it fires `onCityPrompt(screenX, screenY)` once per approach (guarded by `_cityPromptShown`). When the player walks away while the prompt is open, `onCityPromptDismiss` fires automatically and `_cityCooldown` is set to prevent re-triggering.

**Callbacks wired in `game.js`:**
- `worldScene.onCityPrompt` → `UI.showCityPrompt()`
- `worldScene.onCityPromptDismiss` → `UI.hideCityPrompt()`

**Server city state:** `cityPlayers` Set in `server.js`. On `city_enter`: adds player, broadcasts `player_update` (scene `'city'`) so other clients hide them, broadcasts `city_population` to ALL connected players. On `city_leave`: removes player, broadcasts updated population. Welcome message includes `cityPopulation` so newly joined players see the correct count. `Network.cityPopulation` is the live count; `WorldScene._drawCityLabel` reads it for the map overlay.

**City player filtering:** `WorldScene._handleCanvasClick` and `_drawRemotePlayers` both `continue` on `p.scene === 'city'` — city players are fully invisible and non-interactable on the world map.

### UI layer (`ui.js`)
`UI` is a plain object with `init()` that caches DOM refs into `UI._els`. Manages scene visibility, fades, HP bars, battle log (auto-scrolls, capped at 40 lines), character select, inventory popup, and trade window.

**Inventory popup:** Three-column layout — equipment slots (left), character canvas preview (center), 10×10 bag grid (right). Context menu (`#inv-context-menu`) is positioned fixed at click coordinates. Gold items show only "Delete"; consumables show only "Use"; equipment items show "Wear" (currently unreachable since no equipment drops). The context-menu click-outside listener is registered once in `UI.init()`.

**`UI.showScene()`** always hides the city prompt — no explicit cleanup needed on scene transition.

### Network layer (`network.js` + `server.js`)
`Network` is a global plain object. Callbacks set by game layer: `onDuelStart`, `onDuelAttack`, `onDuelForfeit`, `onCityPopulation`, and the full set of `onTradeXxx` callbacks.

The server tracks: player positions, enemy locks (one player per enemy), defeated enemies, city players, trade sessions, duel queue, and active duel sessions.

**Duel flow:** `sendDuelQueue(stats)` → server matches two players → `duel_start` sent to both → `DuelBattleScene` created → player clicks zone → `sendDuelZone(sessionId, zone, defending)` → server calls `calcDuelDmg` (applies 0.5× for each defending player) → `duel_attack` broadcast → repeat until HP ≤ 0. Disconnect awards forfeit win + XP to the remaining player.

**Enemy locking:** Enemy indices are their position in `ENEMY_SPAWNS` (stable network ID). `WorldScene` checks `Network.isEnemyLocked(idx)` and `Network.isEnemyDefeated(idx)` before allowing collision.

**Trade flow:** `sendTradeRequest(toId)` → receiver accepts → server creates session → `trade_accepted` with `sessionId` sent to both → each side sends `sendTradeOffer(sessionId, items)` → both confirm → server sends `trade_complete` with `receivedItems` to each.

**Critical item serialization rule:** When building a trade offer payload, always spread the full item object (`{ ...item, invIdx }`). Never hand-pick fields like `{ name, slot, amount }` — this silently drops `hotHps`, `hotDuration`, and any other properties the item needs to function after the trade.

### Adding content
- **New enemy type:** add to `ENEMY_TYPES` in `data.js`, add `_drawXxx` in `CharacterDrawer`, add a `case` in `drawMonster`, add spawns to `ENEMY_SPAWNS`.
- **New race/class:** add to `RACE_DATA` / `CLASS_DATA` in `data.js` (include `baseRegen`) — character select builds itself automatically.
- **New consumable item:** add to `EQUIPMENT_TEMPLATES` in `data.js` with `slot: 'consumable'` and either `hotHps`+`hotDuration` (HoT) or `healFraction`/`healAmount` (instant). `_rollLoot()` in `battle.js` must be updated to include it.
- **New equipment item:** add to `EQUIPMENT_TEMPLATES`, update `_rollLoot()`, and update `PlayerCharacter.maxHP`/`totalAtk`/`totalDef` getters in `character.js` if new stat bonuses are introduced.
