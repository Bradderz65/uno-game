import { GameClient } from './game-client.js';
import { areCardsCompatible, isLegalPlayableCard } from './game-rules.js';
import { sounds } from './sounds.js';

;(async () => {

// Connect to server
const socketOrigin = window.location.port && window.location.port !== '3000'
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : window.location.origin;

function loadScriptOnce(src) {
    const existing = Array.from(document.scripts).find(s => s.src === src);
    if (existing) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
    });
}

async function getSocketIoGlobal(socketOriginForClient) {
    if (typeof window.io === 'function') return window.io;

    // Prefer the locally-served client from our Socket.IO server so the game works offline.
    await loadScriptOnce(`${socketOriginForClient}/socket.io/socket.io.js`);

    if (typeof window.io !== 'function') {
        throw new Error('Socket.IO client loaded, but window.io is not available');
    }
    return window.io;
}

let socket;
try {
    const ioGlobal = await getSocketIoGlobal(socketOrigin);
    socket = ioGlobal(socketOrigin);
} catch (err) {
    console.error(err);
    alert('Failed to initialize networking (Socket.IO). Is the server running on port 3000?');
    throw err;
}

// Initialize game client
const game = new GameClient();

// DOM Elements - Lobby
const lobbyScreen = document.getElementById('lobby-screen');
const joinSection = document.getElementById('join-section');
const waitingSection = document.getElementById('waiting-section');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const roomsBrowser = document.getElementById('rooms-browser');
const roomsList = document.getElementById('rooms-list');
const refreshRoomsBtn = document.getElementById('refresh-rooms-btn');
const startBtn = document.getElementById('start-btn');
const addBotBtn = document.getElementById('add-bot-btn');
const displayRoomCode = document.getElementById('display-room-code');
const playersList = document.getElementById('players-list');
const waitingText = document.getElementById('waiting-text');
const leaveLobbyBtn = document.getElementById('leave-lobby-btn');
const leaveGameBtn = document.getElementById('leave-game-btn');
const gameSettings = document.getElementById('game-settings');
const startingCardsInput = document.getElementById('starting-cards');
const customCardEnabledInput = document.getElementById('custom-card-enabled');
const customCardSettings = document.getElementById('custom-card-settings');
const customCardDrawInput = document.getElementById('custom-card-draw');
const customCardCountInput = document.getElementById('custom-card-count');

// DOM Elements - Game
const gameScreen = document.getElementById('game-screen');
const currentPlayerName = document.getElementById('current-player-name');
const directionIndicator = document.getElementById('direction-indicator');
const gameRoomCode = document.getElementById('game-room-code');
const opponentsArea = document.getElementById('opponents-area');
const discardPile = document.getElementById('discard-pile');
const deckCount = document.getElementById('deck-count');
const drawStackIndicator = document.getElementById('draw-stack');
const drawStackCount = document.getElementById('draw-stack-count');
const playerHand = document.getElementById('player-hand');
const autoSortToggle = document.getElementById('auto-sort-toggle');
const drawBtn = document.getElementById('draw-btn');
const turnActionIcon = document.getElementById('turn-action-icon');
const turnActionLabel = document.getElementById('turn-action-label');
const turnActionStatus = document.getElementById('turn-action-status');
const unoBtn = document.getElementById('uno-btn');
const drawPile = document.getElementById('draw-pile');
const catchPanel = document.getElementById('catch-panel');
const catchButtons = document.getElementById('catch-buttons');

// DOM Elements - Modals
const colorModal = document.getElementById('color-modal');
const colorButtons = document.querySelectorAll('.color-btn');
const gameoverModal = document.getElementById('gameover-modal');
const winnerText = document.getElementById('winner-text');
const scoresList = document.getElementById('scores-list');
const playAgainBtn = document.getElementById('play-again-btn');
const rematchModal = document.getElementById('rematch-modal');
const rematchStatus = document.getElementById('rematch-status');
const rematchVotes = document.getElementById('rematch-votes');
const rematchYesBtn = document.getElementById('rematch-yes-btn');
const rematchNoBtn = document.getElementById('rematch-no-btn');
const soundToggle = document.getElementById('sound-toggle');

// Toast container
const toastContainer = document.getElementById('toast-container');

// State
let myPlayerId = null;
let currentRoomCode = null;
let isHost = false;
let selectedCardIndex = null;
let pendingWildCard = null;
let pendingMultiPlay = false; // For multi-play wild selection
let playerName = null;
let drawingCardIds = new Set();
let selectedCardIndices = new Set();
let pendingPlayAnimation = null;
let manualSortedCardIds = [];
let handDragState = null;
let suppressNextCardClick = false;
const AUTO_SORT_KEY = 'uno_auto_sort_hand';
const HAND_DRAG_HOLD_MS = 230;
const HAND_DRAG_CANCEL_DISTANCE = 10;

// UI Elements for Multi Select
const playBtn = document.getElementById('play-btn');
const selectedCountSpan = document.getElementById('selected-count');

// Session storage keys
const SESSION_ROOM_KEY = 'uno_room_code';
const SESSION_NAME_KEY = 'uno_player_name';
const SESSION_ID_KEY = 'uno_player_id';

if (autoSortToggle) {
    autoSortToggle.checked = localStorage.getItem(AUTO_SORT_KEY) === 'true';
}

// Play Selected Button
playBtn.addEventListener('click', () => {
    if (selectedCardIndices.size === 0) return;

    // Preserve selection order (do not sort)
    const indices = Array.from(selectedCardIndices);
    const hand = game.state.hand;
    const selectedCards = indices.map(i => hand[i]);

    // Validation (redundant but safe)
    if (!areCardsCompatible(selectedCards)) {
        showToast("Selected cards cannot be played together", "error");
        return;
    }

    // Check if Wild
    const hasWild = selectedCards.some(c => c.color === 'wild');
    if (hasWild) {
        pendingMultiPlay = true;
        colorModal.classList.remove('hidden');
        return;
    }

    pendingPlayAnimation = {
        cardIds: selectedCards.map(card => card.id),
        cards: selectedCards,
        chosenColor: null,
        startRects: selectedCards.map(card => {
            const cardEl = document.querySelector(`.hand-card[data-card-id="${card.id}"]`);
            return cardEl ? cardEl.getBoundingClientRect() : null;
        })
    };

    socket.emit('playCard', {
        roomCode: currentRoomCode,
        cardIndex: indices // Server handles array
    });

    selectedCardIndices.clear();
    updateMultiPlayUI();
});

function updateMultiPlayUI() {
    selectedCountSpan.textContent = selectedCardIndices.size;
    const isMyTurn = game.state?.currentPlayerId === myPlayerId;

    if (selectedCardIndices.size > 0 && isMyTurn) {
        playBtn.classList.remove('disabled');
        playBtn.disabled = false;
    } else {
        playBtn.classList.add('disabled');
        playBtn.disabled = true;
    }

    // Re-evaluate UNO button based on new selection
    if (game.state) {
        updateUnoButtonVisibility(game.state);
    }
}

function updateUnoButtonVisibility(state) {
    if (!state || !state.hand) return;

    const hand = state.hand;
    const showUno = hand.length === 1 && !state.hasCalledUno;

    if (showUno) {
        unoBtn.classList.remove('hidden');
    } else {
        unoBtn.classList.add('hidden');
    }
}

