import { createDeck, shuffleDeck, canPlayCard, areCardsCompatible, CARD_TYPES, COLORS } from './game.js';

export class GameRoom {
    constructor(roomCode, io) {
        this.roomCode = roomCode;
        this.io = io;
        this.players = [];
        this.gameStarted = false;
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.direction = 1; // 1 = clockwise, -1 = counter-clockwise
        this.currentColor = null;
        this.drawStack = 0; // For stacking +2 and +4
        this.unoCalledBy = new Set();
        this.winner = null;
        this.hasDrawnThisTurn = false;
        this.pendingBotTurn = null;
    }

    addPlayer(socket, name) {
        const player = {
            id: socket.id,
            socket,
            name,
            hand: [],
            isHost: this.players.length === 0,
            isBot: false
        };
        this.players.push(player);
        this.broadcastLobbyState();
    }

    addBot() {
        const botNumber = this.players.filter(p => p.isBot).length + 1;
        const botId = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const botSocket = {
            id: botId,
            emit: () => {},
            join: () => {},
            leave: () => {}
        };
        const player = {
            id: botId,
            socket: botSocket,
            name: `Bot ${botNumber}`,
            hand: [],
            isHost: false,
            isBot: true
        };
        this.players.push(player);
        this.broadcastLobbyState();
    }

    removePlayer(playerId) {
        const index = this.players.findIndex(p => p.id === playerId);
        if (index !== -1) {
            this.players.splice(index, 1);

            if (this.gameStarted && this.players.length > 1) {
                // Adjust current player index if needed
                if (this.currentPlayerIndex >= this.players.length) {
                    this.currentPlayerIndex = 0;
                }
                this.broadcastGameState();
            } else if (this.players.length > 0) {
                // Make first player the new host
                this.players[0].isHost = true;
                this.broadcastLobbyState();
            }
        }
    }

    hasPlayer(playerId) {
        return this.players.some(p => p.id === playerId);
    }

    isHost(playerId) {
        const player = this.players.find(p => p.id === playerId);
        return player && player.isHost;
    }

