export const CARD_TYPES = {
    NUMBER: 'number',
    SKIP: 'skip',
    REVERSE: 'reverse',
    DRAW_TWO: 'draw_two',
    WILD: 'wild',
    WILD_DRAW_FOUR: 'wild_draw_four',
    CUSTOM_DRAW: 'custom_draw'
};

export function isPlusCard(card) {
    return card?.type === CARD_TYPES.DRAW_TWO ||
        card?.type === CARD_TYPES.WILD_DRAW_FOUR ||
        card?.type === CARD_TYPES.CUSTOM_DRAW;
}

export function areCardsCompatible(cards) {
    if (cards.length <= 1) return true;

    const first = cards[0];

    for (let i = 1; i < cards.length; i++) {
        const current = cards[i];
        if (isPlusCard(first) && isPlusCard(current)) continue;
        if (first.type !== current.type || first.value != current.value) return false;
    }

    return true;
}

export function canPlayCard(card, topCard, currentColor, drawStack = 0) {
    if (!card || !topCard) return false;

    if (drawStack > 0) {
        return isPlusCard(topCard) && isPlusCard(card);
    }

    if (card.type === CARD_TYPES.WILD ||
        card.type === CARD_TYPES.WILD_DRAW_FOUR ||
        card.type === CARD_TYPES.CUSTOM_DRAW) {
        return true;
    }

    if (isPlusCard(card) && isPlusCard(topCard)) {
        return true;
    }

    if (card.color === currentColor) {
        return true;
    }

    if (card.type !== CARD_TYPES.NUMBER && card.type === topCard.type) {
        return true;
    }

    return card.type === CARD_TYPES.NUMBER &&
        topCard.type === CARD_TYPES.NUMBER &&
        card.value == topCard.value;
}

export function isLegalPlayableCard(card, handSize, topCard, currentColor, drawStack = 0) {
    if (!canPlayCard(card, topCard, currentColor, drawStack)) return false;
    return handSize !== 1 || card.type === CARD_TYPES.NUMBER;
}
