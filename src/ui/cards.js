import { CARD_TYPES, cardLabel, getDrawAmount, isWildCard } from '../../shared/rules.js';
import { h, icon } from '../lib/dom.js';

export const COLOR_NAMES = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' };

export const colorVar = color => (COLOR_NAMES[color] ? `var(--uno-${color})` : '#6b7394');

function faceContent(card) {
    switch (card.type) {
        case CARD_TYPES.NUMBER: {
            const value = String(card.value);
            const is69 = value === '6' || value === '9';
            return {
                center: h('span', { class: `card-center${is69 ? ' is-69' : ''}` }, value),
                corner: () => value
            };
        }
        case CARD_TYPES.SKIP:
            return { center: icon('sym-skip', 'card-symbol'), corner: () => icon('sym-skip', 'card-symbol') };
        case CARD_TYPES.REVERSE:
            return { center: icon('sym-reverse', 'card-symbol'), corner: () => icon('sym-reverse', 'card-symbol') };
        case CARD_TYPES.WILD:
            return { center: null, corner: () => h('span', { class: 'corner-wild' }) };
        default: {
            const text = `+${getDrawAmount(card)}`;
            return { center: h('span', { class: 'card-center is-plus' }, text), corner: () => text };
        }
    }
}

export function renderCard(card) {
    const { center, corner } = faceContent(card);
    const colorClass = isWildCard(card) ? 'c-wild' : `c-${card.color}`;
    return h('div', {
        class: `card ${colorClass} t-${card.type.replaceAll('_', '-')}`,
        dataset: { cardId: card.id },
        role: 'img',
        'aria-label': cardLabel(card)
    },
    h('div', { class: 'card-face' },
        h('span', { class: 'card-oval' }),
        center,
        h('span', { class: 'card-corner tl' }, corner()),
        h('span', { class: 'card-corner br' }, corner())
    ));
}

export function renderCardBack() {
    return h('div', { class: 'card card-back', 'aria-hidden': 'true' },
        h('div', { class: 'card-face' },
            h('span', { class: 'card-oval' }),
            h('span', { class: 'card-logo' }, 'UNO')
        ));
}

/** Stable pseudo-random tilt per card so the pile looks naturally messy. */
export function cardTilt(id) {
    const n = Math.sin(Number(id) * 9301 + 49297) * 233280;
    const r = n - Math.floor(n);
    return { rotate: Math.round((r - 0.5) * 28), dx: Math.round((r - 0.5) * 10), dy: Math.round((0.5 - r) * 8) };
}