// Save session
function saveSession() {
    if (currentRoomCode && playerName) {
        sessionStorage.setItem(SESSION_ROOM_KEY, currentRoomCode);
        sessionStorage.setItem(SESSION_NAME_KEY, playerName);
        sessionStorage.setItem(SESSION_ID_KEY, myPlayerId);
    }
}

// Clear session
function clearSession() {
    sessionStorage.removeItem(SESSION_ROOM_KEY);
    sessionStorage.removeItem(SESSION_NAME_KEY);
    sessionStorage.removeItem(SESSION_ID_KEY);
}

// Try to reconnect from saved session
function tryReconnect() {
    const savedRoom = sessionStorage.getItem(SESSION_ROOM_KEY);
    const savedName = sessionStorage.getItem(SESSION_NAME_KEY);
    const savedId = sessionStorage.getItem(SESSION_ID_KEY);

    if (savedRoom && savedName) {
        showToast('Reconnecting...', 'info');
        socket.emit('rejoinRoom', { roomCode: savedRoom, playerName: savedName, oldPlayerId: savedId }, (response) => {
            if (response.success) {
                myPlayerId = response.playerId;
                game.setPlayerId(myPlayerId);
                currentRoomCode = response.roomCode;
                playerName = savedName;
                isHost = response.isHost;
                saveSession();

                if (response.gameInProgress) {
                    lobbyScreen.classList.remove('active');
                    gameScreen.classList.add('active');
                    gameRoomCode.textContent = currentRoomCode;
                    showToast('Reconnected to game!', 'success');
                } else {
                    showWaitingSection();
                    showToast('Reconnected to lobby!', 'success');
                }
            } else {
                clearSession();
                showToast('Could not reconnect: ' + response.error, 'error');
            }
        });
    }
}

// ========================================
// Event Listeners - Lobby
// ========================================

createBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    if (!name) {
        showToast('Please enter your name', 'error');
        playerNameInput.focus();
        return;
    }

    socket.emit('createRoom', name, (response) => {
        if (response.success) {
            myPlayerId = response.playerId;
            game.setPlayerId(myPlayerId);
            currentRoomCode = response.roomCode;
            playerName = name;
            isHost = true;
            saveSession();
            showWaitingSection();
            // Manually update UI for host since we know we're the host
            updateLobbyUIForHost();
        } else {
            showToast(response.error, 'error');
        }
    });
});

refreshRoomsBtn.addEventListener('click', () => {
    refreshRoomsList();
});

function refreshRoomsList() {
    socket.emit('getRooms', (rooms) => {
        if (rooms.length === 0) {
            roomsBrowser.classList.add('hidden');
            return;
        }

        roomsBrowser.classList.remove('hidden');
        roomsList.innerHTML = '';

        rooms.forEach(room => {
            const roomEl = document.createElement('div');
            roomEl.className = 'room-item';
            roomEl.innerHTML = `
                <div class="room-info-left">
                    <span class="room-code-display">${room.code}</span>
                    <span class="host-name">Host: ${escapeHtml(room.hostName)}</span>
                </div>
                <span class="player-count">${room.playerCount}/${room.maxPlayers} 👥</span>
            `;
            roomEl.addEventListener('click', () => {
                joinRoomByCode(room.code);
            });
            roomsList.appendChild(roomEl);
        });
    });
}

// Auto-refresh rooms
setInterval(refreshRoomsList, 3000);
socket.on('connect', () => {
    refreshRoomsList();
    tryReconnect(); // Keep existing reconnect logic
});

function joinRoomByCode(code) {
    const name = playerNameInput.value.trim();
    if (!name) {
        showToast('Please enter your name first', 'error');
        playerNameInput.focus();
        return;
    }

    socket.emit('joinRoom', { roomCode: code, playerName: name }, (response) => {
        if (response.success) {
            myPlayerId = response.playerId;
            game.setPlayerId(myPlayerId);
            currentRoomCode = response.roomCode;
            playerName = name;
            isHost = false;
            saveSession();
            showWaitingSection();
        } else {
            showToast(response.error, 'error');
        }
    });
}

joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();

    if (!name) {
        showToast('Please enter your name', 'error');
        playerNameInput.focus();
        return;
    }
    if (!code || code.length !== 4) {
        showToast('Please enter a valid room code', 'error');
        roomCodeInput.focus();
        return;
    }

    socket.emit('joinRoom', { roomCode: code, playerName: name }, (response) => {
        if (response.success) {
            myPlayerId = response.playerId;
            game.setPlayerId(myPlayerId);
            currentRoomCode = response.roomCode;
            playerName = name;
            isHost = false;
            saveSession();
            showWaitingSection();
        } else {
            showToast(response.error, 'error');
        }
    });
});

startBtn.addEventListener('click', () => {
    if (isHost && currentRoomCode) {
        socket.emit('startGame', currentRoomCode, startingCardsInput.value, getCustomCardConfig());
    }
});

customCardEnabledInput?.addEventListener('change', () => {
    customCardSettings?.classList.toggle('enabled', customCardEnabledInput.checked);
});

addBotBtn?.addEventListener('click', () => {
    if (!isHost || !currentRoomCode) return;
    socket.emit('addBot', currentRoomCode, (response) => {
        if (!response?.success) {
            showToast(response?.error || 'Could not add bot', 'error');
        }
    });
});

// Copy room code button
document.getElementById('copy-code-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoomCode).then(() => {
        const btn = document.getElementById('copy-code-btn');
        btn.classList.add('copied');
        showToast('Room code copied!', 'success');
        setTimeout(() => btn.classList.remove('copied'), 2000);
    });
});

// Starting cards +/- buttons
document.getElementById('dec-cards')?.addEventListener('click', () => {
    const input = document.getElementById('starting-cards');
    const val = parseInt(input.value) || 7;
    if (val > 1) input.value = val - 1;
});

document.getElementById('inc-cards')?.addEventListener('click', () => {
    const input = document.getElementById('starting-cards');
    const val = parseInt(input.value) || 7;
    if (val < 20) input.value = val + 1;
});

// Leave room function
function leaveRoom() {
    if (confirm('Are you sure you want to leave?')) {
        clearSession();
        socket.emit('leaveRoom', currentRoomCode);
        location.reload();
    }
}

leaveLobbyBtn?.addEventListener('click', leaveRoom);
leaveGameBtn?.addEventListener('click', leaveRoom);

// ========================================
// Event Listeners - Game
// ========================================

autoSortToggle?.addEventListener('change', () => {
    localStorage.setItem(AUTO_SORT_KEY, String(autoSortToggle.checked));
    manualSortedCardIds = [];
    selectedCardIndices.clear();

    if (game.state?.hand) {
        updatePlayerHand(game.state.hand, game.state.topCard, game.state.currentColor, game.isMyTurn, game.state.drawStack);
        updateMultiPlayUI();
    }
});

drawBtn.addEventListener('click', () => {
    if (!currentRoomCode || !game.isMyTurn || drawBtn.disabled) return;

    if (drawBtn.dataset.action === 'pass') {
        socket.emit('passTurn', currentRoomCode);
    } else {
        socket.emit('drawCard', currentRoomCode);
    }
});

drawPile.addEventListener('click', () => {
    if (currentRoomCode && game.isMyTurn && !drawBtn.disabled && drawBtn.dataset.action === 'draw') {
        socket.emit('drawCard', currentRoomCode);
    }
});

