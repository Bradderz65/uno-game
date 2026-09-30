import { CARD_TYPES, cardLabel, hasLegalPlay, isPlusCard, isWildCard, validatePlay } from '../../shared/rules.js';
import { $, h, icon, avatar } from '../lib/dom.js';
import { sounds } from '../sounds.js';
import { COLOR_NAMES, cardTilt, colorVar, renderCard, renderCardBack } from './cards.js';
import { pickColor } from './dialogs.js';
import { fly, pulse, unoBurst } from './fx.js';
import { Hand } from './hand.js';
import { Results } from './results.js';
import { toast } from './toast.js';

const FLIGHT_MS = 460;
const MAX_FAN = 10;

export class GameScreen {
    constructor(app) {
        this.app = app;
        this.el = $('#game-screen');
        this.tableArea = $('#table-area');
        this.seatsEl = $('#seats');
        this.discardEl = $('#discard-pile');
        this.drawPileEl = $('#draw-pile');
        this.drawBtn = $('#draw-btn');
        this.playBtn = $('#play-btn');
        this.unoBtn = $('#uno-btn');
        this.state = null;
        this.seatEls = new Map();
        this.pendingLanding = false;
        this.ownPlay = null;
        this.busy = false;

        this.drawPileEl.prepend(renderCardBack());
        this.hand = new Hand($('#hand'), {
            onSelectionChange: () => this.renderDock(),
            onPlayRequest: () => this.playSelected(),
            onInvalid: (reason, slot) => {
                sounds.error();
                slot?.firstChild.animate(
                    [{ translate: '0 0' }, { translate: '-5px 0' }, { translate: '5px 0' }, { translate: '0 0' }],
                    { duration: 260 }
                );
                this.flashStatus(reason);
            },
            onSortChange: enabled => this.syncSortButton(enabled)
        });
        this.results = new Results(app);

        this.drawBtn.addEventListener('click', () => this.drawOrPass());
        this.drawPileEl.addEventListener('click', () => {
            if (this.drawBtn.dataset.action === 'draw' && !this.drawBtn.disabled) this.drawOrPass();
        });
        this.playBtn.addEventListener('click', () => this.playSelected());
        this.unoBtn.addEventListener('click', () => this.callUno());
        $('#sort-btn').addEventListener('click', () => this.hand.setAutoSort(!this.hand.autoSort));
        $('#game-leave-btn').addEventListener('click', () => this.app.leaveRoom());
        this.syncSortButton(this.hand.autoSort);

        new ResizeObserver(() => this.updateLayoutMode()).observe(this.tableArea);
        document.addEventListener('keydown', event => this.onKeyDown(event));
        document.addEventListener('visibilitychange', () => this.updateTitle());
    }

    show() {
        this.el.hidden = false;
        this.updateLayoutMode();
    }

    hide() {
        this.el.hidden = true;
        this.results.close();
        this.state = null;
        document.title = 'UNO · Play with friends';
    }

    // ------------------------------------------------------------- derived

    get me() {
        return this.state?.players.find(p => p.id === this.state.you) ?? null;
    }

    get table() {
        const game = this.state?.game;
        return game ? { topCard: game.discard.at(-1), currentColor: game.currentColor, drawStack: game.drawStack } : null;
    }

    get isMyTurn() {
        const { state } = this;
        return Boolean(state?.phase === 'playing' && !state.game.dealing && state.game.currentPlayerId === state.you);
    }

    playerName(id) {
        if (id === this.state?.you) return 'You';
        return this.state?.players.find(p => p.id === id)?.name ?? 'Someone';
    }

    // -------------------------------------------------------------- render

    render(state) {
        const prev = this.state;
        this.state = state;
        const game = state.game;

        this.el.classList.toggle('is-my-turn', this.isMyTurn);
        this.el.style.setProperty('--table-color', colorVar(game.currentColor));
        $('#game-code').textContent = state.code;

        this.updateLayoutMode();
        this.renderTurnPill();
        this.renderSeats(prev);
        this.renderPiles(prev);
        this.renderFeed();

        this.hand.render(game.hand, {
            myTurn: this.isMyTurn,
            table: this.table,
            locked: state.phase !== 'playing' || game.dealing,
            dealing: game.dealing
        }, { from: prev?.game ? this.drawPileEl.getBoundingClientRect() : undefined });

        this.renderDock();
        this.announceTurn(prev);
        this.updateTitle();
        this.results.render(state);
    }

