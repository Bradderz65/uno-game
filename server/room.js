import { randomBytes } from 'crypto';
import {
    COLORS, CARD_TYPES, LIMITS, DEFAULT_SETTINGS,
    createDeck, shuffle, validatePlay, hasLegalPlay, getDrawAmount,
    handPoints, isWildCard, normalizeSettings
} from '../shared/rules.js';
import { BOT_NAMES, chooseBotPlay } from './bot.js';

export const PHASES = Object.freeze({ LOBBY: 'lobby', PLAYING: 'playing', FINISHED: 'finished' });

export const DEFAULT_TIMING = Object.freeze({
    dealStartDelay: 900,
    dealRoundDelay: 170,
    botThink: [1100, 2100],
    botAfterDraw: [650, 1200],
    drawSettle: count => Math.min(1600, 350 + count * 150),
    disconnectGrace: 45_000
});

const SAVE_VERSION = 2;
const LOG_LIMIT = 30;

const randomBetween = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));
const newId = () => randomBytes(6).toString('hex');
const newToken = () => randomBytes(18).toString('base64url');

export function sanitizeName(raw) {
    return String(raw ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, LIMITS.nameLength);
}

/**
 * One table. Owns players, the deck and turn order. Sends state to each
 * player's socket directly, so it has no dependency on the Socket.IO server.
 */
export class GameRoom {
    constructor(code, { timing = DEFAULT_TIMING, onChange = () => {}, onClose = () => {} } = {}) {
        this.code = code;
        this.timing = { ...DEFAULT_TIMING, ...timing };
        this.onChange = onChange;
        this.onClose = onClose;
        this.closed = false;

        this.players = [];
        this.hostId = null;
        this.bannedTokens = new Set();
        this.settings = normalizeSettings(DEFAULT_SETTINGS);
        this.phase = PHASES.LOBBY;
        this.log = [];
        this.logSeq = 0;

        this.timers = new Set();
        this.botTimer = null;
        this.resetGame();
    }

    resetGame() {
        this.deck = [];
        this.discard = [];
        this.currentIndex = 0;
        this.direction = 1;
        this.currentColor = null;
        this.drawStack = 0;
        this.hasDrawn = false;
        this.dealing = false;
        this.turnSeq = 0;
        this.settleUntil = 0;
        this.results = null;
        this.rematchReady = new Set();
        for (const player of this.players) {
            player.hand = [];
            player.calledUno = false;
        }
    }

    // ---------------------------------------------------------------- players

    get humans() {
        return this.players.filter(p => !p.isBot);
    }

    get currentPlayer() {
        return this.phase === PHASES.PLAYING ? this.players[this.currentIndex] : null;
    }

    getPlayer(id) {
        return this.players.find(p => p.id === id) ?? null;
    }

    isHost(id) {
        return this.hostId === id;
    }