unoBtn.addEventListener('click', () => {
    if (currentRoomCode) {
        socket.emit('callUno', currentRoomCode);
        unoBtn.classList.add('hidden');
        showToast('UNO!', 'success');
        showUnoCallAnimation();
    }
});

// Color picker
colorButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        if (pendingWildCard !== null) {
            sounds.colorSelect();
            socket.emit('playCard', {
                roomCode: currentRoomCode,
                cardIndex: pendingWildCard,
                chosenColor: color
            });
            pendingWildCard = null;
            colorModal.classList.add('hidden');
        } else if (pendingMultiPlay) {
            sounds.colorSelect();
            const indices = Array.from(selectedCardIndices);
            const hand = game.state.hand;
            const selectedCards = indices.map(i => hand[i]);
            pendingPlayAnimation = {
                cardIds: selectedCards.map(card => card.id),
                cards: selectedCards,
                chosenColor: color,
                startRects: selectedCards.map(card => {
                    const cardEl = document.querySelector(`.hand-card[data-card-id="${card.id}"]`);
                    return cardEl ? cardEl.getBoundingClientRect() : null;
                })
            };
            socket.emit('playCard', {
                roomCode: currentRoomCode,
                cardIndex: indices,
                chosenColor: color
            });
            pendingMultiPlay = false;
            selectedCardIndices.clear();
            updateMultiPlayUI();
            colorModal.classList.add('hidden');
        }
    });
});

// Play again
playAgainBtn.addEventListener('click', () => {
    if (!currentRoomCode) return;
    playAgainBtn.disabled = true;
    socket.emit('requestRematch', currentRoomCode, (response) => {
        if (!response?.success) {
            playAgainBtn.disabled = false;
            showToast(response?.error || 'Could not request rematch', 'error');
        }
    });
});

rematchYesBtn?.addEventListener('click', () => {
    respondToRematch(true);
});

rematchNoBtn?.addEventListener('click', () => {
    respondToRematch(false);
});

// Sound toggle
soundToggle?.addEventListener('click', () => {
    const enabled = sounds.toggle();
    soundToggle.textContent = enabled ? 'Sound' : 'Muted';
    soundToggle.title = enabled ? 'Sound On' : 'Sound Off';
});

// ========================================
// Socket Event Handlers
// ========================================

socket.on('lobbyState', (state) => {
    updateLobbyUI(state);
});

socket.on('gameStarted', () => {
    lobbyScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameoverModal.classList.add('hidden');
    rematchModal.classList.add('hidden');
    playAgainBtn.disabled = false;
    gameRoomCode.textContent = currentRoomCode;
    sounds.gameStart();
});

socket.on('gameState', (state) => {
    // Check for other players drawing cards
    if (game.state) {
        state.players.forEach(player => {
            if (player.id !== myPlayerId) {
                const oldPlayer = game.state.players.find(p => p.id === player.id);
                if (oldPlayer && player.cardCount > oldPlayer.cardCount) {
                    const count = player.cardCount - oldPlayer.cardCount;
                    for (let i = 0; i < count; i++) {
                        setTimeout(() => {
                            animateOtherPlayerDraw(player.id);
                        }, i * 150);
                    }
                }
            }
        });
    }

    // Check if it just became our turn
    const wasMyTurn = game.isMyTurn;
    game.updateState(state, myPlayerId);
    updateGameUI(state);

    // Play "your turn" sound if turn just changed to us
    if (!wasMyTurn && state.currentPlayerId === myPlayerId) {
        sounds.yourTurn();
    }
});

socket.on('cardPlayed', (data) => {
    // Show animation for card being played
    showCardPlayedAnimation(data);

    // Play appropriate sound based on card type
    if (data.card.type === 'skip') {
        sounds.skip();
    } else if (data.card.type === 'reverse') {
        sounds.reverse();
    } else if (data.card.type === 'draw_two' || data.card.type === 'wild_draw_four' || data.card.type === 'custom_draw') {
        sounds.drawPenalty();
    } else if (data.card.type === 'wild') {
        sounds.wildCard();
    } else {
        sounds.cardPlay();
    }
});

socket.on('cardsDrawn', (cards) => {
    // Show animation for drawn cards
    cards.forEach((card, i) => {
        drawingCardIds.add(card.id);

        // IMMEDIATE FIX: Check if card is already in DOM and hide it
        const existingCard = document.querySelector(`.hand-card[data-card-id="${card.id}"]`);
        if (existingCard) {
            existingCard.style.visibility = 'hidden';
        }

        setTimeout(() => {
            showCardDrawAnimation(card);
            sounds.cardDraw();
        }, i * 150);
    });
});

socket.on('unoCalled', (data) => {
    showToast(`${data.playerName} called UNO!`, 'info');
    sounds.unoCall();
    if (data.playerId !== myPlayerId) {
        showUnoCallAnimation();
    }
});

socket.on('unoCaught', (data) => {
    showToast(`${data.catcherName} caught ${data.targetName}! +2 cards`, 'info');
    sounds.caught();
});

socket.on('unoForgotten', (data) => {
    // Warning everyone that a player forgot to call UNO
    if (data.playerId === myPlayerId) {
        showToast(`You forgot to call UNO! +2 penalty cards`, 'error');
    } else {
        showToast(`${data.playerName} forgot to call UNO! +2 penalty cards`, 'info');
    }
    sounds.caught();
});

socket.on('playRejected', (data) => {
    showToast(data.reason, 'error');
    sounds.error();
    pendingPlayAnimation = null;
});

socket.on('gameOver', (data) => {
    showGameOver(data);
    if (data.winner.id === myPlayerId) {
        sounds.victory();
    } else {
        sounds.lose();
    }
});

socket.on('rematchState', (state) => {
    showRematchPrompt(state);
});

socket.on('rematchDeclined', (data) => {
    rematchModal.classList.add('hidden');
    gameoverModal.classList.remove('hidden');
    playAgainBtn.disabled = true;
    playAgainBtn.textContent = 'Game Ended';
    showToast(`${data.playerName} ended the game`, 'info');
    clearSession();
    setTimeout(() => {
        location.reload();
    }, 1800);
});

socket.on('disconnect', () => {
    showToast('Disconnected from server', 'error');
    sounds.error();
});

socket.on('roomClosed', () => {
    clearSession();
    showToast('Room was closed', 'error');
    sounds.error();
    location.reload();
});

socket.on('kicked', () => {
    clearSession();
    showToast('You were removed from the room', 'error');
    sounds.error();
    location.reload();
});

// ========================================
// UI Update Functions
// ========================================

function showWaitingSection() {
    joinSection.classList.add('hidden');
    waitingSection.classList.remove('hidden');
    displayRoomCode.textContent = currentRoomCode;
}

function updateLobbyUIForHost() {
    // Show host controls immediately when creating room
    // This is a fallback in case the lobbyState event arrives before myPlayerId is set
    if (!isHost) return;
    
    startBtn.classList.remove('hidden');
    if (addBotBtn) {
        addBotBtn.classList.remove('hidden');
        addBotBtn.disabled = false;
        addBotBtn.title = '';
    }
    gameSettings.classList.remove('hidden');
    waitingText.classList.remove('hidden');
}