    updateLayoutMode() {
        if (this.el.hidden) return;
        const { clientWidth: width, clientHeight: height } = this.tableArea;
        const opponents = Math.max(1, (this.state?.players.length ?? 2) - 1);
        // Around-the-table seating needs room; otherwise seats go in a strip above the table.
        const compact = width < 700 || height < 470 || width / opponents < 110;
        this.el.classList.toggle('is-compact', compact);
    }

    renderTurnPill() {
        const { state } = this;
        const game = state.game;
        let text;
        if (state.phase === 'finished') text = 'Game over';
        else if (game.dealing) text = 'Dealing…';
        else if (this.isMyTurn) text = 'Your turn';
        else text = `${this.playerName(game.currentPlayerId)}’s turn`;
        $('#turn-text').textContent = text;
    }

    renderSeats(prev) {
        const { state } = this;
        const players = state.players;
        const meIndex = Math.max(0, players.findIndex(p => p.id === state.you));
        // Seat opponents clockwise starting from the player after us.
        const opponents = [...players.slice(meIndex + 1), ...players.slice(0, meIndex)];
        const n = opponents.length;
        const live = new Set(opponents.map(p => p.id));

        for (const [id, el] of this.seatEls) {
            if (!live.has(id)) {
                el.remove();
                this.seatEls.delete(id);
            }
        }

        opponents.forEach((player, index) => {
            let seat = this.seatEls.get(player.id);
            if (!seat) {
                seat = h('div', { class: 'seat', dataset: { playerId: player.id } });
                this.seatEls.set(player.id, seat);
            }
            if (this.seatsEl.children[index] !== seat) this.seatsEl.insertBefore(seat, this.seatsEl.children[index] ?? null);

            // Spread seats over the top arc of the table: left → top → right.
            const angle = (160 + (index + 0.5) * (220 / n)) * (Math.PI / 180);
            seat.style.setProperty('--x', `${50 + 40 * Math.cos(angle)}%`);
            seat.style.setProperty('--y', `${52 + 41 * Math.sin(angle)}%`);

            this.renderSeat(seat, player);

            const before = prev?.players.find(p => p.id === player.id)?.cardCount ?? player.cardCount;
            if (prev?.game && player.cardCount > before) this.animateOpponentDraw(seat, player.cardCount - before);
        });
    }

    renderSeat(seat, player) {
        const { state } = this;
        const active = state.phase === 'playing' && state.game.currentPlayerId === player.id && !state.game.dealing;
        seat.classList.toggle('is-active', active);
        seat.classList.toggle('is-offline', !player.connected);

        const key = JSON.stringify([player.name, player.cardCount, player.connected, player.calledUno, active, player.isBot]);
        if (seat.dataset.key === key) return;
        seat.dataset.key = key;

        const shown = Math.min(player.cardCount, MAX_FAN);
        const fan = h('div', { class: 'seat-fan', 'aria-hidden': 'true', style: { '--n': shown - 1 } },
            Array.from({ length: shown }, (_, i) => h('span', {
                class: 'mini-card',
                style: { '--i': i, '--d': Math.abs(i - (shown - 1) / 2) ** 2 * 0.6 }
            })));

        let meta;
        if (!player.connected) meta = [icon('i-offline'), 'Reconnecting'];
        else if (active && player.isBot) meta = [h('span', { class: 'thinking' }, h('i'), h('i'), h('i')), 'Thinking'];
        else meta = [`${player.cardCount} ${player.cardCount === 1 ? 'card' : 'cards'}`];

        seat.replaceChildren(
            fan,
            h('div', { class: 'seat-card' },
                avatar(player),
                h('div', { class: 'seat-text' },
                    h('span', { class: 'seat-name', title: player.name }, player.name),
                    h('span', { class: 'seat-meta' }, meta)
                ),
                player.cardCount === 1 && h('span', { class: 'seat-badge' }, player.calledUno ? 'UNO' : '1')
            )
        );
        seat.setAttribute('aria-label', `${player.name}, ${player.cardCount} cards${active ? ', playing now' : ''}`);
    }

    animateOpponentDraw(seat, count) {
        const from = this.drawPileEl.getBoundingClientRect();
        const target = seat.querySelector('.seat-card')?.getBoundingClientRect();
        if (!target) return;
        const to = new DOMRect(target.left + target.width / 2 - from.width * 0.2, target.top - from.height * 0.1, from.width * 0.4, from.height * 0.4);
        for (let i = 0; i < Math.min(count, 6); i++) {
            fly(renderCardBack(), from, to, { duration: 420, delay: i * 110, rotate: 10, fade: true });
        }
    }

