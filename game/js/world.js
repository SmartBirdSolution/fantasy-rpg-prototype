'use strict';

// Painterly mid-tone color per tile type (keyed by TILE constant values)
const _TILE_PAINT = {
  0: '#3c8048',  // GRASS
  1: '#1c5428',  // FOREST
  2: '#1c5e92',  // WATER
  3: '#bc9a68',  // ROAD
  4: '#c8a458',  // VILLAGE
  5: '#686878',  // MOUNTAIN
  6: '#ccb868',  // SAND
};

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

    this.onCityPrompt        = null; // callback(screenX, screenY)
    this.onCityPromptDismiss = null; // callback() — player walked away
    this._cityCooldown    = 0;
    this._cityPromptShown = false;

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

    // City proximity constants
    const CITY_CX     = 30 * TILE_SIZE + TILE_SIZE / 2;
    const CITY_CY     = 30 * TILE_SIZE + TILE_SIZE / 2;
    const CITY_RADIUS = TILE_SIZE * 2;
    const distToCity  = Math.hypot(this.px - CITY_CX, this.py - CITY_CY);

    if (!this._cityPromptShown && distToCity < CITY_RADIUS) {
      // Player walked into the gate — show prompt
      this._cityPromptShown = true;
      if (this.onCityPrompt) {
        this.onCityPrompt(CITY_CX - this.cam.x, CITY_CY - this.cam.y);
      }
    } else if (this._cityPromptShown && distToCity >= CITY_RADIUS) {
      // Player walked away without choosing — auto-dismiss
      this._cityPromptShown = false;
      this._cityCooldown = 1; // brief pause before re-triggering
      if (this.onCityPromptDismiss) this.onCityPromptDismiss();
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

    // Screen-edge vignette — painterly fog atmosphere
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.30,
                                        W / 2, H / 2, Math.max(W, H) * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.48)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  _drawTiles() {
    const ctx = this.ctx;
    const ts  = TILE_SIZE;
    const startX = Math.max(0, Math.floor(this.cam.x / ts) - 1);
    const startY = Math.max(0, Math.floor(this.cam.y / ts) - 1);
    const endX   = Math.min(MAP_W - 1, Math.ceil((this.cam.x + this.canvas.width)  / ts));
    const endY   = Math.min(MAP_H - 1, Math.ceil((this.cam.y + this.canvas.height) / ts));

    // Pass 1 — flat painted base fills (no grid lines)
    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        ctx.fillStyle = _TILE_PAINT[MAP_DATA[ty][tx]];
        ctx.fillRect(tx * ts, ty * ts, ts, ts);
      }
    }

    // Pass 1b — single diagonal sheen over all tiles (one gradient, painted light direction)
    const vw = this.canvas.width, vh = this.canvas.height;
    const sg = ctx.createLinearGradient(this.cam.x, this.cam.y, this.cam.x + vw, this.cam.y + vh);
    sg.addColorStop(0,   'rgba(255,255,255,0.055)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0)');
    sg.addColorStop(1,   'rgba(0,0,0,0.080)');
    ctx.fillStyle = sg;
    ctx.fillRect(this.cam.x, this.cam.y, vw, vh);

    // Pass 2 — soft blend strips where tile types meet (painterly, no hard edges)
    const B = 5;
    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const tt = MAP_DATA[ty][tx];
        const mc = _TILE_PAINT[tt];
        const px = tx * ts, py = ty * ts;
        if (tx + 1 <= endX) {
          const rt = MAP_DATA[ty][tx + 1];
          if (rt !== tt) {
            const g = ctx.createLinearGradient(px + ts - B, 0, px + ts + B, 0);
            g.addColorStop(0, mc); g.addColorStop(1, _TILE_PAINT[rt]);
            ctx.fillStyle = g; ctx.fillRect(px + ts - B, py, B * 2, ts);
          }
        }
        if (ty + 1 <= endY) {
          const bt = MAP_DATA[ty + 1][tx];
          if (bt !== tt) {
            const g = ctx.createLinearGradient(0, py + ts - B, 0, py + ts + B);
            g.addColorStop(0, mc); g.addColorStop(1, _TILE_PAINT[bt]);
            ctx.fillStyle = g; ctx.fillRect(px, py + ts - B, ts, B * 2);
          }
        }
      }
    }

    // Pass 3 — decorations on top of blended ground
    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const tileType = MAP_DATA[ty][tx];
        const px = tx * ts, py = ty * ts;
        if (tileType === TILE.FOREST)   this._drawTree(ctx, px + ts/2, py + ts/2 - 2, tx, ty);
        if (tileType === TILE.MOUNTAIN) this._drawPeak(ctx, px + ts/2, py + ts);
        if (tileType === TILE.WATER)    this._drawWave(ctx, px, py, ts, tx, ty);
      }
    }
  }

  _drawTree(ctx, cx, cy, tx, ty) {
    const seed = (tx * 7 + ty * 13) % 4;
    const r = 7 + seed * 1.2;
    // Shadow blob on ground
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + r * 0.6, r * 0.85, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Trunk
    ctx.fillStyle = '#5a3210';
    ctx.fillRect(cx - 2, cy, 4, r * 0.7);
    // Canopy — radial gradient, dark at edges, bright highlight top-left
    const canopyGrad = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.3, r * 0.12, cx, cy, r);
    canopyGrad.addColorStop(0,   '#72c84a');
    canopyGrad.addColorStop(0.5, '#3a8230');
    canopyGrad.addColorStop(1,   '#1a4a18');
    ctx.fillStyle = canopyGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Tiny specular fleck
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#c8f0a0';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.26, cy - r * 0.28, r * 0.22, r * 0.14, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawPeak(ctx, cx, cy) {
    const h = 22;
    // Shadow right face
    ctx.fillStyle = '#50505f';
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.closePath();
    ctx.fill();
    // Light left face — gradient from peak down
    const lg = ctx.createLinearGradient(cx - 12, cy - h, cx, cy);
    lg.addColorStop(0, '#c8cad8');
    lg.addColorStop(1, '#888898');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx - 12, cy);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    // Snow cap
    const snowH = h * 0.38;
    ctx.fillStyle = '#eef0f8';
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx - 5.5, cy - h + snowH);
    ctx.lineTo(cx + 4,   cy - h + snowH * 0.8);
    ctx.closePath();
    ctx.fill();
    // Snow shadow edge
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#6070a0';
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx, cy - h + snowH * 0.9);
    ctx.lineTo(cx + 4, cy - h + snowH * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawWave(ctx, px, py, ts, tx, ty) {
    const seed = (tx * 3 + ty * 7) % 3;
    const off  = seed * 3;
    ctx.save();
    ctx.strokeStyle = 'rgba(180,235,255,0.30)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    // First wave — upper
    const y1 = py + ts * 0.38 + off;
    ctx.beginPath();
    ctx.moveTo(px + 3, y1);
    ctx.quadraticCurveTo(px + ts * 0.28, y1 - 4, px + ts * 0.52, y1);
    ctx.quadraticCurveTo(px + ts * 0.76, y1 + 4, px + ts - 3, y1);
    ctx.stroke();
    // Second wave — lower, subtler
    ctx.strokeStyle = 'rgba(140,210,255,0.18)';
    ctx.lineWidth = 1.2;
    const y2 = py + ts * 0.62 + off;
    ctx.beginPath();
    ctx.moveTo(px + 5, y2);
    ctx.quadraticCurveTo(px + ts * 0.32, y2 + 3.5, px + ts * 0.56, y2);
    ctx.quadraticCurveTo(px + ts * 0.78, y2 - 3.5, px + ts - 5, y2);
    ctx.stroke();
    ctx.restore();
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
