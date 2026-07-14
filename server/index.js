const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // In production, restrict to your domain
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/deadzone', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Define schemas and models
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    level: { type: Number, default: 1 },
    experience: { type: Number, default: 0 },
    kills: { type: Number, default: 0 },
    deaths: { type: Number, default: 0 },
    unlockedItems: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

userSchema.methods.comparePassword = function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateAuthToken = function() {
    return jwt.sign({ userId: this._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const User = mongoose.model('User', userSchema);

const matchSchema = new mongoose.Schema({
    matchId: { type: String, required: true, unique: true },
    map: { type: String, default: 'default' },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    players: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        kills: { type: Number, default: 0 },
        deaths: { type: Number, default: 0 },
        score: { type: Number, default: 0 }
    }],
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

const Match = mongoose.model('Match', matchSchema);

// In-memory game state (for simplicity - in production use Redis or database)
const gameState = {
    players: {}, // socketId -> { position, rotation, health, ammo, score, userId }
    bullets: [], // bullets in flight
    matchId: null
};

// Game constants (should match client)
const CONSTANTS = {
    PLAYER_SPEED: 5,
    JUMP_FORCE: 8,
    GRAVITY: 20,
    BULLET_SPEED: 100,
    MAP_SIZE: 200,
    RESPA_TIME: 3, // seconds
    MAX_PLAYERS_PER_MATCH: 16
};

// Handle socket connections
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Handle authentication
    socket.on('authenticate', async (token) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.userId);
            if (!user) throw new Error('User not found');

            // Store user info with socket
            socket.userId = user._id;
            socket.username = user.username;

            // Send auth success
            socket.emit('authenticated', { success: true, user: {
                id: user._id,
                username: user.username,
                level: user.level
            }});
        } catch (err) {
            console.error('Auth error:', err);
            socket.emit('authenticated', { success: false, message: 'Invalid token' });
        }
    });

    // Handle joining game
    socket.on('join-game', async () => {
        if (!socket.userId) {
            socket.emit('join-game', { success: false, message: 'Not authenticated' });
            return;
        }

        // Initialize player state
        gameState.players[socket.id] = {
            id: socket.id,
            userId: socket.userId,
            username: socket.username,
            position: { x: 0, y: 1, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            health: 100,
            ammo: 30,
            score: 0,
            isJumping: false,
            isSliding: false,
            lastUpdate: Date.now()
        };

        // Send initial state to this player
        const otherPlayers = Object.values(gameState.players)
            .filter(p => p.id !== socket.id)
            .map(p => ({
                id: p.id,
                position: p.position,
                rotation: p.rotation,
                health: p.health,
                username: p.username
            }));

        socket.emit('init', {
            player: gameState.players[socket.id],
            otherPlayers: otherPlayers,
            bullets: gameState.bullets
        });

        // Notify others of new player
        socket.broadcast.emit('player-joined', {
            id: socket.id,
            position: gameState.players[socket.id].position,
            rotation: gameState.players[socket.id].rotation,
            username: socket.username
        });
    });

    // Handle player movement updates
    socket.on('player-move', (data) => {
        if (!gameState.players[socket.id]) return;

        // Update player state
        const player = gameState.players[socket.id];
        player.position = data.position;
        player.rotation = data.rotation;
        player.health = data.health;
        player.ammo = data.ammo;
        player.score = data.score;
        player.isJumping = data.isJumping;
        player.isSliding = data.isSliding;
        player.lastUpdate = Date.now();

        // Broadcast to others (with interpolation lag compensation)
        socket.broadcast.emit('player-update', {
            id: socket.id,
            position: player.position,
            rotation: player.rotation,
            health: player.health,
            username: player.username
        });
    });

    // Handle shooting
    socket.on('shoot', (bulletData) => {
        if (!gameState.players[socket.id]) return;

        const shooter = gameState.players[socket.id];

        // Validate ammo (basic cheat prevention)
        if (shooter.ammo <= 0) return;

        // Create bullet with server authority
        const bullet = {
            id: bulletData.id || Math.random().toString(36).substr(2, 9),
            position: { ...bulletData.position },
            velocity: { ...bulletData.velocity },
            lifetime: 0,
            shooterId: socket.id,
            shooterUsername: shooter.username
        };

        // Deduct ammo
        shooter.ammo--;

        // Add to bullets
        gameState.bullets.push(bullet);

        // Notify all clients of new bullet
        io.emit('bullet-fired', bullet);
    });

    // Handle hit registration
    socket.on('register-hit', (hitData) => {
        // In a real implementation, we'd do proper hit validation on server
        // For now, we'll trust the client but verify basic conditions

        const shooterId = hitData.shooterId;
        const targetId = hitData.targetId;

        if (!gameState.players[shooterId] || !gameState.players[targetId]) return;

        const shooter = gameState.players[shooterId];
        const target = gameState.players[targetId];

        // Apply damage
        target.health -= hitData.damage || 34; // Default damage

        // Check for kill
        if (target.health <= 0) {
            // Increment killer's score and kills
            shooter.score += 100;
            shooter.kills = (shooter.kills || 0) + 1;
            shooter.health = 100; // Reset for respawn logic

            // Increment target's deaths
            target.deaths = (target.deaths || 0) + 1;

            // Notify kill
            io.emit('kill', {
                killer: shooter.username,
                victim: target.username,
                weapon: hitData.weapon || 'unknown'
            });

            // Schedule respawn
            setTimeout(() => {
                target.position = {
                    x: (Math.random() - 0.5) * CONSTANTS.MAP_SIZE,
                    y: 1,
                    z: (Math.random() - 0.5) * CONSTANTS.MAP_SIZE
                };
                target.rotation = { x: 0, y: 0, z: 0 };
                target.health = 100;
                target.ammo = 30;

                // Notify target to respawn
                io.to(targetId).emit('respawn', {
                    playerId: target.id,
                    position: target.position,
                    rotation: target.rotation
                });

                // Notify others of respawn
                socket.broadcast.emit('player-respawned', {
                    id: target.id,
                    position: target.position
                });
            }, CONSTANTS.RESPA_TIME * 1000);
        } else {
            // Just apply damage
            io.to(targetId).emit('hit', {
                targetId: target.id,
                health: target.health,
                damage: hitData.damage || 34
            });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        // Remove player from game state
        if (gameState.players[socket.id]) {
            socket.broadcast.emit('player-left', { id: socket.id });
            delete gameState.players[socket.id];
        }

        // Remove any bullets from this shooter? (optional)
    });
});

