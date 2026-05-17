'use strict';

// Central game configuration — edit here to tune balance without touching game logic.
const GAME_CONFIG = {
  DUEL_TURN_SECONDS: 15,   // seconds each player has to pick a move in a duel
};

// Allow Node.js (server.js) to require() this file directly.
if (typeof module !== 'undefined') module.exports = GAME_CONFIG;