    renderPiles() {
        const game = this.state.game;
        $('#deck-count').textContent = game.deckCount;
        this.drawPileEl.classList.toggle('is-empty', game.deckCount === 0);

        const recent = game.discard.slice(-3);
        const key = recent.map(card => card.id).join(',') + `|${game.currentColor}`;
        if (this.discardEl.dataset.key !== key) {
            const landing = this.pendingLanding;
            this.pendingLanding = false;
            this.discardEl.dataset.key = key;
            this.discardEl.replaceChildren(...recent.map((card, index) => {
                const el = renderCard(card);
                const tilt = cardTilt(card.id);
                const isTop = index === recent.length - 1;
                el.style.setProperty('--r', `${isTop ? tilt.rotate / 3 : tilt.rotate}deg`);
                el.style.setProperty('--tx', `${isTop ? 0 : tilt.dx}px`);
                el.style.setProperty('--ty', `${isTop ? 0 : tilt.dy}px`);
                if (!isTop) el.classList.add('is-under');
                if (isTop && isWildCard(card) && COLOR_NAMES[game.currentColor]) {
                    el.classList.add('has-chosen-color');
                    el.style.setProperty('--chosen', colorVar(game.currentColor));
                }
                if (isTop && landing) {
                    el.classList.add('is-landing');
                    el.style.setProperty('--land-delay', `${FLIGHT_MS * 0.6}ms`);
                }
                return el;
            }));
            const top = recent.at(-1);
            this.discardEl.setAttribute('aria-label', top ? `Top card: ${cardLabel(top)}${isWildCard(top) ? `, ${COLOR_NAMES[game.currentColor]}` : ''}` : 'Discard pile');
        }

        $('#color-name').textContent = COLOR_NAMES[game.currentColor] ?? '—';
        const stack = $('#stack-chip');
        stack.hidden = !game.drawStack;
        if (game.drawStack && stack.textContent !== `+${game.drawStack}`) {
            stack.textContent = `+${game.drawStack}`;
            pulse(stack, 'is-bumped');
        }
        $('#direction-ring').classList.toggle('is-ccw', game.direction === -1);
    }

    renderFeed() {
        const log = this.state.log ?? [];
        const latest = log.at(-1);
        const last = $('#last-action');
        last.replaceChildren(...(latest ? describe(latest, this.state.you) : []));

        const feed = $('#feed');
        const entries = log.slice(-6);
        const key = entries.map(entry => entry.seq).join();
        if (feed.dataset.key === key) return;
        feed.dataset.key = key;
        feed.replaceChildren(...entries.map(entry => h('li', {},
            h('span', { class: 'dot', style: { '--dot': entry.color ? colorVar(entry.color) : '' } }),
            h('span', {}, describe(entry, this.state.you))
        )));
    }

