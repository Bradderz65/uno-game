import { COLORS, CARD_TYPES, areCardsCompatible, validatePlay } from '../../shared/rules.js';
import { h } from '../lib/dom.js';
import { prefs } from '../lib/storage.js';
import { renderCard, renderCardBack } from './cards.js';
import { fly } from './fx.js';

const HOLD_MS = { mouse: 220, touch: 380, pen: 300 };
const MOVE_TOLERANCE = 8;
const DOUBLE_TAP_MS = 320;
const GAP = 8;

const COLOR_ORDER = [...COLORS, 'wild'];
const TYPE_ORDER = [CARD_TYPES.NUMBER, CARD_TYPES.SKIP, CARD_TYPES.REVERSE, CARD_TYPES.DRAW_TWO, CARD_TYPES.WILD, CARD_TYPES.WILD_DRAW_FOUR, CARD_TYPES.CUSTOM_DRAW];

function compareCards(a, b) {
    return COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color) ||
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
        (Number(a.value) || 0) - (Number(b.value) || 0) ||
        a.id - b.id;
}

/**
 * The local player's hand. Owns display order, selection and drag-to-reorder;
 * the server only ever sees card ids.
 */
export class Hand {
    constructor(el, { onSelectionChange, onPlayRequest, onInvalid, onSortChange }) {
        this.el = el;
        this.wrap = el.parentElement;
        this.callbacks = { onSelectionChange, onPlayRequest, onInvalid, onSortChange };
        this.cards = [];
        this.context = null;
        this.selected = [];
        this.manualOrder = [];
        this.autoSort = prefs.get('autoSort', true);
        this.slots = new Map();
        this.drag = null;
        this.lastTap = { id: null, at: 0 };
        this.suppressClick = false;

        el.addEventListener('click', event => this.onClick(event));
        el.addEventListener('pointerdown', event => this.onPointerDown(event));
        el.addEventListener('pointermove', event => this.onPointerMove(event));
        el.addEventListener('pointerup', event => this.onPointerUp(event));
        el.addEventListener('pointercancel', event => this.onPointerUp(event));
        el.addEventListener('contextmenu', event => event.preventDefault());
        el.addEventListener('keydown', event => this.onKeyDown(event));
        // Once a press-and-hold drag starts, stop the hand from scrolling under the finger.
        el.addEventListener('touchmove', event => {
            if (this.drag?.active) event.preventDefault();
        }, { passive: false });

        new ResizeObserver(() => this.layout()).observe(this.wrap);
    }

    // ----------------------------------------------------------- state

    setAutoSort(enabled) {
        this.autoSort = enabled;
        prefs.set('autoSort', enabled);
        if (!enabled) this.manualOrder = this.displayCards().map(card => card.id);
        this.callbacks.onSortChange?.(enabled);
        this.render(this.cards, this.context);
    }

    get selectedCards() {
        return this.selected.map(id => this.cards.find(card => card.id === id)).filter(Boolean);
    }

    clearSelection() {
        if (!this.selected.length) return;
        this.selected = [];
        this.refreshStates();
        this.callbacks.onSelectionChange?.();
    }

    displayCards() {
        if (this.autoSort) return [...this.cards].sort(compareCards);
        const position = new Map(this.manualOrder.map((id, index) => [id, index]));
        // New cards go on the right, in the order they arrived.
        return [...this.cards].sort((a, b) =>
            (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) ||
            this.cards.indexOf(a) - this.cards.indexOf(b));
    }

    /**
     * @param {object[]} cards the hand from the server
     * @param {object} context { myTurn, table, locked }
     * @param {{from?: DOMRect}} options where new cards should fly in from
     */
    render(cards, context, { from } = {}) {
        this.cards = cards;
        this.context = context;

        const ids = new Set(cards.map(card => card.id));
        this.selected = this.selected.filter(id => ids.has(id));
        if (!context.myTurn || context.locked) this.selected = [];
        this.manualOrder = [
            ...this.manualOrder.filter(id => ids.has(id)),
            ...cards.map(card => card.id).filter(id => !this.manualOrder.includes(id))
        ];

        const before = new Map([...this.slots].map(([id, slot]) => [id, slot.getBoundingClientRect()]));
        const ordered = this.displayCards();
        const fresh = [];

        for (const [id, slot] of this.slots) {
            if (!ids.has(id)) {
                slot.remove();
                this.slots.delete(id);
            }
        }

        ordered.forEach((card, index) => {
            let slot = this.slots.get(card.id);
            if (!slot) {
                slot = h('div', { class: 'hand-slot', dataset: { cardId: card.id } }, renderCard(card));
                slot.firstChild.setAttribute('role', 'option');
                slot.firstChild.tabIndex = 0;
                this.slots.set(card.id, slot);
                fresh.push(slot);
            }
            if (this.el.children[index] !== slot) this.el.insertBefore(slot, this.el.children[index] ?? null);
        });

        if (!cards.length) {
            this.el.replaceChildren(h('div', { class: 'hand-empty' }, context.dealing ? 'Dealing…' : 'No cards'));
            this.slots.clear();
        } else {
            this.el.querySelector('.hand-empty')?.remove();
        }

        this.layout();
        this.refreshStates();
        this.animateMoves(before);
        this.animateArrivals(fresh, before.size === 0 && !from ? null : from);
    }

