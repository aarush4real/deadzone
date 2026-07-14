// Shared constants between client and server
const CONSTANTS = {
    PLAYER_SPEED: 5,
    JUMP_FORCE: 8,
    GRAVITY: 20,
    SLIDE_SPEED_MULTIPLIER: 1.5,
    SLIDE_DURATION: 0.3,
    BULLET_SPEED: 100,
    BULLET_LIFETIME: 2, // seconds
    MOUSE_SENSITIVITY: 0.002,
    MAP_SIZE: 200,
    PLAYER_HEIGHT: 1.8,
    PLAYER_WIDTH: 0.5,
    RESPA_TIME: 3, // seconds
    MAX_PLAYERS_PER_MATCH: 16
};

// Export for Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONSTANTS;
} else {
    window.CONSTANTS = CONSTANTS;
}