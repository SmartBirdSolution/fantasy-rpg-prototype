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

    Network.onEnemyRespawned = (idx) => {
      const e = this.enemies[idx];
      if (!e) return;
      e.defeated     = false;
      e.currentHP    = e.maxHP;
      e._roamX       = e.spawnTX * TILE_SIZE + TILE_SIZE / 2;
      e._roamY       = e.spawnTY * TILE_SIZE + TILE_SIZE / 2;
      e._roamTargetX = e._roamX;
      e._roamTargetY = e._roamY;
      e._roamTimer   = Math.random() * 2;
      e._respawnTimer = -1;
    };

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

    // Sync defeated state from network, then tick roam / respawn
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.defeated && Network.isEnemyDefeated(i)) e.defeated = true;

      if (!e.defeated && !Network.isEnemyLocked(i)) {
        this._updateMobRoam(e, dt);
      }
    }

    if (this._battleCooldown <= 0 && this._cityCooldown <= 0) this._checkCollisions();
  }

  _updateMobRoam(e, dt) {
    const ROAM_RADIUS = 2.5 * TILE_SIZE;
    const ROAM_SPEED  = 18;

    e._roamTimer -= dt;
    if (e._roamTimer <= 0) {
      const spawnX = e.spawnTX * TILE_SIZE + TILE_SIZE / 2;
      const spawnY = e.spawnTY * TILE_SIZE + TILE_SIZE / 2;
      const angle  = Math.random() * Math.PI * 2;
      const dist   = Math.random() * ROAM_RADIUS;
      e._roamTargetX = spawnX + Math.cos(angle) * dist;
      e._roamTargetY = spawnY + Math.sin(angle) * dist;
      e._roamTimer   = 2 + Math.random() * 3;
    }

    const dx = e._roamTargetX - e._roamX;
    const dy = e._roamTargetY - e._roamY;
    const d  = Math.hypot(dx, dy);
    if (d > 2) {
      const step = ROAM_SPEED * dt;
      e._roamX += (dx / d) * Math.min(step, d);
      e._roamY += (dy / d) * Math.min(step, d);
    }
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
      const ex = e._roamX;
      const ey = e._roamY;
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

      const ex = e._roamX;
      const ey = e._roamY + 6;
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

// ── CITY SCENE ──────────────────────────────────────────────────────
class CityScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this._t     = 0;
  }

  update(dt) { this._t += dt; }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    this._drawSky(ctx, W, H);
    this._drawFarSilhouette(ctx, W, H);
    this._drawGround(ctx, W, H);
    this._drawBuildings(ctx, W, H);
    this._drawFountain(ctx, W, H);
    this._drawLantern(ctx, W * 0.33, H * 0.45, H);
    this._drawLantern(ctx, W * 0.67, H * 0.45, H);
    this._drawNPCs(ctx, W, H);
    this._drawVignette(ctx, W, H);
  }

  _drawSky(ctx, W, H) {
    const skyH = H * 0.45;
    const grad = ctx.createLinearGradient(0, 0, 0, skyH);
    grad.addColorStop(0,   '#2a4878');
    grad.addColorStop(0.5, '#6898c0');
    grad.addColorStop(1,   '#c8a070');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, skyH);

    // Sun
    const sx = W * 0.72, sy = H * 0.09;
    const glow = ctx.createRadialGradient(sx, sy, 18, sx, sy, 80);
    glow.addColorStop(0, 'rgba(255,210,100,0.9)');
    glow.addColorStop(0.3, 'rgba(255,190,80,0.4)');
    glow.addColorStop(1,   'rgba(255,170,60,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, 80, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe090';
    ctx.beginPath(); ctx.arc(sx, sy, 22, 0, Math.PI * 2); ctx.fill();

    // Clouds
    this._cloud(ctx, W * 0.14, H * 0.10, 75);
    this._cloud(ctx, W * 0.44, H * 0.06, 55);
    this._cloud(ctx, W * 0.82, H * 0.14, 45);
  }

  _cloud(ctx, x, y, r) {
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.beginPath();
    ctx.arc(x,           y,           r * 0.48, 0, Math.PI * 2);
    ctx.arc(x + r * 0.38, y - r * 0.1, r * 0.36, 0, Math.PI * 2);
    ctx.arc(x - r * 0.34, y + r * 0.05, r * 0.28, 0, Math.PI * 2);
    ctx.arc(x + r * 0.72, y + r * 0.08, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFarSilhouette(ctx, W, H) {
    ctx.fillStyle = '#485060';
    // Left distant tower
    ctx.fillRect(W * 0.04, H * 0.27, W * 0.055, H * 0.18);
    ctx.beginPath();
    ctx.moveTo(W * 0.04, H * 0.27);
    ctx.lineTo(W * 0.068, H * 0.20);
    ctx.lineTo(W * 0.095, H * 0.27);
    ctx.fill();
    // Right distant buildings
    ctx.fillRect(W * 0.80, H * 0.30, W * 0.07, H * 0.15);
    ctx.fillRect(W * 0.87, H * 0.24, W * 0.06, H * 0.21);
  }

  _drawGround(ctx, W, H) {
    const gy = H * 0.45;
    const gr = ctx.createLinearGradient(0, gy, 0, H);
    gr.addColorStop(0,   '#888070');
    gr.addColorStop(0.4, '#989080');
    gr.addColorStop(1,   '#787060');
    ctx.fillStyle = gr;
    ctx.fillRect(0, gy, W, H - gy);

    // Cobblestone grid
    ctx.strokeStyle = 'rgba(55,48,38,0.32)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const y = gy + (H - gy) * i / 10;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    const vp = W / 2;
    for (let i = -9; i <= 9; i++) {
      const t = i / 9;
      ctx.beginPath();
      ctx.moveTo(vp + t * W * 0.48, gy);
      ctx.lineTo(vp + t * W * 2.8, H + 100);
      ctx.stroke();
    }

    // Path highlight edges
    ctx.strokeStyle = 'rgba(170,150,110,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W * 0.2, gy); ctx.lineTo(0, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.8, gy); ctx.lineTo(W, H); ctx.stroke();
  }

  _drawBuildings(ctx, W, H) {
    const gy = H * 0.45;
    this._drawTavern   (ctx, W * 0.06, gy, W * 0.22, H * 0.38);
    this._drawGuildHall(ctx, W * 0.34, gy - H * 0.06, W * 0.32, H * 0.44);
    this._drawShop     (ctx, W * 0.72, gy, W * 0.22, H * 0.32);
  }

  _drawTavern(ctx, bx, gy, bw, bh) {
    const by = gy - bh;
    // Walls
    ctx.fillStyle = '#b09070';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#8a7050';
    ctx.fillRect(bx + bw * 0.76, by, bw * 0.24, bh);
    // Roof
    ctx.fillStyle = '#4a3020';
    ctx.beginPath();
    ctx.moveTo(bx - 8, by); ctx.lineTo(bx + bw / 2, by - bh * 0.28); ctx.lineTo(bx + bw + 8, by);
    ctx.closePath(); ctx.fill();
    // Chimney + smoke
    ctx.fillStyle = '#806050';
    ctx.fillRect(bx + bw * 0.62, by - bh * 0.12, bw * 0.09, bh * 0.24);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(200,190,180,${0.3 - i * 0.08})`;
      ctx.beginPath();
      ctx.arc(bx + bw * 0.66, by - bh * (0.20 + i * 0.09), 5 + i * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Windows
    this._window(ctx, bx + bw * 0.12, by + bh * 0.18, bw * 0.2, bh * 0.22);
    this._window(ctx, bx + bw * 0.44, by + bh * 0.18, bw * 0.2, bh * 0.22);
    // Door
    ctx.fillStyle = '#3a2010';
    ctx.beginPath();
    ctx.roundRect(bx + bw * 0.36, by + bh * 0.54, bw * 0.28, bh * 0.46, [6,6,0,0]);
    ctx.fill();
    ctx.fillStyle = '#6a4828';
    ctx.fillRect(bx + bw * 0.39, by + bh * 0.58, bw * 0.11, bh * 0.40);
    ctx.fillRect(bx + bw * 0.51, by + bh * 0.58, bw * 0.11, bh * 0.40);
    ctx.fillStyle = '#c8a028';
    ctx.beginPath(); ctx.arc(bx + bw * 0.57, by + bh * 0.77, 3, 0, Math.PI * 2); ctx.fill();
    // Sign
    ctx.fillStyle = '#5a3818';
    ctx.fillRect(bx + bw * 0.24, by + bh * 0.06, bw * 0.52, bh * 0.12);
    ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 1.5;
    ctx.strokeRect(bx + bw * 0.24, by + bh * 0.06, bw * 0.52, bh * 0.12);
    ctx.fillStyle = '#e8c870';
    ctx.font = `bold ${Math.round(bh * 0.075)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TAVERN', bx + bw * 0.5, by + bh * 0.12);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  _drawGuildHall(ctx, bx, gy, bw, bh) {
    const by = gy - bh;
    // Stone walls
    ctx.fillStyle = '#9090a0';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#707080';
    ctx.fillRect(bx + bw * 0.8, by, bw * 0.2, bh);
    // Stone block pattern
    ctx.strokeStyle = 'rgba(75,75,88,0.45)'; ctx.lineWidth = 1;
    for (let row = 0; row < 8; row++) {
      const ry = by + bh * row / 8;
      ctx.beginPath(); ctx.moveTo(bx, ry); ctx.lineTo(bx + bw, ry); ctx.stroke();
      const off = row % 2 === 0 ? 0 : bw / 10;
      for (let col = 0; col < 6; col++) {
        const cx2 = bx + off + col * bw / 5;
        ctx.beginPath(); ctx.moveTo(cx2, ry); ctx.lineTo(cx2, ry + bh / 8); ctx.stroke();
      }
    }
    // Pointed roof
    ctx.fillStyle = '#506080';
    ctx.beginPath();
    ctx.moveTo(bx - 10, by); ctx.lineTo(bx + bw / 2, by - bh * 0.32); ctx.lineTo(bx + bw + 10, by);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#384060'; ctx.lineWidth = 2; ctx.stroke();
    // Flag
    ctx.strokeStyle = '#604020'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx + bw / 2, by - bh * 0.32); ctx.lineTo(bx + bw / 2, by - bh * 0.52); ctx.stroke();
    ctx.fillStyle = '#c82020';
    ctx.beginPath();
    ctx.moveTo(bx + bw / 2,      by - bh * 0.52);
    ctx.lineTo(bx + bw / 2 + 22, by - bh * 0.44);
    ctx.lineTo(bx + bw / 2,      by - bh * 0.37);
    ctx.fill();
    // Arched windows
    this._archWindow(ctx, bx + bw * 0.08, by + bh * 0.14, bw * 0.22, bh * 0.30);
    this._archWindow(ctx, bx + bw * 0.39, by + bh * 0.14, bw * 0.22, bh * 0.30);
    this._archWindow(ctx, bx + bw * 0.70, by + bh * 0.14, bw * 0.22, bh * 0.30);
    // Grand arched door
    ctx.fillStyle = '#2a1808';
    const dx = bx + bw * 0.35, dy = by + bh * 0.52, dw = bw * 0.30, dh = bh * 0.48;
    ctx.beginPath();
    ctx.moveTo(dx, dy + dh); ctx.lineTo(dx, dy + dh * 0.3);
    ctx.arc(dx + dw / 2, dy + dh * 0.3, dw / 2, Math.PI, 0);
    ctx.lineTo(dx + dw, dy + dh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4a2a10';
    ctx.fillRect(dx + dw * 0.05, dy + dh * 0.36, dw * 0.42, dh * 0.60);
    ctx.fillRect(dx + dw * 0.53, dy + dh * 0.36, dw * 0.42, dh * 0.60);
    // Name plate
    ctx.fillStyle = '#e8d080';
    ctx.font = `bold ${Math.round(bh * 0.055)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('DION  GUILD HALL', bx + bw * 0.5, by + bh * 0.07);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  _drawShop(ctx, bx, gy, bw, bh) {
    const by = gy - bh;
    // Walls
    ctx.fillStyle = '#c0a870';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#a08850';
    ctx.fillRect(bx + bw * 0.76, by, bw * 0.24, bh);
    // Parapet
    ctx.fillStyle = '#8a7050';
    ctx.fillRect(bx - 5, by - bh * 0.07, bw + 10, bh * 0.08);
    // Awning
    ctx.fillStyle = '#c03020';
    ctx.beginPath();
    ctx.moveTo(bx - 5, by + bh * 0.34); ctx.lineTo(bx + bw + 5, by + bh * 0.34);
    ctx.lineTo(bx + bw,   by + bh * 0.48); ctx.lineTo(bx, by + bh * 0.48);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 3;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(bx + bw * i / 5, by + bh * 0.34);
      ctx.lineTo(bx + bw * i / 5, by + bh * 0.48);
      ctx.stroke();
    }
    // Windows
    this._window(ctx, bx + bw * 0.08, by + bh * 0.09, bw * 0.36, bh * 0.21);
    this._window(ctx, bx + bw * 0.54, by + bh * 0.09, bw * 0.32, bh * 0.21);
    // Door
    ctx.fillStyle = '#3a2010';
    ctx.fillRect(bx + bw * 0.37, by + bh * 0.54, bw * 0.26, bh * 0.46);
    ctx.fillStyle = '#c8a028';
    ctx.beginPath(); ctx.arc(bx + bw * 0.58, by + bh * 0.77, 3, 0, Math.PI * 2); ctx.fill();
    // Barrels
    this._barrel(ctx, bx - 14, gy - 20);
    this._barrel(ctx, bx - 28, gy - 20);
    // Sign
    ctx.fillStyle = '#c03020';
    ctx.fillRect(bx + bw * 0.2, by + bh * 0.03, bw * 0.6, bh * 0.09);
    ctx.fillStyle = '#ffe8a0';
    ctx.font = `bold ${Math.round(bh * 0.065)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MARKET', bx + bw * 0.5, by + bh * 0.075);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  _window(ctx, x, y, w, h) {
    ctx.fillStyle = '#a0c8e0';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#5a4020'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillRect(x + 2, y + 2, w * 0.42, h * 0.38);
  }

  _archWindow(ctx, x, y, w, h) {
    ctx.fillStyle = '#80b0d0';
    ctx.beginPath();
    ctx.moveTo(x, y + h); ctx.lineTo(x, y + h * 0.35);
    ctx.arc(x + w / 2, y + h * 0.35, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a4828'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.52); ctx.lineTo(x + w, y + h * 0.52); ctx.stroke();
  }

  _barrel(ctx, x, y) {
    ctx.fillStyle = '#5a3818';
    ctx.beginPath(); ctx.ellipse(x + 9, y, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x, y, 18, 18);
    ctx.beginPath(); ctx.ellipse(x + 9, y + 18, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + 18, y + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x + 18, y + 12); ctx.stroke();
  }

  _drawFountain(ctx, W, H) {
    const gy = H * 0.45;
    const cx = W * 0.5, cy = gy + H * 0.12;
    const R  = W * 0.072;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 9, R + 5, R * 0.33, 0, 0, Math.PI * 2); ctx.fill();
    // Basin rim
    ctx.fillStyle = '#8090a0';
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    // Water
    ctx.fillStyle = '#3880b8';
    ctx.beginPath(); ctx.ellipse(cx, cy, R - 8, R * 0.20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(140,210,255,0.5)';
    ctx.beginPath(); ctx.ellipse(cx - R * 0.22, cy - 3, R * 0.26, R * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    // Pedestal
    ctx.fillStyle = '#9098a0';
    ctx.fillRect(cx - 8, cy - 38, 16, 38);
    ctx.fillStyle = '#a0a8b0';
    ctx.beginPath(); ctx.ellipse(cx, cy - 38, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Water arcs
    ctx.strokeStyle = 'rgba(100,190,255,0.72)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 40);
      ctx.quadraticCurveTo(cx + sign * 22, cy - 64, cx + sign * 30, cy - 18);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = 'rgba(120,210,255,0.85)';
    ctx.beginPath(); ctx.arc(cx, cy - 66, 3, 0, Math.PI * 2); ctx.fill();
  }

  _drawLantern(ctx, x, gy, H) {
    const postH = H * 0.15;
    ctx.strokeStyle = '#4a3820'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - postH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, gy - postH); ctx.lineTo(x + 14, gy - postH); ctx.stroke();
    ctx.lineCap = 'butt';
    // Box
    ctx.fillStyle = '#5a4828';
    ctx.fillRect(x + 8, gy - postH - 16, 15, 15);
    // Light
    ctx.fillStyle = 'rgba(255,200,80,0.92)';
    ctx.fillRect(x + 10, gy - postH - 14, 11, 11);
    // Glow
    const lg = ctx.createRadialGradient(x + 15, gy - postH - 9, 0, x + 15, gy - postH - 9, 32);
    lg.addColorStop(0, 'rgba(255,200,80,0.28)');
    lg.addColorStop(1, 'rgba(255,180,50,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(x + 15, gy - postH - 9, 32, 0, Math.PI * 2); ctx.fill();
  }

  _drawNPCs(ctx, W, H) {
    const gy = H * 0.45;
    this._npc(ctx, W * 0.22, gy + H * 0.08, '#5a4020', '#8a6030');
    this._npc(ctx, W * 0.31, gy + H * 0.04, '#203860', '#304878');
    this._npc(ctx, W * 0.64, gy + H * 0.06, '#402020', '#603030');
    this._npc(ctx, W * 0.73, gy + H * 0.10, '#204020', '#305030');
  }

  _npc(ctx, x, y, body, accent) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = body;
    ctx.fillRect(x - 6, y - 22, 12, 16);
    ctx.fillRect(x - 10, y - 20, 4, 11);
    ctx.fillRect(x +  6, y - 20, 4, 11);
    ctx.fillStyle = accent;
    ctx.fillRect(x - 5, y - 6, 5, 8);
    ctx.fillRect(x,     y - 6, 5, 8);
    ctx.fillStyle = '#d4a878';
    ctx.beginPath(); ctx.arc(x, y - 28, 7, 0, Math.PI * 2); ctx.fill();
  }

  _drawVignette(ctx, W, H) {
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.44)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
}
