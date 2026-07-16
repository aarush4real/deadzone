// Main client entry point
// THREE is loaded via the global variable from the three.js script tag

// Global game state
const gameState = {
    player: {
        id: null,
        position: new THREE.Vector3(0, 1, 0),
        rotation: new THREE.Euler(0, 0, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        health: 100,
        ammo: 30,
        score: 0,
        isJumping: false,
        isSliding: false
    },
    players: {}, // Other players {id: {position, rotation, health, etc}}
    bullets: [], // Bullets in flight
    map: null,   // Three.js map object
    camera: null,
    renderer: null,
    scene: null,
    mixer: null,
    clock: new THREE.Clock(),
    keysPressed: {},
    mouseDelta: new THREE.Vector2(),
    isPointerLocked: false,
    socket: null,
    playerModel: null,
    otherPlayerModels: {}, // id: model
    bulletMeshes: [] // Three.js meshes for bullets
};

// Game constants
const CONSTANTS = {
    PLAYER_SPEED: 5,
    JUMP_FORCE: 8,
    GRAVITY: 20,
    SLIDE_SPEED_MULTIPLIER: 1.5,
    SLIDE_DURATION: 0.3,
    BULLET_SPEED: 100,
    BULLET_LIFETIME: 2,
    MOUSE_SENSITIVITY: 0.002,
    MAP_SIZE: 200,
    PLAYER_HEIGHT: 1.8,
    PLAYER_WIDTH: 0.5,
    RESPA_TIME: 3, // seconds
    MAX_PLAYERS_PER_MATCH: 16
};

// Initialize the game
function init() {
    initThreeJS();
    initEventListeners();
    initSocket();
    animate();
}

// Initialize Three.js scene, camera, renderer
function initThreeJS() {
    gameState.scene = new THREE.Scene();
    gameState.scene.background = new THREE.Color(0x87ceeb); // Sky blue
    gameState.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    gameState.camera.position.y = gameState.PLAYER_HEIGHT;

    gameState.renderer = new THREE.WebGLRenderer({ antialias: true });
    gameState.renderer.setSize(window.innerWidth, window.innerHeight);
    gameState.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(gameState.renderer.domElement);

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    gameState.scene.add(ambientLight);

    // Add directional light (sun)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    gameState.scene.add(dirLight);

    // Create simple ground plane
    const groundGeometry = new THREE.PlaneGeometry(CONstants.MAP_SIZE, CONSTANTS.MAP_SIZE);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x228b22 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    gameState.scene.add(ground);
    gameState.map = ground;

    // Create a simple player model (capsule-like)
    createPlayerModel();

    // Add some simple obstacles
    createObstacles();
}

// Create a simple player model (for local player and others)
function createPlayerModel() {
    // For simplicity, we'll use a capsule shape made of cylinder and sphere
    const height = CONSTANTS.PLAYER_HEIGHT;
    const radius = CONSTANTS.PLAYER_WIDTH / 2;

    const geometry = new THREE.CylinderGeometry(radius, radius, height * 0.8, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0x00f3ff });
    const cylinder = new THREE.Mesh(geometry, material);
    cylinder.position.y = height * 0.4; // Adjust for cylinder base

    const headGeometry = new THREE.SphereGeometry(radius * 0.8, 8, 8);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = height * 0.85;

    const group = new THREE.Group();
    group.add(cylinder);
    group.add(head);
    group.userData.isPlayer = true;

    gameState.playerModel = group;
    gameState.scene.add(group);
}

// Create simple obstacles on the map
function createObstacles() {
    const geometry = new THREE.BoxGeometry(10, 10, 10);
    const material = new THREE.MeshStandardMaterial({ color: 0x8b4513 });

    // Create a few random boxes
    for (let i = 0; i < 20; i++) {
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(
            (Math.random() - 0.5) * (CONSTANTS.MAP_SIZE - 20),
            5, // Half height so it sits on ground
            (Math.random() - 0.5) * (CONSTANTS.MAP_SIZE - 20)
        );
        cube.userData.isObstacle = true;
        gameState.scene.add(cube);
    }
}

