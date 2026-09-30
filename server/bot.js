// Bot decision making. Pure functions: given a hand and table context they
// return what to do, and the room carries it out through the normal actions.
import {
    CARD_TYPES, COLORS, canPlayOn, getDrawAmount, isWildCard, validatePlay
} from '../shared/rules.js';

export const BOT_NAMES = ['Nova', 'Pixel', 'Echo', 'Byte', 'Juno', 'Rex', 'Sol', 'Kit', 'Zed', 'Ivy'];

/**
 * @param {object[]} hand
 * @param {{topCard, currentColor, drawStack}} table
 * @param {{nextOpponentCards: number, anyoneLow: boolean}} context
 * @returns {{cardIds: number[], color?: string} | null} null means "draw / pass"
 */
export function chooseBotPlay(hand, table, context) {
    let best = null;
    let bestScore = -Infinity;

    const colorCount = color => hand.filter(card => card.color === color).length;

    for (const faces of groupIdenticalCards(hand)) {
        // Lead with a card that matches the pile, and finish on the colour we hold most of.
        const leader = faces.find(card => canPlayOn(card, table.topCard, table.currentColor, table.drawStack));
        if (!leader) continue;
        const rest = faces.filter(card => card !== leader).sort((a, b) => colorCount(a.color) - colorCount(b.color));
        const group = [leader, ...rest];

        // Try the largest legal subset (going out on an action card is illegal,
        // so a full group of action cards may need to keep one back).
        for (let size = group.length; size >= 1; size--) {
            const cards = group.slice(0, size);
            if (validatePlay(cards, hand.length, table) !== null) continue;

            const score = scorePlay(cards, hand, context);
            if (score > bestScore) {
                bestScore = score;
                best = cards;
            }
            break;
        }
    }

    if (!best) return null;

    const top = best[best.length - 1];
    return {
        cardIds: best.map(card => card.id),
        color: isWildCard(top) ? chooseBotColor(hand, best, context) : undefined
    };
}

function groupIdenticalCards(hand) {
    const groups = new Map();
    for (const card of hand) {
        // All plus cards may be stacked together; everything else groups by exact face.
        const key = `${card.type}:${card.value}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(card);
    }
    return [...groups.values()];
}

function scorePlay(cards, hand, { nextOpponentCards, anyoneLow }) {
    const card = cards[0];
    const remaining = hand.length - cards.length;
    const endgame = hand.length <= 3 || anyoneLow;
    const threatened = nextOpponentCards <= 2;
    let score = 0;

    if (remaining === 0) score += 10_000;
    else if (remaining === 1) score += 500;

    score += cards.length * 25;

    if (threatened) {
        score += {
            [CARD_TYPES.DRAW_TWO]: 200,
            [CARD_TYPES.WILD_DRAW_FOUR]: 250,
            [CARD_TYPES.CUSTOM_DRAW]: 260 + getDrawAmount(card),
            [CARD_TYPES.SKIP]: 150,
            [CARD_TYPES.REVERSE]: 100
        }[card.type] ?? 0;
    }

    if (endgame) {
        score += {
            [CARD_TYPES.NUMBER]: 5,
            [CARD_TYPES.DRAW_TWO]: 20,
            [CARD_TYPES.SKIP]: 15,
            [CARD_TYPES.REVERSE]: 10,
            [CARD_TYPES.WILD]: 8,
            [CARD_TYPES.WILD_DRAW_FOUR]: 25,
            [CARD_TYPES.CUSTOM_DRAW]: 25 + getDrawAmount(card)
        }[card.type] ?? 0;
    } else {
        // Early on, shed numbers and hold action cards for when they matter.
        score += {
            [CARD_TYPES.NUMBER]: 20,
            [CARD_TYPES.SKIP]: -5,
            [CARD_TYPES.REVERSE]: -5,
            [CARD_TYPES.DRAW_TWO]: -3,
            [CARD_TYPES.WILD]: -30,
            [CARD_TYPES.WILD_DRAW_FOUR]: -35,
            [CARD_TYPES.CUSTOM_DRAW]: -20 - getDrawAmount(card)
        }[card.type] ?? 0;
    }

    if (!isWildCard(card)) {
        // Staying in a colour we hold lots of keeps future turns easy.
        score += hand.filter(c => c.color === card.color).length * 3;
    }

    return score;
}

export function chooseBotColor(hand, playing = [], { nextOpponentCards = 7 } = {}) {
    const playingIds = new Set(playing.map(card => card.id));
    const rest = hand.filter(card => !playingIds.has(card.id) && !isWildCard(card));

    let bestColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    let bestScore = -Infinity;

    for (const color of COLORS) {
        const ofColor = rest.filter(card => card.color === color);
        let score = ofColor.length * 10;
        score += ofColor.reduce((sum, card) => sum + (card.type === CARD_TYPES.NUMBER ? 6 : 3), 0);
        if (ofColor.some(card => card.type === CARD_TYPES.NUMBER)) score += 8;
        if (nextOpponentCards <= 2) {
            if (ofColor.some(card => card.type === CARD_TYPES.DRAW_TWO)) score += 15;
            if (ofColor.some(card => card.type === CARD_TYPES.SKIP)) score += 10;
        }
        if (score > bestScore) {
            bestScore = score;
            bestColor = color;
        }
    }

    return bestColor;
}
