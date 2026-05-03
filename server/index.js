import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';
import { GameRoom } from './room.js';
import { StateManager } from './state-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from project root
app.use(express.static(join(__dirname, '..')));

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '..', 'index.html'));
});

app.get('/api/network-url', (req, res) => {
    const protocol = req.protocol;
    res.json({ url: `${protocol}://${localIP}:${PORT}/` });
});

// Game rooms storage - Load from disk on startup
const rooms = StateManager.load(io);

// Drop stale rooms on startup: lobbies have no active sockets after restart,
// and completed games should not be restored as playable rooms.
let removedStaleRooms = 0;
for (const [roomCode, room] of rooms) {
    if (!room.gameStarted || room.winner) {
        rooms.delete(roomCode);
        removedStaleRooms++;
    }
}

if (removedStaleRooms > 0) {
    console.log(`Removed ${removedStaleRooms} stale room(s) from restored state.`);
    StateManager.save(rooms);
}

for (const room of rooms.values()) {
    if (room.gameStarted) {
        setTimeout(() => room.maybeHandleBotTurn(), 250);
    }
}

// Helper to save state
function saveState() {
    StateManager.save(rooms);
}

// Get local network IP
function getLocalIP() {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    } catch (err) {
        console.warn('Could not inspect network interfaces; using localhost.');
    }
    return 'localhost';
}

function getSocketDiagnostics(socket) {
    return {
        socketId: socket.id,
        transport: socket.conn?.transport?.name || 'unknown',
        address: socket.handshake?.address || 'unknown',
        userAgent: socket.handshake?.headers?.['user-agent'] || 'unknown',
        referer: socket.handshake?.headers?.referer || 'unknown'
    };
}

function logConnectionEvent(event, details) {
    console.log(`[Connection] ${event}: ${JSON.stringify(details)}`);
}