// Initialize event listeners for input
function initEventListeners() {
    // Keyboard
    window.addEventListener('keydown', (event) => {
        gameState.keysPressed[event.code] = true;

        // Handle jump
        if (event.code === 'Space' && !gameState.player.isJumping && !gameState.player.isSliding) {
            gameState.player.isJumping = true;
            gameState.player.velocity.y = CONSTANTS.JUMP_FORCE;
        }

        // Handle slide (C key)
        if (event.code === 'KeyC' && !gameState.player.isSliding && !gameState.player.isJumping) {
            startSlide();
        }
    });

    window.addEventListener('keyup', (event) => {
        gameState.keysPressed[event.code] = false;
    });

    // Mouse
    window.addEventListener('mousedown', (event) => {
        if (event.button === 0 && gameState.isPointerLocked) { // Left click
            shoot();
        }
    });

    window.addEventListener('mousemove', (event) => {
        if (gameState.isPointerLocked) {
            gameState.mouseDelta.x = event.movementX * CONSTANTS.MOUSE_SENSITIVITY;
            gameState.mouseDelta.y = event.movementY * CONSTANTS.MOUSE_SENSITIVITY;
        }
    });

    // Pointer lock
    const canvas = gameState.renderer.domElement;
    canvas.addEventListener('click', () => {
        if (!gameState.isPointerLocked) {
            canvas.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        gameState.isPointerLocked = document.pointerLockElement === canvas;
        document.getElementById('loading-screen').style.display = gameState.isPointerLocked ? 'none' : 'flex';
        document.getElementById('game-container').style.display = gameState.isPointerLocked ? 'block' : 'none';
    });

    document.addEventListener('pointerlockerror', () => {
        alert('Unable to lock pointer');
    });

    // Window resize
    window.addEventListener('resize', () => {
        gameState.camera.aspect = window.innerWidth / window.innerHeight;
        gameState.camera.updateProjectionMatrix();
        gameState.renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// Initialize socket connection
    function initSocket() {
        // Offline mode flag
        gameState.isOffline = false;

        // Determine socket URL: allow override via window.SOCKET_URL (set via server/env or config) or meta tag
        let socketUrl = undefined;
        if (window.SOCKET_URL && window.SOCKET_URL.trim()) {
            socketUrl = window.SOCKET_URL.trim();
        } else {
            const meta = document.querySelector('meta[name="socket-url"]');
            if (meta && meta.content) {
                socketUrl = meta.content;
            }
        }
        const opts = { transports: ['websocket'] };
        gameState.socket = socketUrl ? io(socketUrl, opts) : io(opts);

        // Timer to handle connection timeout (go offline after 5 seconds)
        const connectionTimeout = setTimeout(() => {
            console.warn('Socket connection timed out, switching to offline mode');
            hideLoadingScreen();
            gameState.isOffline = true;
        }, 5000);

        gameState.socket.on('connect', () => {
            console.log('Connected to server');
            gameState.player.id = gameState.socket.id;
            // Request to join the game
            gameState.socket.emit('join-game');
        });

        gameState.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            // If we were connected and now disconnected, we could go offline, but for simplicity we'll stay online until refresh
        });

        // Receive initial game state
        gameState.socket.on('init', (data) => {
            clearTimeout(connectionTimeout);
            // Set up initial state from server
            gameState.player.position.copy(data.player.position);
            gameState.player.rotation.copy(data.player.rotation);

            // Create other players
            data.otherPlayers.forEach((playerData) => {
                addOtherPlayer(playerData);
            });

            // Hide loading screen and show game
            hideLoadingScreen();
        });

        // Receive updates from server
        gameState.socket.on('update', (data) => {
            // If we are offline, ignore updates
            if (gameState.isOffline) return;

            // Update other players
            data.players.forEach((playerData) => {
                if (playerData.id === gameState.player.id) {
                    // This is us - update our state if server has authority
                    // For now, we'll use client-side prediction and server reconciliation
                    // In a full implementation, we'd reconcile differences
                } else {
                    updateOtherPlayer(playerData);
                }
            });

            // Update bullets
            gameState.bullets = data.bullets || [];
            updateBullets();

            // Update chat, kill feed, etc. would go here
        });

        // Hit registration
        gameState.socket.on('hit', (data) => {
            if (gameState.isOffline) return;
            if (data.targetId === gameState.player.id) {
                // We were hit
                gameState.player.health = data.health;
                updateHUD();
                // Add hit effect (screen flash, etc.)
            }
        });

        // Kill feed updates
        gameState.socket.on('kill', (data) => {
            if (gameState.isOffline) return;
            addToKillFeed(data.killer, data.victim, data.weapon);
        });

        // Respawn
        gameState.socket.on('respawn', (data) => {
            if (gameState.isOffline) return;
            if (data.playerId === gameState.player.id) {
                gameState.player.position.copy(data.position);
                gameState.player.rotation.copy(data.rotation);
                gameState.player.velocity.set(0, 0, 0);
                gameState.player.health = 100;
                gameState.player.ammo = 30;
                updateHUD();
            }
        });
    }

    // Helper function to hide loading screen and show game screen
    function hideLoadingScreen() {
        document.getElementById('loading-screen').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';
        // Note: We do not request pointer lock here; we wait for user to click on canvas
        // The pointerlockchange event will handle showing/hiding based on lock state
    }

// Add another player to the scene
function addOtherPlayer(playerData) {
    if (gameState.otherPlayerModels[playerData.id]) return; // Already exists

    // Create player model (similar to local but different color)
    const height = CONSTANTS.PLAYER_HEIGHT;
    const radius = CONSTANTS.PLAYER_WIDTH / 2;

    const geometry = new THREE.CylinderGeometry(radius, radius, height * 0.8, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xff4444 }); // Red for others
    const cylinder = new THREE.Mesh(geometry, material);
    cylinder.position.y = height * 0.4;

    const headGeometry = new THREE.SphereGeometry(radius * 0.8, 8, 8);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = height * 0.85;

    const group = new THREE.Group();
    group.add(cylinder);
    group.add(head);
    group.userData.id = playerData.id;
    group.userData.isOtherPlayer = true;

    gameState.scene.add(group);
    gameState.otherPlayerModels[playerData.id] = group;

    // Set initial position and rotation
    group.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
    group.rotation.set(playerData.rotation.x, playerData.rotation.y, playerData.rotation.z, 'XYZ');
}

// Update another player's position and rotation
function updateOtherPlayer(playerData) {
    const model = gameState.otherPlayerModels[playerData.id];
    if (!model) return;

    // Smooth interpolation - in a real game we'd use more sophisticated interpolation
    const targetPosition = new THREE.Vector3(playerData.position.x, playerData.position.y, playerData.position.z);
    const targetRotation = new THREE.Euler(playerData.rotation.x, playerData.rotation.y, playerData.rotation.z, 'XYZ');

    // Simple lerp for demonstration
    model.position.lerp(targetPosition, 0.2);
    model.quaternion.rotateTowards(
        new THREE.Quaternion().setFromEuler(targetRotation),
        0.2
    );

    // Update health if needed (for nameplates, etc.)
    // This would be stored in userData
}

// Update bullet positions in the scene
function updateBullets() {
    // Remove old bullet meshes
    gameState.bulletMeshes.forEach((mesh) => {
        if (mesh.parent) gameState.scene.remove(mesh);
    });
    gameState.bulletMeshes = [];

    // Create meshes for current bullets
    gameState.bullets.forEach((bullet) => {
        const geometry = new THREE.SphereGeometry(0.05, 8, 8);
        const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.position.set(bullet.position.x, bullet.position.y, bullet.position.z);
        gameState.scene.add(sphere);
        gameState.bulletMeshes.push(sphere);
    });
}

// Handle player movement
function updatePlayerMovement(deltaTime) {
    if (!gameState.isPointerLocked) return;

    const velocity = gameState.player.velocity;
    const direction = new THREE.Vector3();

    // Calculate movement direction based on keys and camera rotation
    if (gameState.keysPressed['KeyW']) direction.z -= 1;
    if (gameState.keysPressed['KeyS']) direction.z += 1;
    if (gameState.keysPressed['KeyA']) direction.x -= 1;
    if (gameState.keysPressed['KeyD']) direction.x += 1;

    direction.normalize();

    // Apply rotation from camera/mouse
    const directionVector = new THREE.Vector3(direction.x, 0, direction.z);
    directionVector.applyQuaternion(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, gameState.player.rotation.y, 0)
    ));

    // Apply movement
    if (direction.length() > 0) {
        directionVector.multiplyScalar(CONSTANTS.PLAYER_SPEED * deltaTime);

        // Apply slide multiplier if sliding
        if (gameState.player.isSliding) {
            directionVector.multiplyScalar(CONSTANTS.SLIDE_SPEED_MULTIPLIER);
        }

        velocity.x = directionVector.x;
        velocity.z = directionVector.z;
    } else {
        // Apply friction when not moving
        velocity.x *= Math.pow(0.8, deltaTime * 10);
        velocity.z *= Math.pow(0.8, deltaTime * 10);
    }

    // Apply gravity
    velocity.y -= CONSTANTS.GRAVITY * deltaTime;

    // Update position
    gameState.player.position.addScaledVector(velocity, deltaTime);

    // Ground collision
    if (gameState.player.position.y < CONSTANTS.PLAYER_HEIGHT / 2) {
        gameState.player.position.y = CONSTANTS.PLAYER_HEIGHT / 2;
        velocity.y = 0;
        gameState.player.isJumping = false;

        // End slide if we land while sliding
        if (gameState.player.isSliding) {
            endSlide();
        }
    }

    // Update player model position
    if (gameState.playerModel) {
        gameState.playerModel.position.copy(gameState.player.position);
        gameState.playerModel.rotation.copy(gameState.player.rotation);
    }

    // Update camera position (slightly above player's eyes)
    gameState.camera.position.set(
        gameState.player.position.x,
        gameState.player.position.y + CONSTANTS.PLAYER_HEIGHT * 0.15,
        gameState.player.position.z
    );

    // Apply mouse look to camera and player rotation
    gameState.player.rotation.y += gameState.mouseDelta.x;
    // Clamp vertical look to prevent flipping
    const desiredX = gameState.camera.rotation.x + gameState.mouseDelta.y;
    const maxVertical = Math.PI / 2 - 0.1;
    const minVertical = -Math.PI / 2 + 0.1;
    gameState.camera.rotation.x = Math.max(Math.min(desiredX, maxVertical), minVertical);
    // Only update player's y rotation (yaw) from mouse, keep pitch for camera only
    gameState.player.rotation.y = gameState.camera.rotation.y;

    // Reset mouse delta
    gameState.mouseDelta.set(0, 0);
}

