import { COLORS, CARD_TYPES, areCardsCompatible, cardLabel, validatePlay } from '../../shared/rules.js';
import { h } from '../lib/dom.js';
import { prefs } from '../lib/storage.js';
import { renderCard, renderCardBack } from './cards.js';
import { fly } from './fx.js';

const HOLD_MS = { mouse: 220, touch: 380, pen: 300 };
const MOVE_TOLERANCE = 8;
const DOUBLE_TAP_MS = 320;
const GAP = 8;
// Fraction of a card's width left showing: below COMFORT a new row starts; MIN is the tightest before scrolling.
const COMFORT_STEP = 0.5;
const MIN_STEP = 0.3;
// How far each extra row sits below the one behind it, as a fraction of card height.
const ROW_OVERLAP = 0.42;
// Tilt of the outermost cards; at ~8° their corners stay inside the hand's side padding.
const MAX_FAN_DEG = 8;
// Most of the window height a multi-row hand may take before its cards shrink.
const HAND_HEIGHT_SHARE = 0.3;

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
    constructor(el, { staging, onSelectionChange, onPlayRequest, onInvalid, onSortChange }) {
        this.el = el;
        this.wrap = el.parentElement;
        this.staging = staging;
        this.staged = new Map();
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
        // Row count depends on window height, which doesn't always change the wrap's size.
        window.addEventListener('resize', () => this.layout());
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
        const slots = [...this.el.children].filter(el => el.classList.contains('hand-slot') && !el.classList.contains('is-staged'));
        const n = slots.length;
        if (!n) {
            this.el.style.width = this.el.style.height = '';
            this.wrap.classList.remove('is-scrollable');
            return;
        }

        // Measure the natural card size (without any shrink from a previous layout).
        this.el.style.removeProperty('--hand-card-w');
        const baseW = slots[0].offsetWidth;
        const aspect = (slots[0].offsetHeight || baseW * 1.5) / baseW;
        const padFor = w => w * 0.25;
        const availableFor = w => this.wrap.clientWidth - padFor(w) * 2;
        const stepFor = (count, w) => (count > 1 ? (availableFor(w) - w) / (count - 1) : w + GAP);

        // Add rows while cards would show less than COMFORT_STEP of their width.
        const maxRows = this.maxRows();
        let rows = 1;
        while (rows < maxRows && rows < n && stepFor(Math.ceil(n / rows), baseW) < baseW * COMFORT_STEP) rows++;

        // Stacked rows mustn't crowd out the table: shrink the cards to fit the height budget.
        const heightFor = w => w * aspect * (1 + (rows - 1) * ROW_OVERLAP) + w * 0.16;
        const singleRow = baseW * aspect + baseW * 0.16;
        const budget = Math.max(singleRow, window.innerHeight * HAND_HEIGHT_SHARE);
        const cardW = rows > 1 ? Math.min(baseW, budget / heightFor(1)) : baseW;
        if (cardW < baseW) this.el.style.setProperty('--hand-card-w', `${cardW}px`);
        const cardH = cardW * aspect;
        const pad = padFor(cardW);
        const available = availableFor(cardW);
        const natural = cardW + GAP;

        // Split evenly; back rows take any extra card.
        const sizes = Array.from({ length: rows }, (_, r) => Math.floor(n / rows) + (r < n % rows ? 1 : 0));
        const rowGap = cardH * ROW_OVERLAP;
        const steps = sizes.map(size => Math.max(cardW * MIN_STEP, Math.min(natural, stepFor(size, cardW))));
        const rowWidths = sizes.map((size, r) => cardW + (size - 1) * steps[r]);
        const inner = Math.max(available, ...rowWidths);

        let i = 0;
        sizes.forEach((size, r) => {
            const step = steps[r];
            const left = pad + (inner - rowWidths[r]) / 2;
            const overlapping = step < natural - 1;
            const mid = (size - 1) / 2;
            // Stacked rows fan less so the back row's corners stay readable, and the end
            // cards never tilt further than the side padding can hold.
            const maxAngle = overlapping && mid > 0 ? Math.min(rows > 1 ? 1.6 : 3.2, MAX_FAN_DEG / mid) : 0;
            for (let k = 0; k < size; k++, i++) {
                const offset = k - mid;
                const slot = slots[i];
                slot.dataset.row = r;
                slot.style.setProperty('--x', `${left + k * step}px`);
                slot.style.setProperty('--y', `${r * rowGap}px`);
                slot.firstChild.style.setProperty('--rot', `${offset * maxAngle}deg`);
                slot.firstChild.style.setProperty('--arc', `${overlapping && rows === 1 ? Math.min(offset * offset * cardW * 0.003, cardW * 0.1) : 0}px`);
            }
        });

        this.rowGap = rowGap;
        this.el.classList.toggle('is-stacked', rows > 1);
        this.el.style.width = `${inner + pad * 2}px`;
        this.el.style.height = `${cardH + (rows - 1) * rowGap + cardW * 0.16}px`;
        this.wrap.classList.toggle('is-scrollable', this.wrap.scrollWidth > this.wrap.clientWidth && !this.drag);
    }

    /** How many stacked rows the screen has height for. */
    maxRows() {
        const height = window.innerHeight;
        if (height < 520) return 1;
        return height < 900 ? 2 : 3;
    }

    refreshStates() {
        const { myTurn, table, locked } = this.context ?? {};
        const chain = this.selectedCards;
        const handSize = this.cards.length;
        // Where every card sits before anything moves between the hand and the tray.
        const before = new Map([...this.slots].map(([id, slot]) => [id, slot.firstChild.getBoundingClientRect()]));
        let stagingChanged = false;

        for (const [id, slot] of this.slots) {
            const card = this.cards.find(c => c.id === id);
            const el = slot.firstChild;
            const isSelected = this.selected.includes(id);

            let playable = false;
            if (myTurn && !locked && card) {
                playable = chain.length
                    ? isSelected || areCardsCompatible([...chain, card])
                    : validatePlay([card], handSize, table) === null;
            }

            if (slot.classList.contains('is-staged') !== isSelected) {
                slot.classList.toggle('is-staged', isSelected);
                stagingChanged = true;
            }
            el.classList.toggle('is-selected', isSelected);
            el.classList.toggle('is-playable', playable && !isSelected);
            el.classList.toggle('is-dim', Boolean(myTurn) && !playable && !isSelected);
            el.setAttribute('aria-selected', String(isSelected));
        }

        if (stagingChanged) {
            this.layout();
            // Only slide cards that were visible before; a card coming back from the tray had no
            // position in the hand (it measures as 0,0) and flies in from the tray instead.
            this.animateMoves(new Map([...before].filter(([, rect]) => rect.width > 0)));
        }
        this.renderStaging(before);
    }

    // -------------------------------------------------------- staging

    /**
     * Selected cards lift out of the hand into a tray above it, in play order,
     * so they're fully visible and never cover the rest of the hand.
     */
    renderStaging(handRects = new Map()) {
        if (!this.staging) return;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        const before = new Map([...this.staged].map(([id, el]) => [id, el.getBoundingClientRect()]));

        for (const [id, el] of this.staged) {
            if (this.selected.includes(id)) continue;
            this.staged.delete(id);
            this.unstage(el, id, reduced);
        }

        const count = this.selected.length;
        this.selected.forEach((id, index) => {
            let el = this.staged.get(id);
            if (!el) {
                const card = this.cards.find(c => c.id === id);
                el = h('button', {
                    class: 'staged',
                    type: 'button',
                    'aria-label': `${cardLabel(card)}, tap to put back`,
                    onclick: () => this.toggle(id)
                }, renderCard(card), h('span', { class: 'staged-order', 'aria-hidden': 'true' }));
                this.staged.set(id, el);
            }
            el.style.setProperty('--rot', `${(index - (count - 1) / 2) * Math.min(5, 14 / count)}deg`);
            el.querySelector('.staged-order').textContent = count > 1 ? index + 1 : '';
            if (this.staging.children[index] !== el) this.staging.insertBefore(el, this.staging.children[index] ?? null);
        });

        this.staging.classList.toggle('is-open', count > 0);
        this.staging.classList.toggle('is-crowded', count > 3);
        if (reduced) return;

        for (const [id, el] of this.staged) {
            const now = el.getBoundingClientRect();
            const from = before.get(id) ?? handRects.get(id);
            if (!from) continue;
            const dx = from.left - now.left;
            const dy = from.top - now.top;
            const scale = from.width / now.width;
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(scale - 1) < 0.01) continue;
            el.animate(
                [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }],
                { duration: before.has(id) ? 260 : 380, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' }
            );
        }
    }

    /** Send a deselected card back down into its place in the hand. */
    unstage(el, id, reduced) {
        const card = this.slots.get(id)?.firstChild;
        const to = card?.getBoundingClientRect();
        const from = el.getBoundingClientRect();
        if (reduced || !to || el.style.visibility === 'hidden') {
            el.remove();
            return;
        }
        // Take it out of the tray's flow so the remaining cards close up straight away.
        el.style.setProperty('--stage-w', `${el.firstChild.offsetWidth}px`);
        Object.assign(el.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, margin: '0', rotate: '0deg', transformOrigin: '0 0' });
        document.body.append(el);
        el.classList.add('is-leaving');
        card.style.visibility = 'hidden';
        el.animate(
            [{ transform: 'none' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})` }],
            { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        ).finished.catch(() => {}).finally(() => {
            el.remove();
            card.style.visibility = '';
        });
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
        // Work out which row the pointer is over, then where in that row it falls.
        const others = this.displayCards().filter(card => card.id !== drag.id).map(card => this.slots.get(card.id)).filter(slot => !slot.classList.contains('is-staged'));
        const top = this.el.getBoundingClientRect().top;
        const rowCount = Math.max(...others.map(slot => Number(slot.dataset.row) || 0)) + 1;
        const pointerRow = Math.min(rowCount - 1, Math.max(0, Math.floor((event.clientY - top) / (this.rowGap || Infinity))));
        const inRow = others.filter(slot => Number(slot.dataset.row || 0) === pointerRow);
        const before = inRow.find(slot => {
            const rect = slot.getBoundingClientRect();
            return event.clientX < rect.left + rect.width / 2;
        });
        let target = before ? others.indexOf(before) : others.indexOf(inRow.at(-1)) + 1;
        if (!inRow.length) target = others.length;

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

    /** Where a card is on screen: in the tray if it's staged, otherwise in the hand. */
    rectOf(cardId) {
        const staged = this.staged.get(cardId);
        if (staged?.isConnected) return staged.firstChild.getBoundingClientRect();
        return this.slots.get(cardId)?.firstChild.getBoundingClientRect() ?? null;
    }

    hide(cardIds) {
        for (const id of cardIds) {
            const card = this.slots.get(id)?.firstChild;
            if (card) card.style.visibility = 'hidden';
            const staged = this.staged.get(id);
            if (staged) staged.style.visibility = 'hidden';
        }
    }
}