function updateLobbyUI(state) {
    playersList.innerHTML = '';
    
    // Update player count
    const playerCountEl = document.getElementById('player-count');
    if (playerCountEl) {
        playerCountEl.textContent = `${state.players.length}/10`;
    }

    state.players.forEach(player => {
        const item = document.createElement('div');
        item.className = 'player-item';
        
        // Determine badges
        let badges = '';
        if (player.id === myPlayerId) {
            badges += '<span class="badge" data-type="you">You</span>';
        }
        if (player.isHost) {
            badges += '<span class="badge" data-type="host">Host</span>';
        }
        if (player.isBot) {
            badges += '<span class="badge" data-type="bot">Bot</span>';
        }

        const canKick = isHost && player.id !== myPlayerId && !player.isHost;
        const kickButton = canKick
            ? `<button class="kick-btn" title="Remove player" aria-label="Remove player">✕</button>`
            : '';
        
        item.innerHTML = `
            <span class="name">${escapeHtml(player.name)}</span>
            <div class="badges">${badges}</div>
            ${kickButton}
        `;
        if (canKick) {
            const kickBtn = item.querySelector('.kick-btn');
            kickBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const label = player.isBot ? 'Remove bot?' : `Remove ${player.name}?`;
                if (!confirm(label)) return;
                socket.emit('kickPlayer', { roomCode: currentRoomCode, targetPlayerId: player.id }, (response) => {
                    if (!response?.success) {
                        showToast(response?.error || 'Could not remove player', 'error');
                    }
                });
            });
        }
        playersList.appendChild(item);

        if (player.id === myPlayerId) {
            isHost = player.isHost;
        }
    });

    if (isHost) {
        // Enable/disable start button based on player count
        const canStart = state.players.length >= 2;
        startBtn.disabled = !canStart;
        startBtn.classList.remove('hidden');
        
        if (addBotBtn) {
            addBotBtn.classList.remove('hidden');
            const isFull = state.players.length >= 10;
            addBotBtn.disabled = isFull;
            addBotBtn.title = isFull ? 'Room is full' : '';
        }
        gameSettings.classList.remove('hidden');
        waitingText.classList.toggle('hidden', state.players.length >= 2);
    } else {
        startBtn.classList.add('hidden');
        addBotBtn?.classList.add('hidden');
        gameSettings.classList.add('hidden');
        waitingText.classList.remove('hidden');
    }
}

function updateGameUI(state) {
    gameScreen.classList.toggle('draw-stack-active', state.drawStack > 0);

    // Current player indicator
    currentPlayerName.textContent = state.currentPlayerName || '---';

    // Direction indicator
    directionIndicator.textContent = state.direction === 1 ? '↻' : '↺';
    directionIndicator.classList.toggle('reversed', state.direction === -1);

    // Draw stack
    if (state.drawStack > 0) {
        drawStackIndicator.classList.remove('hidden');
        drawStackCount.textContent = state.drawStack;
    } else {
        drawStackIndicator.classList.add('hidden');
    }

    // Deck count
    deckCount.textContent = state.deckCount;

    // Top card
    updateDiscardPile(state.topCard, state.currentColor, state.discardHistory);

    // Opponents
    updateOpponents(state.players, state.currentPlayerId);

    // Player hand
    updatePlayerHand(state.hand, state.topCard, state.currentColor, state.currentPlayerId === myPlayerId, state.drawStack);

    // UNO button logic
    updateUnoButtonVisibility(state);

    // Catch panel
    if (state.playersWithOneCard && state.playersWithOneCard.length > 0) {
        showCatchPanel(state.playersWithOneCard);
    } else {
        catchPanel.classList.add('hidden');
    }

    // Highlight if it's my turn
    if (state.currentPlayerId === myPlayerId) {
        document.body.classList.add('my-turn');

        // Disable draw button if:
        // 1. Player has playable cards (and no stack)
        // 2. Player has already drawn this turn
        const hasPlayableCard = state.hand.some(card => isLegalPlayableCard(card, state.hand.length, state.topCard, state.currentColor, state.drawStack));

        if (state.hasDrawnThisTurn && !hasPlayableCard) {
            setTurnActionState({
                action: 'pass',
                disabled: false,
                label: 'Pass',
                title: 'End your turn.',
                status: 'No playable cards. Pass to end your turn.'
            });
        } else if (state.hasDrawnThisTurn) {
            setTurnActionState({
                action: 'draw',
                disabled: true,
                label: 'Draw',
                title: 'Play the card you drew or another playable card.',
                status: 'Play a card to continue.'
            });
        } else if (hasPlayableCard && state.drawStack === 0) {
            setTurnActionState({
                action: 'draw',
                disabled: true,
                label: 'Draw',
                title: 'You have playable cards.',
                status: 'Choose a playable card.'
            });
        } else {
            const hasStack = state.drawStack > 0;
            setTurnActionState({
                action: 'draw',
                disabled: false,
                label: hasStack ? `Draw ${state.drawStack}` : 'Draw',
                title: hasStack ? `Draw ${state.drawStack} cards.` : 'Draw a card.',
                status: hasStack ? `Stack is +${state.drawStack}. Play a plus card or draw.` : 'No playable cards. Draw one card.'
            });
        }
    } else {
        document.body.classList.remove('my-turn');
        setTurnActionState({
            action: 'draw',
            disabled: true,
            label: 'Draw',
            title: '',
            status: `Waiting for ${state.currentPlayerName || 'turn'}`
        });
    }

    updateMultiPlayUI();
}

function setTurnActionState({ action, disabled, label, title, status }) {
    const isPass = action === 'pass';
    drawBtn.dataset.action = action;
    drawBtn.disabled = disabled;
    drawBtn.title = title;
    drawBtn.classList.toggle('is-pass-action', isPass);
    turnActionIcon.textContent = isPass ? '→' : '↓';
    turnActionLabel.textContent = label;
    turnActionStatus.textContent = status;
}

function updateDiscardPile(topCard, currentColor, discardHistory = []) {
    if (!topCard) return;

    discardPile.innerHTML = '';
    const recentCards = (discardHistory.length ? discardHistory : [topCard]).slice(-3);

    recentCards.forEach((card, index) => {
        const cardEl = createCardElement(card, false);
        const isTopCard = index === recentCards.length - 1;
        const depth = recentCards.length - 1 - index;

        cardEl.classList.add(isTopCard ? 'discard-top-card' : 'discard-history-card');
        cardEl.dataset.discardDepth = depth;

        if (depth === 1) {
            const label = document.createElement('span');
            label.className = 'discard-history-label';
            label.textContent = 'Last';
            cardEl.appendChild(label);
        }

        if (isTopCard && isWildCard(card) && currentColor && currentColor !== 'wild') {
            applyChosenColorIndicator(cardEl, currentColor);
        }

        discardPile.appendChild(cardEl);
    });
}

function isWildCard(card) {
    return card?.color === 'wild' ||
        card?.type === 'wild' ||
        card?.type === 'wild_draw_four' ||
        card?.type === 'custom_draw';
}

function applyChosenColorIndicator(cardEl, chosenColor) {
    cardEl.classList.add('has-chosen-color');
    cardEl.style.setProperty('--chosen-color', `var(--uno-${chosenColor})`);
    cardEl.title = `Chosen color: ${chosenColor}`;
    cardEl.setAttribute('aria-label', `Chosen color: ${chosenColor}`);

    if (!cardEl.querySelector('.chosen-color-chip')) {
        const chip = document.createElement('span');
        chip.className = 'chosen-color-chip';
        cardEl.appendChild(chip);
    }
}

