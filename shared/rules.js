// Game rules shared by the server (authoritative) and the client (UI hints).
// Keep this file dependency-free so it runs unchanged in Node and the browser.

export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const WILD = 'wild';

export const CARD_TYPES = Object.freeze({
    NUMBER: 'number',
    SKIP: 'skip',
    REVERSE: 'reverse',
    DRAW_TWO: 'draw_two',
    WILD: 'wild',
    WILD_DRAW_FOUR: 'wild_draw_four',
    CUSTOM_DRAW: 'custom_draw'
});

export const LIMITS = Object.freeze({
    minPlayers: 2,
    maxPlayers: 10,
    nameLength: 16,
    startingCards: { min: 1, max: 20, default: 7 },
    customDraw: { min: 1, max: 20, default: 8 },
    customCount: { min: 1, max: 8, default: 2 }
});

export const DEFAULT_SETTINGS = Object.freeze({
    startingCards: LIMITS.startingCards.default,
    customCard: Object.freeze({
        enabled: false,
        drawAmount: LIMITS.customDraw.default,
        count: LIMITS.customCount.default
    })
});

function clampInt(value, { min, max, default: fallback }) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(input = {}, base = DEFAULT_SETTINGS) {
    const custom = input.customCard ?? {};
    return {
        startingCards: clampInt(input.startingCards ?? base.startingCards, LIMITS.startingCards),
        customCard: {
            enabled: Boolean(custom.enabled ?? base.customCard.enabled),
            drawAmount: clampInt(custom.drawAmount ?? base.customCard.drawAmount, LIMITS.customDraw),
            count: clampInt(custom.count ?? base.customCard.count, LIMITS.customCount)
        }
    };
}

export function isWildCard(card) {
    return card?.color === WILD;
}

export function isPlusCard(card) {
    return card?.type === CARD_TYPES.DRAW_TWO ||
        card?.type === CARD_TYPES.WILD_DRAW_FOUR ||
        card?.type === CARD_TYPES.CUSTOM_DRAW;
}

export function isActionCard(card) {
    return card?.type !== CARD_TYPES.NUMBER;
}

export function getDrawAmount(card) {
    switch (card?.type) {
        case CARD_TYPES.DRAW_TWO: return 2;
        case CARD_TYPES.WILD_DRAW_FOUR: return 4;
        case CARD_TYPES.CUSTOM_DRAW: return clampInt(card.drawAmount, LIMITS.customDraw);
        default: return 0;
    }
}

export function createDeck(settings = DEFAULT_SETTINGS) {
    const { customCard } = normalizeSettings(settings);
    const deck = [];
    let id = 0;
    const add = (card) => deck.push({ id: id++, ...card });

    for (const color of COLORS) {
        add({ color, type: CARD_TYPES.NUMBER, value: 0 });
        for (let n = 1; n <= 9; n++) {
            add({ color, type: CARD_TYPES.NUMBER, value: n });
            add({ color, type: CARD_TYPES.NUMBER, value: n });
        }
        for (let i = 0; i < 2; i++) {
            add({ color, type: CARD_TYPES.SKIP, value: 'skip' });
            add({ color, type: CARD_TYPES.REVERSE, value: 'reverse' });
            add({ color, type: CARD_TYPES.DRAW_TWO, value: '+2' });
        }
    }

    for (let i = 0; i < 4; i++) {
        add({ color: WILD, type: CARD_TYPES.WILD, value: 'wild' });
        add({ color: WILD, type: CARD_TYPES.WILD_DRAW_FOUR, value: '+4' });
    }

    if (customCard.enabled) {
        for (let i = 0; i < customCard.count; i++) {
            add({
                color: WILD,
                type: CARD_TYPES.CUSTOM_DRAW,
                value: `+${customCard.drawAmount}`,
                drawAmount: customCard.drawAmount
            });
        }
    }

    return deck;
}

export function shuffle(cards, random = Math.random) {
    const out = [...cards];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** Can `card` legally be played on `topCard` ignoring hand-size rules. */
export function canPlayOn(card, topCard, currentColor, drawStack = 0) {
    if (!card || !topCard) return false;

    // While a draw penalty is pending, only another plus card can be stacked on it.
    if (drawStack > 0) return isPlusCard(topCard) && isPlusCard(card);

    if (isWildCard(card)) return true;
    if (isPlusCard(card) && isPlusCard(topCard)) return true;
    if (card.color === currentColor) return true;
    if (card.type !== CARD_TYPES.NUMBER) return card.type === topCard.type;
    return topCard.type === CARD_TYPES.NUMBER && card.value === topCard.value;
}

/** Players may not go out on an action or wild card. */
export function canFinishWith(cards) {
    return cards.every(card => card.type === CARD_TYPES.NUMBER);
}

/** A multi-card play must be identical cards, or all plus cards. */
export function areCardsCompatible(cards) {
    if (cards.length <= 1) return true;
    const [first, ...rest] = cards;
    return rest.every(card =>
        (isPlusCard(first) && isPlusCard(card)) ||
        (first.type === card.type && first.value === card.value)
    );
}

/**
 * Full validation for a play. Returns null when legal, otherwise a
 * human-readable reason. `cards` are in the order the player chose them.
 */
export function validatePlay(cards, handSize, { topCard, currentColor, drawStack }) {
    if (!cards.length) return 'Select a card to play.';
    if (!areCardsCompatible(cards)) return 'Those cards can’t be played together.';
    if (!canPlayOn(cards[0], topCard, currentColor, drawStack)) {
        return drawStack > 0
            ? `Stack a plus card or draw ${drawStack}.`
            : 'That card doesn’t match the pile.';
    }
    if (handSize === cards.length && !canFinishWith(cards)) {
        return 'You have to finish on a number card.';
    }
    return null;
}

/** Does this hand contain any single card that could legally be played now? */
export function hasLegalPlay(hand, table) {
    return hand.some(card => validatePlay([card], hand.length, table) === null);
}

export function cardPoints(card) {
    if (card.type === CARD_TYPES.NUMBER) return card.value;
    if (isWildCard(card)) return 50;
    return 20;
}

export function handPoints(hand) {
    return hand.reduce((sum, card) => sum + cardPoints(card), 0);
}

export function cardLabel(card) {
    if (!card) return '';
    const color = isWildCard(card) ? '' : `${capitalize(card.color)} `;
    switch (card.type) {
        case CARD_TYPES.NUMBER: return `${color}${card.value}`;
        case CARD_TYPES.SKIP: return `${color}Skip`;
        case CARD_TYPES.REVERSE: return `${color}Reverse`;
        case CARD_TYPES.DRAW_TWO: return `${color}+2`;
        case CARD_TYPES.WILD: return 'Wild';
        case CARD_TYPES.WILD_DRAW_FOUR: return 'Wild +4';
        case CARD_TYPES.CUSTOM_DRAW: return `Wild +${getDrawAmount(card)}`;
        default: return 'Card';
    }
}

export function capitalize(text = '') {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
