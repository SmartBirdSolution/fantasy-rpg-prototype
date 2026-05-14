'use strict';

class WorldScene {
  constructor(canvas, player) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.player = player;

    // Pixel position of player centre
    this.px = player.worldTileX * TILE_SIZE + TILE_SIZE / 2;
    this.py = player.worldTileY * TILE_SIZE + TILE_SIZE / 2;

    // Camera offset (top-left corner of viewport in world space)
    this.cam = { x: 0, y: 0 };

    this.keys    = {};
    this.enemies = [];
    this.speed   = 120; // pixels per second

    this.onBattleStart = null; // callback(enemy)
    this._battleCooldown = 0;  // seconds after returning from battle

    this._keyDown = e => { this.keys[e.code] = true; };
    this._keyUp   = e => { this.keys[e.code] = false; };
  }

  init() {
    this.enemies = ENEMY_SPAWNS.map(s => new EnemyCharacter(s.type, s.tx, s.ty));
    window.addEventListener('keydown', this._keyDown);
    window.addEventListener('keyup',   this._keyUp);
    // Snap camera immediately
    this._snapCamera();
  }

  destroy() {
    window.removeEventListener('keydown', this._keyDown);
    window.removeEventListener('keyup',   this._keyUp);
  }

  startBattleCooldown() {
    this._battleCooldown = 1.5; // 1.5s grace after returning from battle
  }

  update(dt) {
    if (this._battleCooldown > 0) { this._battleCooldown -= dt; }
    this._movePlayer(dt);
    this._lerpCamera();
    if (this._battleCooldown <= 0) this._checkCollisions();
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
    const hw = 10; // half-hitbox
    const corners = [[-hw,-hw],[hw,-hw],[-hw,hw],[hw,hw]];
    return corners.every(([ox,oy]) => {
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
    for (const e of this.enemies) {
      if (e.defeated) continue;
      const ex = e.spawnTX * TILE_SIZE + TILE_SIZE / 2;
      const ey = e.spawnTY * TILE_SIZE + TILE_SIZE / 2;
      const dist = Math.hypot(this.px - ex, this.py - ey);
      if (dist < 26) {
        if (this.onBattleStart) this.onBattleStart(e);
        break;
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
    this._drawEnemies();
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

        // Subtle grid line
        ctx.strokeStyle = meta.border;
        ctx.lineWidth   = 0.4;
        ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);

        // Decorative details
        if (tileType === TILE.FOREST)   this._drawTree(ctx, px + ts/2, py + ts/2 - 2, tx, ty);
        if (tileType === TILE.MOUNTAIN) this._drawPeak(ctx, px + ts/2, py + ts);
        if (tileType === TILE.WATER)    this._drawWave(ctx, px, py, ts);
        if (tileType === TILE.VILLAGE)  this._drawHouse(ctx, px + ts/2, py + ts/2, tx, ty);
      }
    }
  }

  _drawTree(ctx, cx, cy, tx, ty) {
    // Use tile coords as seed for consistent variation
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
    if (seed !== 0) return; // Only every 3rd village tile gets a house
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

  _drawEnemies() {
    for (const e of this.enemies) {
      if (e.defeated) continue;
      const ex = e.spawnTX * TILE_SIZE + TILE_SIZE / 2;
      const ey = e.spawnTY * TILE_SIZE + TILE_SIZE / 2 + 6;

      CharacterDrawer.drawWorldSprite(this.ctx, e.type, ex, ey);

      // Name label
      this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this.ctx.fillRect(ex - 20, ey - 26, 40, 12);
      this.ctx.fillStyle = '#ffd';
      this.ctx.font = '8px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(e.type, ex, ey - 17);

      // Level badge
      this.ctx.fillStyle = '#e94560';
      this.ctx.fillRect(ex - 8, ey - 36, 16, 10);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '7px monospace';
      this.ctx.fillText('Lv' + e.level, ex, ey - 28);
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

    // Player name tag
    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this.ctx.fillRect(this.px - 22, this.py - 24, 44, 12);
    this.ctx.fillStyle = '#a8dadc';
    this.ctx.font      = '8px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(this.player.name, this.px, this.py - 15);
  }
}