function updateOpponents(players, currentPlayerId) {
    opponentsArea.innerHTML = '';

    players.forEach(player => {
        if (player.id === myPlayerId) return;

        const opponentEl = document.createElement('div');
        opponentEl.className = `opponent ${player.isCurrentTurn ? 'active' : ''}`;
        opponentEl.dataset.playerId = player.id;

        // Create mini cards representation
        const cardsHtml = Array(Math.min(player.cardCount, 7))
            .fill('<div class="mini-card"></div>')
            .join('');

        opponentEl.innerHTML = `
      <span class="name">${escapeHtml(player.name)}</span>
      <div class="cards">${cardsHtml}</div>
      <span class="card-count">${player.cardCount}</span>
    `;

        opponentsArea.appendChild(opponentEl);
    });
}

function getCardSortRank(card) {
    const colorRank = {
        red: 0,
        yellow: 1,
        green: 2,
        blue: 3,
        wild: 4
    };

    const typeRank = {
        number: 0,
        skip: 1,
        reverse: 2,
        draw_two: 3,
        wild: 4,
        wild_draw_four: 5,
        custom_draw: 6
    };

    return {
        color: colorRank[card.color] ?? 9,
        type: typeRank[card.type] ?? 9,
        value: card.type === 'number' ? Number(card.value) : Number(card.drawAmount || 0)
    };
}

function compareCardsForHandSort(a, b) {
    const aRank = getCardSortRank(a.card);
    const bRank = getCardSortRank(b.card);

    if (aRank.color !== bRank.color) return aRank.color - bRank.color;
    if (aRank.type !== bRank.type) return aRank.type - bRank.type;
    if (aRank.value !== bRank.value) return aRank.value - bRank.value;
    return a.originalIndex - b.originalIndex;
}

function getSortedHandEntries(hand) {
    return hand
        .map((card, originalIndex) => ({ card, originalIndex }))
        .sort(compareCardsForHandSort);
}

function getCurrentDisplayCardIds() {
    return Array.from(playerHand.querySelectorAll('.hand-card'))
        .map(cardEl => parseInt(cardEl.dataset.cardId, 10))
        .filter(Number.isInteger);
}

function getDisplayHandEntries(hand) {
    if (autoSortToggle?.checked) {
        return getSortedHandEntries(hand);
    }

    if (!manualSortedCardIds.length) {
        return hand.map((card, originalIndex) => ({ card, originalIndex }));
    }

    const orderedIds = new Map(manualSortedCardIds.map((id, position) => [id, position]));
    return hand
        .map((card, originalIndex) => ({ card, originalIndex }))
        .sort((a, b) => {
            const aPosition = orderedIds.has(a.card.id) ? orderedIds.get(a.card.id) : Number.MAX_SAFE_INTEGER;
            const bPosition = orderedIds.has(b.card.id) ? orderedIds.get(b.card.id) : Number.MAX_SAFE_INTEGER;

            if (aPosition !== bPosition) return aPosition - bPosition;
            return compareCardsForHandSort(a, b);
        });
}

function pruneHandSortState(hand) {
    const idsInHand = new Set(hand.map(card => card.id));
    manualSortedCardIds = manualSortedCardIds.filter(id => idsInHand.has(id));
}

function ensureManualHandOrder(hand) {
    const existingIds = new Set(hand.map(card => card.id));
    const visibleOrder = getCurrentDisplayCardIds().filter(id => existingIds.has(id));
    const knownIds = new Set(visibleOrder);
    const missingIds = hand
        .map(card => card.id)
        .filter(id => !knownIds.has(id));

    manualSortedCardIds = [...visibleOrder, ...missingIds];
}

function moveCardIdInManualOrder(cardId, targetIndex) {
    const fromIndex = manualSortedCardIds.indexOf(cardId);
    if (fromIndex === -1) return false;

    const [cardIdToMove] = manualSortedCardIds.splice(fromIndex, 1);
    const boundedIndex = Math.max(0, Math.min(targetIndex, manualSortedCardIds.length));
    manualSortedCardIds.splice(boundedIndex, 0, cardIdToMove);
    return fromIndex !== boundedIndex;
}

function getHandDragTargetIndex(pointerX, pointerY, draggedCardId) {
    const cards = Array.from(playerHand.querySelectorAll('.hand-card'))
        .filter(cardEl => parseInt(cardEl.dataset.cardId, 10) !== draggedCardId);

    if (!cards.length) return 0;

    for (let index = 0; index < cards.length; index++) {
        const rect = cards[index].getBoundingClientRect();
        const midpointX = rect.left + rect.width / 2;
        const midpointY = rect.top + rect.height / 2;
        const sameRow = pointerY >= rect.top - rect.height * 0.45 && pointerY <= rect.bottom + rect.height * 0.45;

        if ((sameRow && pointerX < midpointX) || pointerY < midpointY - rect.height * 0.55) {
            return index;
        }
    }

    return cards.length;
}

function setAutoSortEnabled(enabled) {
    if (!autoSortToggle) return;
    autoSortToggle.checked = enabled;
    localStorage.setItem(AUTO_SORT_KEY, String(enabled));
}

function updateHandAfterManualReorder() {
    if (!game.state?.hand) return;
    updatePlayerHand(game.state.hand, game.state.topCard, game.state.currentColor, game.isMyTurn, game.state.drawStack);
    updateMultiPlayUI();
}

function clearHandDragState({ suppressClick = false } = {}) {
    if (!handDragState) return;

    clearTimeout(handDragState.holdTimer);

    const draggedEl = playerHand.querySelector(`.hand-card[data-card-id="${handDragState.cardId}"]`);
    draggedEl?.classList.remove('is-reordering');
    playerHand.classList.remove('is-reordering-hand');
    document.body.classList.remove('is-reordering-hand');

    if (suppressClick) {
        suppressNextCardClick = true;
        window.setTimeout(() => {
            suppressNextCardClick = false;
        }, 0);
    }

    handDragState = null;
}

function beginHandCardReorder() {
    if (!handDragState || !game.state?.hand?.length) return;

    setAutoSortEnabled(false);
    ensureManualHandOrder(game.state.hand);

    handDragState.active = true;
    selectedCardIndices.clear();

    const draggedEl = playerHand.querySelector(`.hand-card[data-card-id="${handDragState.cardId}"]`);
    draggedEl?.classList.add('is-reordering');
    playerHand.classList.add('is-reordering-hand');
    document.body.classList.add('is-reordering-hand');
    sounds.click();
}

function handleHandPointerMove(e) {
    if (!handDragState) return;

    const distance = Math.hypot(e.clientX - handDragState.startX, e.clientY - handDragState.startY);

    if (!handDragState.active) {
        if (distance > HAND_DRAG_CANCEL_DISTANCE) {
            clearHandDragState();
        }
        return;
    }

    e.preventDefault();

    handDragState.pointerX = e.clientX;
    handDragState.pointerY = e.clientY;

    const targetIndex = getHandDragTargetIndex(e.clientX, e.clientY, handDragState.cardId);
    if (moveCardIdInManualOrder(handDragState.cardId, targetIndex)) {
        updateHandAfterManualReorder();
        const draggedEl = playerHand.querySelector(`.hand-card[data-card-id="${handDragState.cardId}"]`);
        draggedEl?.classList.add('is-reordering');
    }
}

