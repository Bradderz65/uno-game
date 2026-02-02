import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';
import { GameClient } from './game-client.js';
import { sounds } from './sounds.js';

// Connect to server
const socketOrigin = window.location.port && window.location.port !== '3000'
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : window.location.origin;
const socket = io(socketOrigin);

// Initialize game client
const game = new GameClient(socket);

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
const drawBtn = document.getElementById('draw-btn');
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

// UI Elements for Multi Select
const playBtn = document.getElementById('play-btn');
const passBtn = document.getElementById('pass-btn');
const selectedCountSpan = document.getElementById('selected-count');

// Session storage keys
const SESSION_ROOM_KEY = 'uno_room_code';
const SESSION_NAME_KEY = 'uno_player_name';
const SESSION_ID_KEY = 'uno_player_id';

// Helper: Check compatibility (Must form a valid chain)
function areCardsCompatible(cards) {
    if (cards.length <= 1) return true;

    const first = cards[0];

    // Each card must match the FIRST one by VALUE/TYPE only
    for (let i = 1; i < cards.length; i++) {
        const current = cards[i];

        // Use loose equality for value to handle potential string/number mismatches
        const sameValue = first.type === current.type && first.value == current.value;

        if (!sameValue) {
            console.log('Compatibility check failed (must match value/type):', first, current);
            return false;
        }
    }
    return true;
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
        showToast("Cards must be identical to play together", "error");
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

    let showUno = false;
    if (state.currentPlayerId === myPlayerId) {
        const hand = state.hand;
        const topCard = state.topCard;
        const currentColor = state.currentColor;
        const drawStack = state.drawStack;

        if (selectedCardIndices.size > 0) {
            // Multi-play/Selection case: Does this selection leave 1 card OR chip out (0 cards)?
            const cardsRemaining = hand.length - selectedCardIndices.size;
            if (cardsRemaining <= 1) {
                const indices = Array.from(selectedCardIndices);
                const selectedCards = indices.map(i => hand[i]);

                // Must be compatible and the first card must be playable on the pile
                if (areCardsCompatible(selectedCards) && isLegalPlayableCard(selectedCards[0], hand.length, topCard, currentColor, drawStack)) {
                    showUno = true;
                }
            }
        } else {
            // No selection case: Do we have 1-2 cards AND at least one is playable?
            // 2 cards = going to 1, 1 card = chipping out
            if (hand.length <= 2) {
                const hasPlayable = hand.some(card => isLegalPlayableCard(card, hand.length, topCard, currentColor, drawStack));
                if (hasPlayable) {
                    showUno = true;
                }
            }
        }
    }

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
        socket.emit('startGame', currentRoomCode, startingCardsInput.value);
    }
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

drawBtn.addEventListener('click', () => {
    if (currentRoomCode && game.isMyTurn) {
        socket.emit('drawCard', currentRoomCode);
    }
});

passBtn.addEventListener('click', () => {
    if (currentRoomCode && game.isMyTurn) {
        socket.emit('passTurn', currentRoomCode);
    }
});

drawPile.addEventListener('click', () => {
    if (currentRoomCode && game.isMyTurn) {
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
            const indices = Array.from(selectedCardIndices).sort((a, b) => a - b);
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
    gameoverModal.classList.add('hidden');
    if (isHost) {
        socket.emit('startGame', currentRoomCode);
    }
});

// Sound toggle
soundToggle?.addEventListener('click', () => {
    const enabled = sounds.toggle();
    soundToggle.textContent = enabled ? '🔊' : '🔇';
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
    game.updateState(state);
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
    } else if (data.card.type === 'draw_two' || data.card.type === 'wild_draw_four') {
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
        showToast(`🚨 ${data.playerName} forgot to call UNO! +2 penalty cards`, 'info');
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
    updateDiscardPile(state.topCard, state.currentColor);

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

        if (state.hasDrawnThisTurn) {
            drawBtn.disabled = true;
            drawBtn.title = "You have already drawn.";
        } else if (hasPlayableCard && state.drawStack === 0) {
            drawBtn.disabled = true;
            drawBtn.title = "You have playable cards!";
        } else {
            drawBtn.disabled = false;
            drawBtn.title = "";
        }

        // Show pass button on my turn ONLY if I have drawn a card AND have no playable cards
        if (state.hasDrawnThisTurn && !hasPlayableCard) {
            passBtn.classList.remove('hidden');
        } else {
            passBtn.classList.add('hidden');
        }
    } else {
        document.body.classList.remove('my-turn');
        drawBtn.disabled = true;
        drawBtn.title = "";
        passBtn.classList.add('hidden');
    }

    updateMultiPlayUI();
}

function updateDiscardPile(topCard, currentColor) {
    if (!topCard) return;

    discardPile.innerHTML = '';
    const cardEl = createCardElement(topCard, false);

    // Add color indicator for wild cards
    if (topCard.color === 'wild' && currentColor) {
        const indicator = document.createElement('div');
        indicator.className = `color-indicator ${currentColor}`;
        indicator.style.background = `var(--uno-${currentColor})`;
        cardEl.appendChild(indicator);
    }

    discardPile.appendChild(cardEl);
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

function updatePlayerHand(hand, topCard, currentColor, isMyTurn, drawStack) {
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
    hand.forEach((card, index) => {
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
        cardEl.dataset.index = index;

        // Selection State
        if (selectedCardIndices.has(index)) {
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
        const currentChild = playerHand.children[index];
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
    playerHand.addEventListener('click', (e) => {
        const cardEl = e.target.closest('.hand-card');
        if (!cardEl) return;

        const index = parseInt(cardEl.dataset.index);
        const cardId = parseInt(cardEl.dataset.cardId);

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

    cardElements.forEach((cardEl, index) => {
        const card = hand[index];
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
    cardEl.className = `card ${card.color}`;

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
        default: return '?';
    }
}

function canPlayCard(card, topCard, currentColor, drawStack) {
    // If there's a draw stack, can only play matching stack cards
    if (drawStack > 0) {
        if (topCard.type === 'draw_two' && card.type === 'draw_two') return true;
        if (topCard.type === 'wild_draw_four' && card.type === 'wild_draw_four') return true;
        return false;
    }

    // Wild cards can always be played
    if (card.type === 'wild' || card.type === 'wild_draw_four') {
        return true;
    }

    // Same color
    if (card.color === currentColor) {
        return true;
    }

    // Same type for action cards
    if (card.type !== 'number' && card.type === topCard.type) {
        return true;
    }

    // Same number
    if (card.type === 'number' && topCard.type === 'number' && card.value == topCard.value) {
        return true;
    }

    return false;
}

function isLegalPlayableCard(card, handSize, topCard, currentColor, drawStack) {
    if (!canPlayCard(card, topCard, currentColor, drawStack)) return false;

    if (handSize === 1 && card.type !== 'number') {
        return false;
    }

    return true;
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
    winnerText.textContent = `🎉 ${data.winner.name} Wins! 🎉`;

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

    if (card.color === 'wild' && chosenColor) {
        const indicator = document.createElement('div');
        indicator.className = `color-indicator ${chosenColor}`;
        indicator.style.background = `var(--uno-${chosenColor})`;
        tempCard.appendChild(indicator);
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

    if (card.color === 'wild' && chosenColor) {
        const indicator = document.createElement('div');
        indicator.className = `color-indicator ${chosenColor}`;
        indicator.style.background = `var(--uno-${chosenColor})`;
        tempCard.appendChild(indicator);
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