    // ---------------------------------------------------------- layout

    layout() {
        const slots = [...this.el.children].filter(el => el.classList.contains('hand-slot'));
        const n = slots.length;
        if (!n) return;

        const cardWidth = slots[0].offsetWidth;
        const available = this.wrap.clientWidth - cardWidth * 0.5;
        const natural = cardWidth + GAP;
        const squeezed = n > 1 ? (available - cardWidth) / (n - 1) : natural;
        const step = Math.max(cardWidth * 0.3, Math.min(natural, squeezed));
        this.el.style.setProperty('--step', `${step}px`);

        const overlapping = step < natural - 1;
        const mid = (n - 1) / 2;
        const maxAngle = overlapping ? Math.min(3.2, 36 / n) : 0;
        slots.forEach((slot, i) => {
            const offset = i - mid;
            const card = slot.firstChild;
            card.style.setProperty('--rot', `${offset * maxAngle}deg`);
            card.style.setProperty('--arc', `${overlapping ? Math.min(offset * offset * cardWidth * 0.003, cardWidth * 0.1) : 0}px`);
            card.style.zIndex = '';
        });

        // Keep the selection or the right end visible when the hand scrolls.
        if (this.wrap.scrollWidth > this.wrap.clientWidth && !this.drag) {
            this.wrap.classList.add('is-scrollable');
        } else {
            this.wrap.classList.remove('is-scrollable');
        }
    }

    refreshStates() {
        const { myTurn, table, locked } = this.context ?? {};
        const chain = this.selectedCards;
        const handSize = this.cards.length;

        for (const [id, slot] of this.slots) {
            const card = this.cards.find(c => c.id === id);
            const el = slot.firstChild;
            const order = this.selected.indexOf(id);
            const isSelected = order !== -1;

            let playable = false;
            if (myTurn && !locked && card) {
                playable = chain.length
                    ? isSelected || areCardsCompatible([...chain, card])
                    : validatePlay([card], handSize, table) === null;
            }

            el.classList.toggle('is-selected', isSelected);
            el.classList.toggle('is-playable', playable && !isSelected);
            el.classList.toggle('is-dim', Boolean(myTurn) && !playable && !isSelected);
            el.setAttribute('aria-selected', String(isSelected));

            let badge = el.querySelector('.select-order');
            if (isSelected && this.selected.length > 1) {
                badge ??= el.appendChild(h('span', { class: 'select-order', 'aria-hidden': 'true' }));
                badge.textContent = order + 1;
            } else {
                badge?.remove();
            }
        }
    }