function updatePlayerHand(hand, topCard, currentColor, isMyTurn, drawStack) {
    pruneHandSortState(hand);
    const displayHand = getDisplayHandEntries(hand);

    // 1. FLIP: First - Capture state
    const snapshots = new Map();
    playerHand.querySelectorAll('.hand-card').forEach(el => {
        const id = parseInt(el.dataset.cardId);
        // We must strip any current transform/relative positioning to get the "real" layout-based rect?
        // Actually, getBoundingClientRect returns the visual position.
        // If we are mid-animation, we want the current visual position to start the next one from.
        snapshots.set(id, el.getBoundingClientRect());
    });

    // Track existing elements map for reuse
    const existingElements = new Map();
    playerHand.querySelectorAll('.hand-card').forEach(el => {
        const id = parseInt(el.dataset.cardId);
        existingElements.set(id, el);
    });

    // 2. DOM Updates
    displayHand.forEach(({ card, originalIndex }, displayIndex) => {
        let cardEl = existingElements.get(card.id);

        if (!cardEl) {
            // New Card
            cardEl = createCardElement(card, false);
            cardEl.classList.add('hand-card');
            cardEl.dataset.cardId = card.id;

            // Set initial style for FLIP safety
            cardEl.style.position = 'relative';
            cardEl.style.left = '0';
            cardEl.style.top = '0';
        }

        // Update Metadata
        cardEl.dataset.index = originalIndex;

        // Selection State
        if (selectedCardIndices.has(originalIndex)) {
            cardEl.classList.add('selected');
        } else {
            cardEl.classList.remove('selected');
        }

        // Visibility (for drawing animation)
        if (drawingCardIds.has(card.id)) {
            cardEl.style.visibility = 'hidden';
        } else {
            cardEl.style.visibility = 'visible';
        }

        // Reorder/Insert
        const currentChild = playerHand.children[displayIndex];
        if (currentChild !== cardEl) {
            if (currentChild) {
                playerHand.insertBefore(cardEl, currentChild);
            } else {
                playerHand.appendChild(cardEl);
            }
        }
    });

    // Remove old cards
    existingElements.forEach((el, id) => {
        if (!hand.some(c => c.id === id)) {
            el.remove();
        }
    });

    // 3. FLIP: Last, Invert, Play
    // Force Layout Recalculation (implicitly done by getBoundingClientRect below)

    hand.forEach(card => {
        const el = playerHand.querySelector(`.hand-card[data-card-id="${card.id}"]`);
        if (!el) return;

        const newRect = el.getBoundingClientRect();
        const oldRect = snapshots.get(card.id);

        if (oldRect) {
            // Existing card: Animate from old position
            const deltaX = oldRect.left - newRect.left;
            const deltaY = oldRect.top - newRect.top;

            if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
                // Invert: Position relative to visually return to old spot
                el.style.transition = 'none';
                el.style.position = 'relative';
                el.style.left = `${deltaX}px`;
                el.style.top = `${deltaY}px`;

                // Play
                requestAnimationFrame(() => {
                    // Force reflow
                    el.getBoundingClientRect();

                    // Enable transition and slide to 0
                    el.style.transition = 'left 0.3s ease-out, top 0.3s ease-out';
                    el.style.left = '0';
                    el.style.top = '0';

                    // Cleanup after animation
                    setTimeout(() => {
                        if (el.style.left === '0px') { // Check if not interrupted
                            el.style.transition = '';
                            el.style.position = '';
                            el.style.left = '';
                            el.style.top = '';
                        }
                    }, 300);
                });
            }
        } else {
            // New card: Just appears (or stays hidden if drawing)
            // Ensure clean state
            if (!drawingCardIds.has(card.id)) {
                // Optional: Animate entry? For now, standard behavior.
                el.style.transition = '';
                el.style.position = '';
                el.style.left = '';
                el.style.top = '';
            }
        }
    });

    // 5. Update visuals (Playability)
    updateHandVisuals();
}

// Event Delegation for Player Hand (Run once on init)
// We need to ensure we don't add this multiple times.
if (!playerHand.hasAttribute('data-listener-attached')) {
    playerHand.addEventListener('pointerdown', (e) => {
        const cardEl = e.target.closest('.hand-card');
        if (!cardEl || e.button > 0) return;

        const cardId = parseInt(cardEl.dataset.cardId, 10);
        if (!Number.isInteger(cardId)) return;

        clearHandDragState();

        handDragState = {
            cardId,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            pointerX: e.clientX,
            pointerY: e.clientY,
            active: false,
            holdTimer: window.setTimeout(beginHandCardReorder, HAND_DRAG_HOLD_MS)
        };

        cardEl.setPointerCapture?.(e.pointerId);
    });

    playerHand.addEventListener('pointermove', handleHandPointerMove);

    playerHand.addEventListener('pointerup', (e) => {
        if (!handDragState || handDragState.pointerId !== e.pointerId) return;
        clearHandDragState({ suppressClick: handDragState.active });
    });

    playerHand.addEventListener('pointercancel', (e) => {
        if (!handDragState || handDragState.pointerId !== e.pointerId) return;
        clearHandDragState({ suppressClick: handDragState.active });
    });

    playerHand.addEventListener('click', (e) => {
        if (suppressNextCardClick) {
            e.preventDefault();
            suppressNextCardClick = false;
            return;
        }

        const cardEl = e.target.closest('.hand-card');
        if (!cardEl) return;

        const index = parseInt(cardEl.dataset.index, 10);
        const cardId = parseInt(cardEl.dataset.cardId, 10);

        // Find the card in current state
        const hand = game.state.hand;
        const card = hand[index];

        // Validation check (ensure sync)
        if (!card || card.id !== cardId) {
            console.warn("Card click sync error", index, cardId, card);
            return;
        }

        const topCard = game.state.topCard;
        const currentColor = game.state.currentColor;
        const drawStack = game.state.drawStack;
        const isMyTurn = game.state.currentPlayerId === myPlayerId;

        const canPlay = isMyTurn && isLegalPlayableCard(card, hand.length, topCard, currentColor, drawStack);

        // Smart Switch Logic
        if (selectedCardIndices.has(index)) {
            selectedCardIndices.delete(index);
            cardEl.classList.remove('selected');
        } else {
            // If incompatible with existing chain, clear and start new selection
            if (selectedCardIndices.size > 0) {
                const indices = Array.from(selectedCardIndices);
                const currentChain = indices.map(i => hand[i]);

                if (!areCardsCompatible([...currentChain, card])) {
                    selectedCardIndices.clear();
                    const allCards = playerHand.querySelectorAll('.hand-card');
                    allCards.forEach(el => el.classList.remove('selected'));
                }
            }

            if (!canPlay && selectedCardIndices.size === 0) {
                sounds.error();
                return;
            }

            selectedCardIndices.add(index);
            cardEl.classList.add('selected');
            sounds.click();
        }
        updateMultiPlayUI();
        updateHandVisuals();
    });
    playerHand.setAttribute('data-listener-attached', 'true');
}