    renderDock() {
        const { state } = this;
        if (!state) return;
        const game = state.game;
        const hand = game.hand;
        const table = this.table;
        const myTurn = this.isMyTurn;
        const selection = this.hand.selectedCards;
        const canPlay = hasLegalPlay(hand, table);

        let status;
        let action = 'draw';
        let drawEnabled = false;
        let drawLabel = 'Draw';

        if (state.phase === 'finished') {
            status = 'Game over';
        } else if (game.dealing) {
            status = 'Dealing cards…';
        } else if (!myTurn) {
            const current = state.players.find(p => p.id === game.currentPlayerId);
            status = current?.isBot ? `${current.name} is thinking…` : `Waiting for ${current?.name ?? 'the next player'}…`;
        } else if (game.drawStack > 0) {
            const canStack = hand.some(card => isPlusCard(card));
            status = canStack ? `+${game.drawStack} incoming — stack a draw card or take them` : `+${game.drawStack} incoming — you’ll have to take them`;
            drawEnabled = true;
            drawLabel = `Take ${game.drawStack}`;
        } else if (game.hasDrawn) {
            if (canPlay) {
                status = 'Play a matching card';
            } else {
                status = 'Nothing fits — pass your turn';
                action = 'pass';
                drawEnabled = true;
                drawLabel = 'Pass';
            }
        } else if (canPlay) {
            const color = COLOR_NAMES[game.currentColor]?.toLowerCase() ?? 'the colour';
            const face = faceName(table.topCard);
            status = face ? `Match ${color} or ${face}` : `Match ${color}`;
        } else {
            status = 'No matching cards — draw one';
            drawEnabled = true;
        }

        let playLabel = 'Play';
        let playEnabled = false;
        if (myTurn && selection.length) {
            const reason = validatePlay(selection, hand.length, table);
            playEnabled = !reason;
            playLabel = selection.length > 1 ? `Play ${selection.length}` : 'Play';
            status = reason ?? (selection.length > 1 ? `${selection.length} cards selected — the last one goes on top` : `${cardLabel(selection[0])} selected`);
        }

        if (hand.length === 1 && myTurn && !this.me?.calledUno && !game.hasDrawn) {
            status = 'Last card! Call UNO before you play it';
        }

        this.statusText = status;
        if (!this.flashTimer) $('#dock-status').textContent = status;

        this.drawBtn.dataset.action = action;
        this.drawBtn.disabled = !drawEnabled || this.busy;
        this.drawBtn.classList.toggle('is-stack', myTurn && game.drawStack > 0);
        $('#draw-label').textContent = drawLabel;
        $('#draw-icon use').setAttribute('href', action === 'pass' ? '#i-pass' : '#i-draw');
        this.drawPileEl.classList.toggle('can-draw', drawEnabled && action === 'draw');
        this.drawPileEl.disabled = !(drawEnabled && action === 'draw');

        this.playBtn.disabled = !playEnabled || this.busy;
        $('#play-label').textContent = playLabel;

        this.unoBtn.hidden = !(state.phase === 'playing' && hand.length === 1 && !this.me?.calledUno);
    }

    flashStatus(message) {
        const el = $('#dock-status');
        el.textContent = message;
        clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => {
            this.flashTimer = null;
            el.textContent = this.statusText ?? '';
        }, 2200);
    }

    syncSortButton(enabled) {
        $('#sort-btn').setAttribute('aria-pressed', String(enabled));
    }

    announceTurn(prev) {
        const game = this.state.game;
        const wasMine = prev?.game && prev.phase === 'playing' && !prev.game.dealing &&
            prev.game.currentPlayerId === prev.you && prev.game.turnSeq === game.turnSeq;
        if (this.isMyTurn && !wasMine) {
            sounds.yourTurn();
            navigator.vibrate?.(25);
        }
    }

    updateTitle() {
        if (!this.state) return;
        document.title = this.isMyTurn && document.hidden ? '● Your turn · UNO' : `UNO · ${this.state.code}`;
    }

    // ------------------------------------------------------------- actions

    async withBusy(task) {
        if (this.busy) return;
        this.busy = true;
        this.renderDock();
        try {
            return await task();
        } finally {
            this.busy = false;
            this.renderDock();
        }
    }

    async playSelected() {
        const cards = this.hand.selectedCards;
        if (!this.isMyTurn || !cards.length || this.busy) return;

        const reason = validatePlay(cards, this.state.game.hand.length, this.table);
        if (reason) {
            sounds.error();
            this.flashStatus(reason);
            return;
        }

        let color;
        if (isWildCard(cards.at(-1))) {
            color = await pickColor();
            if (!color) return;
            sounds.colorSelect();
        }

        const cardIds = cards.map(card => card.id);
        this.ownPlay = { ids: cardIds, rects: new Map(cardIds.map(id => [id, this.hand.rectOf(id)])) };
        await this.withBusy(async () => {
            const result = await this.app.action('game:play', { cardIds, color }, { quiet: true });
            if (result.error) {
                this.ownPlay = null;
                sounds.error();
                toast(result.error, 'error');
            }
        });
    }

    drawOrPass() {
        if (!this.isMyTurn) return;
        const event = this.drawBtn.dataset.action === 'pass' ? 'game:pass' : 'game:draw';
        return this.withBusy(() => this.app.action(event));
    }

    callUno() {
        this.unoBtn.hidden = true;
        return this.app.action('game:uno');
    }

    onKeyDown(event) {
        if (this.el.hidden || !this.state || document.querySelector('dialog[open]')) return;
        if (event.target.closest('input, textarea') || event.metaKey || event.ctrlKey || event.altKey) return;

        switch (event.key.toLowerCase()) {
            case 'enter':
                if (event.target.closest('.hand')) return;
                event.preventDefault();
                this.playSelected();
                break;
            case 'd':
                if (!this.drawBtn.disabled) this.drawOrPass();
                break;
            case 'u':
                if (!this.unoBtn.hidden) this.callUno();
                break;
            case 's':
                this.hand.setAutoSort(!this.hand.autoSort);
                break;
            case 'escape':
                this.hand.clearSelection();
                break;
            default:
        }
    }

    // --------------------------------------------------------------- events

    onEvent(event) {
        const isMe = event.playerId === this.state?.you;
        switch (event.type) {
            case 'play':
                this.animatePlay(event, isMe);
                playSound(event.cards.at(-1));
                break;
            case 'draw':
                sounds.cardDraw();
                if (event.forced && event.count > 1) {
                    toast(isMe ? `You draw ${event.count}` : `${event.name} draws ${event.count}`, isMe ? 'warning' : 'info', 2200);
                }
                break;
            case 'penalty':
                sounds.caught();
                toast(isMe ? 'You forgot to call UNO — +2 cards' : `${event.name} forgot to call UNO — +2`, isMe ? 'error' : 'warning');
                pulse(this.seatEls.get(event.playerId), 'is-hit');
                break;
            case 'uno':
                sounds.unoCall();
                unoBurst();
                break;
            case 'start':
                sounds.gameStart();
                this.hand.clearSelection();
                break;
            case 'end':
                if (isMe) {
                    sounds.victory();
                } else {
                    sounds.lose();
                }
                break;
            default:
        }
    }

    animatePlay(event, isMe) {
        const target = this.discardEl.getBoundingClientRect();
        this.pendingLanding = true;
        const cards = event.cards;

        cards.forEach((card, i) => {
            let from;
            if (isMe) {
                from = this.ownPlay?.rects.get(card.id) ?? this.hand.rectOf(card.id);
            } else {
                const seat = this.seatEls.get(event.playerId)?.querySelector('.seat-card');
                const r = seat?.getBoundingClientRect();
                if (r) from = new DOMRect(r.left + r.width / 2 - target.width * 0.25, r.top, target.width * 0.5, target.height * 0.5);
            }
            if (!from) return;
            const el = renderCard(card);
            fly(el, from, target, { duration: FLIGHT_MS, delay: i * 110, rotate: isMe ? 0 : -20 });
        });

        if (isMe) {
            this.hand.hide(cards.map(card => card.id));
            this.ownPlay = null;
        }
    }
}