// Periodic updates to clients
setInterval(() => {
    // Send periodic updates to all clients
    io.emit('update', {
        players: Object.values(gameState.players).map(p => ({
            id: p.id,
            position: p.position,
            rotation: p.rotation,
            health: p.health,
            ammo: p.ammo,
            score: p.score,
            username: p.username
        })),
        bullets: gameState.bullets.map(b => ({
            id: b.id,
            position: b.position,
            velocity: b.velocity,
            lifetime: b.lifetime,
            shooterId: b.shooterId
        }))
    });

    // Update bullet lifetimes and remove old ones
    gameState.bullets = gameState.bullets.filter(bullet => {
        bullet.lifetime += 1/60; // Assuming 60fps update
        return bullet.lifetime < CONSTANTS.BULLET_LIFETIME;
    });

    // Update bullet positions (simple physics)
    gameState.bullets.forEach(bullet => {
        bullet.position.x += bullet.velocity.x * (1/60);
        bullet.position.y += bullet.velocity.y * (1/60);
        bullet.position.z += bullet.velocity.z * (1/60);

        // Simple boundary check
        if (Math.abs(bullet.position.x) > CONSTANTS.MAP_SIZE/2 ||
            Math.abs(bullet.position.z) > CONSTANTS.MAP_SIZE/2 ||
            bullet.position.y < 0) {
            // Mark for removal (will be filtered in next update)
            bullet.lifetime = CONSTANTS.BULLET_LIFETIME;
        }
    });
}, 1000/60); // 60 updates per second

// Auth routes
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }

        const user = new User({ username, email, password });
        await user.save();

        const token = user.generateAuthToken();
        res.status(201).json({ token, user: { id: user._id, username, email } });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const token = user.generateAuthToken();
        res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});