function updateHandVisuals() {
    const hand = game.state?.hand;
    if (!hand) return;

    const cardElements = playerHand.querySelectorAll('.hand-card');

    // Determine the target we are matching against
    let targetCard = null;
    let matchingAgainstSelection = false;

    if (selectedCardIndices.size > 0) {
        // Match against the LAST selected card
        const indices = Array.from(selectedCardIndices);
        const lastIndex = indices[indices.length - 1];
        targetCard = hand[lastIndex];
        matchingAgainstSelection = true;
    }

    cardElements.forEach((cardEl) => {
        const index = parseInt(cardEl.dataset.index, 10);
        const card = hand[index];
        if (!card) return;
        let isPlayable = false;

        if (selectedCardIndices.has(index)) {
            isPlayable = true; // Selected cards are always active
        } else if (matchingAgainstSelection) {
            // Check if card can follow the last selected card
            // We reuse areCardsCompatible with a 2-card chain
            isPlayable = areCardsCompatible([targetCard, card]);
        } else {
            // No selection: Match against Pile (standard rules)
            // Reuse the existing canPlayCard logic which handles Pile, Color, Stack
            isPlayable = game.isMyTurn && isLegalPlayableCard(card, hand.length, game.state.topCard, game.state.currentColor, game.state.drawStack);
        }

        if (isPlayable) {
            cardEl.classList.add('playable');
            cardEl.classList.remove('not-playable');
        } else {
            cardEl.classList.remove('playable');
            cardEl.classList.add('not-playable');
        }
    });
}

function createCardElement(card, canPlay = false) {
    const cardEl = document.createElement('div');
    const typeClass = card.type.replaceAll('_', '-');
    const isPlusCard = card.type === 'draw_two' || card.type === 'wild_draw_four' || card.type === 'custom_draw';
    cardEl.className = `card ${card.color} ${typeClass}${isPlusCard ? ' plus-card' : ''}`;

    const value = getCardDisplayValue(card);

    // Add card value in center
    const valueEl = document.createElement('span');
    valueEl.className = 'card-value';
    valueEl.textContent = value;
    cardEl.appendChild(valueEl);

    // Add corner indicators
    const cornerTL = document.createElement('span');
    cornerTL.className = 'corner-tl';
    cornerTL.textContent = value;
    cardEl.appendChild(cornerTL);

    const cornerBR = document.createElement('span');
    cornerBR.className = 'corner-br';
    cornerBR.textContent = value;
    cardEl.appendChild(cornerBR);

    return cardEl;
}

function getCardDisplayValue(card) {
    switch (card.type) {
        case 'number': return card.value.toString();
        case 'skip': return '⊘';
        case 'reverse': return '↺';
        case 'draw_two': return '+2';
        case 'wild': return 'W';
        case 'wild_draw_four': return '+4';
        case 'custom_draw': return `+${card.drawAmount || parseInt(String(card.value).replace('+', ''), 10) || 8}`;
        default: return '?';
    }
}

function getCustomCardConfig() {
    return {
        enabled: Boolean(customCardEnabledInput?.checked),
        drawAmount: customCardDrawInput?.value || 8,
        count: customCardCountInput?.value || 2
    };
}

function showCatchPanel(players) {
    catchPanel.classList.remove('hidden');
    // Update label to be more descriptive
    const label = catchPanel.querySelector('.catch-label');
    if (label) {
        label.textContent = "Catch Failure!";
        label.title = "These players have 1 card left but forgot to say UNO! Click to make them draw 2 cards.";
    }
    catchButtons.innerHTML = '';

    players.forEach(player => {
        const btn = document.createElement('button');
        btn.className = 'catch-btn';
        btn.textContent = player.name;
        btn.addEventListener('click', () => {
            socket.emit('catchUno', {
                roomCode: currentRoomCode,
                targetPlayerId: player.id
            });
            catchPanel.classList.add('hidden');
        });
        catchButtons.appendChild(btn);
    });
}

function showGameOver(data) {
    winnerText.textContent = `${data.winner.name} Wins`;
    playAgainBtn.disabled = false;
    playAgainBtn.textContent = 'Play Again';

    scoresList.innerHTML = '';
    // Scores are already sorted by server (1st place first)
    data.scores.forEach((score, index) => {
        const rank = index + 1;
        const ordinal = getOrdinal(rank);
        const item = document.createElement('div');
        item.className = `score-item ${score.id === data.winner.id ? 'winner' : ''}`;
        item.innerHTML = `
        <span>${escapeHtml(score.name)}</span>
        <span>${ordinal}</span>
      `;
        scoresList.appendChild(item);
    });

    gameoverModal.classList.remove('hidden');

    // Show confetti
    createConfetti();
}

function showRematchPrompt(state) {
    if (!state) return;

    gameoverModal.classList.add('hidden');
    rematchModal.classList.remove('hidden');
    rematchStatus.textContent = `${state.acceptedCount}/${state.totalCount} ready`;
    rematchVotes.innerHTML = '';

    state.players.forEach(player => {
        const item = document.createElement('div');
        item.className = `rematch-vote ${player.accepted ? 'accepted' : ''}`;
        item.innerHTML = `
            <span>${escapeHtml(player.name)}${player.isBot ? ' Bot' : ''}</span>
            <span>${player.accepted ? 'Ready' : 'Waiting'}</span>
        `;
        rematchVotes.appendChild(item);
    });

    const myVote = state.players.find(player => player.id === myPlayerId);
    const hasAnswered = myVote?.accepted === true;
    rematchYesBtn.disabled = hasAnswered;
    rematchYesBtn.textContent = hasAnswered ? 'Ready' : 'Continue';
    rematchNoBtn.disabled = false;
}

function respondToRematch(wantsRematch) {
    if (!currentRoomCode) return;

    rematchYesBtn.disabled = true;
    rematchNoBtn.disabled = true;

    socket.emit('respondRematch', { roomCode: currentRoomCode, wantsRematch }, (response) => {
        if (!response?.success && !response?.declined) {
            rematchYesBtn.disabled = false;
            rematchNoBtn.disabled = false;
            showToast(response?.error || 'Could not update rematch vote', 'error');
        }
    });
}

function getOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ========================================
// Animations
// ========================================

function showCardPlayedAnimation(data) {
    // Flash the discard pile
    discardPile.classList.add('animate-color-flash');
    setTimeout(() => {
        discardPile.classList.remove('animate-color-flash');
    }, 300);

    const isLocalPlay = data?.playerId === myPlayerId && pendingPlayAnimation?.cardIds?.length;
    const count = Math.max(1, data?.count || 1);

    if (isLocalPlay) {
        const { cardIds, cards, chosenColor, startRects } = pendingPlayAnimation;
        cardIds.slice(0, count).forEach((cardId, i) => {
            setTimeout(() => {
                const cardEl = document.querySelector(`.hand-card[data-card-id="${cardId}"]`);
                const card = cards[i] || cards.find(c => c.id === cardId) || data.card;
                const startRect = startRects?.[i] || (cardEl ? cardEl.getBoundingClientRect() : null);
                animateHandCardToDiscard(cardEl, card, chosenColor || data.chosenColor, startRect);
            }, i * 120);
        });
        pendingPlayAnimation = null;
        return;
    }

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            animateCardPlayToDiscard(data.card, data.chosenColor);
        }, i * 120);
    }
}