    broadcastLobbyState() {
        const state = {
            roomCode: this.roomCode,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                isBot: p.isBot
            })),
            gameStarted: this.gameStarted
        };
        this.io.to(this.roomCode).emit('lobbyState', state);
    }

    startGame(startingCardCount = 7) {
        if (this.players.length < 2) {
            return;
        }

        this.gameStarted = true;
        this.deck = shuffleDeck(createDeck());
        this.discardPile = [];
        this.direction = 1;
        this.currentPlayerIndex = 0;
        this.drawStack = 0;
        this.unoCalledBy.clear();
        this.winner = null;
        this.hasDrawnThisTurn = false;
        this.isDealing = true;

        // Initialize empty hands
        for (const player of this.players) {
            player.hand = [];
        }

        // Place first card (reshuffle if it's a Wild Draw Four)
        let firstCard;
        do {
            firstCard = this.drawFromDeck();
            if (firstCard.type === CARD_TYPES.WILD_DRAW_FOUR) {
                this.deck.push(firstCard);
                this.deck = shuffleDeck(this.deck);
            }
        } while (firstCard.type === CARD_TYPES.WILD_DRAW_FOUR);

        this.discardPile.push(firstCard);
        this.currentColor = firstCard.color === 'wild' ? COLORS[Math.floor(Math.random() * 4)] : firstCard.color;

        // Handle first card effects
        this.handleFirstCardEffect(firstCard);

        this.broadcastGameState();
        this.io.to(this.roomCode).emit('gameStarted');
        
        // Deal cards with animation effect
        this.dealInitialCards(parseInt(startingCardCount) || 7);
    }

    async dealInitialCards(count) {
        // Delay to allow game screen to load
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Deal 1 card to each player, 'count' times
        for (let i = 0; i < count; i++) {
             await new Promise(resolve => setTimeout(resolve, 200)); // Delay between rounds
             
             for (const player of this.players) {
                 const card = this.drawFromDeck();
                 if (!card) break; // Safety check if deck runs out
                 
                 player.hand.push(card);
                 
                 // Notify player (triggers animation)
                 player.socket.emit('cardsDrawn', [card]);
             }
             // Update everyone (updates card counts for opponents)
             this.broadcastGameState();
        }
        
        this.isDealing = false;
        this.broadcastGameState();
    }

    handleFirstCardEffect(card) {
        switch (card.type) {
            case CARD_TYPES.SKIP:
                this.nextTurn();
                break;
            case CARD_TYPES.REVERSE:
                this.direction *= -1;
                break;
            case CARD_TYPES.DRAW_TWO:
                this.drawStack = 2;
                break;
            case CARD_TYPES.WILD:
                // Random color already set
                break;
        }
    }

    drawFromDeck() {
        if (this.deck.length === 0) {
            // Reshuffle discard pile into deck
            const topCard = this.discardPile.pop();
            this.deck = shuffleDeck(this.discardPile);
            this.discardPile = [topCard];
        }
        return this.deck.pop();
    }

    playCard(playerId, cardIndicesOrIndex, chosenColor) {
        if (this.isDealing) return;

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1 || playerIndex !== this.currentPlayerIndex) {
            return;
        }

        const player = this.players[playerIndex];

        // Normalize to array (Client sends insertion order now)
        const cardIndices = Array.isArray(cardIndicesOrIndex) ? [...cardIndicesOrIndex] : [cardIndicesOrIndex];
        
        // Indices to remove must be sorted descending to safe splice
        const indicesToRemove = [...cardIndices].sort((a, b) => b - a);

        // Validate indices
        if (cardIndices.some(idx => idx < 0 || idx >= player.hand.length)) {
            return;
        }

        // Cards in user-selected order
        const cardsToPlay = cardIndices.map(idx => player.hand[idx]);
        
        // Ensure compatibility within the set itself
        if (!areCardsCompatible(cardsToPlay)) {
            console.log(`[Room ${this.roomCode}] Play rejected: Cards not compatible ${JSON.stringify(cardsToPlay)}`);
            return;
        }

        const topCard = this.discardPile[this.discardPile.length - 1];

        // STRICT CHECK: The FIRST card selected must be playable on the pile.
        const firstCard = cardsToPlay[0];
        let isPlayable = false;

        // Must draw if there's a stack and card isn't matching stack type
        if (this.drawStack > 0) {
            isPlayable = (topCard.type === CARD_TYPES.DRAW_TWO && firstCard.type === CARD_TYPES.DRAW_TWO) ||
                         (topCard.type === CARD_TYPES.WILD_DRAW_FOUR && firstCard.type === CARD_TYPES.WILD_DRAW_FOUR);
        } else {
            isPlayable = canPlayCard(firstCard, topCard, this.currentColor);
        }

        if (!isPlayable) {
            console.log(`[Room ${this.roomCode}] Play rejected: First card not playable. Top: ${JSON.stringify(topCard)}, Color: ${this.currentColor}, First: ${JSON.stringify(firstCard)}`);
            return;
        }

        // Calculate cards remaining after this play
        const cardsRemainingAfterPlay = player.hand.length - cardsToPlay.length;
        
        // Check if trying to chip out (win) with special cards
        const hasSpecialCard = cardsToPlay.some(c => 
            c.type === CARD_TYPES.SKIP || 
            c.type === CARD_TYPES.REVERSE || 
            c.type === CARD_TYPES.DRAW_TWO || 
            c.type === CARD_TYPES.WILD || 
            c.type === CARD_TYPES.WILD_DRAW_FOUR
        );
        
        if (cardsRemainingAfterPlay === 0 && hasSpecialCard) {
            // Cannot chip out with special cards - notify and reject
            player.socket.emit('playRejected', {
                reason: 'Cannot win with special cards (+2, +4, Wild, Reverse, Skip). You must finish with a number card!'
            });
            console.log(`[Room ${this.roomCode}] ${player.name} tried to chip out with special cards - rejected`);
            return;
        }

        // UNO ENFORCEMENT: Check if player needs to have called UNO
        // Player needs UNO if: going to 1 card OR chipping out (going to 0 cards)
        const needsUno = cardsRemainingAfterPlay <= 1;
        
        if (needsUno && !this.unoCalledBy.has(playerId)) {
            // Player forgot to call UNO! Give them 2 penalty cards and warn everyone
            console.log(`[Room ${this.roomCode}] ${player.name} forgot to call UNO! Penalty: +2 cards`);
            
            // Draw 2 penalty cards
            const penaltyCards = [];
            for (let i = 0; i < 2; i++) {
                const card = this.drawFromDeck();
                player.hand.push(card);
                penaltyCards.push(card);
            }
            
            // Notify the player of their penalty cards
            player.socket.emit('cardsDrawn', penaltyCards);
            
            // Broadcast the cheater warning to everyone
            this.io.to(this.roomCode).emit('unoForgotten', {
                playerId,
                playerName: player.name
            });
            
            // The play is rejected - they must try again after getting penalty
            this.broadcastGameState();
            return;
        }

        // Remove cards from hand (using sorted indices)
        for (const idx of indicesToRemove) {
            player.hand.splice(idx, 1);
        }
        
        // Push to discard pile (in user selected order)
        for (const card of cardsToPlay) {
            this.discardPile.push(card);
        }

        // Handle color choice (using last card or first wild found)
        const wildCard = cardsToPlay.find(c => c.color === 'wild');
        if (wildCard) {
            this.currentColor = chosenColor || COLORS[0];
        } else {
            // Use color of the LAST card played
            this.currentColor = cardsToPlay[cardsToPlay.length - 1].color;
        }

        // Clear UNO call only if they no longer have exactly 1 card
        // (If they have 1 card, they must remain in the set to be safe from catching)
        if (player.hand.length !== 1) {
            this.unoCalledBy.delete(playerId);
        }

        // Check for win
        if (player.hand.length === 0) {
            this.winner = player;
            this.io.to(this.roomCode).emit('gameOver', {
                winner: { id: player.id, name: player.name },
                scores: this.calculateScores(player.id)
            });
            return;
        }

        // Calculate and apply effects from ALL cards
        let skipSteps = 0;
        let totalDraw = 0;
        let reverseFlipped = false;

        for (const card of cardsToPlay) {
            if (card.type === CARD_TYPES.SKIP) skipSteps++;
            if (card.type === CARD_TYPES.DRAW_TWO) totalDraw += 2;
            if (card.type === CARD_TYPES.WILD_DRAW_FOUR) totalDraw += 4;
            if (card.type === CARD_TYPES.REVERSE) {
                if (this.players.length === 2) skipSteps++;
                else reverseFlipped = !reverseFlipped;
            }
        }

        this.drawStack += totalDraw;
        if (reverseFlipped) this.direction *= -1;

        // Advance turn (1 base + any skips)
        let steps = 1 + skipSteps;
        
        // Special Rule for 1v1: Playing Skips/Reverses should always keep turn with player
        if (this.players.length === 2 && skipSteps > 0) {
             if (steps % 2 !== 0) {
                 steps++;
             }
        }

        console.log(`[Room ${this.roomCode}] Turn transition: skipSteps=${skipSteps}, totalSteps=${steps}, direction=${this.direction}, playercount=${this.players.length}`);
        const oldIndex = this.currentPlayerIndex;
        for (let i = 0; i < steps; i++) {
            this.nextTurn();
        }
        console.log(`[Room ${this.roomCode}] Turn moved from ${oldIndex} to ${this.currentPlayerIndex}`);

        // Broadcast the play
        console.log(`[Room ${this.roomCode}] ${player.name} (${playerId}) played ${cardsToPlay.length} card(s): ${cardsToPlay.map(c => `${c.color} ${c.type}${c.value !== undefined ? ' ' + c.value : ''}`).join(', ')}`);
        this.io.to(this.roomCode).emit('cardPlayed', {
            playerId,
            playerName: player.name,
            card: cardsToPlay[cardsToPlay.length - 1], // Display the "top" one
            count: cardsToPlay.length,
            chosenColor: this.currentColor
        });

        this.broadcastGameState();
    }

    handleCardEffect(card) {
        switch (card.type) {
            case CARD_TYPES.SKIP:
                this.nextTurn(); // Skip next player
                this.nextTurn();
                break;
            case CARD_TYPES.REVERSE:
                this.direction *= -1;
                if (this.players.length === 2) {
                    // In 2-player, reverse acts like skip
                    this.nextTurn();
                    this.nextTurn();
                } else {
                    this.nextTurn();
                }
                break;
            case CARD_TYPES.DRAW_TWO:
                this.drawStack += 2;
                this.nextTurn();
                break;
            case CARD_TYPES.WILD:
                this.nextTurn();
                break;
            case CARD_TYPES.WILD_DRAW_FOUR:
                this.drawStack += 4;
                this.nextTurn();
                break;
            default:
                this.nextTurn();
        }
    }

    drawCard(playerId) {
        if (this.isDealing) return;

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1 || playerIndex !== this.currentPlayerIndex) {
            return;
        }

        const player = this.players[playerIndex];
        const topCard = this.discardPile[this.discardPile.length - 1];

        // Check if already drawn this turn
        if (this.hasDrawnThisTurn) {
            console.log(`[Room ${this.roomCode}] ${player.name} tried to draw again in same turn.`);
            return;
        }

        // If no draw stack, check if they have any legal plays
        if (this.drawStack === 0) {
            const hasLegalPlay = this.hasLegalPlay(player, topCard, this.currentColor, this.drawStack);
            if (hasLegalPlay) {
                console.log(`[Room ${this.roomCode}] ${player.name} tried to draw but has playable cards.`);
                return;
            }
        }

        // If there's a draw stack, draw that many
        const cardsToDraw = this.drawStack > 0 ? this.drawStack : 1;
        this.drawStack = 0;

        const drawnCards = [];
        for (let i = 0; i < cardsToDraw; i++) {
            const card = this.drawFromDeck();
            player.hand.push(card);
            drawnCards.push(card);
        }

        // Notify the player of their drawn cards
        player.socket.emit('cardsDrawn', drawnCards);

        // Clear UNO status since they drew cards
        this.unoCalledBy.delete(playerId);

        // DO NOT automatically skip turn anymore, let the player decide to play or pass
        this.hasDrawnThisTurn = true;
        this.broadcastGameState();
    }

    passTurn(playerId) {
        if (this.isDealing) return;

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1 || playerIndex !== this.currentPlayerIndex) {
            return;
        }

        if (!this.hasDrawnThisTurn) {
            console.log(`[Room ${this.roomCode}] ${this.players[playerIndex].name} tried to pass without drawing first.`);
            return;
        }
        
        console.log(`[Room ${this.roomCode}] ${this.players[playerIndex].name} passed their turn.`);
        this.nextTurn();
        this.broadcastGameState();
    }

    callUno(playerId) {
        const player = this.players.find(p => p.id === playerId);
        // Allow calling UNO if they have at least 1 card (for chipping out) or 2 cards (going to 1)
        if (player && player.hand.length >= 1) {
            this.unoCalledBy.add(playerId);
            this.io.to(this.roomCode).emit('unoCalled', {
                playerId,
                playerName: player.name
            });
        }
    }

    catchUno(catcherId, targetPlayerId) {
        const target = this.players.find(p => p.id === targetPlayerId);
        const catcher = this.players.find(p => p.id === catcherId);

        if (target && catcher && target.hand.length === 1 && !this.unoCalledBy.has(targetPlayerId)) {
            // Target must draw 2 cards as penalty
            for (let i = 0; i < 2; i++) {
                target.hand.push(this.drawFromDeck());
            }
            
            this.io.to(this.roomCode).emit('unoCaught', {
                catcherName: catcher.name,
                targetName: target.name
            });

            this.broadcastGameState();
        }
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
        this.hasDrawnThisTurn = false;
    }

    clearPendingBotTurn() {
        if (this.pendingBotTurn?.timerId) {
            clearTimeout(this.pendingBotTurn.timerId);
        }
        this.pendingBotTurn = null;
    }

    maybeHandleBotTurn() {
        if (!this.gameStarted) {
            this.clearPendingBotTurn();
            return;
        }
        const currentPlayer = this.players[this.currentPlayerIndex];
        if (!currentPlayer || !currentPlayer.isBot || this.isDealing || this.winner) {
            this.clearPendingBotTurn();
            return;
        }

        if (this.pendingBotTurn && this.pendingBotTurn.playerId === currentPlayer.id) {
            return;
        }

        this.clearPendingBotTurn();
        const delay = 600 + Math.floor(Math.random() * 500);
        this.pendingBotTurn = {
            playerId: currentPlayer.id,
            timerId: setTimeout(() => {
                this.pendingBotTurn = null;
                this.performBotTurn(currentPlayer.id);
            }, delay)
        };
    }

    performBotTurn(botId) {
        const playerIndex = this.players.findIndex(p => p.id === botId);
        if (playerIndex === -1 || playerIndex !== this.currentPlayerIndex) {
            return;
        }

        const bot = this.players[playerIndex];
        if (!bot.isBot || this.isDealing || this.winner) return;

        // Bot tries to catch opponents who forgot UNO before playing
        this.botTryCatchUno(botId);

        const topCard = this.discardPile[this.discardPile.length - 1];
        let playableGroups = this.getBotPlayableGroups(bot.hand, topCard, this.currentColor, this.drawStack);
        const hasLegalPlay = this.hasLegalPlay(bot, topCard, this.currentColor, this.drawStack);

        if (!hasLegalPlay && this.drawStack === 0) {
            playableGroups = [];
        }
        if (this.drawStack === 0) {
            const hasPlayableCard = bot.hand.some(card => canPlayCard(card, topCard, this.currentColor));
            if (hasPlayableCard && playableGroups.length === 0 && hasLegalPlay) {
                playableGroups = this.getBotSinglePlayableGroups(bot.hand, topCard, this.currentColor);
            }
        }

        if (this.drawStack > 0) {
            if (playableGroups.length > 0) {
                const selection = this.chooseBotPlay(bot.hand, playableGroups, topCard, this.currentColor);
                if (!selection) return;
                const chosenColor = this.getBotWildColor(bot.hand, selection.indices[0]);
                if (this.shouldBotCallUno(bot.hand, selection.indices.length)) {
                    this.callUno(bot.id);
                }
                this.playCard(bot.id, selection.indices, chosenColor);
            } else {
                this.drawCard(bot.id);
                this.passTurn(bot.id);
            }
            return;
        }

        if (playableGroups.length === 0) {
            if (!this.hasDrawnThisTurn) {
                this.drawCard(bot.id);
            } else {
                this.passTurn(bot.id);
            }
            return;
        }

        const selection = this.chooseBotPlay(bot.hand, playableGroups, topCard, this.currentColor);
        if (!selection) return;
        const chosenColor = this.getBotWildColor(bot.hand, selection.indices[0]);
        if (this.shouldBotCallUno(bot.hand, selection.indices.length)) {
            this.callUno(bot.id);
        }
        this.playCard(bot.id, selection.indices, chosenColor);
    }

    getBotPlayableGroups(hand, topCard, currentColor, drawStack) {
        const groups = new Map();

        hand.forEach((card, index) => {
            const key = `${card.type}:${card.value}`;
            if (!groups.has(key)) {
                groups.set(key, { card, indices: [] });
            }
            groups.get(key).indices.push(index);
        });

        const playableGroups = [];
        for (const group of groups.values()) {
            if (drawStack > 0) {
                if ((topCard.type === CARD_TYPES.DRAW_TWO && group.card.type === CARD_TYPES.DRAW_TWO) ||
                    (topCard.type === CARD_TYPES.WILD_DRAW_FOUR && group.card.type === CARD_TYPES.WILD_DRAW_FOUR)) {
                    playableGroups.push(group);
                }
            } else if (canPlayCard(group.card, topCard, currentColor)) {
                playableGroups.push(group);
            }
        }

        return playableGroups;
    }

    getBotSinglePlayableGroups(hand, topCard, currentColor) {
        const playableGroups = [];
        for (let i = 0; i < hand.length; i++) {
            const card = hand[i];
            if (canPlayCard(card, topCard, currentColor)) {
                playableGroups.push({ card, indices: [i] });
            }
        }
        return playableGroups;
    }

    hasLegalPlay(player, topCard, currentColor, drawStack) {
        if (!player || !topCard) return false;

        if (drawStack > 0) {
            return player.hand.some(card =>
                (topCard.type === CARD_TYPES.DRAW_TWO && card.type === CARD_TYPES.DRAW_TWO) ||
                (topCard.type === CARD_TYPES.WILD_DRAW_FOUR && card.type === CARD_TYPES.WILD_DRAW_FOUR)
            );
        }

        for (const card of player.hand) {
            if (!canPlayCard(card, topCard, currentColor)) continue;

            if (player.hand.length === 1) {
                if (card.type !== CARD_TYPES.NUMBER) {
                    continue;
                }
            }

            return true;
        }

        return false;
    }

    chooseBotPlay(hand, playableGroups, topCard, currentColor) {
        // Count colors in hand (for wild color choice later)
        const colorCounts = { red: 0, yellow: 0, green: 0, blue: 0 };
        hand.forEach(card => {
            if (colorCounts[card.color] !== undefined) {
                colorCounts[card.color] += 1;
            }
        });

        // Get info about next player
        const nextPlayerInfo = this.getNextPlayerInfo();
        const nextPlayerCards = nextPlayerInfo?.handSize || 7;
        const nextPlayerIsDangerous = nextPlayerCards <= 2;
        const isEndgame = hand.length <= 3 || this.players.some(p => p.hand.length <= 2);

        let bestSelection = null;
        let bestScore = -Infinity;

        for (const group of playableGroups) {
            const card = group.card;
            let playCount = group.indices.length;
            const cardsAfterPlay = hand.length - playCount;
            const wouldWin = cardsAfterPlay === 0;
            const isSpecial = card.type !== CARD_TYPES.NUMBER;

            // Don't play special cards to win (must use number cards)
            if (isSpecial && wouldWin) {
                if (playCount > 1) {
                    // Can play multiple - only play enough to leave 1 card
                    playCount -= 1;
                } else {
                    // Skip this option - can't win with special card
                    continue;
                }
            }

            let score = 0;

            // === WINNING PRIORITY ===
            if (cardsAfterPlay === 0) {
                // Highest priority: winning the game
                score += 10000;
            } else if (cardsAfterPlay === 1) {
                // Second priority: getting to UNO
                score += 500;
            }

            // === OFFENSIVE PLAY BONUSES ===
            // When opponent is dangerous (has 1-2 cards), prioritize attack cards
            if (nextPlayerIsDangerous) {
                if (card.type === CARD_TYPES.DRAW_TWO) score += 200;
                if (card.type === CARD_TYPES.WILD_DRAW_FOUR) score += 250;
                if (card.type === CARD_TYPES.SKIP) score += 150;
                if (card.type === CARD_TYPES.REVERSE) score += 100;
            }

            // === MULTI-CARD BONUS ===
            // Playing multiple cards is generally good
            score += playCount * 15;

            // === COLOR STRATEGY ===
            // Prefer colors we have the most of (so we can keep playing)
            const effectiveColor = card.color === 'wild' ? currentColor : card.color;
            if (effectiveColor && colorCounts[effectiveColor]) {
                score += colorCounts[effectiveColor] * 3;
            }

            // === CARD TYPE PRIORITIES ===
            // In endgame, prefer action cards to disrupt opponents
            if (isEndgame) {
                if (card.type === CARD_TYPES.NUMBER) {
                    score += 5; // Still good to play numbers
                } else if (card.type === CARD_TYPES.DRAW_TWO) {
                    score += 20; // Great for offense
                } else if (card.type === CARD_TYPES.SKIP) {
                    score += 15; // Good for skipping dangerous players
                } else if (card.type === CARD_TYPES.REVERSE) {
                    score += 10; // Can redirect to safer player
                } else if (card.type === CARD_TYPES.WILD) {
                    score += 8; // Flexibility
                } else if (card.type === CARD_TYPES.WILD_DRAW_FOUR) {
                    score += 25; // Best offensive card
                }
            } else {
                // Early/mid game: conserve action cards, play numbers
                if (card.type === CARD_TYPES.NUMBER) {
                    score += 20; // Preferred early
                } else if (card.type === CARD_TYPES.SKIP || card.type === CARD_TYPES.REVERSE) {
                    score -= 5; // Save for later
                } else if (card.type === CARD_TYPES.DRAW_TWO) {
                    score -= 3; // Save for when needed
                } else if (card.type === CARD_TYPES.WILD) {
                    score -= 10; // Save wild cards for emergencies
                } else if (card.type === CARD_TYPES.WILD_DRAW_FOUR) {
                    score -= 15; // Save +4 for desperate situations or endgame
                }
            }

            // === SAVING CARDS BONUS ===
            // If we have 2+ of same card type, playing them is good
            if (playCount >= 2) {
                score += 10;
            }

            // === PENALTIES ===
            // Don't waste wild cards on small advantages
            if (card.color === 'wild' && !isEndgame && !nextPlayerIsDangerous) {
                score -= 20;
            }

            if (score > bestScore) {
                bestScore = score;
                bestSelection = {
                    indices: group.indices.slice(0, playCount)
                };
            }
        }

        if (!bestSelection && playableGroups.length > 0) {
            bestSelection = { indices: [playableGroups[0].indices[0]] };
        }

        return bestSelection;
    }

    getNextPlayerInfo() {
        if (this.players.length <= 1) return null;
        const nextIndex = (this.currentPlayerIndex + this.direction + this.players.length) % this.players.length;
        const nextPlayer = this.players[nextIndex];
        return nextPlayer ? { id: nextPlayer.id, handSize: nextPlayer.hand.length, isBot: nextPlayer.isBot } : null;
    }

    botTryCatchUno(botId) {
        // Bot looks for players with 1 card who forgot to call UNO
        // Bots have a high chance (85%) to catch to make them competitive
        const victims = this.players.filter(p => 
            p.id !== botId && 
            p.hand.length === 1 && 
            !this.unoCalledBy.has(p.id)
        );

        for (const victim of victims) {
            // 85% chance to catch (bots are good but not perfect)
            if (Math.random() < 0.85) {
                console.log(`[Room ${this.roomCode}] Bot caught ${victim.name} forgetting UNO!`);
                this.catchUno(botId, victim.id);
            }
        }
    }

    getBotWildColor(hand, wildIndex) {
        const card = hand[wildIndex];
        if (!card || card.color !== 'wild') return undefined;

        // If this is the last card, we shouldn't be playing a wild (number card required)
        if (hand.length === 1) return 'red'; // Fallback

        const colorCounts = { red: 0, yellow: 0, green: 0, blue: 0 };
        const colorPlayability = { red: 0, yellow: 0, green: 0, blue: 0 };

        hand.forEach((c, idx) => {
            if (idx === wildIndex) return;
            if (colorCounts[c.color] !== undefined) {
                colorCounts[c.color] += 1;
                // Bonus for cards that can be played next (numbers are more versatile)
                if (c.type === CARD_TYPES.NUMBER) {
                    colorPlayability[c.color] += 2;
                } else {
                    colorPlayability[c.color] += 1;
                }
            }
        });

        // Get next player's info
        const nextPlayer = this.getNextPlayerInfo();
        const nextPlayerIsDangerous = nextPlayer && nextPlayer.handSize <= 2;

        let bestColor = 'red';
        let bestScore = -Infinity;

        for (const color of COLORS) {
            let score = 0;
            const count = colorCounts[color];

            // Base score: number of cards of this color
            score += count * 10;

            // Bonus for playability
            score += colorPlayability[color] * 3;

            // Prefer colors where we have action cards if next player is dangerous
            if (nextPlayerIsDangerous) {
                const hasSkip = hand.some(c => c.color === color && c.type === CARD_TYPES.SKIP);
                const hasDrawTwo = hand.some(c => c.color === color && c.type === CARD_TYPES.DRAW_TWO);
                const hasReverse = hand.some(c => c.color === color && c.type === CARD_TYPES.REVERSE);
                
                if (hasDrawTwo) score += 15;
                if (hasSkip) score += 10;
                if (hasReverse) score += 5;
            }

            // Prefer colors with number cards (easier to play and can win with them)
            const hasNumber = hand.some(c => c.color === color && c.type === CARD_TYPES.NUMBER);
            if (hasNumber) score += 8;

            if (score > bestScore) {
                bestScore = score;
                bestColor = color;
            }
        }

        return bestColor;
    }

    shouldBotCallUno(hand, cardsToPlayCount) {
        return (hand.length - cardsToPlayCount) <= 1;
    }

    calculateScores(winnerId = null) {
        const resolvedWinnerId = winnerId || this.winner?.id;
        
        // Calculate hand values for ranking
        const handValues = this.players.map(p => ({
            id: p.id,
            name: p.name,
            handSize: p.hand.length,
            // Points for tie-breaking (lower is better, except winner has 0)
            points: p.hand.reduce((sum, card) => {
                if (card.type === CARD_TYPES.NUMBER) return sum + card.value;
                if (card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR) return sum + 50;
                return sum + 20;
            }, 0)
        }));

        // Sort: winner first, then by hand size (asc), then by points (asc) as tiebreaker
        return handValues.sort((a, b) => {
            // Winner always comes first
            if (a.id === resolvedWinnerId) return -1;
            if (b.id === resolvedWinnerId) return 1;
            // Then sort by hand size (fewer cards = better rank)
            if (a.handSize !== b.handSize) return a.handSize - b.handSize;
            // Then by point value as tiebreaker
            return a.points - b.points;
        });
    }

    broadcastGameState() {
        const topCard = this.discardPile[this.discardPile.length - 1];
        const currentPlayer = this.players[this.currentPlayerIndex];

        // Send personalized state to each player
        for (const player of this.players) {
            const state = {
                roomCode: this.roomCode,
                currentPlayerId: currentPlayer?.id,
                currentPlayerName: currentPlayer?.name,
                direction: this.direction,
                currentColor: this.currentColor,
                topCard,
                drawStack: this.drawStack,
                deckCount: this.deck.length,
                hand: player.hand,
                hasDrawnThisTurn: this.hasDrawnThisTurn,
                players: this.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    cardCount: p.hand.length,
                    isCurrentTurn: p.id === currentPlayer?.id
                })),
                canCallUno: player.hand.length === 2,
                playersWithOneCard: this.players
                    .filter(p => p.hand.length === 1 && !this.unoCalledBy.has(p.id) && p.id !== player.id)
                    .map(p => ({ id: p.id, name: p.name }))
            };

            player.socket.emit('gameState', state);
        }

        this.maybeHandleBotTurn();
    }

    toJSON() {
        return {
            roomCode: this.roomCode,
            gameStarted: this.gameStarted,
            deck: this.deck,
            discardPile: this.discardPile,
            currentPlayerIndex: this.currentPlayerIndex,
            direction: this.direction,
            currentColor: this.currentColor,
            drawStack: this.drawStack,
            unoCalledBy: Array.from(this.unoCalledBy),
            winner: this.winner ? { id: this.winner.id, name: this.winner.name } : null,
            hasDrawnThisTurn: this.hasDrawnThisTurn,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                hand: p.hand,
                isHost: p.isHost,
                isBot: p.isBot,
                disconnected: true // Always disconnected on save/restore
            }))
        };
    }

    static restore(state, io) {
        const room = new GameRoom(state.roomCode, io);
        room.gameStarted = state.gameStarted;
        room.deck = state.deck;
        room.discardPile = state.discardPile;
        room.currentPlayerIndex = state.currentPlayerIndex;
        room.direction = state.direction;
        room.currentColor = state.currentColor;
        room.drawStack = state.drawStack;
        room.unoCalledBy = new Set(state.unoCalledBy);
        room.winner = state.winner;
        room.hasDrawnThisTurn = state.hasDrawnThisTurn || false;
        room.players = state.players.map(p => ({
            ...p,
            isBot: !!p.isBot,
            socket: { emit: () => {}, join: () => {}, leave: () => {} }, // Mock socket
            disconnected: true
        }));
        return room;
    }
}