function playSound(card) {
    if (!card) return;
    if (card.type === CARD_TYPES.SKIP) sounds.skip();
    else if (card.type === CARD_TYPES.REVERSE) sounds.reverse();
    else if (isPlusCard(card)) sounds.drawPenalty();
    else if (card.type === CARD_TYPES.WILD) sounds.wildCard();
    else sounds.cardPlay();
}

/** What else (besides colour) matches the top card, or null for wilds. */
function faceName(card) {
    if (!card || isWildCard(card)) return null;
    if (card.type === CARD_TYPES.NUMBER) return String(card.value);
    if (card.type === CARD_TYPES.SKIP) return 'Skip';
    if (card.type === CARD_TYPES.REVERSE) return 'Reverse';
    return 'a draw card';
}

/** Human-readable summary of a log entry, as DOM nodes. */
export function describe(entry, youId) {
    const who = h('strong', {}, entry.playerId === youId ? 'You' : entry.name ?? 'Someone');
    switch (entry.type) {
        case 'play': {
            const top = entry.cards.at(-1);
            const count = entry.cards.length > 1 ? `${entry.cards.length} × ` : '';
            const color = isWildCard(top) ? ` → ${COLOR_NAMES[entry.color]}` : '';
            return [who, ` played ${count}${cardLabel(top)}${color}`];
        }
        case 'draw':
            return [who, entry.count === 1 ? ' drew a card' : ` drew ${entry.count} cards`];
        case 'penalty':
            return [who, ' forgot to call UNO (+2)'];
        case 'uno':
            return [who, ' called UNO!'];
        case 'pass':
            return [who, ' passed'];
        case 'start':
            return ['New game — good luck!'];
        case 'end':
            return entry.reason === 'forfeit' ? [who, ' won — everyone else left'] : [who, entry.playerId === youId ? ' won the game!' : ' won the game'];
        case 'join':
            return [who, ' joined'];
        case 'leave':
            return [h('strong', {}, entry.name), entry.reason === 'kicked' ? ' was removed' : ' left'];
        default:
            return [];
    }
}
