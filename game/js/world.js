'use strict';

class WorldScene {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.player = player;

    this.px = player.worldTileX * TILE_SIZE + TILE_SIZE / 2;
    this.py = player.worldTileY * TILE_SIZE + TILE_SIZE / 2;

    this.cam   = { x: 0, y: 0 };
    this.keys  = {};
    this.enemies = [];
    this.speed   = 120;

    this.onBattleStart = null; // callback(enemy, enemyIdx)
    this._battleCooldown = 0;

    this.onCityPrompt = null;   // callback() — show "Enter Dion?" popup
    this._cityCooldown    = 0;
    this._cityPromptShown = false; // prevent re-triggering while prompt is open

    this._keyDown = e => { this.keys[e.code] = true; };
    this._keyUp   = e => { this.keys[e.code] = false; };
    this.onPeerClick = null; // callback(peerId, peerName, canvasX, canvasY)
    this._canvasClick = e => this._handleCanvasClick(e);
  }

  init() {
    this.enemies = ENEMY_SPAWNS.map((s, i) => {
      const e = new EnemyCharacter(s.type, s.tx, s.ty);
      e.idx = i; // stable network ID
      return e;
    });

    // Apply server-known defeated enemies from this session
    for (let i = 0; i < this.enemies.length; i++) {
      if (Network.isEnemyDefeated(i)) this.enemies[i].defeated = true;
    }

    window.addEventListener('keydown', this._keyDown);
    window.addEventListener('keyup',   this._keyUp);
    this.canvas.addEventListener('click', this._canvasClick);
    this._snapCamera();
  }

  destroy() {
    window.removeEventListener('keydown', this._keyDown);
    window.removeEventListener('keyup',   this._keyUp);
    this.canvas.removeEventListener('click', this._canvasClick);
  }

  // Convert a canvas-space click to world coords and check proximity to peers
  _handleCanvasClick(e) {
    // Close context menu if already open and user clicks elsewhere
    const menu = document.getElementById('player-context-menu');
    if (menu.style.display !== 'none') {
      UI.hidePlayerContextMenu();
      return;
    }

    const rect   = this.canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert to world pixel coords (account for camera)
    const worldX = clickX + this.cam.x;
    const worldY = clickY + this.cam.y;

    const PROXIMITY_PX = 2 * TILE_SIZE; // ~2 tiles
    const HIT_RADIUS   = 20;            // pixel hit radius for avatar

    for (const p of Network.remotePlayers.values()) {
      if (!p.race) continue;
      if (p.scene === 'city') continue; // in city — no interaction on world map
      // p.x and p.y are world pixel coords (as sent by sendMove)
      const dist = Math.hypot(worldX - p.x, worldY - p.y);
      // Check proximity of LOCAL player to the remote peer
      const localDist = Math.hypot(this.px - p.x, this.py - p.y);
      if (dist < HIT_RADIUS && localDist < PROXIMITY_PX) {
        if (this.onPeerClick) {
          this.onPeerClick(p.id, p.name, e.clientX, e.clientY);
        }
        return;
      }
    }
  }

  startBattleCooldown() {
    this._battleCooldown = 1.5;
  }

  startCityCooldown() {
    this._cityCooldown    = 3;
    this._cityPromptShown = false;
  }

  dismissCityPrompt(longCooldown) {
    this._cityPromptShown = false;
    this._cityCooldown = longCooldown ? 4 : 0;
  }

  update(dt) {
    if (this._battleCooldown > 0) this._battleCooldown -= dt;
    if (this._cityCooldown > 0) this._cityCooldown -= dt;
    this._movePlayer(dt);
    this._lerpCamera();

    // Keep local defeated state in sync with network
    for (let i = 0; i < this.enemies.length; i++) {
      if (!this.enemies[i].defeated && Network.isEnemyDefeated(i)) {
        this.enemies[i].defeated = true;
      }
    }

    if (this._battleCooldown <= 0 && this._cityCooldown <= 0) this._checkCollisions();
  }

  _movePlayer(dt) {
    let dx = 0, dy = 0;
    if (this.keys['ArrowLeft']  || this.keys['KeyA']) dx -= 1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) dx += 1;
    if (this.keys['ArrowUp']    || this.keys['KeyW']) dy -= 1;
    if (this.keys['ArrowDown']  || this.keys['KeyS']) dy += 1;

    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

    const step = this.speed * dt;
    const nx = this.px + dx * step;
    const ny = this.py + dy * step;

    if (this._walkable(nx, this.py)) this.px = nx;
    if (this._walkable(this.px, ny)) this.py = ny;

    this.player.worldTileX = Math.floor(this.px / TILE_SIZE);
    this.player.worldTileY = Math.floor(this.py / TILE_SIZE);
  }

  _walkable(px, py) {
    const hw = 10;
    return [[-hw,-hw],[hw,-hw],[-hw,hw],[hw,hw]].every(([ox,oy]) => {
      const tx = Math.floor((px + ox) / TILE_SIZE);
      const ty = Math.floor((py + oy) / TILE_SIZE);
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return false;
      return TILE_META[MAP_DATA[ty][tx]].walkable;
    });
  }

  _snapCamera() {
    const vw = this.canvas.width, vh = this.canvas.height;
    this.cam.x = Math.max(0, Math.min(MAP_W * TILE_SIZE - vw, this.px - vw / 2));
    this.cam.y = Math.max(0, Math.min(MAP_H * TILE_SIZE - vh, this.py - vh / 2));
  }

  _lerpCamera() {
    const vw = this.canvas.width, vh = this.canvas.height;
    const tx = Math.max(0, Math.min(MAP_W * TILE_SIZE - vw, this.px - vw / 2));
    const ty = Math.max(0, Math.min(MAP_H * TILE_SIZE - vh, this.py - vh / 2));
    this.cam.x += (tx - this.cam.x) * 0.12;
    this.cam.y += (ty - this.cam.y) * 0.12;
  }

  _checkCollisions() {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.defeated) continue;
      if (Network.isEnemyLocked(i)) continue; // another player is fighting it
      const ex = e.spawnTX * TILE_SIZE + TILE_SIZE / 2;
      const ey = e.spawnTY * TILE_SIZE + TILE_SIZE / 2;
      if (Math.hypot(this.px - ex, this.py - ey) < 26) {
        if (this.onBattleStart) this.onBattleStart(e, i);
        break;
      }
    }

    // City entry: fire when player walks into the village bounding box (rows 27-33, cols 27-33)
    const tx = Math.floor(this.px / TILE_SIZE);
    const ty = Math.floor(this.py / TILE_SIZE);
    if (tx >= 27 && tx <= 33 && ty >= 27 && ty <= 33 && !this._cityPromptShown) {
      this._cityPromptShown = true;
      if (this.onCityPrompt) {
        // Pass the city's screen position so the menu appears near it
        const ts = TILE_SIZE;
        const screenX = (30 * ts + ts / 2) - this.cam.x; // center of village
        const screenY = (30 * ts + ts / 2) - this.cam.y; // center of village
        this.onCityPrompt(screenX, screenY);
      }
    }
  }

  // ── DRAW ──────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(-Math.floor(this.cam.x), -Math.floor(this.cam.y));

    this._drawTiles();
    this._drawCityLabel(ctx);
    this._drawEnemies();
    this._drawRemotePlayers();
    this._drawPlayer();

    ctx.restore();
  }

  _drawTiles() {
    const ctx = this.ctx;
    const ts  = TILE_SIZE;
    const startX = Math.max(0, Math.floor(this.cam.x / ts) - 1);
    const startY = Math.max(0, Math.floor(this.cam.y / ts) - 1);
    const endX   = Math.min(MAP_W - 1, Math.ceil((this.cam.x + this.canvas.width)  / ts));
    const endY   = Math.min(MAP_H - 1, Math.ceil((this.cam.y + this.canvas.height) / ts));

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const tileType = MAP_DATA[ty][tx];
        const meta     = TILE_META[tileType];
        const px = tx * ts, py = ty * ts;

        ctx.fillStyle = meta.color;
        ctx.fillRect(px, py, ts, ts);

        ctx.strokeStyle = meta.border;
        ctx.lineWidth   = 0.4;
        ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);

        if (tileType === TILE.FOREST)   this._drawTree(ctx, px + ts/2, py + ts/2 - 2, tx, ty);
        if (tileType === TILE.MOUNTAIN) this._drawPeak(ctx, px + ts/2, py + ts);
        if (tileType === TILE.WATER)    this._drawWave(ctx, px, py, ts);
      }
    }
  }

  _drawTree(ctx, cx, cy, tx, ty) {
    const seed = (tx * 7 + ty * 13) % 4;
    const h = 10 + seed * 2;
    ctx.fillStyle = '#0d3a18';
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx - 7 + seed, cy + 2);
    ctx.lineTo(cx + 7 - seed, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3d1a08';
    ctx.fillRect(cx - 2, cy + 2, 4, 4);
  }

  _drawPeak(ctx, cx, cy) {
    ctx.fillStyle = '#9090a0';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 22);
    ctx.lineTo(cx - 12, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#dde';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 22);
    ctx.lineTo(cx - 5, cy - 14);
    ctx.lineTo(cx + 5, cy - 14);
    ctx.closePath();
    ctx.fill();
  }

  _drawWave(ctx, px, py, ts) {
    ctx.strokeStyle = 'rgba(150,220,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px + 4, py + ts/2);
    ctx.quadraticCurveTo(px + ts/3, py + ts/2 - 4, px + ts/2, py + ts/2);
    ctx.quadraticCurveTo(px + ts*2/3, py + ts/2 + 4, px + ts - 4, py + ts/2);
    ctx.stroke();
  }

  _drawHouse(ctx, cx, cy, tx, ty) {
    const seed = (tx * 5 + ty * 11) % 3;
    if (seed !== 0) return;
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(cx - 8, cy - 4, 16, 10);
    ctx.fillStyle = '#c03020';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 14);
    ctx.lineTo(cx - 10, cy - 4);
    ctx.lineTo(cx + 10, cy - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6aafff';
    ctx.fillRect(cx - 3, cy - 2, 6, 6);
  }

  _drawCityLabel(ctx) {
    const ts = TILE_SIZE;
    // Draw the city centered on the village block (col 30, rows 27-33)
    const cx = 30 * ts + ts / 2;  // horizontal center
    const cy = 30 * ts;            // vertical center of village

    // ── City gate / building ──────────────────────────────
    // Main wall
    ctx.fillStyle = '#9a8060';
    ctx.fillRect(cx - 36, cy - 14, 72, 28);
    // Gate arch
    ctx.fillStyle = '#3a2a10';
    ctx.beginPath();
    ctx.arc(cx, cy + 14, 9, Math.PI, 0);
    ctx.fillRect(cx - 9, cy + 5, 18, 9);
    ctx.fill();
    // Left tower
    ctx.fillStyle = '#b09070';
    ctx.fillRect(cx - 46, cy - 22, 18, 36);
    ctx.fillStyle = '#786040';
    ctx.fillRect(cx - 48, cy - 30, 22, 10);
    // Right tower
    ctx.fillStyle = '#b09070';
    ctx.fillRect(cx + 28, cy - 22, 18, 36);
    ctx.fillStyle = '#786040';
    ctx.fillRect(cx + 26, cy - 30, 22, 10);
    // Battlements left
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#786040';
      ctx.fillRect(cx - 46 + i * 8, cy - 34, 5, 6);
    }
    // Battlements right
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#786040';
      ctx.fillRect(cx + 28 + i * 8, cy - 34, 5, 6);
    }

    // ── DION nameplate — anchored above gate ──────────────
    const pop = Network.cityPopulation || 0;
    const labelY = cy - 42;

    ctx.fillStyle = 'rgba(0,0,0,0.80)';
    ctx.fillRect(cx - 36, labelY - 18, 72, 30);
    ctx.strokeStyle = '#8a6a20';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 36, labelY - 18, 72, 30);

    ctx.fillStyle = '#f0d070';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('DION', cx, labelY - 4);

    ctx.fillStyle = '#88bb88';
    ctx.font = '7px monospace';
    ctx.fillText(pop + ' inside', cx, labelY + 8);
  }

  _drawEnemies() {
    const ctx = this.ctx;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.defeated) continue;

      const ex = e.spawnTX * TILE_SIZE + TILE_SIZE / 2;
      const ey = e.spawnTY * TILE_SIZE + TILE_SIZE / 2 + 6;
      const locked = Network.isEnemyLocked(i);

      // Dim locked enemies
      if (locked) ctx.globalAlpha = 0.55;
      CharacterDrawer.drawWorldSprite(ctx, e.type, ex, ey);
      ctx.globalAlpha = 1;

      // Name label
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(ex - 20, ey - 26, 40, 12);
      ctx.fillStyle = locked ? '#ff9933' : '#ffd';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(e.type, ex, ey - 17);

      // Level badge
      ctx.fillStyle = locked ? '#cc4400' : '#e94560';
      ctx.fillRect(ex - 8, ey - 36, 16, 10);
      ctx.fillStyle = '#fff';
      ctx.font = '7px monospace';
      ctx.fillText('Lv' + e.level, ex, ey - 28);

      // "IN BATTLE" indicator for locked enemies
      if (locked) {
        ctx.fillStyle = 'rgba(255,100,0,0.85)';
        ctx.font = '11px monospace';
        ctx.fillText('⚔', ex, ey - 44);
      }
    }
  }

  _drawRemotePlayers() {
    const ctx = this.ctx;
    for (const p of Network.remotePlayers.values()) {
      if (!p.race) continue; // hasn't chosen character yet
      if (p.scene === 'city') continue; // inside city — hidden from world map

      const color  = RACE_DATA[p.race]?.color  ?? '#e8c99a';
      const accent = RACE_DATA[p.race]?.accent ?? '#b89060';

      const inBattle = p.scene === 'battle';
      if (inBattle) ctx.globalAlpha = 0.6;

      CharacterDrawer.drawWorldPlayer(ctx, p.x, p.y + 6, color, accent);
      ctx.globalAlpha = 1;

      // Name tag (different colour from local player)
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(p.x - 22, p.y - 24, 44, 12);
      ctx.fillStyle = '#88ccaa';
      ctx.font      = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, p.x, p.y - 15);

      // Battle indicator above name
      if (inBattle) {
        ctx.fillStyle = 'rgba(255,140,0,0.9)';
        ctx.font      = '11px monospace';
        ctx.fillText('⚔', p.x, p.y - 30);
      }
    }
  }

  _drawPlayer() {
    CharacterDrawer.drawWorldPlayer(
      this.ctx,
      this.px,
      this.py + 6,
      this.player.color,
      this.player.accent
    );

    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.ctx.fillRect(this.px - 22, this.py - 24, 44, 12);
    this.ctx.fillStyle = '#a8dadc';
    this.ctx.font      = '8px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.player.name, this.px, this.py - 15);
  }
}
