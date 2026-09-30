import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CARD_TYPES, createDeck, canPlayOn, areCardsCompatible, validatePlay,
    hasLegalPlay, normalizeSettings, cardLabel
} from '../shared/rules.js';

const card = (color, type, value, extra = {}) => ({ id: Math.random(), color, type, value, ...extra });
const n = (color, value) => card(color, CARD_TYPES.NUMBER, value);
const skip = color => card(color, CARD_TYPES.SKIP, 'skip');
const plus2 = color => card(color, CARD_TYPES.DRAW_TWO, '+2');
const wild = () => card('wild', CARD_TYPES.WILD, 'wild');
const plus4 = () => card('wild', CARD_TYPES.WILD_DRAW_FOUR, '+4');

test('standard deck has 108 cards, custom cards are added on top', () => {
    assert.equal(createDeck().length, 108);
    const deck = createDeck({ customCard: { enabled: true, drawAmount: 10, count: 3 } });
    assert.equal(deck.length, 111);
    assert.equal(deck.filter(c => c.type === CARD_TYPES.CUSTOM_DRAW && c.drawAmount === 10).length, 3);
    assert.equal(new Set(deck.map(c => c.id)).size, deck.length);
});

test('matching by colour, number and action type', () => {
    const top = n('red', 5);
    assert.ok(canPlayOn(n('red', 9), top, 'red'));
    assert.ok(canPlayOn(n('blue', 5), top, 'red'));
    assert.ok(!canPlayOn(n('blue', 6), top, 'red'));
    assert.ok(canPlayOn(skip('blue'), skip('red'), 'red'));
    assert.ok(!canPlayOn(skip('blue'), top, 'red'));
    assert.ok(canPlayOn(wild(), top, 'red'));
});

test('wild top card uses the chosen colour', () => {
    assert.ok(canPlayOn(n('green', 1), wild(), 'green'));
    assert.ok(!canPlayOn(n('red', 1), wild(), 'green'));
});

test('only plus cards can answer a pending draw stack', () => {
    assert.ok(canPlayOn(plus2('blue'), plus2('red'), 'red', 2));
    assert.ok(canPlayOn(plus4(), plus2('red'), 'red', 2));
    assert.ok(canPlayOn(plus2('green'), plus4(), 'blue', 4));
    assert.ok(!canPlayOn(n('red', 3), plus2('red'), 'red', 2));
    assert.ok(!canPlayOn(wild(), plus2('red'), 'red', 2));
});

test('multi-card plays must be identical faces or all plus cards', () => {
    assert.ok(areCardsCompatible([n('red', 5), n('blue', 5)]));
    assert.ok(!areCardsCompatible([n('red', 5), n('red', 6)]));
    assert.ok(areCardsCompatible([plus2('red'), plus4()]));
    assert.ok(!areCardsCompatible([skip('red'), n('red', 5)]));
});

test('cannot finish on an action card', () => {
    const table = { topCard: n('red', 2), currentColor: 'red', drawStack: 0 };
    assert.match(validatePlay([skip('red')], 1, table), /number card/);
    assert.equal(validatePlay([n('red', 7)], 1, table), null);
    assert.ok(!hasLegalPlay([skip('red')], table));
});

test('settings are clamped', () => {
    const s = normalizeSettings({ startingCards: 99, customCard: { enabled: 1, drawAmount: -3, count: 'x' } });
    assert.deepEqual(s, { startingCards: 20, customCard: { enabled: true, drawAmount: 1, count: 2 } });
});

test('card labels', () => {
    assert.equal(cardLabel(n('red', 7)), 'Red 7');
    assert.equal(cardLabel(plus4()), 'Wild +4');
    assert.equal(cardLabel(card('wild', CARD_TYPES.CUSTOM_DRAW, '+9', { drawAmount: 9 })), 'Wild +9');
});
