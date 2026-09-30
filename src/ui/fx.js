import { h } from '../lib/dom.js';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animate a detached element from one rect to another, then remove it.
 * Resolves when the flight lands.
 */
export function fly(el, from, to, { duration = 480, delay = 0, rotate = 0, fromScale, fade = false } = {}) {
    if (!from || !to || reducedMotion()) return Promise.resolve();

    el.classList.add('fly-card');
    el.style.setProperty('--card-w', `${to.width}px`);
    document.body.append(el);

    const startScale = fromScale ?? from.width / to.width;
    const start = `translate(${from.left}px, ${from.top}px) scale(${startScale}) rotate(${rotate}deg)`;
    const end = `translate(${to.left}px, ${to.top}px) scale(1) rotate(0deg)`;

    el.style.transformOrigin = '0 0';
    el.style.transform = start;
    el.style.opacity = delay ? '0' : '1';

    const animation = el.animate(
        [
            { transform: start, opacity: 1 },
            { transform: end, opacity: fade ? 0 : 1 }
        ],
        { duration, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
    );

    return animation.finished.catch(() => {}).finally(() => el.remove());
}

export function unoBurst() {
    if (reducedMotion()) return;
    const el = h('div', { class: 'uno-burst', 'aria-hidden': 'true' }, h('span', {}, 'UNO!'));
    document.body.append(el);
    setTimeout(() => el.remove(), 1200);
}

export function confetti(count = 90, container = document.body) {
    if (reducedMotion()) return;
    const colors = ['#e5383b', '#fcc419', '#2fb344', '#1c7ed6', '#ffffff'];
    for (let i = 0; i < count; i++) {
        const piece = h('div', {
            class: 'confetti',
            style: {
                left: `${Math.random() * 100}vw`,
                background: colors[i % colors.length],
                '--fall': `${2.2 + Math.random() * 2}s`,
                '--drift': `${(Math.random() - 0.5) * 240}px`,
                '--spin': `${360 + Math.random() * 1080}deg`,
                'animation-delay': `${Math.random() * 0.6}s`,
                width: `${6 + Math.random() * 6}px`
            }
        });
        container.append(piece);
        setTimeout(() => piece.remove(), 5000);
    }
}

export function pulse(el, className, duration = 520) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), duration);
}