io.on('connection', (socket) => {
    logConnectionEvent('connected', getSocketDiagnostics(socket));

    socket.conn.on('upgrade', (transport) => {
        logConnectionEvent('transport upgraded', {
            socketId: socket.id,
            transport: transport.name
        });
    });

    // Get list of available rooms
    socket.on('getRooms', (callback) => {
        const availableRooms = [];
        for (const [code, room] of rooms) {
            // Only show rooms that haven't started and aren't full
            if (!room.gameStarted && room.players.length < 10) {
                availableRooms.push({
                    code: code,
                    playerCount: room.players.length,
                    maxPlayers: 10,
                    hostName: room.players.find(p => p.isHost)?.name || 'Unknown'
                });
            }
        }
        callback(availableRooms);
    });

    // Create a new game room
    socket.on('createRoom', (playerName, callback) => {
        const roomCode = generateRoomCode();
        const room = new GameRoom(roomCode, io);
        rooms.set(roomCode, room);

        socket.join(roomCode);
        room.addPlayer(socket, playerName);

        saveState(); // Save state
        callback({ success: true, roomCode, playerId: socket.id });
        console.log(`Room ${roomCode} created by ${playerName}`);
    });

    // Join existing room
    socket.on('joinRoom', (data, callback) => {
        const { roomCode, playerName } = data;
        const room = rooms.get(roomCode.toUpperCase());

        if (!room) {
            callback({ success: false, error: 'Room not found' });
            return;
        }

        if (room.gameStarted) {
            callback({ success: false, error: 'Game already in progress' });
            return;
        }

        if (room.isBanned(playerName, null)) {
            callback({ success: false, error: 'You are banned from this room' });
            return;
        }

        if (room.players.length >= 10) {
            callback({ success: false, error: 'Room is full' });
            return;
        }

        room.addPlayer(socket, playerName);
        socket.join(roomCode.toUpperCase());

        saveState(); // Save state
        callback({ success: true, roomCode: roomCode.toUpperCase(), playerId: socket.id });
        console.log(`${playerName} joined room ${roomCode}`);
    });

    // Rejoin room after disconnect/refresh
    socket.on('rejoinRoom', (data, callback) => {
        const { roomCode, playerName, oldPlayerId } = data;
        const room = rooms.get(roomCode.toUpperCase());

        if (!room) {
            callback({ success: false, error: 'Room no longer exists' });
            return;
        }

        if (room.isBanned(playerName, oldPlayerId)) {
            callback({ success: false, error: 'You are banned from this room' });
            return;
        }

        // Try to find the old player by name
        const existingPlayer = room.players.find(p => p.name === playerName);

        if (existingPlayer) {
            // Update the socket reference for the existing player
            const previousPlayerId = existingPlayer.id;
            existingPlayer.socket = socket;
            existingPlayer.id = socket.id;
            existingPlayer.disconnected = false; // Clear disconnected flag
            if (room.unoCalledBy.has(previousPlayerId)) {
                room.unoCalledBy.delete(previousPlayerId);
                room.unoCalledBy.add(socket.id);
            }
            if (room.rematchVotes?.has(previousPlayerId)) {
                const previousVote = room.rematchVotes.get(previousPlayerId);
                room.rematchVotes.delete(previousPlayerId);
                room.rematchVotes.set(socket.id, previousVote);
            }
            socket.join(roomCode.toUpperCase());

            saveState(); // Save state (update player connection status/id)
            logConnectionEvent('player reconnected', {
                roomCode: roomCode.toUpperCase(),
                playerName,
                previousPlayerId,
                newPlayerId: socket.id,
                ...getSocketDiagnostics(socket)
            });
            callback({
                success: true,
                roomCode: roomCode.toUpperCase(),
                playerId: socket.id,
                isHost: existingPlayer.isHost,
                gameInProgress: room.gameStarted
            });

            console.log(`${playerName} reconnected to room ${roomCode}`);

            // Send current game state if game is in progress
            if (room.gameStarted) {
                room.broadcastGameState();
            } else {
                room.broadcastLobbyState();
            }
        } else if (!room.gameStarted) {
            // Player not found but game hasn't started, add as new player
            room.addPlayer(socket, playerName);
            socket.join(roomCode.toUpperCase());

            saveState(); // Save state
            callback({
                success: true,
                roomCode: roomCode.toUpperCase(),
                playerId: socket.id,
                isHost: false,
                gameInProgress: false
            });

            console.log(`${playerName} joined room ${roomCode} as new player`);
        } else {
            callback({ success: false, error: 'Cannot rejoin - game in progress and you were not in it' });
        }
    });

    // Start game
    socket.on('startGame', (roomCode, startingCardCount, customCardConfig) => {
        const room = rooms.get(roomCode);
        if (room && room.isHost(socket.id)) {
            room.startGame(startingCardCount, customCardConfig);
            saveState(); // Save state
        }
    });

    // Ask all players whether they want to continue with a new round
    socket.on('requestRematch', (roomCode, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            callback?.({ success: false, error: 'Room not found' });
            return;
        }

        const result = room.requestRematch(socket.id);
        saveState();
        callback?.(result);
    });

    // Vote on a pending rematch. A "no" vote ends the room for everyone.
    socket.on('respondRematch', (data, callback) => {
        const { roomCode, wantsRematch } = data || {};
        const room = rooms.get(roomCode);
        if (!room) {
            callback?.({ success: false, error: 'Room not found' });
            return;
        }

        const result = room.respondRematch(socket.id, !!wantsRematch);
        if (result.declined) {
            rooms.delete(roomCode);
        }
        saveState();
        callback?.(result);
    });

    // Add a bot player (host only, pre-game)
    socket.on('addBot', (roomCode, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            callback?.({ success: false, error: 'Room not found' });
            return;
        }
        if (!room.isHost(socket.id)) {
            callback?.({ success: false, error: 'Only the host can add bots' });
            return;
        }
        if (room.gameStarted) {
            callback?.({ success: false, error: 'Game already in progress' });
            return;
        }
        if (room.players.length >= 10) {
            callback?.({ success: false, error: 'Room is full' });
            return;
        }

        room.addBot();
        saveState();
        callback?.({ success: true });
    });

    // Kick a player (host only, lobby only)
    socket.on('kickPlayer', (data, callback) => {
        const { roomCode, targetPlayerId } = data || {};
        const room = rooms.get(roomCode);
        if (!room) {
            callback?.({ success: false, error: 'Room not found' });
            return;
        }
        if (!room.isHost(socket.id)) {
            callback?.({ success: false, error: 'Only the host can kick players' });
            return;
        }
        if (room.gameStarted) {
            callback?.({ success: false, error: 'Cannot kick after game starts' });
            return;
        }
        if (targetPlayerId === socket.id) {
            callback?.({ success: false, error: 'You cannot kick yourself' });
            return;
        }

        const target = room.players.find(p => p.id === targetPlayerId);
        if (!target) {
            callback?.({ success: false, error: 'Player not found' });
            return;
        }

        if (target.socket) {
            target.socket.emit('kicked', { roomCode });
            target.socket.leave(roomCode);
        }

        room.kickPlayer(targetPlayerId);
        if (room.players.length === 0) {
            rooms.delete(roomCode);
        }
        saveState();
        callback?.({ success: true });
    });

    // Play a card
    socket.on('playCard', (data) => {
        const { roomCode, cardIndex, chosenColor } = data;
        const room = rooms.get(roomCode);
        if (room) {
            room.playCard(socket.id, cardIndex, chosenColor);
            saveState(); // Save state
        }
    });

    // Draw a card
    socket.on('drawCard', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room) {
            room.drawCard(socket.id);
            saveState(); // Save state
        }
    });

    // Pass turn
    socket.on('passTurn', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room) {
            room.passTurn(socket.id);
            saveState(); // Save state
        }
    });

    // Call UNO
    socket.on('callUno', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room) {
            room.callUno(socket.id);
            saveState(); // Save state
        }
    });

    // Catch someone not calling UNO
    socket.on('catchUno', (data) => {
        const { roomCode, targetPlayerId } = data;
        const room = rooms.get(roomCode);
        if (room) {
            room.catchUno(socket.id, targetPlayerId);
            saveState(); // Save state
        }
    });

    // Voluntarily leave room
    socket.on('leaveRoom', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room && room.hasPlayer(socket.id)) {
            console.log(`Player voluntarily left room ${roomCode}`);
            room.removePlayer(socket.id);
            socket.leave(roomCode);

            if (room.players.length === 0) {
                rooms.delete(roomCode);
                console.log(`Room ${roomCode} deleted (empty)`);
            }
            saveState(); // Save state
        }
    });

    // Handle disconnect - use grace period for reconnection
    socket.on('disconnect', (reason) => {
        const diagnostics = getSocketDiagnostics(socket);
        logConnectionEvent('disconnected', {
            reason,
            ...diagnostics
        });

        for (const [roomCode, room] of rooms) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                const disconnectContext = {
                    roomCode,
                    playerName: player.name,
                    gameStarted: room.gameStarted,
                    currentPlayer: room.players[room.currentPlayerIndex]?.name || null,
                    playerCount: room.players.length,
                    reason,
                    ...diagnostics
                };

                if (!room.gameStarted) {
                    logConnectionEvent('lobby player disconnected', disconnectContext);
                    room.removePlayer(player.id);

                    if (room.players.length === 0) {
                        rooms.delete(roomCode);
                        console.log(`Room ${roomCode} deleted (empty)`);
                    }
                    saveState();
                    break;
                }

                // Mark player as disconnected but don't remove immediately
                player.disconnected = true;
                player.disconnectTime = Date.now();

                // Save state immediately on disconnect to preserve "disconnected" flag
                // This ensures if server restarts during grace period, player is still known
                saveState();

                logConnectionEvent('game player marked disconnected', {
                    ...disconnectContext,
                    disconnectTime: player.disconnectTime
                });

                // Give 30 seconds to reconnect
                setTimeout(() => {
                    // Check if player is still disconnected (hasn't reconnected)
                    // Note: If server restarted, this timeout is lost.
                    // But on restart, loaded state has "disconnected: true".
                    // The 'rejoinRoom' logic handles reconnect.
                    // If they never return, the room might stay with a ghost player forever?
                    // We might need a cleanup task on server start.
                    if (player.disconnected && room.hasPlayer(player.id)) {
                        logConnectionEvent('removing disconnected player after grace period', {
                            roomCode,
                            playerName: player.name,
                            playerId: player.id,
                            graceMs: Date.now() - player.disconnectTime
                        });
                        room.removePlayer(player.id);

                        if (room.players.length === 0) {
                            rooms.delete(roomCode);
                            console.log(`Room ${roomCode} deleted (empty)`);
                        }
                        saveState(); // Save final state
                    }
                }, 30000); // 30 second grace period

                break;
            }
        }
    });
});

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    // Make sure code is unique
    if (rooms.has(code)) {
        return generateRoomCode();
    }
    return code;
}

// Default to 3000 so Vite (dev) can proxy `/socket.io` to it, and README stays correct.
const PORT = process.env.PORT || 3000;
const localIP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n🎮 UNO Server Started!\n');
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Network: http://${localIP}:${PORT}`);
    console.log('\nShare the network URL with players on your local network!\n');
});
