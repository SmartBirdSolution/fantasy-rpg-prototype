'use strict';

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx    = this.canvas.getContext('2d');
    this.scene  = 'charselect';

    this.player       = null;
    this.worldScene   = null;
    this.battleScene  = null;
    this.currentEnemy = null;
    this.currentEnemyIdx = null;

    this.lastTime     = 0;
    this._netTimer    = 0; // throttle for position sends
  }

  start() {
    this._resize();
    window.addEventListener('resize', () => this._resize());

    Network.connect();

    UI.init();
    UI.showScene('charselect');
    UI.buildCharSelect((race, cls) => this._onCharSelected(race, cls));

    requestAnimationFrame(ts => this._loop(ts));
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ── CHAR SELECT → WORLD ──────────────────────────────────────────────
  _onCharSelected(race, cls) {
    this.player = new PlayerCharacter(race, cls);

    this.worldScene = new WorldScene(this.canvas, this.player);
    this.worldScene.init();
    this.worldScene.onBattleStart = (e, idx) => this._startBattle(e, idx);

    // Tell server we've joined with our character
    Network.sendJoin(race, cls, this.player.name);

    UI.fadeOut(() => {
      UI.showScene('world');
      UI.updateWorldStats(this.player);
      this.scene = 'world';
      UI.fadeIn(null);
    });
  }

  // ── WORLD → BATTLE ───────────────────────────────────────────────────
  _startBattle(enemy, idx) {
    if (this.scene !== 'world') return;

    // Double-check lock (race condition guard before fade starts)
    if (Network.isEnemyLocked(idx)) return;

    this.scene = 'transitioning';
    this.currentEnemy    = enemy;
    this.currentEnemyIdx = idx;

    Network.sendBattleStart(idx);

    UI.fadeOut(() => {
      this.battleScene = new BattleScene(this.canvas, this.player, enemy);
      this.battleScene.onBattleEnd = result => this._endBattle(result);

      UI.showScene('battle');
      UI.initBattleHUD(this.player, enemy);
      UI.setDefenseEnabled(false);
      UI.setDefenseActive(false);

      document.getElementById('btn-defense').onclick = () => {
        if (this.battleScene) this.battleScene.toggleDefense();
      };

      this.scene = 'battle';
      this.battleScene.init();

      UI.fadeIn(null);
    });
  }

  // ── BATTLE → WORLD ───────────────────────────────────────────────────
  _endBattle(result) {
    const won = result === 'win';
    Network.sendBattleEnd(this.currentEnemyIdx, won);

    UI.fadeOut(() => {
      if (won) {
        this.currentEnemy.defeated = true;

        UI.showScene('world');
        UI.updateWorldStats(this.player);
        this.worldScene.startBattleCooldown();
        this.scene = 'world';
        UI.fadeIn(null);

      } else {
        this.player.currentHP = Math.floor(this.player.maxHP * 0.5);
        this.worldScene.px = 30 * TILE_SIZE + TILE_SIZE / 2;
        this.worldScene.py = 30 * TILE_SIZE + TILE_SIZE / 2;
        this.worldScene._snapCamera();
        this.worldScene.startBattleCooldown();

        UI.showScene('world');
        this.scene = 'world';

        UI.fadeIn(() => {
          UI.showGameOver(() => {
            UI.updateWorldStats(this.player);
          });
        });
      }
    });
  }

  // ── MAIN LOOP ────────────────────────────────────────────────────────
  _loop(ts) {
    const dt = Math.min((ts - this.lastTime) / 1000, 0.05);
    this.lastTime = ts;

    if (this.scene === 'world' && this.worldScene) {
      this.worldScene.update(dt);
      this.worldScene.draw();
      UI.updateWorldStats(this.player);

      // Send position to server at ~20 Hz
      this._netTimer += dt;
      if (this._netTimer >= 0.05 && Network.connected) {
        this._netTimer = 0;
        Network.sendMove(this.worldScene.px, this.worldScene.py, 'world');
      }

    } else if (this.scene === 'battle' && this.battleScene) {
      this.battleScene.update(dt);
      this.battleScene.draw();
      UI.updateBattleHUD(this.player, this.battleScene.enemy);

    } else if (this.scene === 'charselect') {
      this.ctx.fillStyle = '#05081a';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    requestAnimationFrame(nts => this._loop(nts));
  }
}

window.addEventListener('load', () => { new Game().start(); });