// Handle shooting
function shoot() {
    if (gameState.player.ammo <= 0) return;

    gameState.player.ammo--;
    updateHUD();

    // Create bullet from camera position and direction
    const startPos = gameState.camera.position.clone();
    const direction = new THREE.Vector3();
    gameState.camera.getWorldDirection(direction);

    const bullet = {
        id: Math.random().toString(36).substr(2, 9),
        position: {
            x: startPos.x,
            y: startPos.y,
            z: startPos.z
        },
        velocity: {
            x: direction.x * CONSTANTS.BULLET_SPEED,
            y: direction.y * CONSTANTS.BULLET_SPEED,
            z: direction.z * CONSTANTS.BULLET_SPEED
        },
        lifetime: 0,
        shooterId: gameState.player.id
    };

    // Send to server for authoritative handling (if connected)
    if (gameState.socket) {
        gameState.socket.emit('shoot', bullet);
    }

    // Also add locally for immediate feedback (client-side prediction)
    gameState.bullets.push(bullet);
}

// Handle slide mechanic
function startSlide() {
    gameState.player.isSliding = true;
    // In a full implementation, we'd lower the camera and collision height
    setTimeout(endSlide, CONSTANTS.SLIDE_DURATION * 1000);
}

function endSlide() {
    gameState.player.isSliding = false;
}

// Update HUD elements
function updateHUD() {
    document.getElementById('ammo-count').textContent = gameState.player.ammo;
    document.getElementById('health-value').textContent = Math.floor(gameState.player.health);
    document.getElementById('score-value').textContent = gameState.player.score;
}

// Add a kill feed entry
function addToKillFeed(killer, victim, weapon) {
    const feed = document.getElementById('kill-feed');
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = `
        <span class="killer">${killer}</span>
        <span> killed </span>
        <span class="victim">${victim}</span>
        <span class="weapon"> with ${weapon}</span>
    `;
    feed.prepend(entry);

    // Keep only last 5 entries
    while (feed.children.length > 5) {
        feed.removeChild(feed.lastChild);
    }
}

// Main animation loop
function animate() {
    requestAnimationFrame(animate);

    const delta = gameState.clock.getDelta();

    // Update player movement
    updatePlayerMovement(delta);

    // Update other game logic (bullets, etc.) would go here

    // Render
    gameState.renderer.render(gameState.scene, gameState.camera);
}

// Start the game when window loads
window.addEventListener('load', init);