    uniqueName(name) {
        const taken = new Set(this.players.map(p => p.name.toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        for (let n = 2; ; n++) {
            const suffix = ` ${n}`;
            const candidate = name.slice(0, LIMITS.nameLength - suffix.length) + suffix;
            if (!taken.has(candidate.toLowerCase())) return candidate;
        }
    }

    canJoin() {
        if (this.phase !== PHASES.LOBBY) return 'That game has already started.';
        if (this.players.length >= LIMITS.maxPlayers) return 'That room is full.';
        return null;
    }

    addHuman(rawName, socket) {
        const name = sanitizeName(rawName);
        if (!name) return { error: 'Please enter a name.' };
        const blocked = this.canJoin();
        if (blocked) return { error: blocked };

        const player = {
            id: newId(),
            token: newToken(),
            name: this.uniqueName(name),
            isBot: false,
            socket,
            connected: true,
            hand: [],
            calledUno: false,
            graceTimer: null
        };
        this.players.push(player);
        this.hostId ??= player.id;
        this.record({ type: 'join', playerId: player.id });
        this.sync();
        return { player };
    }

    addBot(byId) {
        if (!this.isHost(byId)) return { error: 'Only the host can add bots.' };
        const blocked = this.canJoin();
        if (blocked) return { error: blocked };

        const used = new Set(this.players.map(p => p.name));
        const base = BOT_NAMES.find(n => !used.has(n)) ?? 'Bot';
        const player = {
            id: newId(),
            token: null,
            name: this.uniqueName(base),
            isBot: true,
            socket: null,
            connected: true,
            hand: [],
            calledUno: false,
            graceTimer: null
        };
        this.players.push(player);
        this.record({ type: 'join', playerId: player.id });
        this.sync();
        return { player };
    }

    /** Re-attach a socket using the secret token handed out on join. */
    resume(token, socket) {
        if (!token || this.bannedTokens.has(token)) return null;
        const player = this.players.find(p => p.token === token);
        if (!player) return null;

        if (player.socket && player.socket !== socket) {
            // The same seat opened in another tab: the newest connection wins.
            player.socket.emit('room:replaced');
        }
        clearTimeout(player.graceTimer);
        player.graceTimer = null;
        player.socket = socket;
        player.connected = true;
        this.sync();
        return player;
    }

    disconnect(playerId) {
        const player = this.getPlayer(playerId);
        if (!player || player.isBot) return;

        player.socket = null;
        player.connected = false;
        this.startGraceTimer(player);
        this.sync();
    }

    startGraceTimer(player) {
        clearTimeout(player.graceTimer);
        player.graceTimer = setTimeout(() => {
            player.graceTimer = null;
            if (!player.connected && this.getPlayer(player.id)) {
                this.removePlayer(player.id, 'timeout');
            }
        }, this.timing.disconnectGrace);
    }

    kick(byId, targetId) {
        if (!this.isHost(byId)) return { error: 'Only the host can remove players.' };
        if (byId === targetId) return { error: 'You can’t remove yourself.' };
        const target = this.getPlayer(targetId);
        if (!target) return { error: 'That player has already left.' };
        if (this.phase === PHASES.PLAYING && !target.isBot) {
            return { error: 'Players can only be removed between games.' };
        }

        if (target.token) this.bannedTokens.add(target.token);
        target.socket?.emit('room:kicked');
        this.removePlayer(targetId, 'kicked');
        return { ok: true };
    }

    removePlayer(playerId, reason = 'left') {
        const index = this.players.findIndex(p => p.id === playerId);
        if (index === -1) return;

        const [player] = this.players.splice(index, 1);
        clearTimeout(player.graceTimer);
        this.rematchReady.delete(player.id);
        this.record({ type: 'leave', name: player.name, reason });

        if (!this.humans.length) {
            this.close();
            return;
        }

        if (this.hostId === player.id) {
            this.hostId = this.humans[0].id;
        }

        if (this.phase === PHASES.PLAYING) {
            this.handleSeatRemoved(index, player);
        } else if (this.phase === PHASES.FINISHED) {
            this.maybeStartRematch();
        }

        this.sync();
    }

    handleSeatRemoved(index, player) {
        // Their cards go back into the deck so it doesn't shrink over a long game.
        this.deck = shuffle([...this.deck, ...player.hand]);

        if (this.players.length < LIMITS.minPlayers) {
            this.finish(this.players[0], 'forfeit');
            return;
        }

        if (index < this.currentIndex) {
            this.currentIndex -= 1;
        } else if (index === this.currentIndex) {
            // Hand the turn to whoever would have gone next.
            if (this.direction === -1) this.currentIndex -= 1;
            this.currentIndex = (this.currentIndex + this.players.length) % this.players.length;
            this.hasDrawn = false;
            this.turnSeq += 1;
        }
        this.currentIndex %= this.players.length;
    }

    updateSettings(byId, settings) {
        if (!this.isHost(byId)) return { error: 'Only the host can change settings.' };
        if (this.phase !== PHASES.LOBBY) return { error: 'Settings are locked during a game.' };
        this.settings = normalizeSettings(settings, this.settings);
        this.sync();
        return { ok: true };
    }

    // ------------------------------------------------------------ game flow

    requestStart(byId) {
        if (!this.isHost(byId)) return { error: 'Only the host can start the game.' };
        if (this.phase === PHASES.PLAYING) return { error: 'The game is already running.' };
        if (this.players.length < LIMITS.minPlayers) return { error: 'You need at least two players.' };
        this.start();
        return { ok: true };
    }

    start() {
        this.clearTimers();
        this.resetGame();
        this.phase = PHASES.PLAYING;
        this.dealing = true;
        this.deck = shuffle(createDeck(this.settings));

        // The opening card can't be a wild draw card.
        let first;
        do {
            first = this.deck.pop();
            if (first.type === CARD_TYPES.WILD_DRAW_FOUR || first.type === CARD_TYPES.CUSTOM_DRAW) {
                this.deck.unshift(first);
                first = null;
            }
        } while (!first);

        this.discard.push(first);
        this.currentColor = isWildCard(first) ? COLORS[Math.floor(Math.random() * COLORS.length)] : first.color;
        this.applyOpeningCard(first);
        this.log = [];
        this.record({ type: 'start' });
        this.sync();

        this.deal(this.settings.startingCards);
    }

    applyOpeningCard(card) {
        if (card.type === CARD_TYPES.SKIP) this.advance(1);
        if (card.type === CARD_TYPES.REVERSE) {
            if (this.players.length === 2) this.advance(1);
            else this.direction = -1;
        }
        if (card.type === CARD_TYPES.DRAW_TWO) this.drawStack = 2;
    }

    deal(rounds) {
        let round = 0;
        const dealRound = () => {
            for (const player of this.players) {
                const card = this.drawFromDeck();
                if (card) player.hand.push(card);
            }
            round += 1;
            if (round < rounds) {
                this.later(dealRound, this.timing.dealRoundDelay);
            } else {
                this.dealing = false;
                this.turnSeq += 1;
            }
            this.sync();
        };
        this.later(dealRound, this.timing.dealStartDelay);
    }

    drawFromDeck() {
        if (!this.deck.length) {
            if (this.discard.length <= 1) return null;
            const top = this.discard.pop();
            this.deck = shuffle(this.discard);
            this.discard = [top];
        }
        return this.deck.pop() ?? null;
    }

    drawInto(player, count) {
        const drawn = [];
        for (let i = 0; i < count; i++) {
            const card = this.drawFromDeck();
            if (!card) break;
            player.hand.push(card);
            drawn.push(card);
        }
        player.calledUno = false;
        this.settleUntil = Math.max(this.settleUntil, Date.now() + this.timing.drawSettle(drawn.length));
        return drawn;
    }

    advance(steps) {
        const n = this.players.length;
        this.currentIndex = ((this.currentIndex + this.direction * steps) % n + n) % n;
        this.hasDrawn = false;
        this.turnSeq += 1;
    }

    get table() {
        return {
            topCard: this.discard[this.discard.length - 1],
            currentColor: this.currentColor,
            drawStack: this.drawStack
        };
    }

    turnGuard(playerId) {
        if (this.phase !== PHASES.PLAYING) return 'The game isn’t running.';
        if (this.dealing) return 'Hang on — still dealing.';
        if (this.currentPlayer?.id !== playerId) return 'It’s not your turn.';
        return null;
    }

    play(playerId, cardIds, chosenColor) {
        const blocked = this.turnGuard(playerId);
        if (blocked) return { error: blocked };

        const player = this.currentPlayer;
        const ids = Array.isArray(cardIds) ? cardIds.map(Number) : [];
        if (!ids.length || new Set(ids).size !== ids.length) return { error: 'Select a card to play.' };

        const cards = ids.map(id => player.hand.find(card => card.id === id));
        if (cards.some(card => !card)) return { error: 'Those cards aren’t in your hand.' };

        const invalid = validatePlay(cards, player.hand.length, this.table);
        if (invalid) return { error: invalid };

        const top = cards[cards.length - 1];
        if (isWildCard(top) && !COLORS.includes(chosenColor)) return { error: 'Choose a colour for your wild card.' };

        // Going out requires calling UNO first; forgetting costs two cards and the play.
        if (player.hand.length === 1 && !player.calledUno) {
            this.drawInto(player, 2);
            this.record({ type: 'penalty', playerId: player.id, count: 2 });
            this.sync();
            return { error: 'You forgot to call UNO! +2 cards.' };
        }

        const playedIds = new Set(ids);
        player.hand = player.hand.filter(card => !playedIds.has(card.id));
        this.discard.push(...cards);
        this.currentColor = isWildCard(top) ? chosenColor : top.color;
        if (player.hand.length !== 1) player.calledUno = false;

        this.record({ type: 'play', playerId: player.id, cards, color: this.currentColor });

        if (!player.hand.length) {
            this.finish(player, 'won');
            this.sync();
            return { ok: true };
        }

        this.applyEffects(cards);

        if (player.isBot && player.hand.length === 1) {
            player.calledUno = true;
            this.record({ type: 'uno', playerId: player.id });
        }

        this.sync();
        return { ok: true };
    }

    applyEffects(cards) {
        let skips = 0;
        let reverses = 0;
        for (const card of cards) {
            if (card.type === CARD_TYPES.SKIP) skips += 1;
            if (card.type === CARD_TYPES.REVERSE) reverses += 1;
            this.drawStack += getDrawAmount(card);
        }

        if (this.players.length === 2) {
            // Heads-up, skips and reverses both mean "go again".
            this.advance(skips + reverses > 0 ? 0 : 1);
            return;
        }

        if (reverses % 2 === 1) this.direction *= -1;
        this.advance(1 + skips);
    }

    draw(playerId) {
        const blocked = this.turnGuard(playerId);
        if (blocked) return { error: blocked };

        const player = this.currentPlayer;
        if (this.hasDrawn) return { error: 'You’ve already drawn this turn.' };
        if (this.drawStack === 0 && hasLegalPlay(player.hand, this.table)) {
            return { error: 'You have a card you can play.' };
        }

        const count = this.drawStack || 1;
        this.drawStack = 0;
        const drawn = this.drawInto(player, count);
        this.hasDrawn = true;
        this.record({ type: 'draw', playerId: player.id, count: drawn.length, forced: count > 1 });
        this.sync();
        return { ok: true, cards: drawn };
    }

    pass(playerId) {
        const blocked = this.turnGuard(playerId);
        if (blocked) return { error: blocked };

        const player = this.currentPlayer;
        if (!this.hasDrawn) return { error: 'Draw a card before passing.' };
        if (hasLegalPlay(player.hand, this.table)) return { error: 'You have a card you can play.' };

        this.record({ type: 'pass', playerId: player.id });
        this.advance(1);
        this.sync();
        return { ok: true };
    }

    callUno(playerId) {
        const player = this.getPlayer(playerId);
        if (!player || this.phase !== PHASES.PLAYING) return { error: 'The game isn’t running.' };
        if (player.hand.length !== 1) return { error: 'You can call UNO when you have one card left.' };
        if (player.calledUno) return { ok: true };

        player.calledUno = true;
        this.record({ type: 'uno', playerId: player.id });
        this.sync();
        return { ok: true };
    }

    finish(winner, reason) {
        this.clearTimers();
        this.phase = PHASES.FINISHED;
        this.dealing = false;
        this.rematchReady = new Set(this.players.filter(p => p.isBot).map(p => p.id));

        const standings = this.players
            .map(p => ({ id: p.id, name: p.name, isBot: p.isBot, cardCount: p.hand.length, points: handPoints(p.hand) }))
            .sort((a, b) => {
                if (a.id === winner.id) return -1;
                if (b.id === winner.id) return 1;
                return a.cardCount - b.cardCount || a.points - b.points;
            });

        this.results = { winnerId: winner.id, winnerName: winner.name, reason, standings };
        this.record({ type: 'end', playerId: winner.id, reason });
    }

    setReady(playerId, ready) {
        if (this.phase !== PHASES.FINISHED) return { error: 'The game is still running.' };
        if (!this.getPlayer(playerId)) return { error: 'You’re not in this room.' };

        if (ready) this.rematchReady.add(playerId);
        else this.rematchReady.delete(playerId);

        if (!this.maybeStartRematch()) this.sync();
        return { ok: true };
    }

    maybeStartRematch() {
        const everyoneReady = this.players.every(p => this.rematchReady.has(p.id));
        if (this.phase === PHASES.FINISHED && everyoneReady && this.players.length >= LIMITS.minPlayers) {
            this.start();
            return true;
        }
        return false;
    }

    returnToLobby(byId) {
        if (!this.isHost(byId)) return { error: 'Only the host can do that.' };
        if (this.phase === PHASES.LOBBY) return { ok: true };
        this.clearTimers();
        this.resetGame();
        this.phase = PHASES.LOBBY;
        this.sync();
        return { ok: true };
    }

    // ------------------------------------------------------------------ bots

    scheduleBot() {
        clearTimeout(this.botTimer);
        this.botTimer = null;

        const bot = this.currentPlayer;
        if (!bot?.isBot || this.dealing || this.closed) return;
        if (!this.hasAudience()) return;

        const think = randomBetween(this.hasDrawn ? this.timing.botAfterDraw : this.timing.botThink);
        const settle = Math.max(0, this.settleUntil - Date.now());
        const expectedTurn = this.turnSeq;

        this.botTimer = setTimeout(() => {
            this.botTimer = null;
            if (this.turnSeq !== expectedTurn || this.currentPlayer?.id !== bot.id) return;
            this.runBotTurn(bot);
        }, think + settle);
    }

    /** Bots wait for at least one person to be watching (e.g. after a server restart). */
    hasAudience() {
        return this.humans.some(p => p.connected);
    }

    runBotTurn(bot) {
        const next = this.players[((this.currentIndex + this.direction) % this.players.length + this.players.length) % this.players.length];
        const choice = chooseBotPlay(bot.hand, this.table, {
            nextOpponentCards: next?.hand.length ?? 7,
            anyoneLow: this.players.some(p => p.id !== bot.id && p.hand.length <= 2)
        });

        let result;
        if (choice) {
            result = this.play(bot.id, choice.cardIds, choice.color);
        } else if (!this.hasDrawn) {
            result = this.draw(bot.id);
        } else {
            result = this.pass(bot.id);
        }

        if (result?.error) {
            // Should never happen, but never let a bot stall the table.
            console.warn(`[Room ${this.code}] Bot ${bot.name} action failed: ${result.error}`);
            const fallback = this.hasDrawn ? this.pass(bot.id) : this.draw(bot.id);
            if (fallback.error) {
                this.advance(1);
                this.sync();
            }
        }
    }

    // ------------------------------------------------------------ plumbing

    record(entry) {
        this.logSeq += 1;
        const withMeta = { seq: this.logSeq, at: Date.now(), ...entry };
        if (entry.playerId && !entry.name) {
            withMeta.name = this.getPlayer(entry.playerId)?.name ?? 'Someone';
        }
        this.log.push(withMeta);
        if (this.log.length > LOG_LIMIT) this.log.shift();
        for (const player of this.players) player.socket?.emit('room:event', withMeta);
    }

    later(fn, delay) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (!this.closed) fn();
        }, delay);
        this.timers.add(timer);
    }

    clearTimers() {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers.clear();
        clearTimeout(this.botTimer);
        this.botTimer = null;
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.clearTimers();
        for (const player of this.players) clearTimeout(player.graceTimer);
        this.onClose(this);
    }

    /** Push fresh state to every connected player, persist, and wake bots. */
    sync() {
        if (this.closed) return;
        for (const player of this.players) {
            player.socket?.emit('room:state', this.viewFor(player));
        }
        this.onChange(this);
        this.scheduleBot();
    }

    viewFor(viewer) {
        const current = this.currentPlayer;
        const inGame = this.phase !== PHASES.LOBBY;

        return {
            code: this.code,
            phase: this.phase,
            you: viewer.id,
            hostId: this.hostId,
            settings: this.settings,
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                isBot: p.isBot,
                connected: p.connected,
                cardCount: p.hand.length,
                calledUno: p.calledUno
            })),
            game: inGame ? {
                hand: viewer.hand,
                currentPlayerId: current?.id ?? null,
                direction: this.direction,
                currentColor: this.currentColor,
                discard: this.discard.slice(-4),
                drawStack: this.drawStack,
                deckCount: this.deck.length,
                hasDrawn: this.hasDrawn,
                dealing: this.dealing,
                turnSeq: this.turnSeq
            } : null,
            results: this.results,
            ready: this.phase === PHASES.FINISHED ? [...this.rematchReady] : [],
            log: this.log.slice(-12)
        };
    }

    summary() {
        return {
            code: this.code,
            host: this.getPlayer(this.hostId)?.name ?? 'Unknown',
            playerCount: this.players.length,
            maxPlayers: LIMITS.maxPlayers
        };
    }

    // ------------------------------------------------------- persistence

    toJSON() {
        return {
            version: SAVE_VERSION,
            code: this.code,
            phase: this.phase,
            hostId: this.hostId,
            settings: this.settings,
            bannedTokens: [...this.bannedTokens],
            players: this.players.map(({ id, token, name, isBot, hand, calledUno }) => ({ id, token, name, isBot, hand, calledUno })),
            deck: this.deck,
            discard: this.discard,
            currentIndex: this.currentIndex,
            direction: this.direction,
            currentColor: this.currentColor,
            drawStack: this.drawStack,
            hasDrawn: this.hasDrawn,
            turnSeq: this.turnSeq,
            results: this.results,
            rematchReady: [...this.rematchReady],
            log: this.log,
            logSeq: this.logSeq
        };
    }

    static restore(data, options) {
        if (data?.version !== SAVE_VERSION) return null;

        const room = new GameRoom(data.code, options);
        Object.assign(room, {
            phase: data.phase,
            hostId: data.hostId,
            settings: normalizeSettings(data.settings),
            bannedTokens: new Set(data.bannedTokens),
            deck: data.deck,
            discard: data.discard,
            currentIndex: data.currentIndex,
            direction: data.direction,
            currentColor: data.currentColor,
            drawStack: data.drawStack,
            hasDrawn: data.hasDrawn,
            turnSeq: data.turnSeq,
            results: data.results,
            rematchReady: new Set(data.rematchReady),
            log: data.log ?? [],
            logSeq: data.logSeq ?? 0
        });
        room.players = data.players.map(p => ({
            ...p,
            socket: null,
            connected: p.isBot,
            graceTimer: null
        }));
        // Everyone is offline after a restart; give them time to come back.
        for (const player of room.humans) room.startGraceTimer(player);
        return room;
    }
}