    animateMoves(before) {
        for (const [id, slot] of this.slots) {
            const old = before.get(id);
            if (!old) continue;
            const now = slot.getBoundingClientRect();
            const dx = old.left - now.left;
            const dy = old.top - now.top;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
            slot.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
            );
        }
    }

    animateArrivals(slots, from) {
        slots.forEach((slot, i) => {
            const card = slot.firstChild;
            if (!from) {
                card.classList.add('is-new');
                card.addEventListener('animationend', () => card.classList.remove('is-new'), { once: true });
                return;
            }
            card.style.visibility = 'hidden';
            const target = slot.getBoundingClientRect();
            const delay = i * 90;
            const ghost = renderCardBack();
            fly(ghost, from, target, { duration: 460, delay, rotate: -12 })
                .then(() => { card.style.visibility = ''; });
        });
    }

    // ------------------------------------------------------- selection

    onClick(event) {
        if (this.suppressClick) {
            this.suppressClick = false;
            return;
        }
        const slot = event.target.closest('.hand-slot');
        if (!slot) return;
        const id = Number(slot.dataset.cardId);
        const now = performance.now();
        const isDoubleTap = this.lastTap.id === id && now - this.lastTap.at < DOUBLE_TAP_MS;
        this.lastTap = { id, at: now };

        if (isDoubleTap && this.selected.includes(id)) {
            this.callbacks.onPlayRequest?.();
            return;
        }
        this.toggle(id);
    }

    toggle(id) {
        const { myTurn, table, locked } = this.context ?? {};
        const card = this.cards.find(c => c.id === id);
        if (!card) return;

        if (!myTurn || locked) {
            this.callbacks.onInvalid?.(myTurn ? 'Hang on…' : 'Wait for your turn.', this.slots.get(id));
            return;
        }

        if (this.selected.includes(id)) {
            this.selected = this.selected.filter(x => x !== id);
            const first = this.selectedCards[0];
            if (first && validatePlay([first], this.cards.length, table) !== null) this.selected = [];
        } else {
            const chain = this.selectedCards;
            if (chain.length && areCardsCompatible([...chain, card])) {
                this.selected.push(id);
            } else {
                const reason = validatePlay([card], this.cards.length, table);
                if (reason) {
                    this.callbacks.onInvalid?.(reason, this.slots.get(id));
                    return;
                }
                this.selected = [id];
            }
        }

        this.refreshStates();
        this.callbacks.onSelectionChange?.();
    }

    onKeyDown(event) {
        const slot = event.target.closest('.hand-slot');
        if (!slot) return;
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            this.toggle(Number(slot.dataset.cardId));
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const sibling = event.key === 'ArrowLeft' ? slot.previousElementSibling : slot.nextElementSibling;
            sibling?.firstChild.focus();
        }
    }

    // --------------------------------------------------------- reorder

    onPointerDown(event) {
        const slot = event.target.closest('.hand-slot');
        if (!slot || event.button > 0) return;
        const hold = HOLD_MS[event.pointerType] ?? HOLD_MS.mouse;
        this.drag = {
            id: Number(slot.dataset.cardId),
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            timer: setTimeout(() => this.startDrag(slot, event.pointerId), hold)
        };
    }

    startDrag(slot, pointerId) {
        if (!this.drag || this.cards.length < 2) return;
        if (this.autoSort) {
            this.manualOrder = this.displayCards().map(card => card.id);
            this.autoSort = false;
            prefs.set('autoSort', false);
            this.callbacks.onSortChange?.(false);
        }
        this.drag.active = true;
        slot.setPointerCapture?.(pointerId);
        slot.firstChild.classList.add('is-dragging');
        this.el.classList.add('is-reordering');
        navigator.vibrate?.(12);
    }

    onPointerMove(event) {
        const drag = this.drag;
        if (!drag || drag.pointerId !== event.pointerId) return;

        if (!drag.active) {
            if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > MOVE_TOLERANCE) this.cancelDrag();
            return;
        }

        event.preventDefault();
        const others = [...this.slots.values()].filter(slot => Number(slot.dataset.cardId) !== drag.id);
        const ordered = others.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        let target = ordered.findIndex(slot => {
            const rect = slot.getBoundingClientRect();
            return event.clientX < rect.left + rect.width / 2;
        });
        if (target === -1) target = ordered.length;

        const order = this.displayCards().map(card => card.id).filter(id => id !== drag.id);
        order.splice(target, 0, drag.id);
        if (order.join() !== this.manualOrder.join()) {
            this.manualOrder = order;
            this.render(this.cards, this.context);
            this.slots.get(drag.id)?.firstChild.classList.add('is-dragging');
        }
    }

    onPointerUp(event) {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        if (this.drag.active) this.suppressClick = true;
        this.cancelDrag();
    }

    cancelDrag() {
        if (!this.drag) return;
        clearTimeout(this.drag.timer);
        this.slots.get(this.drag.id)?.firstChild.classList.remove('is-dragging');
        this.el.classList.remove('is-reordering');
        this.drag = null;
    }

    // ---------------------------------------------------------- queries

    rectOf(cardId) {
        return this.slots.get(cardId)?.firstChild.getBoundingClientRect() ?? null;
    }

    hide(cardIds) {
        for (const id of cardIds) {
            const card = this.slots.get(id)?.firstChild;
            if (card) card.style.visibility = 'hidden';
        }
    }
}
