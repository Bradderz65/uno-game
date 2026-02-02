// UNO Card Colors and Types
export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const WILD_COLOR = 'wild';

export const CARD_TYPES = {
    NUMBER: 'number',
    SKIP: 'skip',
    REVERSE: 'reverse',
    DRAW_TWO: 'draw_two',
    WILD: 'wild',
    WILD_DRAW_FOUR: 'wild_draw_four'
};

// Create a standard UNO deck
export function createDeck() {
    const deck = [];
    let id = 0;

    // Number cards (0-9) for each color
    // One 0 per color, two of each 1-9
    for (const color of COLORS) {
        // One zero
        deck.push({ id: id++, color, type: CARD_TYPES.NUMBER, value: 0 });

        // Two of each 1-9
        for (let num = 1; num <= 9; num++) {
            deck.push({ id: id++, color, type: CARD_TYPES.NUMBER, value: num });
            deck.push({ id: id++, color, type: CARD_TYPES.NUMBER, value: num });
        }

        // Two of each action card per color
        for (let i = 0; i < 2; i++) {
            deck.push({ id: id++, color, type: CARD_TYPES.SKIP, value: 'skip' });
            deck.push({ id: id++, color, type: CARD_TYPES.REVERSE, value: 'reverse' });
            deck.push({ id: id++, color, type: CARD_TYPES.DRAW_TWO, value: '+2' });
        }
    }

    // Wild cards (4 of each)
    for (let i = 0; i < 4; i++) {
        deck.push({ id: id++, color: WILD_COLOR, type: CARD_TYPES.WILD, value: 'wild' });
        deck.push({ id: id++, color: WILD_COLOR, type: CARD_TYPES.WILD_DRAW_FOUR, value: '+4' });
    }

    return deck;
}

// Shuffle deck using Fisher-Yates algorithm
export function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Check if a card can be played on top of another
export function canPlayCard(card, topCard, currentColor) {
    // Wild cards can always be played
    if (card.type === CARD_TYPES.WILD || card.type === CARD_TYPES.WILD_DRAW_FOUR) {
        return true;
    }

    // Same color
    if (card.color === currentColor) {
        return true;
    }

    // Same type/value for action cards
    if (card.type !== CARD_TYPES.NUMBER && card.type === topCard.type) {
        return true;
    }

    // Same number
    if (card.type === CARD_TYPES.NUMBER && topCard.type === CARD_TYPES.NUMBER && card.value == topCard.value) {
        return true;
    }

    return false;
}

// Check if a group of cards can be played together (must form a valid chain)
export function areCardsCompatible(cards) {
    if (cards.length <= 1) return true;
    
    const first = cards[0];

    // Each card must match the FIRST one by VALUE/TYPE only
    for (let i = 1; i < cards.length; i++) {
        const current = cards[i];
        
        const sameValue = first.type === current.type && first.value == current.value;
        
        if (!sameValue) return false;
    }
    
    return true;
}

// Get card display value
export function getCardDisplay(card) {
    switch (card.type) {
        case CARD_TYPES.NUMBER:
            return card.value.toString();
        case CARD_TYPES.SKIP:
            return '⊘';
        case CARD_TYPES.REVERSE:
            return '↺';
        case CARD_TYPES.DRAW_TWO:
            return '+2';
        case CARD_TYPES.WILD:
            return 'W';
        case CARD_TYPES.WILD_DRAW_FOUR:
            return '+4';
        default:
            return '?';
    }
}

// Calculate points for a hand (for scoring)
export function calculateHandPoints(hand) {
    return hand.reduce((total, card) => {
        switch (card.type) {
            case CARD_TYPES.NUMBER:
                return total + card.value;
            case CARD_TYPES.SKIP:
            case CARD_TYPES.REVERSE:
            case CARD_TYPES.DRAW_TWO:
                return total + 20;
            case CARD_TYPES.WILD:
            case CARD_TYPES.WILD_DRAW_FOUR:
                return total + 50;
            default:
                return total;
        }
    }, 0);
}