function animateCardPlayToDiscard(card, chosenColor) {
    const drawPileEl = document.getElementById('draw-pile');
    const discardEl = document.getElementById('discard-pile');

    if (!drawPileEl || !discardEl) return;

    const deckRect = drawPileEl.getBoundingClientRect();
    const discardRect = discardEl.getBoundingClientRect();

    const tempCard = createCardElement(card);
    tempCard.classList.add('drawing-card-temp', 'playing-card-temp');

    if (isWildCard(card) && chosenColor && chosenColor !== 'wild') {
        applyChosenColorIndicator(tempCard, chosenColor);
    }

    tempCard.style.position = 'fixed';
    tempCard.style.left = `${deckRect.left}px`;
    tempCard.style.top = `${deckRect.top}px`;
    tempCard.style.width = `${deckRect.width}px`;
    tempCard.style.height = `${deckRect.height}px`;
    tempCard.style.margin = '0';
    tempCard.style.transform = 'scale(0.5) rotate(-15deg)';
    tempCard.style.opacity = '0.8';
    tempCard.style.transition = 'none';

    document.body.appendChild(tempCard);

    requestAnimationFrame(() => {
        tempCard.style.transition = '';
        tempCard.style.left = `${discardRect.left}px`;
        tempCard.style.top = `${discardRect.top}px`;
        tempCard.style.width = `${discardRect.width}px`;
        tempCard.style.height = `${discardRect.height}px`;
        tempCard.style.transform = 'scale(1) rotate(0deg)';
        tempCard.style.opacity = '1';
    });

    setTimeout(() => {
        tempCard.remove();
    }, 600);
}

function animateHandCardToDiscard(cardEl, card, chosenColor, startRectOverride) {
    const discardEl = document.getElementById('discard-pile');
    if (!discardEl || !card) return;

    const discardRect = discardEl.getBoundingClientRect();
    const startRect = startRectOverride || (cardEl ? cardEl.getBoundingClientRect() : discardRect);

    const tempCard = createCardElement(card);
    tempCard.classList.add('drawing-card-temp', 'playing-card-temp');

    if (isWildCard(card) && chosenColor && chosenColor !== 'wild') {
        applyChosenColorIndicator(tempCard, chosenColor);
    }

    tempCard.style.position = 'fixed';
    tempCard.style.left = `${startRect.left}px`;
    tempCard.style.top = `${startRect.top}px`;
    tempCard.style.width = `${startRect.width}px`;
    tempCard.style.height = `${startRect.height}px`;
    tempCard.style.margin = '0';
    tempCard.style.transform = 'scale(1) rotate(0deg)';
    tempCard.style.opacity = '1';
    tempCard.style.transition = 'none';

    document.body.appendChild(tempCard);

    requestAnimationFrame(() => {
        tempCard.style.transition = '';
        tempCard.style.left = `${discardRect.left}px`;
        tempCard.style.top = `${discardRect.top}px`;
        tempCard.style.width = `${discardRect.width}px`;
        tempCard.style.height = `${discardRect.height}px`;
        tempCard.style.transform = 'scale(1) rotate(-6deg)';
        tempCard.style.opacity = '1';
    });

    setTimeout(() => {
        tempCard.remove();
    }, 600);
}

function showCardDrawAnimation(card) {
    const drawPile = document.getElementById('draw-pile');
    const playerHand = document.getElementById('player-hand');

    if (!drawPile || !playerHand) return;

    // Create a temporary card element
    const tempCard = createCardElement(card);
    tempCard.classList.add('drawing-card-temp');

    // Get deck position for start
    const deckRect = drawPile.getBoundingClientRect();
    const startX = deckRect.left;
    const startY = deckRect.top;

    // Set initial position
    tempCard.style.position = 'fixed';
    tempCard.style.left = `${startX}px`;
    tempCard.style.top = `${startY}px`;
    tempCard.style.width = `${deckRect.width}px`;
    tempCard.style.height = `${deckRect.height}px`;
    tempCard.style.margin = '0';
    tempCard.style.transform = 'scale(0.5) rotate(-10deg)';
    // Remove transition for manual control
    tempCard.style.transition = 'none';

    document.body.appendChild(tempCard);

    const startTime = performance.now();
    const duration = 600; // ms

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease-out-cubic)
        const ease = 1 - Math.pow(1 - progress, 3);

        // Find current target position
        const realCard = playerHand.querySelector(`.hand-card[data-card-id="${card.id}"]`);

        if (realCard) {
            const targetRect = realCard.getBoundingClientRect();

            // Interpolate position
            const currentX = startX + (targetRect.left - startX) * ease;
            const currentY = startY + (targetRect.top - startY) * ease;

            // Interpolate scale and rotation
            const currentScale = 0.5 + (1.0 - 0.5) * ease;
            const currentRotation = -10 + (360 + 10) * ease; // Spin to 360

            tempCard.style.left = `${currentX}px`;
            tempCard.style.top = `${currentY}px`;
            tempCard.style.transform = `scale(${currentScale}) rotate(${currentRotation}deg)`;
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Animation complete
            if (realCard) {
                drawingCardIds.delete(card.id);
                realCard.style.visibility = 'visible';
                realCard.classList.add('animate-bounce');
                setTimeout(() => realCard.classList.remove('animate-bounce'), 500);
            }
            tempCard.remove();
        }
    }

    requestAnimationFrame(animate);
}

function animateOtherPlayerDraw(playerId) {
    const drawPile = document.getElementById('draw-pile');
    const opponentEl = document.querySelector(`.opponent[data-player-id="${playerId}"]`);

    if (!drawPile || !opponentEl) return;

    // Create a temporary card element (back only)
    const tempCard = document.createElement('div');
    tempCard.className = 'card card-back drawing-card-temp';
    tempCard.innerHTML = '<div class="card-back-design">UNO</div>';

    // Get deck position
    const deckRect = drawPile.getBoundingClientRect();

    // Set initial position
    tempCard.style.position = 'fixed';
    tempCard.style.top = `${deckRect.top}px`;
    tempCard.style.left = `${deckRect.left}px`;
    tempCard.style.width = `${deckRect.width}px`;
    tempCard.style.height = `${deckRect.height}px`;

    document.body.appendChild(tempCard);

    // Force reflow
    tempCard.offsetHeight;

    // Find target position
    const opponentRect = opponentEl.getBoundingClientRect();
    const targetTop = opponentRect.top;
    const targetLeft = opponentRect.left + opponentRect.width / 2;

    // Animate to opponent
    tempCard.style.top = `${targetTop}px`;
    tempCard.style.left = `${targetLeft}px`;
    tempCard.style.transform = 'scale(0.3) rotate(-180deg)';
    tempCard.style.opacity = '0.5';

    setTimeout(() => {
        tempCard.remove();
        // Brief highlight of the opponent
        opponentEl.classList.add('animate-color-flash');
        setTimeout(() => {
            opponentEl.classList.remove('animate-color-flash');
        }, 300);
    }, 600);
}

function showUnoCallAnimation() {
    const overlay = document.createElement('div');
    overlay.className = 'uno-call-overlay';
    overlay.innerHTML = '<div class="uno-call-text">UNO!</div>';
    document.body.appendChild(overlay);

    setTimeout(() => {
        overlay.remove();
    }, 1000);
}

function createConfetti() {
    const colors = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#6366f1'];

    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animation = `confettiFall ${2 + Math.random() * 2}s ease-out forwards`;
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        document.body.appendChild(confetti);

        setTimeout(() => confetti.remove(), 4000);
    }
}

// ========================================
// Utilities
// ========================================

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Auto-focus name input
playerNameInput.focus();

// Handle Enter key in inputs
playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        roomCodeInput.focus();
    }
});

roomCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinBtn.click();
    }
});

// Export for HMR
if (import.meta.hot) {
    import.meta.hot.accept();
}

})();
